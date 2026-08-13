#!/usr/bin/env python3
"""Lo que la documentación AFIRMA, comprobado contra la realidad. ~0,4 s.

(Era < 0,1 s. La diferencia es el recuento de pruebas del nivel rápido, que
solo pytest sabe hacer —ver `_pruebas`— y cuesta ~0,25 s medidos. Se paga
porque el número escrito a mano ya mintió una vez: «256 pruebas» siendo 272,
y subiendo, con agentes añadiendo pruebas en paralelo.)

Este sprint encontró cinco afirmaciones falsas en la documentación, y una de
ellas —«ninguna fuente de marca está instalada»— **bloqueó el diagnóstico del
aspecto genérico del catálogo**: mientras esa frase estuvo escrita, el problema
se atribuyó a fuentes ausentes y nadie buscó la causa real.

Una afirmación falsa en la documentación no es un error de redacción: es un
diagnóstico bloqueado. Y las que se pueden derivar de la realidad no tienen por
qué mantenerse a mano.

Mismo patrón que `comprobar_relojes.py`: es una PUERTA, no un aviso. Sale con 1
y dice el fichero, la línea y qué hacer.

## Qué NO comprueba, y por qué

**`ROADMAP.md` queda fuera, entero.** Es una bitácora *append-only*: «54
plantillas» en la entrada del Sprint 3 es *correcto*, describe el pasado. Sin
esta exclusión escrita, alguien «arreglaría» la bitácora y destruiría el
registro de lo que se sabía en cada momento.

Uso:
    python3 scripts/comprobar_docs.py
    python3 scripts/comprobar_docs.py --listar     # de dónde sale cada número
"""

from __future__ import annotations

import argparse
import glob
import os
import re
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(RAIZ, "templates")

# Los ficheros cuyo texto se comprueba. `ROADMAP.md` NO está: ver la cabecera.
DOCS = ["README.md", "CLAUDE.md", "BRAND_RULES.md",
        "Makefile", "requirements.txt", "requirements-dev.txt"]

CANONICO = re.compile(r"^[a-z0-9-]+\.html$")


def _plantillas() -> int:
    return len([f for f in os.listdir(TPL)
                if f.endswith(".html") and not f.startswith("_")
                and CANONICO.match(f)])


def _sfx() -> int:
    try:
        sys.path.insert(0, os.path.join(RAIZ, "scripts"))
        import hacer_sfx
        return len(hacer_sfx.catalogo())
    except Exception:
        return len(glob.glob(os.path.join(RAIZ, "assets", "sfx", "*.wav")))


def _claves_hoja() -> int:
    sys.path.insert(0, os.path.join(RAIZ, "scripts"))
    import reloj
    return len(reloj.SEMANTICA)


def _scripts() -> int:
    return len(glob.glob(os.path.join(RAIZ, "scripts", "*.py")) +
               glob.glob(os.path.join(RAIZ, "scripts", "*.js")))


def _pruebas() -> int:
    """Las pruebas RECOGIDAS en el nivel rápido, contadas por pytest con los
    mismos `-m` de `pytest.ini`. No vale un grep por `def test_`: la
    parametrización multiplica —hoy 274 recogidas sobre 294 definidas— y un
    grep no la ve. Es el único derivado que paga un subproceso: ~0,25 s
    medidos con `PYTEST_DISABLE_PLUGIN_AUTOLOAD` (sin él, ~0,31 s); ningún
    plugin externo participa en la recogida, así que apagarlos solo ahorra."""
    sys.path.insert(0, os.path.join(RAIZ, "scripts"))
    import comun
    py = os.path.join(RAIZ, ".venv", "bin", "python")
    if not os.path.exists(py):
        py = sys.executable
    r = subprocess.run(
        [py, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider"],
        cwd=RAIZ, capture_output=True, text=True, timeout=30,
        env=dict(os.environ, PYTEST_DISABLE_PLUGIN_AUTOLOAD="1"))
    comun.exige_ok(r, "pytest --collect-only (recuento del nivel rápido)",
                   arregla="make instalar")
    # «274/294 tests collected (20 deselected)» o «294 tests collected»: el
    # primer número es SIEMPRE el de las seleccionadas, que es el que se
    # promete en la documentación.
    m = re.search(r"(\d+)(?:/\d+)?\s+tests?\s+collected", r.stdout)
    if not m:
        print("pytest terminó bien pero no imprimió «N tests collected»; "
              "míralo a mano:  %s -m pytest --collect-only -q" % py,
              file=sys.stderr)
        raise SystemExit(2)
    return int(m.group(1))


def _contrato_guionista() -> list:
    """`guiones/CONTRATO.md` es un documento GENERADO entero: cada tabla es
    copia de las de `leer_guion.py`, del catálogo de `hacer_sfx.py` o de los
    `defaults` de las plantillas, y hay agentes ampliando esas tablas en
    paralelo. Un contrato viejo es el mismo fallo que motivó este script —el
    agente guionista pidió `cursor-tap` y `#4CC2FF` porque nada le decía qué
    SÍ hay— así que no se comprueba número a número: se regenera y se compara
    byte a byte. Misma idea que DERIVADAS con la granularidad al revés: allí
    el documento manda y el número se deriva; aquí el documento ES el
    derivado."""
    py = os.path.join(RAIZ, ".venv", "bin", "python")
    if not os.path.exists(py):
        py = sys.executable
    r = subprocess.run(
        [py, os.path.join(RAIZ, "scripts", "contrato_guion.py")],
        cwd=RAIZ, capture_output=True, text=True, timeout=60)
    if r.returncode == 0:
        return []
    if "no existe" in (r.stderr or ""):
        return ["guiones/CONTRATO.md no existe y la documentación lo cita: "
                "escríbelo con  python3 scripts/contrato_guion.py --escribir"]
    return ["guiones/CONTRATO.md diverge de las tablas de las que se genera "
            "(el diff lo enseña scripts/contrato_guion.py sin flags): "
            "regenéralo con  python3 scripts/contrato_guion.py --escribir"]


# La frase «POS_* emite dx/dy» y su contraria. Ninguna de las dos se puede
# escribir a mano sin que alguien la contradiga: la tabla `POSICIONES` ha ido
# y vuelto dos veces, y la segunda vuelta —`b3cf841`, medida sobre la pieza—
# dejó CUATRO sitios afirmando lo contrario del código, uno de ellos un
# mensaje que el usuario LEE al montar y otro `guiones/CONTRATO.md`, que se
# contradecía a sí mismo: el párrafo prometía `dx`/`dy` y las seis filas de
# debajo decían «ninguno».
#
# Los números derivables ya no se mantienen a mano (DERIVADAS). Esta es la
# misma idea para una afirmación booleana: la verdad es `any(POSICIONES
# .values())` y la prosa tiene que coincidir con ella, aquí y en el código.
#
# «se traduce a desplazamiento» está en la lista y no es redundante: es la
# forma exacta en que `CONTRATO.md` lo decía, sin usar el verbo «emitir» ni
# una sola vez. Una puerta que solo buscara «emite» habría dado verde sobre
# el fichero que peor mentía.
AFIRMA = re.compile(
    r"`?POS_\*`?[^.\n]{0,80}?\bemit\w+"
    r"|`?POSICIONES`?[^.\n]{0,80}?\bemit\w+"
    r"|\bemite\b[^.\n]{0,12}`?dx`?\s*/\s*`?dy`?"
    r"|`?POS_\*`?[^.\n]{0,80}?\bse\s+traduce\s+a\s+desplazamiento", re.I)
NIEGA = re.compile(r"\bno\s+(?:se\s+)?emit\w+|se\s+INFORMA|no\s+emite", re.I)

# Este fichero lleva las dos frases como DATO (los patrones de arriba), y
# `contrato_guion.py` las lleva como las dos ramas de un `if` sobre la tabla.
# Ninguno de los dos afirma nada; escanearlos daría un rojo permanente.
EXENTOS = {"comprobar_docs.py", "contrato_guion.py"}


def _posiciones() -> list:
    """La prosa sobre `POS_*` contra la tabla `POSICIONES`, en docs Y código.

    Los comentarios entran a propósito. La contradicción de `b3cf841` vivió
    dentro de `leer_guion.py`: su docstring decía «`POS_*` se emite» catorce
    líneas antes de que un comentario sobre la propia tabla dijera «se
    INFORMA, no se emite». Un comprobador que solo mirara los `.md` habría
    dado verde con las dos frases en el mismo fichero."""
    sys.path.insert(0, os.path.join(RAIZ, "scripts"))
    try:
        import leer_guion
    except Exception as exc:                       # pragma: no cover
        return ["no se pudo importar leer_guion para comprobar POSICIONES: %s"
                % exc]
    emite = any(leer_guion.POSICIONES.values())
    fuentes = [d for d in DOCS if d.endswith(".md")]
    fuentes += ["guiones/CONTRATO.md"]
    fuentes += sorted("scripts/" + f for f in os.listdir(
        os.path.join(RAIZ, "scripts"))
        if f.endswith(".py") and f not in EXENTOS)
    fallos = []
    # El generador del contrato lleva las DOS prosas, y así tiene que ser: es
    # quien elige cuál sale según la tabla. Escanearlo marcaría siempre la
    # rama que hoy no se imprime. Queda fuera del escaneo, pero no sin
    # vigilancia: lo que se le exige es que la elección siga saliendo de la
    # tabla y no de una frase clavada a mano.
    gen = os.path.join(RAIZ, "scripts", "contrato_guion.py")
    if "any(leer_guion.POSICIONES.values())" not in open(
            gen, encoding="utf-8").read():
        fallos.append(
            "scripts/contrato_guion.py ya no deriva la prosa de `POS_*` de "
            "`leer_guion.POSICIONES`: el contrato del guionista puede volver "
            "a contradecir su propia tabla")
    for doc in fuentes:
        ruta = os.path.join(RAIZ, doc)
        if not os.path.exists(ruta):
            continue
        for n, linea in enumerate(open(ruta, encoding="utf-8"), 1):
            if NIEGA.search(linea):
                if emite and ("POS_" in linea or "POSICIONES" in linea):
                    fallos.append(
                        "%s:%d dice que `POS_*` NO se emite y la tabla "
                        "`POSICIONES` sí emite (%s)"
                        % (doc, n, ", ".join(sorted(
                            k for k, v in leer_guion.POSICIONES.items() if v))))
                continue
            if AFIRMA.search(linea) and not emite:
                fallos.append(
                    "%s:%d afirma que `POS_*` emite desplazamiento y las %d "
                    "filas de `POSICIONES` están vacías"
                    % (doc, n, len(leer_guion.POSICIONES)))
    return fallos


# Cada afirmación: (patrón con UN grupo numérico, de dónde sale la verdad, qué
# es). Añadir una comprobación es añadir una línea.
DERIVADAS = [
    (r"(\d+)\s+plantillas",        _plantillas,  "plantillas en templates/"),
    (r"(\d+)\s+(?:efectos|sonidos)\s+sintetizados", _sfx, "efectos en hacer_sfx.EFECTOS"),
    # La forma corta —«los 21 SFX», «con los 21 sonidos»— se escapaba del
    # patrón de arriba, y así es como CLAUDE.md dijo «15» dos veces cuando el
    # catálogo llevaba en 21 desde hacía dos sprints.
    (r"(\d+)\s+(?:SFX|sonidos)",   _sfx,         "efectos en hacer_sfx.EFECTOS"),
    (r"(\d+)\s+claves\s+hoja",     _claves_hoja, "claves en reloj.SEMANTICA"),
    (r"los\s+(\d+)\s+scripts",     _scripts,     "ficheros en scripts/"),
    # Anclado a la frase completa y no a «N pruebas» a secas: la versión corta
    # atrapaba el «500 pruebas con nombre propio» de requirements-dev.txt, que
    # es retórica sobre `parametrize` y no un recuento. El precio es que la
    # frase del README tiene que caber en una línea; está reflowada para eso.
    (r"(\d+)\s+pruebas\s+en\s+el\s+nivel", _pruebas,
     "pytest --collect-only, nivel rápido"),
]

# Rutas citadas en la documentación que tienen que existir Y estar versionadas.
# `guiones/` faltaba del grupo: `guiones/codex-security.json` llevaba citada en
# CLAUDE.md desde que existe `leer_guion.py` y esta puerta no la veía.
RUTA = re.compile(r"`((?:scripts|templates|assets|tests|docs|guiones)/[\w./-]+)`")


def versionados() -> set:
    """Lo que git tiene. `os.path.exists` no basta: distingue «existe en tu
    disco» de «existe en el repo», y esa diferencia es exactamente el fallo que
    tuvo `assets/broll/auditoria_antes.png` —citada por la documentación y
    excluida por `.gitignore`— y el de `galeria.js`, documentado sin trackear.
    Un comprobador que solo mire el disco da verde en la máquina del autor y el
    clon está roto."""
    try:
        r = subprocess.run(["git", "ls-files"], cwd=RAIZ,
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            # Sin repo (un export, un tarball) no hay veredicto posible: se
            # devuelve vacío y el llamador SALTA la comprobación de
            # «versionada» en vez de tumbar la puerta entera. Antes ni se
            # miraba el código de salida: un git roto daba stdout vacío y
            # desactivaba la comprobación en silencio, indistinguible de
            # «todo está versionado».
            return set()
        return set(r.stdout.split())
    except Exception:
        return set()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--listar", action="store_true",
                    help="imprime de dónde sale cada número y termina")
    args = ap.parse_args()

    if args.listar:
        print("  afirmación                     se deriva de                 hoy")
        for pat, fn, que in DERIVADAS:
            print("  %-30s %-28s %s" % (pat, que, fn()))
        return 0

    errores = []
    en_repo = versionados()
    verdad = [(re.compile(p), fn(), q) for p, fn, q in DERIVADAS]

    for doc in DOCS:
        ruta = os.path.join(RAIZ, doc)
        if not os.path.exists(ruta):
            continue
        for n, linea in enumerate(open(ruta, encoding="utf-8"), 1):
            for rx, real, que in verdad:
                for m in rx.finditer(linea):
                    dicho = int(m.group(1))
                    if dicho != real:
                        errores.append(
                            "%s:%d dice «%s» y hoy son %d (%s)"
                            % (doc, n, m.group(0).strip(), real, que))
            for m in RUTA.finditer(linea):
                p = m.group(1)
                if "*" in p or p.endswith("/"):
                    continue
                if not os.path.exists(os.path.join(RAIZ, p)):
                    errores.append("%s:%d cita `%s`, que no existe" % (doc, n, p))
                elif en_repo and p not in en_repo:
                    errores.append(
                        "%s:%d cita `%s`, que existe en disco pero NO está "
                        "versionada: en un clon la documentación mentiría"
                        % (doc, n, p))

    # --- claves `config.X` citadas en la norma ---------------------------
    #
    # `comprobar_docs.py` cazaba plantillas SIN mención y rutas que no
    # existen; no cazaba menciones EQUIVOCADAS. Y esa es la que hace daño:
    # §4B afirmó durante tres tandas que `data-diagram` tenía «dos modos vía
    # `config.modo`», cuando `modo` está RESERVADA por el renderizador —la
    # inyecta con `detalle`/`mascara` y pisa la del plan— y la plantilla la
    # renombró a `vista` justamente por eso. O sea que la norma recomendaba la
    # clave que rompe la plantilla.
    #
    # Esto es lo mecánicamente comprobable de una descripción: una clave
    # citada tiene que existir en los `defaults` de su plantilla. Se atribuye
    # a la última plantilla nombrada antes de la cita, que es como está
    # escrita la sección: un encabezado por componente y su prosa debajo.
    sys.path.insert(0, os.path.join(RAIZ, "scripts"))
    import reloj
    # Las claves que `_engine.js` aplica a CUALQUIER plantilla no pertenecen a
    # ninguna: se leen del propio motor en vez de mantener una lista aquí, que
    # es la única forma de que no se quede vieja. Más `sinSonido`, que es el
    # contrato de cues y lo respeta quien quiera.
    _eng = open(os.path.join(TPL, "_engine.js"), encoding="utf-8").read()
    RESERVADAS = set(re.findall(r"_cfg\.(\w+)", _eng)) | {"sinSonido"}
    CLAVE = re.compile(r"`config\.(\w+)`")
    TPLNOM = re.compile(r"`templates/([a-z0-9-]+)\.html`|`([a-z0-9-]+)\.html`")
    for doc in DOCS:
        ruta = os.path.join(RAIZ, doc)
        if not os.path.exists(ruta):
            continue
        actual = None
        for n, linea in enumerate(open(ruta, encoding="utf-8"), 1):
            # La atribución se reinicia en cada encabezado. Sin esto, «la
            # última plantilla nombrada» arrastra secciones enteras: `config.
            # zona` y `config.ancho`, que son del SISTEMA de tarjetas y las
            # aplica el motor, se le colgaban a `fondo` solo por ser la última
            # citada quince párrafos antes. Una auditoría que grita en falso se
            # deja de leer en dos días.
            if linea.lstrip().startswith("#"):
                actual = None
            m = TPLNOM.search(linea)
            if m:
                actual = m.group(1) or m.group(2)
            for c in CLAVE.finditer(linea):
                k = c.group(1)
                if k in RESERVADAS or not actual:
                    continue
                f = os.path.join(TPL, actual + ".html")
                if not os.path.exists(f):
                    continue
                src = open(f, encoding="utf-8").read()
                blk = reloj.bloque_defaults(src) or ""
                if not re.search(r"\b%s\s*:" % re.escape(k), blk):
                    errores.append(
                        "%s:%d recomienda `config.%s` para `%s`, y esa clave "
                        "no está en sus `defaults`" % (doc, n, k, actual))

    # Toda plantilla tiene que salir en BRAND_RULES: si no, existe y nadie sabe
    # para qué es, que es como se acumulan las que no usa nadie.
    br = open(os.path.join(RAIZ, "BRAND_RULES.md"), encoding="utf-8").read()
    sin_norma = sorted(f[:-5] for f in os.listdir(TPL)
                       if CANONICO.match(f) and not f.startswith("_")
                       and f[:-5] not in br)
    for f in sin_norma:
        errores.append("`%s.html` no se menciona en BRAND_RULES.md" % f)

    # `POS_*`: la prosa contra la tabla, en documentación y en código.
    errores += _posiciones()

    # El contrato del guionista, byte a byte contra sus fuentes de verdad.
    errores += _contrato_guionista()

    for e in errores:
        print("  ✗ %s" % e, file=sys.stderr)
    print("\n%d desajuste(s) entre lo que dice la documentación y lo que hay"
          % len(errores))
    if errores:
        print("  (los números derivables no se mantienen a mano: corrígelos "
              "y esta comprobación deja de sonar)", file=sys.stderr)
    return 1 if errores else 0


if __name__ == "__main__":
    raise SystemExit(main())
