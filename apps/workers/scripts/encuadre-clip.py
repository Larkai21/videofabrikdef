#!/usr/bin/env python3
"""Plan de encuadre POR PLANO para un clip de episodio (Apple Silicon, local).

Un foco fijo no vale para multicámara: el que habla cambia de lado con cada
corte de realización — medido en el primer clip real, que encuadró al único
que no hablaba. Esto trocea la ventana por CAMBIOS DE PLANO (ffmpeg scene
detection) y pone la x del recorte en la cara más grande de cada plano
(framework Vision de macOS, receta del proyecto hermano editor-youtube:
rápido, sin descargas, y es un detector de verdad).

El plan se calcula AL PROPONER y se congela (principio 6: ni un píxel se
analiza durante el render): el pre-corte lo hornea en el fichero del clip.

Salida (stdout):
    {"tramos": [{"from_ms": 0, "to_ms": 4200, "x": 0.31,
                 "kf": [{"t_ms": 150, "x": 0.31}, ...]}, ...]}
    x = null si en ese plano no se ve ninguna cara. kf (opcional, >=2
    muestras del hablante, reloj de la VENTANA) es la serie cruda para el
    tracking continuo: el worker la suaviza con zona muerta — aquí solo se
    MIDE, la política de movimiento vive en un solo sitio.

Uso:
    python3 encuadre-clip.py --input episode.mp4 --from 295.2 --to 354.1
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

FFMPEG = os.environ.get("FFMPEG_BIN", "ffmpeg")
ESCENA_UMBRAL = 0.30
TRAMO_MIN_MS = 700


def detectar_cortes(video: str, desde: float, dur: float) -> list[float]:
    """Instantes (s, relativos a la ventana) donde cambia el plano."""
    r = subprocess.run(
        [FFMPEG, "-nostdin", "-ss", f"{desde:.3f}", "-t", f"{dur:.3f}",
         "-i", video, "-vf", f"select='gt(scene,{ESCENA_UMBRAL})',showinfo",
         "-f", "null", "-"],
        capture_output=True, text=True)
    cortes = []
    for m in re.finditer(r"pts_time:([\d.]+)", r.stderr):
        t = float(m.group(1))
        if 0.2 < t < dur - 0.2:
            cortes.append(round(t, 3))
    return sorted(set(cortes))


def extraer_frame(video: str, t_abs: float, destino: str) -> bool:
    r = subprocess.run(
        [FFMPEG, "-nostdin", "-loglevel", "error", "-ss", f"{t_abs:.3f}",
         "-i", video, "-frames:v", "1", "-q:v", "4", "-y", destino],
        capture_output=True, text=True)
    return r.returncode == 0 and os.path.exists(destino)


def caras(ruta: str) -> list[dict]:
    """Caras del fotograma con centro x, área y APERTURA de boca (landmarks).

    La apertura es la clave: la cara más grande no es la que habla —el primer
    clip real encuadró al oyente— pero la que MUEVE los labios entre dos
    fotogramas separados 300 ms, sí.
    """
    try:
        import Quartz
        import Vision
    except ImportError:
        return []
    try:
        url = Quartz.CFURLCreateFromFileSystemRepresentation(
            None, ruta.encode("utf-8"), len(ruta.encode("utf-8")), False)
        src = Quartz.CGImageSourceCreateWithURL(url, None)
        if src is None:
            return []
        img = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
        peticion = Vision.VNDetectFaceLandmarksRequest.alloc().init()
        manejador = Vision.VNImageRequestHandler.alloc() \
            .initWithCGImage_options_(img, None)
        ok, _ = manejador.performRequests_error_([peticion], None)
        obs = peticion.results() or []
        if not ok:
            return []
        salida = []
        for o in obs:
            bb = o.boundingBox()
            cx = float(bb.origin.x) + float(bb.size.width) / 2
            area = float(bb.size.width) * float(bb.size.height)
            apertura = None
            try:
                labios = o.landmarks().innerLips()
                n = labios.pointCount()
                ys = []
                pts = labios.normalizedPoints()
                for i in range(n):
                    ys.append(float(pts[i].y))
                if ys:
                    # normalizada por la ALTURA de la cara: comparable entre
                    # fotogramas aunque el encuadre respire
                    apertura = (max(ys) - min(ys))
            except Exception:
                apertura = None
            salida.append({
                "cx": round(min(1.0, max(0.0, cx)), 4),
                "area": area,
                "apertura": apertura,
            })
        return salida
    except Exception:
        return []


def ganador_en(video: str, t_abs: float, tope_abs: float, tmp: str, clave: str) -> float | None:
    """x del hablante en UN instante: par de fotogramas a 300 ms, gana la cara
    con más variación de apertura de boca; sin señal comparable, la más
    grande. None si no se ve ninguna cara."""
    par = []
    for k, dt in enumerate((0.0, 0.3)):
        frame = os.path.join(tmp, f"{clave}-{k}.jpg")
        if extraer_frame(video, min(t_abs + dt, tope_abs - 0.05), frame):
            par.append(caras(frame))
    if len(par) != 2:
        return None
    grupos: list[dict] = []

    def grupo_de(cx: float) -> dict:
        for g in grupos:
            if abs(g["cx"] - cx) < 0.08:
                return g
        g = {"cx": cx, "areas": [], "aperturas": []}
        grupos.append(g)
        return g

    for antes, despues in [(a, b) for a in par[0] for b in par[1]
                           if abs(a["cx"] - b["cx"]) < 0.08]:
        g = grupo_de(antes["cx"])
        g["areas"].append(antes["area"])
        if antes["apertura"] is not None and despues["apertura"] is not None:
            g["aperturas"].append(abs(antes["apertura"] - despues["apertura"]))
    if not grupos:
        return None
    con_boca = [g for g in grupos if g["aperturas"]]
    if len(con_boca) >= 2:
        mejor = max(con_boca, key=lambda g: sum(g["aperturas"]) / len(g["aperturas"]))
        return round(mejor["cx"], 4)
    mejor = max(grupos, key=lambda g: max(g["areas"]) if g["areas"] else 0)
    return round(mejor["cx"], 4)


PASO_HABLANTE_S = 1.2

def tramos_de_hablante(video: str, t0_abs: float, t1_abs: float,
                       tmp: str, clave: str) -> list[dict]:
    """Sub-tramos del plano por CAMBIO DE HABLANTE (reloj relativo al plano).

    En una entrevista a dos, el mismo plano de cámara alterna quién habla: se
    muestrea el ganador de labios cada ~1,2 s y se abre tramo nuevo cuando el
    ganador cambia de posición (>0,08) y el siguiente muestreo lo CONFIRMA —
    sin confirmación, un falso positivo de labios movería el encuadre a mitad
    de frase.
    """
    dur = t1_abs - t0_abs
    puntos = []  # (t_rel, x|None)
    t = 0.15
    j = 0
    while t < max(0.16, dur - 0.35):
        puntos.append((t, ganador_en(video, t0_abs + t, t1_abs, tmp, f"{clave}-{j}")))
        t += PASO_HABLANTE_S
        j += 1
    if not puntos:
        return [{"from_ms": 0, "to_ms": round(dur * 1000), "x": None}]

    tramos = []
    ini = 0.0
    x_actual = next((x for _, x in puntos if x is not None), None)
    seg_kf: list[dict] = []  # muestras del HABLANTE del tramo en curso

    def cerrar(hasta_s: float) -> None:
        t = {"from_ms": round(ini * 1000), "to_ms": round(hasta_s * 1000), "x": x_actual}
        # la serie completa viaja como keyframes: el tracking continuo del
        # worker la suaviza; con <2 muestras no hay paneo que valga
        if len(seg_kf) >= 2:
            t["kf"] = list(seg_kf)
        tramos.append(t)

    i = 0
    while i < len(puntos):
        t_rel, x = puntos[i]
        cambia = x is not None and x_actual is not None and abs(x - x_actual) > 0.08
        confirmada = False
        if cambia:
            sig = puntos[i + 1] if i + 1 < len(puntos) else None
            confirmada = sig is None or (sig[1] is not None and abs(sig[1] - x) <= 0.08)
        if cambia and confirmada:
            cerrar(t_rel)
            ini = t_rel
            x_actual = x
            seg_kf = []
        elif x is not None and x_actual is None:
            x_actual = x
        # solo las muestras del hablante actual: la cara del OTRO no debe
        # tirar del paneo (el cambio de hablante ya abre tramo nuevo)
        if x is not None and x_actual is not None and abs(x - x_actual) <= 0.08:
            seg_kf.append({"t_ms": round(t_rel * 1000), "x": x})
        i += 1
    cerrar(dur)
    return [t for t in tramos if t["to_ms"] - t["from_ms"] >= TRAMO_MIN_MS or len(tramos) == 1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--from", dest="desde", type=float, required=True)
    ap.add_argument("--to", dest="hasta", type=float, required=True)
    args = ap.parse_args()

    dur = args.hasta - args.desde
    cortes = detectar_cortes(args.input, args.desde, dur)
    bordes = [0.0, *cortes, dur]

    tramos = []
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(len(bordes) - 1):
            ini, fin = bordes[i], bordes[i + 1]
            if (fin - ini) * 1000 < TRAMO_MIN_MS and tramos:
                # un plano de <0,7 s no merece salto de encuadre: se funde
                tramos[-1]["to_ms"] = round(fin * 1000)
                continue
            # dentro del plano, sub-tramos por cambio de HABLANTE (el caso a
            # dos personas: mismo plano, turnos alternos)
            for sub in tramos_de_hablante(args.input, args.desde + ini,
                                          args.desde + fin, tmp, f"p{i}"):
                t = {"from_ms": round(ini * 1000) + sub["from_ms"],
                     "to_ms": round(ini * 1000) + sub["to_ms"],
                     "x": sub["x"]}
                if "kf" in sub:
                    # mismo desplazamiento que el tramo: todo al reloj de la VENTANA
                    t["kf"] = [{"t_ms": round(ini * 1000) + k["t_ms"], "x": k["x"]}
                               for k in sub["kf"]]
                tramos.append(t)

    json.dump({"tramos": tramos}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
