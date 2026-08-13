#!/usr/bin/env python3
"""Genera la locución de un guion con edge-tts.

Para piezas sin A-Roll (motion graphics puro) no hay voz de la que sacar
tiempos. Se sintetiza aquí y luego se pasa por transcribe_mlx.py: así el
karaoke queda sincronizado con marcas REALES, no estimadas a ojo. Estimar
la duración de cada palabra por número de letras desincroniza en cuanto
hay una pausa o una palabra larga.

Uso:
    python3 scripts/narrar.py --texto guion.txt --salida build/voz.mp3
    python3 scripts/narrar.py --texto guion.txt --voz es-ES-ElviraNeural
"""

from __future__ import annotations

import argparse
import asyncio
import os
import subprocess
import sys

import comun
from comun import exige_ffmpeg

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = comun.build_dir()   # `EDITOR_BUILD` lo redirige
# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
FFPROBE = comun.FFPROBE


async def sintetizar(texto, voz, ruta, velocidad, tono):
    import edge_tts
    com = edge_tts.Communicate(texto, voz, rate=velocidad, pitch=tono)
    await com.save(ruta)


def duracion(ruta):
    try:
        r = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", ruta],
            capture_output=True, text=True, check=True)
        return round(float(r.stdout.strip()), 2)
    except Exception:
        return 0.0


def main() -> int:
    # Antes de nada: si falta el binario, decirlo con el comando que
    # lo arregla en vez de reventar con un FileNotFoundError crudo en
    # medio del trabajo.
    exige_ffmpeg("ffprobe")
    ap = argparse.ArgumentParser()
    ap.add_argument("--texto", required=True, help="archivo .txt con el guion")
    ap.add_argument("--voz", default="es-ES-AlvaroNeural")
    ap.add_argument("--velocidad", default="+0%",
                    help="p.ej. '+8%%' para acelerar y que quepa en el metraje")
    ap.add_argument("--tono", default="+0Hz")
    ap.add_argument("--salida", default=os.path.join(BUILD, "voz.mp3"))
    args = ap.parse_args()

    if not os.path.exists(args.texto):
        print("no existe el guion: %s" % args.texto, file=sys.stderr)
        return 2
    with open(args.texto, encoding="utf-8") as f:
        texto = f.read().strip()
    if not texto:
        print("el guion está vacío", file=sys.stderr)
        return 2

    os.makedirs(os.path.dirname(os.path.abspath(args.salida)), exist_ok=True)
    asyncio.run(sintetizar(texto, args.voz, args.salida,
                           args.velocidad, args.tono))

    d = duracion(args.salida)
    palabras = len(texto.split())
    print("voz: %s\n  %s · %s · %.2fs · %d palabras (%.0f ppm)"
          % (args.salida, args.voz, args.velocidad, d, palabras,
             palabras / d * 60 if d else 0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
