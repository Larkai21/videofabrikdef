#!/usr/bin/env python3
"""Comprueba los contratos entre etapas sobre los artefactos REALES de build/.

Las mismas funciones que usan las pruebas, expuestas como comando. Es lo que
convierte el arnés en algo que protege al que edita Reels y no solo al que
escribió las pruebas: se ejecuta sobre lo que hay en `build/` en cada sesión.

Uso:
    python3 scripts/comprobar_contratos.py
    python3 scripts/comprobar_contratos.py --build otro/
    python3 scripts/comprobar_contratos.py --sin-disco   # no cuenta fotogramas

Devuelve 1 si algún artefacto incumple su contrato.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import comun                                 # noqa: E402

import contratos                             # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", default=comun.build_dir())
    ap.add_argument("--sin-disco", action="store_true",
                    help="no comprobar el recuento de fotogramas")
    args = ap.parse_args()

    total = 0
    revisados = 0
    for nombre, comprueba in contratos.TODOS.items():
        ruta = os.path.join(args.build, nombre)
        if not os.path.exists(ruta):
            print("  · %-18s no está todavía" % nombre)
            continue
        try:
            d = json.load(open(ruta, encoding="utf-8"))
        except ValueError as e:
            print("  ✗ %-18s no es JSON válido: %s" % (nombre, e))
            total += 1
            continue

        if nombre == "layers.json":
            # `base` es el build: es donde vive el manifiesto, así que sus
            # rutas relativas se resuelven contra él.
            mal = comprueba(d, comprobar_disco=not args.sin_disco,
                            base=args.build)
        else:
            mal = comprueba(d)
        revisados += 1
        if mal:
            print("  ✗ %-18s %d problema(s)" % (nombre, len(mal)))
            for x in mal:
                print("      %s" % x)
            total += len(mal)
        else:
            print("  ✓ %-18s cumple" % nombre)

    print("\n%d artefacto(s) revisados, %d problema(s)" % (revisados, total))
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
