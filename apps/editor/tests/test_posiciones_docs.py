"""La puerta que ata la prosa de `POS_*` a la tabla `POSICIONES`.

Existe porque la puerta se escribió DESPUÉS de arreglar las cuatro frases que
mentían, y una puerta que nace con el prado limpio no demuestra nada: da verde
igual si sus dos expresiones regulares no casan con nada. Aquí se le enseñan
las frases REALES que estuvieron escritas en el repo —`b3cf841` las dejó en
`CLAUDE.md`, en el docstring de `leer_guion.py`, en un mensaje de informe que
el usuario lee al montar, y en `guiones/CONTRATO.md`, que además se
contradecía a sí mismo— y se comprueba que las caza.

Y al revés, que es la mitad que se olvida: si algún día `POSICIONES` vuelve a
emitir, las frases de HOY pasan a ser las falsas. La puerta es simétrica y esa
simetría también se prueba.
"""

from __future__ import annotations

import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import comprobar_docs  # noqa: E402
import leer_guion      # noqa: E402


# Las cuatro, copiadas del árbol tal y como estaban.
MENTIAN = [
    "`POSICIONES` emite `dx`/`dy` en la capa, cada acto full-motion emite",
    "- **`POS_*` se emite.** `dx`/`dy` viajan en la capa —escaleta los pasa, el",
    '                       "El de las CAPAS sí: POS_* emite dx/dy; colocar.py "',
    "`POS_*` se traduce a desplazamiento de COMPOSICIÓN: `dx`/`dy` viajan",
]

# Las que describen la tabla vacía de hoy. Ninguna puede saltar la puerta
# mientras `POSICIONES` siga vacía.
HONESTAS = [
    "# `POS_*` se INFORMA, no se emite. Y esto es una vuelta atrás medida.",
    "`POS_*` **se informa y no se emite**: ninguna posición se traduce a",
    "desplazamiento; quien coloca es la plantilla y colocar.py, que afina",
    "El de las CAPAS tampoco: POS_* se informa y no emite desplazamiento",
]


def test_la_tabla_esta_vacia_hoy():
    """El resto del fichero depende de esto, así que se afirma en voz alta en
    vez de darlo por hecho: si alguien rellena la tabla, es ESTA prueba la que
    falla primero y con el mensaje entendible."""
    assert not any(leer_guion.POSICIONES.values()), (
        "`POSICIONES` volvió a emitir: revisa la prosa de CLAUDE.md, "
        "leer_guion.py y guiones/CONTRATO.md, que hoy dice lo contrario")
    assert len(leer_guion.POSICIONES) == 6


def test_caza_las_frases_que_mintieron():
    for linea in MENTIAN:
        assert comprobar_docs.AFIRMA.search(linea), linea
        assert not comprobar_docs.NIEGA.search(linea), (
            "«%s» no niega nada; si NIEGA casa, la línea se salta la puerta"
            % linea.strip())


def test_deja_pasar_las_honestas():
    """«No la marca» tiene dos formas legítimas y las dos valen: que la línea
    niegue explícitamente, o que no afirme nada —los mensajes del informe van
    partidos en varias cadenas y solo una lleva el verbo—."""
    for linea in HONESTAS:
        assert (comprobar_docs.NIEGA.search(linea)
                or not comprobar_docs.AFIRMA.search(linea)), linea


def test_el_arbol_esta_limpio():
    """Sobre el repo de verdad, que es lo único que protege a nadie."""
    assert comprobar_docs._posiciones() == []


def test_la_puerta_es_simetrica(monkeypatch):
    """Con la tabla emitiendo, las frases honestas de hoy son las falsas."""
    monkeypatch.setitem(leer_guion.POSICIONES, "POS_MID_RIGHT", {"dx": 250})
    fallos = comprobar_docs._posiciones()
    assert fallos, ("con `POSICIONES` emitiendo, las frases de «se informa y "
                    "no se emite» del árbol tienen que salir en rojo")
    assert any("NO se emite" in f for f in fallos)
