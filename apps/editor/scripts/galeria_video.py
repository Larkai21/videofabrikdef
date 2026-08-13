#!/usr/bin/env python3
"""Monta la galería: los fotogramas de `galeria.js` más el catálogo de sonidos.

Dos secciones en un solo vídeo:

  1. MOTION   cada plantilla animada, con su nombre, sobre fondo de MEDIO TONO
  2. SONIDO   los 15 SFX de uno en uno, con su nombre y su forma de onda

El fondo es medio tono y no negro por la misma razón que el catálogo de
subtítulos (`BRAND_RULES.md` §16): sobre negro, un trazo negro y una sombra
dura son invisibles. Están ahí —se puede medir— pero no se pueden JUZGAR, y
un catálogo que miente sobre la mitad de sus fichas no sirve para elegir.

Cada clip se monta como su propio mp4 y luego se concatenan con el demuxer
`concat`. Es más invocaciones de ffmpeg que un solo filtergraph gigante, pero
un grafo de 70 entradas es imposible de depurar cuando falla, y aquí el que
falla es siempre uno concreto.

Uso:
    python3 scripts/galeria_video.py
    python3 scripts/galeria_video.py --entrada /tmp/galeria-editor \\
        --salida renders/galeria.mp4
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comun import exige_ffmpeg          # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SFX = os.path.join(RAIZ, "assets", "sfx")
# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
from comun import FFMPEG, FFPROBE               # noqa: E402

# Medio tono por tema. No es `--bg`: es el tono sobre el que un overlay se
# puede juzgar, ligeramente más claro que el fondo de marca en carbon y
# ligeramente más oscuro en paper.
FONDO = {"carbon": "0x1E1E24", "paper": "0xE8E4DD"}

# Parámetros de codificación COMPARTIDOS por todos los segmentos. El demuxer
# `concat` no recodifica: si dos segmentos difieren en perfil, resolución o
# frecuencia de muestreo, el resultado se corrompe a mitad sin un solo error.
V = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
     "-pix_fmt", "yuv420p", "-profile:v", "high", "-g", "40"]
A = ["-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"]


def corre(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        cola = "\n".join(r.stderr.strip().splitlines()[-12:])
        raise SystemExit("ffmpeg ha fallado:\n  %s\n%s"
                         % (" ".join(cmd[:14]), cola))
    return r


def dur_de(ruta) -> float:
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries",
                        "format=duration", "-of", "csv=p=0", ruta],
                       capture_output=True, text=True)
    # Sonda: 0.0 significa «no se pudo medir» y los llamadores ya viven con
    # ello —el suelo de 2 s de las tarjetas, el informe final—. Lo que no
    # puede ser es que un ffprobe roto deje todas las duraciones a cero sin
    # una línea que lo diga: el fallo se tolera, el silencio no.
    if r.returncode != 0:
        print("aviso: ffprobe no pudo medir %s (código %d)"
              % (ruta, r.returncode), file=sys.stderr)
        return 0.0
    try:
        return float(r.stdout.strip())
    except ValueError:
        return 0.0


def segmento_motion(c, tmp, i, ancho, alto):
    """Un clip: fondo + fotogramas + rótulo, con sus señales de sonido."""
    salida = os.path.join(tmp, "seg%03d.mp4" % i)
    fondo = FONDO.get(c["tema"], FONDO["carbon"])
    dur = c["frames"] / float(c["fps"])

    cmd = [FFMPEG, "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
           "-f", "lavfi", "-i", "color=c=%s:s=%dx%d:r=%d:d=%.3f"
           % (fondo, ancho, alto, c["fps"], dur),
           "-framerate", str(c["fps"]),
           "-i", os.path.join(c["dir"], "%05d.png"),
           "-i", c["etiqueta_png"]]

    # Las señales que publica la plantilla entran como pistas de audio y se
    # retrasan a su instante. `adelay` va en MILISEGUNDOS y por canal.
    filtros = [
        "[0:v][1:v]overlay=0:0:shortest=1[v1]",
        # el rótulo abajo, sobre el propio fondo: encima taparía la entrada,
        # que es justo lo que hay que ver
        "[v1][2:v]overlay=0:%d[vid]" % (alto - 96),
    ]
    entradas = 3
    mezcla = []
    for cue in c.get("cues", []):
        ruta = os.path.join(SFX, "%s.wav" % cue["sfx"])
        if not os.path.exists(ruta):
            continue
        cmd += ["-i", ruta]
        ms = int(max(0.0, float(cue.get("at", 0))) * 1000)
        g = float(cue.get("gain", 1.0))
        filtros.append("[%d:a]adelay=%d|%d,volume=%.2f[s%d]"
                       % (entradas, ms, ms, g, entradas))
        mezcla.append("[s%d]" % entradas)
        entradas += 1

    if mezcla:
        filtros.append("%samix=inputs=%d:normalize=0,apad[aud]"
                       % ("".join(mezcla), len(mezcla)))
        mapa_a = "[aud]"
    else:
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
        mapa_a = "%d:a" % entradas

    cmd += ["-filter_complex", ";".join(filtros),
            "-map", "[vid]", "-map", mapa_a, "-t", "%.3f" % dur,
            "-r", str(c["fps"])] + V + A + [salida]
    corre(cmd)
    return salida


def tarjeta_sfx(nombre, etiqueta_png, tmp, i, ancho, alto, fps):
    """Un sonido: su nombre en pantalla, su onda dibujada y él sonando."""
    ruta = os.path.join(SFX, "%s.wav" % nombre)
    real = dur_de(ruta)
    # Suelo de 2 s: doce de los quince duran menos de 0,6 s y `tecleo` dura 45
    # MILISEGUNDOS. Con la duración real, la tarjeta pasa antes de que se pueda
    # leer el nombre, y una galería que no deja mirar no es una galería.
    dur = max(2.0, real + 0.6)
    salida = os.path.join(tmp, "sfx%03d.mp4" % i)

    # `showwavespic` y NO `showwaves`: el segundo dibuja la onda mientras suena,
    # y con sonidos de 45 ms eso es UN fotograma — se probó y la tarjeta salía
    # vacía. `showwavespic` dibuja la onda entera de una vez y se queda fija
    # todo el rato, así que se ve la FORMA del sonido mientras se oye.
    #
    # Es la onda real del fichero, no una inventada: misma decisión que en
    # `onda.html` y por el mismo motivo.
    cmd = [FFMPEG, "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
           "-f", "lavfi", "-i", "color=c=%s:s=%dx%d:r=%d:d=%.3f"
           % (FONDO["carbon"], ancho, alto, fps, dur),
           "-i", ruta,
           "-i", etiqueta_png,
           "-filter_complex",
           "[1:a]asplit=2[son][dib];"
           "[dib]showwavespic=s=%dx420:colors=0xCD7F32|0x4E9A8F[w];"
           # `repeatlast` sostiene el único fotograma de la onda durante toda
           # la tarjeta; sin él desaparece tras el primero.
           "[0:v][w]overlay=0:(H-h)/2:repeatlast=1:shortest=0[v1];"
           "[v1][2:v]overlay=0:%d[vid];"
           # `apad` porque el sonido acaba antes que la tarjeta y una pista de
           # audio más corta que el vídeo descoloca el concat.
           "[son]apad[aud]" % (ancho, alto - 96),
           "-map", "[vid]", "-map", "[aud]", "-t", "%.3f" % dur,
           "-r", str(fps)] + V + A + [salida]
    corre(cmd)
    return salida


def main() -> int:
    # ffprobe también: `dur_de` mide con él las duraciones de los SFX.
    exige_ffmpeg("ffmpeg", "ffprobe")
    ap = argparse.ArgumentParser()
    ap.add_argument("--entrada", default="/tmp/galeria-editor",
                    help="lo que dejó galeria.js")
    ap.add_argument("--salida", default=os.path.join(RAIZ, "renders",
                                                     "galeria.mp4"))
    ap.add_argument("--sin-sfx", action="store_true",
                    help="omite la sección de sonidos")
    args = ap.parse_args()

    manif = os.path.join(args.entrada, "galeria.json")
    if not os.path.exists(manif):
        print("falta %s — ejecuta antes: node scripts/galeria.js" % manif,
              file=sys.stderr)
        return 2
    with open(manif, encoding="utf-8") as f:
        g = json.load(f)

    tmp = os.path.join(args.entrada, "segmentos")
    os.makedirs(tmp, exist_ok=True)
    ancho, alto, fps = g["ancho"], g["alto"], g["fps"]

    segmentos = []
    for i, c in enumerate(g["clips"]):
        if not os.path.isdir(c["dir"]):
            print("aviso: faltan los fotogramas de «%s» (%s). Se omite."
                  % (c["etiqueta"], c["dir"]), file=sys.stderr)
            continue
        segmentos.append(segmento_motion(c, tmp, i, ancho, alto))
        if (i + 1) % 10 == 0:
            print("  motion %d/%d" % (i + 1, len(g["clips"])))

    n_sfx = 0
    if not args.sin_sfx:
        # ffmpeg no puede escribir texto, así que los rótulos de los sonidos
        # también llegan rasterizados: los deja `galeria.js` en `etiq_sfx/`,
        # con el mismo generador que los de las plantillas.
        etiqs = os.path.join(args.entrada, "etiq_sfx")
        if os.path.isdir(etiqs):
            # Las variantes de ráfaga (`tecleo_v2.wav`…) son la MISMA tecla
            # con otra pulsación, no sonidos del catálogo: listadas aparte la
            # galería diría 30 sonidos donde hay 21.
            for j, nombre in enumerate(sorted(
                    f[:-4] for f in os.listdir(SFX)
                    if f.endswith(".wav")
                    and not re.search(r"_v\d+$", f[:-4]))):
                png = os.path.join(etiqs, nombre + ".png")
                if not os.path.exists(png):
                    continue
                segmentos.append(tarjeta_sfx(nombre, png, tmp, j,
                                             ancho, alto, fps))
                n_sfx += 1
        else:
            print("aviso: no hay rótulos de sonido en %s; se omite la sección.\n"
                  "       Los genera galeria.js; vuelve a ejecutarlo." % etiqs,
                  file=sys.stderr)

    if not segmentos:
        print("no hay nada que montar", file=sys.stderr)
        return 1

    lista = os.path.join(tmp, "lista.txt")
    with open(lista, "w", encoding="utf-8") as f:
        for s in segmentos:
            f.write("file '%s'\n" % s.replace("'", r"'\''"))

    os.makedirs(os.path.dirname(args.salida), exist_ok=True)
    # `-c copy` no recodifica: los segmentos ya salieron con los mismos
    # parámetros a propósito. Recodificar aquí duplicaría el trabajo y
    # perdería detalle en los bordes de las letras por segunda vez.
    corre([FFMPEG, "-nostdin", "-y", "-hide_banner", "-loglevel", "error",
           "-f", "concat", "-safe", "0", "-i", lista,
           "-c", "copy", "-movflags", "+faststart", args.salida])

    print(json.dumps({
        "salida": args.salida,
        "segmentos": len(segmentos),
        "motion": len(segmentos) - n_sfx,
        "sonidos": n_sfx,
        "duracion_s": round(dur_de(args.salida), 1),
        "tam_mb": round(os.path.getsize(args.salida) / 1e6, 2),
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
