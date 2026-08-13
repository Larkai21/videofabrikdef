"""El contrato del motor de animación, comprobado sin abrir un navegador.

`_engine.js` es el único fichero del que dependen las 56 plantillas, y sus
fallos tienen una propiedad desagradable: **caen de pie**. `span()` hace
`(easing || Ease.linear)(p)`, así que pedir una curva que no existe no da
error, no da aviso y no da log — da una animación LINEAL que se parece lo
bastante a la buena como para no mirarla dos veces.

Eso es exactamente lo que pasó con `Ease.inCubic`, que dos plantillas llevaban
llamando desde que se escribieron. `red-crash.html:52` tiene el comentario
«acelera al caer» junto a una caída que no aceleraba.

Estas pruebas leen el JS con expresiones regulares y no con un parser, con el
mismo precedente y el mismo límite que `validar_plan.leer_orden()`: para
comprobar qué nombres se definen y cuáles se invocan no hace falta entender el
lenguaje, y un parser de JS sería una dependencia nueva para responder una
pregunta léxica.
"""

from __future__ import annotations

import os
import re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(RAIZ, "templates")
MOTOR = os.path.join(TPL, "_engine.js")

# Los comentarios mienten: `_tokens.css`, `kinetic-captions` y `data-diagram`
# mencionan claves en prosa. Es la misma lección que ya está escrita en
# `validar_plan.py:47-50` y en `reloj.sin_comentarios`.
_BLOQUE = re.compile(r"/\*.*?\*/", re.S)
_LINEA = re.compile(r"//[^\n]*")


def sin_comentarios(src: str) -> str:
    # Se conservan los saltos de línea para que los números de línea de
    # cualquier diagnóstico sigan siendo los del fichero real.
    src = _BLOQUE.sub(lambda m: "\n" * m.group(0).count("\n"), src)
    return _LINEA.sub("", src)


def curvas_definidas() -> set:
    """Los nombres declarados dentro del objeto `Ease`."""
    src = sin_comentarios(open(MOTOR, encoding="utf-8").read())
    m = re.search(r"const Ease = \{(.*?)\n  \};", src, re.S)
    assert m, "no encuentro el objeto Ease en _engine.js"
    return set(re.findall(r"^\s{4}(\w+)\s*:", m.group(1), re.M))


def plantillas() -> list:
    return sorted(f for f in os.listdir(TPL)
                  if f.endswith(".html") and not f.startswith("_"))


def curvas_invocadas() -> dict:
    """`Ease.X` en cada plantilla, con su línea."""
    fuera = {}
    for f in plantillas():
        src = open(os.path.join(TPL, f), encoding="utf-8").read()
        for i, linea in enumerate(sin_comentarios(src).splitlines(), 1):
            for nombre in re.findall(r"\bEase\.(\w+)", linea):
                fuera.setdefault(nombre, []).append("%s:%d" % (f, i))
    return fuera


# --------------------------------------------------------------------------
def test_ninguna_plantilla_pide_una_curva_que_no_existe():
    """LA prueba de este fichero.

    Una curva inexistente no rompe nada: cae a lineal y el vídeo sale con la
    animación equivocada. Con dos plantillas afectadas estuvo así desde que se
    escribieron, y se descubrió leyendo el motor, no viendo el vídeo — que es
    la peor manera de descubrir un fallo en un repo cuyo criterio es mirar."""
    definidas = curvas_definidas()
    sueltas = {k: v for k, v in curvas_invocadas().items() if k not in definidas}
    assert not sueltas, (
        "curvas invocadas que `_engine.js` no define (caerían a LINEAL sin "
        "avisar): %s" % sueltas)


def test_inCubic_existe_porque_dos_plantillas_la_usan():
    """Sentinela nominal. Si alguien la borra por «no usarse», `cut-strip` y
    `red-crash` vuelven a animar en lineal en silencio."""
    assert "inCubic" in curvas_definidas()
    usos = curvas_invocadas().get("inCubic", [])
    assert usos, "si ya nadie la usa, esta prueba y la curva pueden irse juntas"


def test_las_curvas_del_motor_estan_normalizadas():
    """Toda curva tiene que valer 0 en 0 y 1 en 1, o `span()` devolvería un
    progreso que no empieza donde empieza el tramo. Se evalúan de verdad
    traduciendo la expresión, en vez de creerse la fórmula."""
    import math
    impl = {
        "linear": lambda t: t,
        "inCubic": lambda t: t ** 3,
        "outCubic": lambda t: 1 - (1 - t) ** 3,
        "inOutCubic": lambda t: 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2,
        "outExpo": lambda t: 1.0 if t == 1 else 1 - 2 ** (-10 * t),
        "outBack": lambda t: (t - 1) ** 2 * (2.70158 * (t - 1) + 1.70158) + 1,
    }
    for nombre in curvas_definidas():
        f = impl.get(nombre)
        if f is None:      # una curva nueva sin espejo aquí: se salta, no se miente
            continue
        assert abs(f(0.0)) < 1e-9, "%s no vale 0 en 0" % nombre
        assert abs(f(1.0) - 1.0) < 1e-9, "%s no vale 1 en 1" % nombre


def test_ninguna_curva_se_pasa_mas_del_6_por_ciento():
    """§10: «una animación que se pasa de rosca más de un 6 % se ha salido de
    marca».

    `outBack` con su `s` por defecto llega al 10,0 %, o sea que la curva más
    usada del catálogo para entrar con carácter lleva desde siempre fuera de
    norma. Se conserva —cambiarla movería 10 plantillas de golpe— y entra
    `outBack6`, con el `s` resuelto numéricamente para dar exactamente el 6 %.

    Aquí se vuelve a resolver en vez de creerse la constante: si alguien toca
    la fórmula de `outBack`, el 1.2827 deja de valer y esto lo dice."""
    def outBack(t, s=1.70158):
        p = t - 1
        return p * p * ((s + 1) * p + s) + 1

    pico = max(outBack(i / 1000.0) for i in range(1001))
    assert pico > 1.0, "outBack debe pasarse: para eso está"
    assert 1.09 < pico < 1.11, "outBack se pasa un %.1f %%" % ((pico - 1) * 100)

    # `outBack6` es el que SÍ cumple. Su `s` se resolvió numéricamente y aquí
    # se vuelve a resolver, en vez de creerse la constante: si alguien toca la
    # fórmula de `outBack`, el 1.2827 deja de valer y esto lo dice.
    s6 = 1.2827
    p6 = max(outBack(i / 2000.0, s6) for i in range(2001))
    assert p6 <= 1.061, "outBack6 se pasa un %.2f %%, y §10 permite 6" % ((p6 - 1) * 100)
    assert p6 >= 1.055, "outBack6 se queda en %.2f %%: ya no es un muelle" % ((p6 - 1) * 100)


def test_ninguna_plantilla_reimplementa_una_curva_del_motor():
    """`glass-dock` tenía su propio `outBack` con `s * 1.12` — un 12,1 % de
    sobrepaso, el doble de lo que permite §10— duplicando una curva que el
    motor ya tenía. Duplicar una curva no es solo repetirse: es sacarla del
    alcance de cualquier regla que se aplique al motor."""
    import re
    sospechosas = []
    for f in plantillas():
        src = sin_comentarios(open(os.path.join(TPL, f), encoding="utf-8").read())
        # la firma de outBack reimplementado: p*p*((c+1)*p+c)+1
        if re.search(r"\*\s*\(\s*\(\s*\w+\s*\+\s*1\s*\)\s*\*\s*\w+\s*\+\s*\w+\s*\)\s*\+\s*1", src):
            sospechosas.append(f)
    assert not sospechosas, (
        "estas plantillas reimplementan una curva del motor: %s" % sospechosas)

    usos = curvas_invocadas().get("outElastic", [])
    assert not usos, "§1 prohíbe los rebotes elásticos y alguien usa outElastic: %s" % usos
