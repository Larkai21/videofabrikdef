#!/usr/bin/env python3
"""Detección local de rostro para posicionar la UI sin taparle la cara.

Muestrea 1 frame por segundo y devuelve, por cada muestra, la caja del
rostro en coordenadas RELATIVAS (0-1) y qué tercio queda libre.

Tres motores, en orden de preferencia. Se degrada solo, nunca revienta:

  1. vision   Framework Vision de macOS (PyObjC). Rápido, sin descargas,
              y es un detector de caras de verdad.
  2. ollama   Modelo multimodal local (qwen2-vl / llava). Lo que pide la
              spec. Requiere `ollama serve` y haber hecho `ollama pull`.
  3. estatico Sin detector: asume busto parlante centrado y deja libre el
              tercio inferior. Es lo que hace el 90% de los vídeos, pero
              queda marcado en la salida como no verificado.

Salida: build/face.json

    {
      "engine": "vision",
      "reloj": "origen",
      "samples": [{"t": 0.0, "bbox": [x0,y0,x1,y1], "safe": "bottom"}, ...],
      "zones":   [{"t0": 0.0, "t1": 7.0, "safe": "bottom", "y_ui": 0.71,
                   "y0": 0.293, "y1": 0.658}, ...]
    }

Todo va en reloj de ORIGEN: los frames se muestrean sobre el vídeo fuente,
así que `samples[].t` y `zones[].t0/t1` cuentan ese reloj y el JSON lo
declara. Quien consulte una zona con un instante del reloj de SALIDA tiene
que pasarlo antes por el mapa inverso de `keep` — con una única zona global
la confusión no se notaba; con zonas por ventana sí.

`zones` es UNA POR VENTANA DE ENCUADRE, no una media de toda la pieza. La
versión anterior emitía una sola zona 0..50 con y_ui 0.72 mientras el
encuadre cambiaba tres veces: en t=7..20 la cara bajaba hasta 0.765 de la
altura —el 0.72 la PISABA— y en t=21..40 acababa en 0.597 y quedaba un 12%
de altura desperdiciado. Un promedio que no existe en ningún fotograma.

Uso:
    python3 scripts/detect_face_bbox.py --input input.mp4
    python3 scripts/detect_face_bbox.py --input input.mp4 --engine ollama
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import comun
from comun import exige_ffmpeg

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = comun.build_dir()   # `EDITOR_BUILD` lo redirige
# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
FFMPEG = comun.FFMPEG
FFPROBE = comun.FFPROBE

# Dónde puede vivir la UI, en fracción de altura, según dónde esté la cara.
# Son los valores del motor `estatico` (sin detector no hay nada que medir)
# y los topes de seguridad; con detector, el y_ui de cada zona se DERIVA del
# borde real del rostro en ESA ventana — ver `ventanas()`.
Y_INFERIOR = 0.72
Y_SUPERIOR = 0.16

# Cuándo un movimiento del bbox es un reencuadre y no temblor del detector.
# Medido sobre los 50 samples de aroll_codex.mp4 (centro vertical contra la
# mediana de la ventana en curso): el temblor dentro de un mismo encuadre
# llega como mucho a 0.055 (p95 = 0.046) y los tres reencuadres reales
# saltan 0.086, 0.161 y 0.107. El 0.08 cae entre las dos poblaciones:
# con 0.05 sale un corte espurio (un 0.051, temblor) y con 0.10 se traga
# el reencuadre de 0.086. Resultado en esa pieza: 4 ventanas, no 50.
UMBRAL_REENCUADRE = 0.08

# Aire entre el borde del rostro y donde arranca la UI, y altura típica de
# un bloque de subtítulos (380 px sobre 1920, lo que pide render_playwright
# en `yLibre(face, t, 380)`). Sirven para derivar y_ui por ventana.
MARGEN_UI = 0.05
ALTO_UI_TIPICO = 0.20


# ---------------------------------------------------------------------------
#  muestreo de frames
# ---------------------------------------------------------------------------

def duracion(ruta: str) -> float:
    try:
        r = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", ruta],
            capture_output=True, text=True, check=True)
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def muestrear(video: str, carpeta: str, cada: float, ancho: int = 480) -> list[str]:
    """1 frame cada `cada` segundos, reescalado: no hace falta resolución
    completa para localizar una cara y así la inferencia vuela."""
    patron = os.path.join(carpeta, "f%05d.jpg")
    r = subprocess.run(
        [FFMPEG, "-nostdin", "-y", "-loglevel", "error", "-i", video,
         "-vf", "fps=%.6f,scale=%d:-2" % (1.0 / cada, ancho),
         "-q:v", "4", patron],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg no pudo extraer frames:\n" + r.stderr.strip())
    return sorted(os.path.join(carpeta, n) for n in os.listdir(carpeta)
                  if n.endswith(".jpg"))


# ---------------------------------------------------------------------------
#  motor 1: Vision de macOS
# ---------------------------------------------------------------------------

def motor_vision(rutas: list[str]) -> list[list[float] | None] | None:
    try:
        import Quartz
        import Vision
    except ImportError:
        return None

    salidas = []
    for ruta in rutas:
        try:
            url = Quartz.CFURLCreateFromFileSystemRepresentation(
                None, ruta.encode("utf-8"), len(ruta.encode("utf-8")), False)
            src = Quartz.CGImageSourceCreateWithURL(url, None)
            if src is None:
                salidas.append(None)
                continue
            img = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
            peticion = Vision.VNDetectFaceRectanglesRequest.alloc().init()
            manejador = Vision.VNImageRequestHandler.alloc() \
                .initWithCGImage_options_(img, None)
            ok, _ = manejador.performRequests_error_([peticion], None)
            obs = peticion.results() or []
            if not ok or not obs:
                salidas.append(None)
                continue
            # la mayor: si hay varias caras nos interesa la del presentador
            mejor = max(obs, key=lambda o: o.boundingBox().size.width *
                                           o.boundingBox().size.height)
            bb = mejor.boundingBox()
            # Vision usa origen abajo-izquierda; lo pasamos a arriba-izquierda
            x0 = float(bb.origin.x)
            y0 = 1.0 - float(bb.origin.y) - float(bb.size.height)
            # Recortado al cuadro. Vision devuelve la caja de la CARA ESTIMADA,
            # no de los píxeles que ve: con el presentador pegado al borde
            # izquierdo la extrapola fuera del fotograma y sale x0 = −0.0356.
            # El contrato dice [0,1] y todo lo que lo consume —`colocar.py` al
            # medir bandas libres, el recorte de cámara— cuenta con eso; una
            # coordenada negativa ensancha la zona del rostro hacia un lado
            # que no existe y estrecha la banda libre del otro.
            caja = [x0, y0, x0 + float(bb.size.width),
                    y0 + float(bb.size.height)]
            salidas.append([round(min(1.0, max(0.0, v)), 4) for v in caja])
        except Exception:
            salidas.append(None)
    return salidas


# ---------------------------------------------------------------------------
#  motor 2: Ollama multimodal
# ---------------------------------------------------------------------------

PROMPT_VISION = (
    "Look at this image. If there is a human face, answer ONLY with a JSON "
    "object with the normalised bounding box of the largest face, using "
    "coordinates from 0 to 1 with the origin at the top-left corner: "
    '{"x0":0.0,"y0":0.0,"x1":0.0,"y1":0.0}. '
    'If there is no face, answer exactly {"face":false}. No prose.'
)


def ollama_vivo() -> bool:
    try:
        import urllib.request
        with urllib.request.urlopen("http://127.0.0.1:11434/api/tags",
                                    timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def motor_ollama(rutas: list[str], modelo: str) -> list[list[float] | None] | None:
    if not shutil.which("ollama") or not ollama_vivo():
        return None
    import urllib.error
    import urllib.request

    salidas = []
    for ruta in rutas:
        with open(ruta, "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        cuerpo = json.dumps({
            "model": modelo,
            "prompt": PROMPT_VISION,
            "images": [b64],
            "stream": False,
            "options": {"temperature": 0},
        }).encode("utf-8")
        try:
            req = urllib.request.Request(
                "http://127.0.0.1:11434/api/generate", data=cuerpo,
                headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as r:
                resp = json.loads(r.read().decode("utf-8"))
            texto = resp.get("response", "")
            m = re.search(r"\{[^{}]*\}", texto)
            if not m:
                salidas.append(None)
                continue
            d = json.loads(m.group(0))
            if d.get("face") is False or "x0" not in d:
                salidas.append(None)
                continue
            salidas.append([round(float(d["x0"]), 4), round(float(d["y0"]), 4),
                            round(float(d["x1"]), 4), round(float(d["y1"]), 4)])
        except urllib.error.HTTPError as e:
            print("  ollama respondió %s (¿hiciste `ollama pull %s`?)"
                  % (e.code, modelo), file=sys.stderr)
            return None
        except Exception:
            salidas.append(None)
    return salidas


# ---------------------------------------------------------------------------
#  zonas seguras
# ---------------------------------------------------------------------------

def zona_de(bbox) -> str:
    """Dónde puede ir la UI dado dónde está la cara."""
    if bbox is None:
        return "bottom"
    centro_y = (bbox[1] + bbox[3]) / 2.0
    if centro_y < 0.45:
        return "bottom"          # cara arriba -> UI abajo
    if centro_y > 0.62:
        return "top"             # cara abajo -> UI arriba
    return "bottom"              # cara centrada -> abajo, que estorba menos


def pct(vals, p):
    """Percentil por índice sobre la lista ordenada. p10/p90 en vez de
    min/max: un frame suelto mal detectado no debe decidir el layout."""
    if not vals:
        return None
    vals = sorted(vals)
    return vals[min(len(vals) - 1, int(p * (len(vals) - 1)))]


def ventanas(muestras: list[dict], rellenas: list, minimo: float,
             cada: float, fin: float) -> list[dict]:
    """Una zona por VENTANA DE ENCUADRE, con safe/y_ui derivados de las
    muestras de esa ventana y no de un promedio global.

    Se corta ventana nueva cuando el centro vertical del rostro se aparta
    más de UMBRAL_REENCUADRE de la MEDIANA de la ventana en curso — contra
    la mediana y no contra la muestra anterior, para que el temblor del
    detector no acumule deriva ni un frame suelto parta la ventana en dos.
    Las ventanas más cortas que `minimo` se absorben en la anterior: evita
    que la UI salte de sitio cada segundo, que marea más que taparle la
    cara. Todo en reloj de ORIGEN, que es donde viven las muestras.
    """
    if not muestras:
        return []

    # Sin ninguna caja efectiva (motor estatico) no hay nada que medir:
    # una zona global con los valores de siempre, marcada por `verificado`.
    if not any(rellenas):
        return [{"t0": 0.0, "t1": round(max(fin, muestras[-1]["t"] + cada), 2),
                 "safe": "bottom", "y_ui": Y_INFERIOR}]

    def centro(b):
        return (b[1] + b[3]) / 2.0

    # 1. segmentar por movimiento del centro vertical
    grupos = [[0]]
    for i in range(1, len(muestras)):
        cys = sorted(centro(rellenas[j]) for j in grupos[-1])
        mediana = cys[len(cys) // 2] if len(cys) % 2 else \
            (cys[len(cys) // 2 - 1] + cys[len(cys) // 2]) / 2.0
        if abs(centro(rellenas[i]) - mediana) > UMBRAL_REENCUADRE:
            grupos.append([i])
        else:
            grupos[-1].append(i)

    # 2. absorber ventanas demasiado cortas en la anterior, ANTES de
    #    derivar nada: la ventana fusionada se mide con todas sus muestras
    fusionados = [grupos[0]]
    for g in grupos[1:]:
        dur_g = muestras[g[-1]]["t"] - muestras[g[0]]["t"]
        if dur_g < minimo:
            fusionados[-1].extend(g)
        else:
            fusionados.append(g)

    # 3. derivar safe/y_ui de LAS MUESTRAS DE CADA VENTANA
    zonas = []
    for g in fusionados:
        votos = [muestras[i]["safe"] for i in g]
        safe = "top" if votos.count("top") > votos.count("bottom") else "bottom"
        borde_sup = pct([rellenas[i][1] for i in g], 0.10)
        borde_inf = pct([rellenas[i][3] for i in g], 0.90)
        if safe == "bottom":
            # la UI arranca justo bajo el rostro DE ESTA VENTANA, con aire;
            # tope en 0.86 para que el elemento quepa en el lienzo
            y_ui = min(0.86, max(0.55, borde_inf + MARGEN_UI))
        else:
            # cuelga desde arriba y tiene que acabar antes del rostro
            y_ui = min(Y_SUPERIOR,
                       max(0.06, borde_sup - MARGEN_UI - ALTO_UI_TIPICO))
        zonas.append({"t0": round(muestras[g[0]]["t"], 2), "t1": 0.0,
                      "safe": safe, "y_ui": round(y_ui, 2),
                      "y0": round(borde_sup, 3), "y1": round(borde_inf, 3)})

    # 4. cobertura continua: cada zona llega hasta el arranque de la
    #    siguiente y la primera empieza en 0 — quien tome zones[0] sin
    #    mirar t sigue recibiendo una zona que cubre desde el principio
    zonas[0]["t0"] = 0.0
    for z, siguiente in zip(zonas, zonas[1:]):
        z["t1"] = siguiente["t0"]
    zonas[-1]["t1"] = round(max(fin, muestras[-1]["t"] + cada), 2)
    return zonas


# ---------------------------------------------------------------------------

def main() -> int:
    # Antes de nada: si falta el binario, decirlo con el comando que
    # lo arregla en vez de reventar con un FileNotFoundError crudo en
    # medio del trabajo.
    exige_ffmpeg("ffmpeg", "ffprobe")
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--engine", default="auto",
                    choices=["auto", "vision", "ollama", "estatico"])
    ap.add_argument("--model", default="qwen2-vl",
                    help="modelo multimodal de Ollama")
    ap.add_argument("--cada", type=float, default=1.0,
                    help="segundos entre muestras")
    ap.add_argument("--min-zona", type=float, default=2.5,
                    help="duración mínima de una zona antes de fusionarla")
    ap.add_argument("--output", default=os.path.join(BUILD, "face.json"))
    args = ap.parse_args()

    if not os.path.exists(args.input):
        print("no existe el archivo: %s" % args.input, file=sys.stderr)
        return 2

    dur = duracion(args.input)
    os.makedirs(BUILD, exist_ok=True)
    carpeta = tempfile.mkdtemp(prefix="face_")

    try:
        print("muestreando 1 frame cada %.1fs..." % args.cada, file=sys.stderr)
        rutas = muestrear(args.input, carpeta, args.cada)
        if not rutas:
            raise RuntimeError("no se extrajo ningún frame")

        cajas, motor = None, "estatico"
        if args.engine in ("auto", "vision"):
            print("probando Vision de macOS...", file=sys.stderr)
            cajas = motor_vision(rutas)
            if cajas is not None:
                motor = "vision"
        if cajas is None and args.engine in ("auto", "ollama"):
            print("probando Ollama (%s)..." % args.model, file=sys.stderr)
            cajas = motor_ollama(rutas, args.model)
            if cajas is not None:
                motor = "ollama"
        if cajas is None:
            cajas = [None] * len(rutas)
            motor = "estatico"
    finally:
        shutil.rmtree(carpeta, ignore_errors=True)

    detectadas = sum(1 for b in cajas if b)

    # Una muestra sin cara no significa que la cara no esté: en primeros
    # planos con movimiento el detector falla en frames sueltos. Heredar
    # de la vecina detectada más cercana es más fiel que caer al defecto.
    if detectadas:
        rellenas, ultima = [], None
        for b in cajas:
            if b:
                ultima = b
            rellenas.append(b if b else ultima)
        # los huecos iniciales toman la primera detección que aparezca
        primera = next((b for b in cajas if b), None)
        rellenas = [b if b else primera for b in rellenas]
    else:
        rellenas = cajas

    muestras = [{"t": round(i * args.cada, 2), "bbox": cajas[i],
                 "heredado": cajas[i] is None and rellenas[i] is not None,
                 "safe": zona_de(rellenas[i])}
                for i in range(len(cajas))]
    zonas = ventanas(muestras, rellenas, args.min_zona, args.cada, dur)

    # ¿Cuánto sitio libre queda de verdad? En un primerísimo plano la cara
    # ocupa casi todo el encuadre y NO hay banda segura: hay que decirlo,
    # no fingir que la hay colocando la UI en un tercio imaginario.
    y0s = [b[1] for b in cajas if b]
    y1s = [b[3] for b in cajas if b]
    borde_sup = pct(y0s, 0.10)
    borde_inf = pct(y1s, 0.90)
    if borde_sup is None:
        banda = {"arriba": 0.30, "abajo": 0.28, "y0": None, "y1": None}
    else:
        banda = {"arriba": round(max(0.0, borde_sup), 3),
                 "abajo": round(max(0.0, 1.0 - borde_inf), 3),
                 "y0": round(borde_sup, 3), "y1": round(borde_inf, 3)}
    mayor = max(banda["arriba"], banda["abajo"])
    banda["espacio_ui"] = ("amplio" if mayor >= 0.28 else
                           "justo" if mayor >= 0.14 else "ninguno")
    banda["lado"] = "arriba" if banda["arriba"] > banda["abajo"] else "abajo"

    tasa = (detectadas / len(muestras)) if muestras else 0.0
    salida = {
        "source": os.path.abspath(args.input),
        "engine": motor,
        # Los frames se muestrean sobre el vídeo FUENTE: samples y zones
        # cuentan el reloj de origen, igual que timeline.words. Consultar
        # una zona con un instante del reloj de salida exige pasar por el
        # mapa inverso de `keep` — se declara aquí para que el consumidor
        # no tenga que adivinarlo.
        "reloj": "origen",
        "verificado": motor != "estatico" and detectadas > 0,
        "duration": round(dur, 2),
        "muestras": len(muestras),
        "con_rostro": detectadas,
        "tasa_deteccion": round(tasa, 2),
        "banda_libre": banda,
        "samples": muestras,
        "zones": zonas,
    }
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, indent=2)

    print(json.dumps({k: v for k, v in salida.items()
                      if k not in ("samples",)}, ensure_ascii=False, indent=2))

    if banda["espacio_ui"] == "ninguno":
        print("\nAVISO: primerísimo plano. El rostro ocupa de %.0f%% a %.0f%% de la\n"
              "altura y no queda banda libre (arriba %.0f%%, abajo %.0f%%). Cualquier\n"
              "rótulo grande le tapará la cara. Los subtítulos van igualmente abajo\n"
              "(sobre barbilla/cuello, que es lo estándar), pero los títulos y\n"
              "mockups deberían ir sobre B-Roll o un plano más abierto."
              % (banda["y0"] * 100, banda["y1"] * 100,
                 banda["arriba"] * 100, banda["abajo"] * 100), file=sys.stderr)
    elif banda["espacio_ui"] == "justo":
        print("\nAVISO: espacio justo para UI (banda mayor %.0f%% de la altura, %s)."
              % (max(banda["arriba"], banda["abajo"]) * 100, banda["lado"]),
              file=sys.stderr)

    if motor != "estatico" and 0 < tasa < 0.5:
        print("\nAVISO: solo se detectó rostro en el %d%% de las muestras.\n"
              "Suele pasar en primerísimos planos (la cara desborda el encuadre)\n"
              "o con mucho movimiento. Las muestras sin detección heredan de la\n"
              "vecina, así que el posicionado sigue siendo coherente, pero\n"
              "conviene revisar el resultado." % round(tasa * 100),
              file=sys.stderr)

    if motor == "estatico":
        print("\nAVISO: sin detector de rostro. Se asume busto centrado y la UI\n"
              "va al tercio inferior. Para detección real:\n"
              "  .venv/bin/pip install pyobjc-framework-Vision   (rápido, sin descargas)\n"
              "  o bien:  ollama serve  &&  ollama pull %s" % args.model,
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
