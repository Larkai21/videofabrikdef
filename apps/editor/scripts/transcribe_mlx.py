#!/usr/bin/env python3
"""Transcripción local con mlx-whisper sobre Apple Silicon.

Corre en la GPU/Neural Engine del M4 Pro vía MLX: nada sale de la máquina.
Produce marcas de tiempo POR PALABRA, que es lo que necesitan tanto el
limpiador (para cortar por silencios) como el karaoke.

Salida: build/transcript.json

    {
      "source": "...", "language": "es", "duration": 128.4,
      "text": "...",
      "words":    [{"w": "hola", "start": 0.12, "end": 0.44, "p": 0.98}, ...],
      "segments": [{"start": .., "end": .., "text": ".."}, ...]
    }

Uso:
    python3 scripts/transcribe_mlx.py --input input.mp4
    python3 scripts/transcribe_mlx.py --input input.mp4 --model large-v3
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time

import comun
from comun import exige_ffmpeg

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = comun.build_dir()   # `EDITOR_BUILD` lo redirige
# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
FFMPEG = comun.FFMPEG
FFPROBE = comun.FFPROBE

# Repos MLX ya convertidos. 'medium' es el equilibrio; 'large-v3' afina
# nombres propios y tecnicismos a cambio de ~2x de tiempo.
MODELOS = {
    "medium":   "mlx-community/whisper-medium-mlx",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
    "turbo":    "mlx-community/whisper-large-v3-turbo",
}


def duracion(ruta: str) -> float:
    try:
        r = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", ruta],
            capture_output=True, text=True, check=True)
        return round(float(r.stdout.strip()), 3)
    except Exception:
        return 0.0


def extraer_audio(origen: str, destino: str) -> str:
    """Whisper quiere 16 kHz mono. Convertir aquí evita que el modelo
    haga su propio resampleo y desalinee las marcas de tiempo."""
    r = subprocess.run(
        [FFMPEG, "-nostdin", "-y", "-loglevel", "error", "-i", origen,
         "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", destino],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg no pudo extraer el audio:\n" + r.stderr.strip())
    if not os.path.exists(destino) or os.path.getsize(destino) < 1024:
        raise RuntimeError("el archivo no tiene pista de audio utilizable")
    return destino


def aplanar(res: dict) -> list[dict]:
    palabras = []
    for seg in res.get("segments", []):
        for w in (seg.get("words") or []):
            txt = (w.get("word") or "").strip()
            if not txt:
                continue
            palabras.append({
                "w": txt,
                "start": round(float(w["start"]), 3),
                "end": round(float(w["end"]), 3),
                "p": round(float(w.get("probability", 1.0)), 3),
            })
    return palabras


def main() -> int:
    # Antes de nada: si falta el binario, decirlo con el comando que
    # lo arregla en vez de reventar con un FileNotFoundError crudo en
    # medio del trabajo.
    exige_ffmpeg("ffmpeg", "ffprobe")
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--model", default="medium", choices=sorted(MODELOS))
    ap.add_argument("--language", default="es",
                    help="código ISO; 'auto' para detectar")
    ap.add_argument("--output", default=None)
    args = ap.parse_args()

    if not os.path.exists(args.input):
        print("no existe el archivo: %s" % args.input, file=sys.stderr)
        return 2

    os.makedirs(BUILD, exist_ok=True)
    destino = args.output or os.path.join(BUILD, "transcript.json")

    try:
        import mlx_whisper
    except ImportError:
        print("falta mlx-whisper. Instala con:\n"
              "  python3 -m venv .venv && .venv/bin/pip install -r requirements.txt",
              file=sys.stderr)
        return 3

    wav = tempfile.mktemp(suffix=".wav")
    t0 = time.time()
    try:
        print("[1/2] extrayendo audio...", file=sys.stderr)
        extraer_audio(args.input, wav)

        print("[2/2] transcribiendo con %s (Metal)..." % args.model, file=sys.stderr)
        res = mlx_whisper.transcribe(
            wav,
            path_or_hf_repo=MODELOS[args.model],
            language=None if args.language == "auto" else args.language,
            word_timestamps=True,
            condition_on_previous_text=False,   # evita arrastrar alucinaciones
            verbose=None,
        )
    finally:
        if os.path.exists(wav):
            os.remove(wav)

    dur = duracion(args.input)
    palabras = aplanar(res)
    salida = {
        "source": os.path.abspath(args.input),
        "model": MODELOS[args.model],
        "language": res.get("language"),
        "duration": dur,
        "text": (res.get("text") or "").strip(),
        "words": palabras,
        "segments": [
            {"start": round(float(s["start"]), 3),
             "end": round(float(s["end"]), 3),
             "text": (s.get("text") or "").strip()}
            for s in res.get("segments", [])
        ],
    }
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, indent=2)

    tardado = time.time() - t0
    veloc = (dur / tardado) if tardado > 0 else 0
    print(json.dumps({
        "salida": destino,
        "idioma": salida["language"],
        "palabras": len(palabras),
        "duracion_s": dur,
        "tardado_s": round(tardado, 1),
        "velocidad": "%.1fx tiempo real" % veloc,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
