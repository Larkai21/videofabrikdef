"""Humo de todo el catálogo. Va al nivel de render, no al opt-in.

El coste está medido en el propio repo —`hoja_contactos.js` hace 56 capturas a
1080×1920 en 6,45 s— y la medición se confirma aquí: 56 plantillas en 8,7 s,
0,158 s cada una. Lo caro de este pipeline son los fotogramas de una pieza
(1431 en la última), no abrir el navegador.

La lógica vive en `scripts/humo_plantillas.js`, en JavaScript, que es donde
tiene que estar: necesita Playwright y el DOM. Aquí solo se ejecuta y se
afirma, plantilla por plantilla, para que un fallo diga QUÉ plantilla y POR QUÉ
en vez de «el humo falló».
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

pytestmark = pytest.mark.render


def _hay_navegador() -> bool:
    if not shutil.which("node"):
        return False
    return os.path.isdir(os.path.join(RAIZ, "node_modules", "playwright"))


@pytest.fixture(scope="module")
def humo():
    if not _hay_navegador():
        pytest.skip("hacen falta node y playwright (npm install)")
    r = subprocess.run(
        ["node", os.path.join(RAIZ, "scripts", "humo_plantillas.js")],
        capture_output=True, text=True, cwd=RAIZ, timeout=600)
    if not r.stdout.strip():
        pytest.fail("el humo no ha emitido JSON. stderr:\n%s" % r.stderr[-2000:])
    return json.loads(r.stdout)


def test_todas_las_plantillas_revisadas(humo):
    """El barrido tiene que cubrir el catálogo entero: si alguien añade una
    plantilla y el humo no la ve, el hueco es silencioso."""
    en_disco = {f for f in os.listdir(os.path.join(RAIZ, "templates"))
                if f.endswith(".html") and not f.startswith("_")}
    vistas = {r["plantilla"] for r in humo["resultados"]}
    assert vistas == en_disco, "sin revisar: %s" % (en_disco - vistas)


def test_el_humo_es_rapido(humo):
    """Si se pasa de 40 s deja de ser un nivel rápido y hay que bajar a dos
    instantes por plantilla. Se afirma para que la decisión no se tome por
    inercia cuando el catálogo crezca."""
    assert humo["segundos"] < 40, \
        "%.1f s: baja a dos instantes por plantilla" % humo["segundos"]


def test_ninguna_plantilla_con_problemas(humo):
    malas = {r["plantilla"]: r["problemas"]
             for r in humo["resultados"] if r["problemas"]}
    assert not malas, json.dumps(malas, indent=1, ensure_ascii=False)


# --------------------------------------------------------------------------
#  y las mismas comprobaciones, una por plantilla, para que el fallo señale
# --------------------------------------------------------------------------
def _por_plantilla(humo):
    return [(r["plantilla"], r) for r in humo["resultados"]]


def test_setup_devuelve_duracion(humo):
    sin = [p for p, r in _por_plantilla(humo)
           if not r.get("problemas") and not r.get("duration")]
    assert not sin, "setup() no devuelve duración en: %s" % sin


def test_todas_se_mueven(humo):
    """Los tres instantes no pueden dar el mismo fotograma. Una plantilla
    congelada pasa todos los demás controles: `dataset.frameReady` cambia
    porque `seek` se ha ejecutado, no porque algo se haya movido."""
    quietas = [p for p, r in _por_plantilla(humo)
               if any("no se mueve" in x for x in r["problemas"])]
    assert not quietas, quietas


def test_ninguna_raiz_opaca_sin_declararlo(humo):
    """El fondo del elemento RAÍZ queda fuera del grupo de opacidad del body,
    así que `omitBackground` no lo recorta y los PNG salen SIN alfa. El
    renderizador lo comprueba capa a capa; esto cubre las 56 de una vez."""
    malas = [p for p, r in _por_plantilla(humo)
             if any("sin alfa" in x for x in r["problemas"])]
    assert not malas, malas


def test_ninguna_usa_modo_como_clave_propia(humo):
    """`modo` la reserva el renderizador y la inyecta con `Object.assign`, así
    que pisa la del plan. Pasó con `subtitles-showcase` —salía siempre en
    rejilla— y con `data-diagram`, cuyo modo tabla era inalcanzable desde el
    pipeline aunque funcionara en la hoja de contactos. Las dos renombradas a
    `vista`."""
    malas = [p for p, r in _por_plantilla(humo)
             if any("dataset.modo" in x for x in r["problemas"])]
    assert not malas, malas


def test_anclas_dentro_del_lienzo(humo):
    """Caza el fallo de la tanda 6: una tarjeta que animaba su propio nodo
    borraba el `translateX(-50%)` que la centra y aparecía clavada por su borde
    izquierdo, medio fuera de cuadro."""
    malas = [p for p, r in _por_plantilla(humo)
             if any("fuera del lienzo" in x for x in r["problemas"])]
    assert not malas, malas


def test_ningun_fotograma_vacio(humo):
    """Una fuente que falta o un `omitBackground` mal puesto producen imágenes
    vacías que ningún log delata."""
    malas = [p for p, r in _por_plantilla(humo)
             if any("está vacío" in x for x in r["problemas"])]
    assert not malas, malas


def test_cobertura_de_muestras(humo):
    """Cuántas plantillas tienen config de muestra. No es un fallo tenerlas sin
    ella —el humo las prueba con sus `defaults`—, pero se registra: una
    plantilla sin muestra se juzga solo por lo que ella misma declara, y eso
    es más débil. Es deuda, y conviene verla."""
    n, total = humo["con_muestra"], humo["plantillas"]
    assert n >= 39, "solo %d de %d tienen muestra" % (n, total)
