#!/usr/bin/env python3
"""Subtítulos cinéticos sobre un vídeo, y nada más.

    python3 scripts/solo_subs.py --input clip.mp4
    python3 scripts/solo_subs.py --input clip.mp4 --acento '#E5789F'
    python3 scripts/solo_subs.py --input *.mp4 --claves novia,éxito

## Por qué no vale la cadena de siempre

La cadena completa hace tres cosas que aquí están de más y una que es
directamente dañina. De más: detectar el rostro, generar B-Rolls y aplicar el
LUT de marca. Dañina: `clean_transcript.py` quita silencios y tomas falsas, o
sea REEDITA. Sobre el material de otro eso no es una mejora, es tomarse una
decisión que no te han pedido — te piden subtitular, no montar.

Así que `keep` es el clip entero, de 0 a su duración, y la traducción
origen→salida es la identidad. El vídeo que sale dura exactamente lo que
entró.

## El acento

`kinetic-captions` pinta la palabra con carga en `--accent`, que es el azul de
esta marca. Para una pieza que no es de esta marca eso es el error y no el
acierto, y por eso la plantilla acepta `config.acento`: un color del PLAN.
Aquí se expone como `--acento`.

## Las claves

Sin `--claves` no hay palabra en color: el subtítulo sale entero en la tinta
de siempre y el acento no se usa. Es lo correcto por defecto —resaltar al azar
es peor que no resaltar—, pero deja el color sin estrenar, así que si no se
dan y hay acento se avisa.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import comun                                    # noqa: E402
from comun import FFPROBE, carga_json, exige_ok  # noqa: E402

PY = os.path.join(RAIZ, ".venv", "bin", "python")
if not os.path.exists(PY):
    PY = sys.executable


def duracion(ruta: str) -> float:
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries",
                        "format=duration", "-of", "csv=p=0", ruta],
                       capture_output=True, text=True)
    exige_ok(r, "ffprobe sobre %s" % ruta)
    return float(r.stdout.strip())


def fps_de(ruta: str) -> float:
    """Los fotogramas por segundo del ORIGEN, que aquí mandan.

    El pipeline trabaja a 30 y eso está bien para lo que se graba aquí, pero
    imponérselos a un clip ajeno lo remuestrea: los cuatro de este encargo
    venían a 24, salieron a 30, y 240 fotogramas se convirtieron en 300
    duplicando uno de cada cuatro. En una imagen quieta no se nota; en
    movimiento es un tirón por segundo, y al recomprimir cada duplicado el
    codificador reparte bits distintos entre fotogramas idénticos y aparece
    la suciedad que se ve en pantalla.

    Es el mismo criterio que el LUT: sobre material de otro, no se cambia lo
    que no se ha pedido cambiar."""
    r = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=r_frame_rate",
                        "-of", "csv=p=0", ruta], capture_output=True, text=True)
    exige_ok(r, "ffprobe fps sobre %s" % ruta)
    num, _, den = r.stdout.strip().partition("/")
    return float(num) / float(den or 1)


def timeline_completo(transcript: dict, dur: float, fuente: str) -> dict:
    """El contrato de `timeline.json` con `keep` = el clip entero.

    `words` va en reloj de ORIGEN, como manda la regla del reloj, y como
    `keep` es la identidad el reloj de salida coincide — pero se deriva igual,
    no se asume: el que lo lea después usa `reloj.Mapa(keep)` sin saber que
    aquí era trivial."""
    return {
        "reloj": "origen",
        "source": os.path.abspath(fuente),
        "words": transcript["words"],
        "blocks": [],
        "keep": [{"src_start": 0.0, "src_end": round(dur, 3),
                  "out_start": 0.0, "out_end": round(dur, 3)}],
        "duration_original": round(dur, 3),
        "duration_final": round(dur, 3),
        "stats": {"cortes": 0, "segundos_recortados": 0.0},
    }


def monta(entrada: str, args) -> str:
    nombre = os.path.splitext(os.path.basename(entrada))[0]
    dir_pieza = os.path.join(comun.build_dir(), "subs", nombre)
    os.makedirs(dir_pieza, exist_ok=True)
    ruta = lambda f: os.path.join(dir_pieza, f)     # noqa: E731
    entorno = dict(os.environ, EDITOR_BUILD=dir_pieza)

    tr = ruta("transcript.json")
    if not os.path.exists(tr) or args.rehacer:
        exige_ok(subprocess.run(
            [PY, "scripts/transcribe_mlx.py", "--input", entrada,
             "--output", tr, "--model", args.modelo],
            cwd=RAIZ, capture_output=True, text=True, env=entorno),
            "transcribir " + nombre)

    dur = duracion(entrada)
    tl = timeline_completo(carga_json(tr), dur, entrada)
    if args.dinamica:
        # La energía se mide sobre el propio clip, ANTES de sellar el
        # timeline: aquí `keep` es la identidad, así que el reloj de origen
        # que exige `medir_energia` se cumple por construcción.
        from extraer_niveles import muestras
        from medir_energia import aplicar as mide_energia
        mide_energia(tl, muestras(entrada))
    with open(ruta("timeline.json"), "w", encoding="utf-8") as f:
        json.dump(tl, f, ensure_ascii=False, indent=1)

    # Una sola capa. `t: 0` y la duración del clip: los subtítulos son la
    # pieza entera, no un acento dentro de ella.
    cfg = {"duration": round(dur, 3), "tema": args.tema,
           "palabras": [{"w": w["w"], "ini": round(float(w["start"]), 3),
                         "fin": round(float(w["end"]), 3),
                         **({"energia": w["energia"]} if "energia" in w
                            else {})}
                        for w in tl["words"]],
           "clave": args.claves, "ventanas": []}
    if args.acento:
        cfg["acento"] = args.acento
    if args.dinamica:
        # El paquete curado vive en `escaleta.DINAMICA`, no copiado aquí:
        # una copia deriva en silencio, que es como se desincronizan.
        from escaleta import DINAMICA
        cfg.update(DINAMICA[args.dinamica])
    plan = [{"capa": "kineticcaptions", "template": "kinetic-captions.html",
             "t": 0.0, "duracion": round(dur, 3), "colocar": False,
             "config": cfg}]
    with open(ruta("plan.json"), "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=1)

    # Los subtítulos se rasterizan a los fps del ORIGEN. El manifiesto lleva
    # ese número y el compositor lo lee de ahí, así que basta con decirlo una
    # vez y ninguna etapa remuestrea nada.
    fps = fps_de(entrada)
    exige_ok(subprocess.run(
        ["node", "scripts/render_playwright.js", "--plan", ruta("plan.json"),
         "--build", dir_pieza, "--fps", "%g" % fps],
        cwd=RAIZ, capture_output=True, text=True,
        env=entorno), "render " + nombre)

    salida = args.salida or os.path.join(RAIZ, "renders", nombre + "-subs.mp4")
    os.makedirs(os.path.dirname(salida), exist_ok=True)
    # `--lut none` EXPLÍCITO aunque hoy sea el defecto del compositor: este
    # script promete no tocar la imagen y esa promesa no puede depender de un
    # defecto ajeno. No pasarlo fue exactamente el fallo: el comentario decía
    # «sin LUT», `--lut` traía `carbon_bronze.cube` de fábrica y los cuatro
    # clips salieron graduados.
    #
    # Sin `--face` por otro motivo: donde no se recorta cámara no hace falta
    # saber dónde está el rostro. El vídeo de origen lo saca el compositor de
    # `timeline.source`, que por eso se escribe absoluto.
    exige_ok(subprocess.run(
        [PY, "scripts/composite_ffmpeg.py", "--lut", "none",
         "--crf", str(args.crf), "--preset-x264", args.preset,
         "--timeline", ruta("timeline.json"), "--layers", ruta("layers.json"),
         "--output", salida],
        cwd=RAIZ, capture_output=True, text=True, env=entorno),
        "componer " + nombre)
    return salida


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", nargs="+", required=True,
                    help="uno o varios vídeos (admite comodines del shell)")
    ap.add_argument("--acento", default=None,
                    help="color CSS de la palabra con carga (ej. '#E5789F')")
    ap.add_argument("--claves", default="",
                    help="palabras que van en color, separadas por comas")
    ap.add_argument("--tema", default="carbon", choices=("carbon", "paper"))
    ap.add_argument("--modelo", default="medium")
    ap.add_argument("--salida", default=None,
                    help="ruta del mp4; solo con UN vídeo de entrada")
    # 14 y no los 17 del pipeline: aquí la única capa es texto sobre metraje
    # que NO se toca, así que todo lo que el codificador tire es pérdida pura
    # respecto al original. Cuesta ~35 % más de fichero.
    ap.add_argument("--crf", type=int, default=14)
    ap.add_argument("--preset", default="slower",
                    help="preset de x264; más lento = mejor por bit")
    ap.add_argument("--rehacer", action="store_true",
                    help="vuelve a transcribir aunque haya transcripción")
    # 0 por defecto y a propósito: esto es material de OTRO, y el criterio
    # del script entero es no añadir nada que no se haya pedido. Quien
    # quiera el subtítulo vivo lo pide, igual que pide el acento.
    # «favorito» es el paquete fijado de la marca (escaleta.DINAMICA).
    ap.add_argument("--dinamica", default="0",
                    choices=("0", "1", "2", "3", "favorito"),
                    help="nivel de dinámica del subtítulo (escaleta.DINAMICA)")
    args = ap.parse_args()
    args.dinamica = (int(args.dinamica) if args.dinamica.isdigit()
                     else args.dinamica)

    entradas = []
    for e in args.input:
        entradas.extend(sorted(glob.glob(e)) if any(c in e for c in "*?[")
                        else [e])
    faltan = [e for e in entradas if not os.path.exists(e)]
    if faltan:
        print("no existe: %s" % ", ".join(faltan), file=sys.stderr)
        return 2
    if args.salida and len(entradas) > 1:
        print("--salida es para UN vídeo; con varios se nombran solos "
              "(<nombre>-subs.mp4)", file=sys.stderr)
        return 2

    args.claves = [c.strip() for c in args.claves.split(",") if c.strip()]
    if args.acento and not args.claves:
        print("aviso: hay --acento pero no --claves, así que ninguna palabra "
              "va en color y el acento no se usa.", file=sys.stderr)

    for e in entradas:
        print("  ✓ %s → %s" % (os.path.basename(e),
                               os.path.relpath(monta(e, args), RAIZ)))
    print("\n%d vídeo(s) subtitulado(s)" % len(entradas))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
