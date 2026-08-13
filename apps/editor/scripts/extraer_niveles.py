#!/usr/bin/env python3
"""Extrae la envolvente de un audio a un array de niveles 0..1.

Sirve para que la onda del vídeo sea la del audio de verdad y no una
animación inventada: si la barra sube cuando la voz sube, el espectador lo
nota aunque no sepa por qué.

Se decodifica a 8 kHz mono —de sobra para una envolvente— y se calcula el
RMS por ventana. El RMS y no el pico: el pico de una locución lo marcan
las consonantes explosivas y da una envolvente que salta como un
sismógrafo, mientras que el RMS sigue la energía que se percibe.

Uso:
    python3 scripts/extraer_niveles.py build/voz.mp3
    python3 scripts/extraer_niveles.py build/voz.mp3 --tasa 30 --salida build/niveles.json
"""

from __future__ import annotations

import argparse
import json
import math
import os
import struct
import subprocess
import sys

from comun import exige_ffmpeg

# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
from comun import FFMPEG                        # noqa: E402
SR = 8000


def muestras(ruta: str) -> list[float]:
    r = subprocess.run(
        [FFMPEG, "-nostdin", "-v", "error", "-i", ruta,
         "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
        capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace").strip())
    b = r.stdout
    n = len(b) // 2
    return [v / 32768.0 for v in struct.unpack("<%dh" % n, b[:n * 2])]


def envolvente(x: list[float], tasa: float, suavizado: float) -> list[float]:
    """RMS por ventana, normalizado, con un ataque rápido y una caída lenta.

    La asimetría no es un capricho: el oído sigue los ataques y perdona las
    caídas. Una envolvente simétrica se ve nerviosa; con la caída frenada
    respira como un vúmetro."""
    paso = max(1, int(SR / tasa))
    crudo = []
    for i in range(0, len(x), paso):
        v = x[i:i + paso]
        crudo.append(math.sqrt(sum(s * s for s in v) / len(v)) if v else 0.0)

    tope = max(crudo) or 1.0
    crudo = [c / tope for c in crudo]

    salida, prev = [], 0.0
    for c in crudo:
        # sube de golpe, baja despacio
        prev = c if c > prev else prev + (c - prev) * (1.0 - suavizado)
        salida.append(round(min(1.0, max(0.0, prev)), 4))
    return salida


def main() -> int:
    # Antes de nada: si falta el binario, decirlo con el comando que
    # lo arregla en vez de reventar con un FileNotFoundError crudo en
    # medio del trabajo.
    exige_ffmpeg("ffmpeg")
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--tasa", type=float, default=30.0,
                    help="muestras de envolvente por segundo")
    ap.add_argument("--suavizado", type=float, default=0.82,
                    help="0 = sin freno en la caída, 0.95 = muy lenta")
    ap.add_argument("--salida", default=None)
    args = ap.parse_args()

    x = muestras(args.audio)
    niveles = envolvente(x, args.tasa, args.suavizado)
    dur = len(x) / SR

    destino = args.salida or os.path.join(
        os.path.dirname(os.path.abspath(args.audio)), "niveles.json")
    with open(destino, "w", encoding="utf-8") as f:
        json.dump({"fuente": args.audio, "tasa": args.tasa,
                   "duracion": round(dur, 3), "niveles": niveles}, f)

    activos = sum(1 for n in niveles if n > 0.08)
    print(json.dumps({
        "salida": destino,
        "duracion_s": round(dur, 2),
        "muestras": len(niveles),
        "pico": max(niveles) if niveles else 0,
        "media": round(sum(niveles) / len(niveles), 4) if niveles else 0,
        "con_voz_pct": round(100.0 * activos / len(niveles), 1) if niveles else 0,
    }, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
