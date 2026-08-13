"""Ningún default ESCALAR puede llevar el contenido de una pieza concreta.

El fallo, medido: `hero-stat` traía `nota: 'un repositorio entero'` —el pie de
la pieza de Codex— y `odometro` traía `pie: 'en una sola pasada de ffmpeg'`.
Las dos son ranuras DECORATIVAS y opcionales, así que un plan que escribe
`valor`, `rotulo` y `etiqueta` las deja como estaban y la frase de una pieza
aparece dentro de otra. Se compuso «un repositorio entero» bajo una cifra de
respiraciones al día y bajo «4 momentos donde entra el sesgo». No dio un solo
aviso: el texto existe, la plantilla lo pinta y todo funciona.

## Por qué solo los ESCALARES

El contenido de muestra de las listas no es el mismo problema y no se toca:
los `pasos` de `pasos-flow`, los `nodos` de `data-diagram`, las líneas de
`terminal`. Esas el plan las reemplaza ENTERAS —o las escribes o no hay
gráfico— así que nunca conviven con la config. Además son lo que hace que la
hoja de contactos y la galería enseñen algo.

La regla es esa: **una clave de texto que puede sobrevivir junto a la config
del plan nace vacía; una que el plan reemplaza entera puede traer muestra.**

## Dos puertas, y la segunda es la que no envejece

La primera es un VOCABULARIO: las palabras de las piezas montadas aquí.
Funciona porque el fallo es siempre el mismo —alguien monta una pieza, escribe
el copy bonito en el default mientras la prueba y ahí se queda—, pero va por
detrás por construcción. Se comprobó: con la lista puesta y en verde, el mismo
`hero-stat` seguía trayendo `etiqueta: 'tokens de contexto'`, que es de la
pieza de Codex igual que la nota, y salió compuesto bajo «MODELOS SESGADOS» en
las diez piezas de sesgos. La lista no lo vio porque «tokens» no estaba en
ella, y no estaba porque nadie la había escrito.

La segunda es ESTRUCTURAL y no depende de ninguna palabra: si la plantilla
esconde una ranura cuando viene vacía —`el.style.display = cfg.X ? '' : 'none'`—
entonces su autor ya declaró que es OPCIONAL, y una ranura opcional con texto
dentro es una fuga esperando a que un plan no la escriba. Esa es la regla que
habría cazado `etiqueta` el primer día, y la que cazará la siguiente sin que
haya que acordarse de nada.
"""

from __future__ import annotations

import os
import re

import pytest

import reloj

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(RAIZ, "templates")

# Vocabulario de las piezas montadas en este repo. Ampliar es añadir una
# palabra.
DE_UNA_PIEZA = re.compile(
    r"repositorio|codex|ffmpeg|whisper|openai|github|mi-repo|playwright|"
    r"respirar|respiración|diafragma|nervio vago|sesgo|tokens de contexto|"
    r"ventana de contexto", re.I)

# Claves de texto ESCALARES: las que conviven con la config del plan.
ESCALARES = re.compile(
    r"^\s*(nota|pie|etiqueta|rotulo|subtitulo|sub|titular|leyenda|firma|"
    r"medio|seccion|entradilla|fecha|marca|lectura)\s*:\s*'([^']*)'", re.M)


def plantillas():
    return sorted(f for f in os.listdir(TPL)
                  if f.endswith(".html") and not f.startswith("_"))


@pytest.mark.parametrize("fichero", plantillas())
def test_ningun_default_escalar_lleva_copy_de_una_pieza(fichero):
    src = open(os.path.join(TPL, fichero), encoding="utf-8").read()
    bloque = reloj.bloque_defaults(src) or ""
    # Los comentarios explican el fallo y NOMBRAN las frases que lo causaron;
    # contarlos sería castigar justo a quien lo dejó escrito.
    bloque = re.sub(r"/\*.*?\*/", "", bloque, flags=re.S)

    culpables = [(m.group(1), m.group(2)) for m in ESCALARES.finditer(bloque)
                 if DE_UNA_PIEZA.search(m.group(2))]
    assert not culpables, (
        "%s trae copy de una pieza concreta en una ranura que el plan casi "
        "nunca escribe: %s.\n"
        "    Déjala vacía: una clave de texto que sobrevive junto a la config "
        "del plan aparece dentro de OTRA pieza y nada lo avisa."
        % (fichero, ", ".join("%s='%s'" % c for c in culpables)))


def test_la_puerta_muerde():
    """Una puerta escrita DESPUÉS de limpiar el prado da verde igual si sus
    expresiones no casan con nada. Se le enseñan las dos frases reales que
    estuvieron en el árbol."""
    for linea in ("    nota: 'un repositorio entero',",
                  "    pie: 'en una sola pasada de ffmpeg',"):
        m = ESCALARES.search(linea)
        assert m, linea
        assert DE_UNA_PIEZA.search(m.group(2)), linea


def test_el_contenido_de_muestra_de_las_listas_no_se_toca():
    """`pasos-flow` y `data-diagram` traen muestra dentro de LISTAS y tienen
    que seguir trayéndola: es lo que enseña la hoja de contactos, y el plan la
    reemplaza entera. Si esta prueba se pone en rojo es que alguien ha
    extendido la puerta a las listas, que es justo lo que no debe hacer."""
    for f in ("pasos-flow.html", "data-diagram.html"):
        src = open(os.path.join(TPL, f), encoding="utf-8").read()
        bloque = reloj.bloque_defaults(src) or ""
        assert DE_UNA_PIEZA.search(bloque), f


# ==========================================================================
#  la puerta que no depende de ninguna palabra
# ==========================================================================
# `el.style.display = cfg.X ? '' : 'none'` es la plantilla diciendo «esta
# ranura es opcional». Una ranura opcional con texto de fábrica es una fuga:
# el plan escribe lo que le importa, no la escribe, y el texto de otra pieza
# sale compuesto sin que nada avise.
#
# Es la regla que la lista de vocabulario no pudo dar: `hero-stat.etiqueta`
# decía 'tokens de contexto' con la lista en verde, y salió bajo «MODELOS
# SESGADOS» en las diez piezas de sesgos.
OCULTA_SI_VACIA = re.compile(
    r"\.style\.display\s*=\s*cfg\.([A-Za-z_$][\w$]*)\s*\?", re.M)

# La ranura de COPY se exime, y no por comodidad: es la única que el pipeline
# rellena POR CONTRATO —`leer_guion.COPY` dice cuál es y de ahí va el
# `card_copy` del guion—, así que su muestra no sobrevive a un plan real. Las
# demás ranuras opcionales no las llena nadie si el guion no se acuerda, que
# es justo el fallo. Aun así pasa por la puerta del VOCABULARIO: eximirla de
# ser opcional no la exime de llevar el copy de una pieza.
import leer_guion                             # noqa: E402


def _copy_de(nombre: str) -> set:
    c = leer_guion.COPY.get(nombre)
    if c is None:
        return set()
    return set(c) if isinstance(c, (list, tuple)) else {c}


def _default_de(src: str, clave: str):
    """El valor literal de `clave:` dentro del bloque `defaults`, o None."""
    m = re.search(r"^\s*%s\s*:\s*(['\"])(.*?)\1\s*,?\s*$" % re.escape(clave),
                  src, re.M)
    return m.group(2) if m else None


@pytest.mark.parametrize("nombre", plantillas())
def test_una_ranura_opcional_nace_vacia(nombre):
    src = open(os.path.join(TPL, nombre), encoding="utf-8").read()
    mal = []
    exentas = _copy_de(nombre)
    for clave in sorted(set(OCULTA_SI_VACIA.findall(src)) - exentas):
        valor = _default_de(src, clave)
        if valor:
            mal.append("%s: `%s` se oculta cuando viene vacía —o sea que es "
                       "opcional— y trae «%s» de fábrica. Un plan que no la "
                       "escriba compone ese texto." % (nombre, clave, valor))
    assert not mal, "\n".join(mal)


def test_la_puerta_estructural_muerde():
    """Con el default que tenía `hero-stat`, la regla dispara. Sin esto la
    prueba se quedaría vigilando el vacío el día que ya no haya fugas."""
    falso = ("Engine.register({\n"
             "  defaults: {\n"
             "    etiqueta: 'tokens de contexto',\n"
             "  },\n"
             "  setup(cfg) { elEti.style.display = cfg.etiqueta ? '' : 'none'; }\n"
             "})")
    claves = set(OCULTA_SI_VACIA.findall(falso))
    assert claves == {"etiqueta"}
    assert _default_de(falso, "etiqueta") == "tokens de contexto"
