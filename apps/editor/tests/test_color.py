"""Los tokens de color, con la aritmética que decidió el segundo acento.

El sistema de color no tenía ninguna red: un cambio de token salía en el vídeo y
en ningún log. Y el fallo que estas pruebas fijan estuvo abierto trece tandas —
`--accent-2` a ΔE 9,2 del acento en carbon, o sea el mismo color otra vez, con
doce componentes usándolo para DIFERENCIAR algo—.

La aritmética se valida contra los números que el propio ROADMAP midió (9,2 en
carbon y 97,2 en paper con los valores antiguos), así que no es una
implementación nueva que dé lo que le apetezca: reproduce la que tomó la
decisión.
"""

from __future__ import annotations

import math
import os
import re

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKENS = os.path.join(RAIZ, "templates", "_tokens.css")


# --------------------------------------------------------------------------
#  aritmética de color: sRGB -> Lab, ΔE(CIE76), contraste WCAG, saturación
# --------------------------------------------------------------------------
def hex2rgb(h: str) -> tuple:
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def _lineal(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lab(h: str) -> tuple:
    r, g, b = (_lineal(x) for x in hex2rgb(h))
    X = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    Y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    Z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    Xn, Yn, Zn = 0.95047, 1.0, 1.08883

    def f(t):
        return t ** (1 / 3) if t > (6 / 29) ** 3 else t / (3 * (6 / 29) ** 2) + 4 / 29
    fx, fy, fz = f(X / Xn), f(Y / Yn), f(Z / Zn)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def dE(a: str, b: str) -> float:
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(lab(a), lab(b))))


def luminancia(h: str) -> float:
    r, g, b = (_lineal(x) for x in hex2rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contraste(a: str, b: str) -> float:
    lo, hi = sorted((luminancia(a), luminancia(b)))
    return (hi + 0.05) / (lo + 0.05)


def saturacion(h: str) -> float:
    r, g, b = hex2rgb(h)
    mx, mn = max(r, g, b), min(r, g, b)
    if mx == mn:
        return 0.0
    l = (mx + mn) / 2
    return (mx - mn) / (2 - mx - mn) if l > 0.5 else (mx - mn) / (mx + mn)


def matiz(h: str) -> float:
    r, g, b = hex2rgb(h)
    mx, mn = max(r, g, b), min(r, g, b)
    if mx == mn:
        return 0.0
    d = mx - mn
    if mx == r:
        t = ((g - b) / d) % 6
    elif mx == g:
        t = (b - r) / d + 2
    else:
        t = (r - g) / d + 4
    return t * 60


# --------------------------------------------------------------------------
def test_la_aritmetica_reproduce_lo_que_midio_el_roadmap():
    """Antes de fiarse de estas pruebas: los valores ANTIGUOS tienen que dar los
    números que el ROADMAP publicó. Si no, la implementación es otra y sus
    veredictos no son comparables con la decisión que se tomó."""
    assert dE("#CD7F32", "#B87333") == pytest.approx(9.2, abs=0.1)
    assert dE("#C2410C", "#0F766E") == pytest.approx(97.2, abs=0.1)


# --------------------------------------------------------------------------
def tokens_del_tema(tema: str) -> dict:
    """Lee un bloque de tema de `_tokens.css`. Se parsea con expresión regular
    y no importando nada, igual que `validar_plan.leer_orden`: el CSS es la
    fuente de verdad y no hay que duplicarlo en Python."""
    src = open(TOKENS, encoding="utf-8").read()
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)   # los comentarios mienten
    if tema == "carbon":
        # el bloque por defecto es carbon
        m = re.search(r":root\s*\{(.*?)\n\}", src, re.S)
    else:
        m = re.search(r'\[data-tema="%s"\]\s*\{(.*?)\n\}' % tema, src, re.S)
    assert m, "no encuentro el bloque del tema «%s»" % tema
    return dict(re.findall(r"--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})\s*;", m.group(1)))


TEMAS = ["carbon", "paper"]


@pytest.mark.parametrize("tema", TEMAS)
def test_los_dos_acentos_diferencian(tema):
    """LA prueba de este fichero. Doce plantillas usan `--accent-2` para
    diferenciar algo —números de tabla, líneas `ok` del terminal, foco del mapa
    de calor, anotaciones `frio`, pastillas `stat`…— y con ΔE 9,2 no
    diferenciaban nada en tema oscuro.

    El umbral son 40: muy por encima del 9,2 que había y holgadamente por debajo
    del 73,7 que da el cardenillo, así que no fija el color elegido sino la
    propiedad que hacía falta."""
    t = tokens_del_tema(tema)
    d = dE(t["accent"], t["accent-2"])
    assert d >= 40, "ΔE %.1f entre acento y acento-2 en %s: son el mismo color" \
        % (d, tema)


def test_el_segundo_acento_no_grita_mas_que_el_primero():
    """Un acento SECUNDARIO más brillante que el principal invierte la jerarquía.
    Es lo que descartó las variantes claras del cardenillo: 6,6:1 frente a los
    6,0:1 del bronce.

    Se comprueba con la LUMINANCIA y solo en el tema oscuro. Mi primera versión
    usaba el contraste con el fondo en los dos temas y fallaba en paper, con
    razón: sobre fondo claro más contraste significa más OSCURO, no más
    ruidoso, y el acento-2 de paper es un verde ligeramente más oscuro que su
    naranja (5,0:1 frente a 4,7:1) sin que eso lo haga dominante. La regla que
    yo quería era «no más brillante», y solo se puede escribir así."""
    t = tokens_del_tema("carbon")
    l1, l2 = luminancia(t["accent"]), luminancia(t["accent-2"])
    assert l2 <= l1 * 1.05, \
        "el acento-2 de carbon es más brillante que el acento (%.3f vs %.3f)" \
        % (l2, l1)


@pytest.mark.parametrize("tema", TEMAS)
def test_los_acentos_se_leen_como_texto(tema):
    """`data-diagram` pinta los números de tabla y `terminal` las líneas `ok`
    con el acento-2: es TEXTO, así que necesita el 4,5:1 de la AA. Es el número
    que descartó usar el verde de paper tal cual en carbon, que se queda en
    3,4:1."""
    t = tokens_del_tema(tema)
    for clave in ("accent", "accent-2"):
        c = contraste(t[clave], t["bg"])
        assert c >= 4.5, "%s en %s: %.1f:1, por debajo de la AA" % (clave, tema, c)


@pytest.mark.parametrize("tema", TEMAS)
def test_ningun_acento_es_neon(tema):
    """§1-2: «nada de neón». El techo lo pone el propio bronce, que es el color
    de marca: si el acento-2 lo pasa, deja de ser Carbon & Bronze."""
    t = tokens_del_tema(tema)
    techo = saturacion(t["accent"])
    s = saturacion(t["accent-2"])
    assert s <= techo + 0.02, \
        "en %s el acento-2 satura %.2f y el acento %.2f" % (tema, s, techo)


def test_los_dos_temas_significan_lo_mismo():
    """Los dos temas tienen que hablar con la MISMA voz: el acento en la misma
    familia de matiz y el acento-2 en la suya, en carbon y en paper. Sin esto,
    un componente que use el acento-2 para «lo secundario» diría una cosa en un
    tema y otra en el otro, y el sistema de color dejaría de ser un sistema.

    Esta prueba fijaba «el acento es CÁLIDO y el acento-2 FRÍO», que era la
    paleta Carbon & Bronze escrita como aserto. Con papel y tinta es al revés
    —azul de sello contra rojo de rúbrica— y el aserto habría bloqueado el
    cambio de paleta sin decir nada sobre la regla que de verdad importa, que
    es la coherencia ENTRE temas. Se comprueba la relación, no el color."""
    ts = {tema: tokens_del_tema(tema) for tema in TEMAS}
    for clave in ("accent", "accent-2"):
        hs = [matiz(ts[tema][clave]) for tema in TEMAS]
        d = abs(hs[0] - hs[1])
        d = min(d, 360 - d)
        assert d <= 30, ("`%s` cambia de familia entre temas: %.0f° y %.0f°"
                         % (clave, hs[0], hs[1]))
    for tema in TEMAS:
        h1, h2 = matiz(ts[tema]["accent"]), matiz(ts[tema]["accent-2"])
        d = abs(h1 - h2)
        d = min(d, 360 - d)
        assert d >= 60, ("en %s el acento y el acento-2 son la misma familia "
                         "(%.0f° y %.0f°): el segundo no diferencia nada"
                         % (tema, h1, h2))


def test_los_bloques_de_carbon_no_se_han_desincronizado():
    """`_tokens.css` declara los tokens de carbon DOS veces —el `:root` por
    defecto y el `[data-tema="carbon"]`— y tocar uno y olvidar el otro deja el
    tema con dos valores según cómo se pida. Los dos bloques tienen que coincidir
    en los acentos."""
    src = re.sub(r"/\*.*?\*/", " ",
                 open(TOKENS, encoding="utf-8").read(), flags=re.S)
    valores = re.findall(r"--accent-2\s*:\s*(#[0-9A-Fa-f]{6})", src)
    assert len(valores) == 3, "esperaba 3 declaraciones (2 carbon + 1 paper)"
    assert valores[0] == valores[1], \
        "los dos bloques de carbon declaran %s y %s" % (valores[0], valores[1])


def test_la_rampa_de_metal_pertenece_al_acento():
    """Los cinco stops del degradado son el MATERIAL del acento, no un color
    aparte: si uno se despega, el acabado de todas las tarjetas se destiñe
    respecto al resto de la marca.

    Esto fijaba `--metal-2 == "#B87333"`, o sea el bronce a pelo, y eso es la
    paleta vieja escrita como aserto: al cambiar a papel y tinta habría fallado
    sin decir nada de la regla. Lo que perdura es la RELACIÓN — cada stop
    dentro de la misma familia que el acento — y eso vale para cualquier
    paleta."""
    for tema in TEMAS:
        t = tokens_del_tema(tema)
        for n in range(1, 6):
            k = "metal-%d" % n
            if k not in t:
                continue
            d = dE(t[k], t["accent"])
            assert d < 45, ("en %s `--%s` está a ΔE %.1f del acento: ya no es "
                            "su material, es otro color" % (tema, k, d))
