#!/usr/bin/env python3
"""Sustituye el texto transcrito por el guion real, conservando los tiempos.

Cuando la locución viene de un TTS, el texto exacto se conoce de antemano.
Whisper sigue siendo necesario para las marcas de tiempo, pero su texto es
una conjetura: transcribió «CLOUD» donde el guion dice «Claude». Fiarse de
él ahí es tirar información que ya tenemos.

Se alinean posicionalmente las palabras del guion sobre las de la
transcripción. Si el número no coincide se usa difflib para casar lo que
sí encaja y se deja intacto el resto, en vez de descuadrarlo todo.

Uso:
    python3 scripts/alinear_guion.py --guion build/guion.txt
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sys

import comun
from comun import carga_json

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = comun.build_dir()   # `EDITOR_BUILD` lo redirige


def normaliza(p: str) -> str:
    return re.sub(r"[^\wáéíóúüñ]", "", p.lower(), flags=re.UNICODE)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--guion", required=True)
    ap.add_argument("--transcript", default=os.path.join(BUILD, "transcript.json"))
    ap.add_argument("--output", default=None)
    args = ap.parse_args()

    with open(args.guion, encoding="utf-8") as f:
        guion = f.read().split()
    tr = carga_json(args.transcript)

    oidas = tr["words"]
    cambios = []

    if len(guion) == len(oidas):
        # caso normal con TTS: correspondencia 1 a 1
        for w, real in zip(oidas, guion):
            if normaliza(w["w"]) != normaliza(real):
                cambios.append((w["w"], real))
            w["w"] = real
    else:
        # el TTS se comió o partió algo: casar lo que se pueda
        sm = difflib.SequenceMatcher(
            None, [normaliza(w["w"]) for w in oidas],
            [normaliza(p) for p in guion])
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            if op == "equal":
                for k in range(i2 - i1):
                    oidas[i1 + k]["w"] = guion[j1 + k]
            elif op == "replace" and (i2 - i1) == (j2 - j1):
                for k in range(i2 - i1):
                    cambios.append((oidas[i1 + k]["w"], guion[j1 + k]))
                    oidas[i1 + k]["w"] = guion[j1 + k]
        print("aviso: %d palabras transcritas vs %d del guion; alineación "
              "parcial por difflib" % (len(oidas), len(guion)), file=sys.stderr)

    tr["text"] = " ".join(guion)
    tr["alineado_con_guion"] = True

    destino = args.output or args.transcript
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(tr, f, ensure_ascii=False, indent=2)

    print(json.dumps({"salida": destino, "palabras": len(oidas),
                      "corregidas": len(cambios)}, ensure_ascii=False, indent=2))
    for antes, ahora in cambios[:12]:
        print("  «%s» -> «%s»" % (antes, ahora))
    return 0


if __name__ == "__main__":
    sys.exit(main())
