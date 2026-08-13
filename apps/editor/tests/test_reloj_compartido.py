"""El contrato COMPARTIDO del reloj origen→salida (fixtures/reloj/casos.json).

El mismo fichero lo consume vitest en apps/workers (apretar.ts): dos
implementaciones del mismo concepto que tienen que mapear IGUAL dentro de un
keep. Aquí se asierta la columna `clamp_ms` — la semántica del editor: fuera
de un keep, el tiempo va al borde más cercano, porque un gráfico anclado a
una pausa tiene que ir a algún sitio. La columna `out_ms` (null = se cae) es
la del worker y se asierta allí.
"""

from __future__ import annotations

import json
import os

import pytest

from reloj import Mapa

AQUI = os.path.dirname(__file__)


def casos():
    with open(os.path.join(AQUI, "fixtures", "reloj", "casos.json")) as f:
        datos = json.load(f)
    for caso in datos["casos"]:
        yield pytest.param(caso, id=caso["nombre"])


@pytest.mark.parametrize("caso", casos())
def test_mapa_cumple_el_contrato(caso):
    # el fixture va en ms enteros (exactos también para JS); Mapa habla segundos
    mapa = Mapa([
        {"src_start": k["src_start_ms"] / 1000,
         "src_end": k["src_end_ms"] / 1000,
         "out_start": k["out_start_ms"] / 1000}
        for k in caso["keep"]
    ])
    for sonda in caso["sondas"]:
        esperado = sonda["clamp_ms"] / 1000
        assert mapa(sonda["t_ms"] / 1000) == pytest.approx(esperado, abs=1e-6), (
            f"t={sonda['t_ms']} ms en «{caso['nombre']}»")


def test_keep_vacio_no_tiene_metraje():
    # la sonda clamp=0 del caso vacío no es «dura cero»: es «no hay metraje»,
    # y hay_metraje() existe para no confundir esas dos respuestas
    assert Mapa([]).hay_metraje() is False
    assert Mapa([]).duracion() == 0.0
