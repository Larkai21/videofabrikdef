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
    {"tramos": [{"from_ms": 0, "to_ms": 4200, "x": 0.31}, ...]}
    x = null si en ese plano no se ve ninguna cara.

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


def hablante_x(video: str, t0_abs: float, t1_abs: float, tmp: str, clave: str) -> float | None:
    """x del HABLANTE del plano: la cara con más varianza de apertura de boca
    entre muestras; sin landmarks o con una sola cara, la más grande."""
    dur = t1_abs - t0_abs
    instantes = [t0_abs + dur * f for f in (0.3, 0.55, 0.8)]
    muestras = []  # lista de listas de caras
    for j, t in enumerate(instantes):
        # dos fotogramas a 300 ms: la boca del que habla cambia entre ellos
        par = []
        for k, dt in enumerate((0.0, 0.3)):
            frame = os.path.join(tmp, f"{clave}-{j}-{k}.jpg")
            if extraer_frame(video, min(t + dt, t1_abs - 0.05), frame):
                par.append(caras(frame))
        if len(par) == 2:
            muestras.append(par)
    if not muestras:
        return None

    # agrupar caras por posición (cx ± 0.08) y acumular su señal
    grupos: list[dict] = []

    def grupo_de(cx: float) -> dict:
        for g in grupos:
            if abs(g["cx"] - cx) < 0.08:
                return g
        g = {"cx": cx, "areas": [], "aperturas": []}
        grupos.append(g)
        return g

    for par in muestras:
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
        # el que habla mueve la boca: máxima variación media de apertura
        mejor = max(con_boca, key=lambda g: sum(g["aperturas"]) / len(g["aperturas"]))
        return round(mejor["cx"], 4)
    # sin señal de labios comparable: la cara más grande (lo de antes)
    mejor = max(grupos, key=lambda g: max(g["areas"]) if g["areas"] else 0)
    return round(mejor["cx"], 4)


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
            x = hablante_x(args.input, args.desde + ini, args.desde + fin,
                           tmp, f"p{i}")
            tramos.append({"from_ms": round(ini * 1000),
                           "to_ms": round(fin * 1000), "x": x})

    json.dump({"tramos": tramos}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
