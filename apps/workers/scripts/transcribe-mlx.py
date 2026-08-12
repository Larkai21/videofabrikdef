#!/usr/bin/env python3
"""Transcripción local con mlx-whisper sobre Apple Silicon (Metal).

Sidecar del proveedor de STT 'mlx' (providers/stt.ts): recibe un wav 16 kHz
mono y escribe JSON por stdout. Adaptado del script hermano de editor-youtube
(scripts/transcribe_mlx.py), que es de donde vienen las dos decisiones:

  - word_timestamps=True: el karaoke y las fronteras necesitan la palabra
  - condition_on_previous_text=False: evita arrastrar alucinaciones

Los modelos son los MLX ya convertidos de mlx-community (Hugging Face); en
esta máquina ya están en ~/.cache/huggingface.

Uso:  python3 transcribe-mlx.py <wav> [--model turbo] [--language es]
"""

from __future__ import annotations

import argparse
import json
import sys

MODELOS = {
    "medium": "mlx-community/whisper-medium-mlx",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
    "turbo": "mlx-community/whisper-large-v3-turbo",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--model", default="turbo", choices=sorted(MODELOS))
    ap.add_argument("--language", default="es")
    args = ap.parse_args()

    try:
        import mlx_whisper
    except ImportError:
        print(
            "falta mlx-whisper. Instala con:\n"
            "  python3.12 -m venv .venv-stt && .venv-stt/bin/pip install mlx-whisper\n"
            "y apunta STT_MLX_PYTHON al python de ese venv (MLX no publica "
            "ruedas para 3.14)",
            file=sys.stderr,
        )
        return 3

    res = mlx_whisper.transcribe(
        args.wav,
        path_or_hf_repo=MODELOS[args.model],
        language=None if args.language == "auto" else args.language,
        word_timestamps=True,
        condition_on_previous_text=False,
        verbose=None,
    )

    words = []
    for seg in res.get("segments", []):
        for w in seg.get("words") or []:
            txt = (w.get("word") or "").strip()
            if not txt:
                continue
            words.append(
                {
                    "text": txt,
                    "from_ms": round(float(w["start"]) * 1000),
                    "to_ms": round(float(w["end"]) * 1000),
                }
            )
    salida = {
        "text": (res.get("text") or "").strip(),
        "words": words,
        "segments": [
            {
                "text": (s.get("text") or "").strip(),
                "from_ms": round(float(s["start"]) * 1000),
                "to_ms": round(float(s["end"]) * 1000),
            }
            for s in res.get("segments", [])
        ],
    }
    json.dump(salida, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
