"""Configuración común del arnés.

`tests/` vive en la raíz y no dentro de `scripts/` porque `scripts/` es la
superficie pública del pipeline —CLAUDE.md la trata como tal— y las pruebas no
son un paso del pipeline.

No hace falta refactorizar nada para importar los módulos: los 38 scripts se
importan en menos de 15 ms en total, sin efectos de módulo y con todo `main()`
bajo `if __name__`. Basta con poner `scripts/` en el path.
"""

from __future__ import annotations

import os
import sys

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


def pytest_configure(config):
    for m, d in [
        ("lento", "cadena completa con material real (1-2 min)"),
        ("render", "necesita Playwright y un navegador"),
        ("ffmpeg", "necesita el binario de ffmpeg"),
    ]:
        config.addinivalue_line("markers", "%s: %s" % (m, d))


@pytest.fixture(scope="session")
def raiz():
    return RAIZ


@pytest.fixture(scope="session")
def fixtures():
    return FIXTURES


def palabras(*tramos):
    """Atajo para construir listas de palabras en las pruebas.

    `palabras(("hola", 0.0, 0.4), ("mundo", 1.0, 1.5))`
    """
    return [{"w": w, "start": float(a), "end": float(b), "p": 1.0}
            for w, a, b in tramos]


def keep(*tramos):
    """`keep((0, 5), (8, 13))` con `out_*` encadenados."""
    fuera, cursor = [], 0.0
    for a, b in tramos:
        fuera.append({"src_start": float(a), "src_end": float(b),
                      "out_start": round(cursor, 3),
                      "out_end": round(cursor + (b - a), 3)})
        cursor += b - a
    return fuera
