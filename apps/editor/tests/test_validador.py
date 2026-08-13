"""El validador y el lint, contra un plan roto CONGELADO.

La tanda 7 del ROADMAP dice: «Verificado contra un plan roto a propósito con
los siete fallos: los detecta todos». Esa verificación fue manual y se tiró.
Congelarla en `fixtures/plan_roto.json` es la prueba más barata del repo: un
plan roto + un plan bueno = dos ficheros y cero mantenimiento.

Se comprueba que cada fallo se detecta POR SEPARADO, con una frase que lo
identifica. Contar errores no vale: si un cambio rompe la detección del anclaje
hacia adelante y a la vez añade un aviso nuevo, el total no se mueve.
"""

from __future__ import annotations

import json
import os

import pytest

import lint_config
import validar_plan
from conftest import FIXTURES


@pytest.fixture(scope="module")
def roto():
    with open(os.path.join(FIXTURES, "plan_roto.json"), encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def bueno(raiz):
    """El plan real de `build/`, con la duración DERIVADA de su timeline.

    Estaba escrita a mano (38.485) y eso hacía que la prueba dependiera de en
    qué punto del pipeline estuviera `build/`: entre `plan_codex.py` y
    `silencios.py --aplicar` el plan está en reloj de ORIGEN y sus tiempos
    llegan a 49 s, así que la comparación contra la duración de SALIDA fallaba
    por un motivo que no tiene nada que ver con el plan. Se deriva del mismo
    sitio que el plan, y así vale en los dos estados."""
    import reloj
    p = os.path.join(raiz, "build", "plan.json")
    p_tl = os.path.join(raiz, "build", "timeline.json")
    if not (os.path.exists(p) and os.path.exists(p_tl)):
        pytest.skip("no hay build/plan.json y build/timeline.json")
    with open(p, encoding="utf-8") as f:
        plan = json.load(f)
    tl = json.load(open(p_tl, encoding="utf-8"))
    mapa = reloj.Mapa(tl["keep"])
    # En reloj de origen la referencia es el final del metraje conservado; en
    # reloj de salida, la duración de la pieza. Se distingue por el propio plan.
    en_origen = max(c["t"] + c["duracion"] for c in plan) > mapa.duracion() + 0.1
    dur = tl["keep"][-1]["src_end"] if en_origen else mapa.duracion()
    return plan, dur


# --------------------------------------------------------------------------
#  validar_plan
# --------------------------------------------------------------------------
# (marca que tiene que aparecer, en qué lista)
FALLOS = [
    ("no existe templates/no-existe.html", "errores"),
    ("duración 0.00 s", "errores"),
    ("negativo", "errores"),
    ("después del final", "errores"),
    ("supera la duración de la capa", "avisos"),
    ("no existe en el plan", "errores"),
    ("va DESPUÉS en el", "errores"),
    ("no está en ORDEN", "errores"),
    ("se solapan", "avisos"),
    ("aparece 2 veces", "errores"),
    ("`config.duration`", "avisos"),
]


@pytest.mark.parametrize("marca,donde", FALLOS,
                         ids=[m[:28] for m, _ in FALLOS])
def test_validar_detecta(roto, marca, donde):
    errores, avisos = validar_plan.validar(roto, duracion=30.0)
    lista = errores if donde == "errores" else avisos
    assert any(marca in x for x in lista), \
        "no ha detectado «%s». %s: %s" % (marca, donde, lista)


def test_validar_devuelve_1_con_el_plan_roto(roto):
    errores, _ = validar_plan.validar(roto, duracion=30.0)
    assert errores


def test_validar_pasa_el_plan_bueno(bueno):
    plan, dur = bueno
    errores, avisos = validar_plan.validar(plan, duracion=dur)
    assert not errores, errores
    assert not avisos, avisos


def test_duplicado_sin_solape_es_error(roto):
    """El caso que el solape NO pilla: dos apariciones de `cita` en momentos
    distintos. Es el que hace desaparecer un gráfico sin rastro."""
    errores, _ = validar_plan.validar(roto, duracion=30.0)
    assert any("«cita» aparece 2 veces" in x for x in errores)


# --------------------------------------------------------------------------
#  permanencia del contenido tecleable
# --------------------------------------------------------------------------
# El incidente, congelado con sus números: el YAML de la pieza de Codex son
# 195 caracteres a 42 cps, el compás de code-mockup termina en 5,83 s y la
# capa moría en 3,0 s — las cuatro últimas líneas no se vieron jamás.
CODIGO_CODEX = [
    "name: Codex Security",
    "on: [pull_request]",
    "jobs:",
    "  audit:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: openai/codex-security@v1",
    "        with:",
    "          fail-on: high",
]


def _capa_codemockup(dur):
    return {"capa": "codemockup", "template": "code-mockup.html", "t": 0,
            "duracion": dur,
            "config": {"duration": dur, "cps": 42, "codigo": CODIGO_CODEX}}


def test_permanencia_dispara_con_la_capa_del_incidente():
    errores, _ = validar_plan.validar([_capa_codemockup(3.0)], duracion=30.0)
    marca = [e for e in errores if "no llegan a verse" in e]
    assert marca, errores
    # Nombra las líneas perdidas, no solo el total: el arreglo empieza por
    # saber QUÉ se está perdiendo.
    assert "fail-on: high" in marca[0]
    assert "checkout@v4" in marca[0]


def test_permanencia_calla_con_la_capa_dimensionada():
    """El mismo contenido con aire de sobra (tecleo 5,83 s + cola 0,9 s)."""
    errores, _ = validar_plan.validar([_capa_codemockup(7.0)], duracion=30.0)
    assert not [e for e in errores if "tecleado" in e], errores


def test_permanencia_terminal_exige_la_cola_de_lectura():
    """El tecleo del terminal cabe (todo escrito en 1,0 s) y aun así es
    error: la última línea pide 2,6 s de lectura y la capa muere en 1,3 s."""
    capa = {"capa": "terminal", "template": "terminal.html", "t": 0,
            "duracion": 1.3,
            "config": {"duration": 1.3, "cps": 34, "lineas": [
                {"tipo": "cmd", "txt": "codex security scan .", "at": 0.15},
                {"tipo": "ok",
                 "txt": "3 vulnerabilidades · 0 falsos positivos",
                 "at": 1.0}]}}
    errores, _ = validar_plan.validar([capa], duracion=30.0)
    assert any("cola de lectura" in e for e in errores), errores


def test_permanencia_no_adivina_formas_ajenas():
    """`lineas` sin {at, txt} es de otra plantilla: no hay compás conocido
    que replicar, y adivinarlo daría errores falsos — que es lo que hace que
    un validador se deje de leer."""
    capa = {"capa": "cita", "template": "cita.html", "t": 0, "duracion": 2,
            "config": {"duration": 2, "lineas": ["una", "dos"]}}
    errores, _ = validar_plan.validar([capa], duracion=30.0)
    assert not [e for e in errores if "tecleado" in e], errores


# --------------------------------------------------------------------------
#  cortinilla
# --------------------------------------------------------------------------
# Las reglas salen de CLAUDE.md y de §17: dos pasadas, una silueta, dos
# tratamientos. Nada de esto falla al renderizar — `cristal` + `cortinilla` lo
# ignoraba el compositor y el resto se veía en el fotograma compuesto—, así
# que el sitio barato para cazarlo es el paso 4.


def _capa_cortinilla(**cambios):
    """La capa del ejemplo canónico de CLAUDE.md, completa y válida."""
    capa = {"capa": "antesdespues", "template": "antes-despues.html",
            "t": 2.0, "duracion": 5.0, "cortinilla": True,
            "imagen": "assets/broll/auditoria_antes.png",
            "config": {"duration": 5.0, "hasta": 0.64,
                       "antes": "LO QUE ENCONTRÓ", "despues": "LO QUE HICE"}}
    capa.update(cambios)
    return capa


def test_cortinilla_completa_calla():
    """La capa canónica no puede disparar nada: un falso positivo aquí es lo
    que hace que un validador se deje de leer."""
    errores, avisos = validar_plan.validar([_capa_cortinilla()], duracion=30.0)
    quejas = ([e for e in errores if "cortinilla" in e or "cristal" in e] +
              [a for a in avisos if "cortinilla" in a])
    assert not quejas, quejas


def test_cristal_y_cortinilla_a_la_vez_es_error():
    errores, _ = validar_plan.validar([_capa_cortinilla(cristal=True)],
                                      duracion=30.0)
    assert any("`cristal` y `cortinilla`" in e for e in errores), errores


@pytest.mark.parametrize("falta", ["duration", "hasta"])
def test_cortinilla_exige_duration_y_hasta(falta):
    capa = _capa_cortinilla()
    del capa["config"][falta]
    errores, _ = validar_plan.validar([capa], duracion=30.0)
    assert any("`cortinilla` sin `config.%s`" % falta in e
               for e in errores), errores


def test_cortinilla_sin_imagen_avisa_del_lut():
    """Es AVISO y no error: si el plan quiere revelar metraje con un look
    fuerte puede. Solo que desde el plan no se sabe si habrá `--lut`, así que
    se dice antes de renderizar, que es cuando arreglarlo es barato."""
    capa = _capa_cortinilla()
    del capa["imagen"]
    _, avisos = validar_plan.validar([capa], duracion=30.0)
    assert any("look fuerte" in a for a in avisos), avisos


# --------------------------------------------------------------------------
#  lint_config
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def catalogo():
    return lint_config.catalogo()


def test_catalogo_todo_legible(catalogo):
    """Una plantilla que el extractor no entienda tiene que salir como
    DESCONOCIDA, no como limpia: un lint que da por bueno lo que no ha leído es
    peor que no tener lint."""
    ilegibles = [f for f, v in catalogo.items() if not v["legible"]]
    assert not ilegibles, ilegibles


def test_manifiesto_sin_desajuste():
    """Propiedades que el compositor lee del manifiesto y el renderizador no
    escribe. Ya pasó dos veces —con `parallax` y con `dx`— y `colocar.py` lo
    comenta. Quince líneas de regex lo vuelven imposible."""
    assert lint_config.desajuste_manifiesto() == []


def test_lint_pasa_el_plan_bueno(bueno, catalogo):
    plan, _ = bueno
    errores, avisos = lint_config.lint(plan, catalogo)
    assert not errores, errores
    assert not avisos, avisos


COLISIONES = [
    ("modo reservado por el renderizador", "data-diagram.html",
     {"modo": "tabla"}, "la reserva el renderizador"),
    ("escala donde el motor usa zoom", "stamp-banned.html",
     {"escala": 0.6}, "usa `config.zoom`"),
    ("zona sin nodo .tarjeta", "pills.html",
     {"zona": "arriba"}, "class=\"tarjeta\""),
    ("clave de tiempo sin clasificar", "kinetic-type.html",
     {"destellosEn": [0.4, 1.2]}, "reloj.SEMANTICA"),
]


@pytest.mark.parametrize("nombre,tpl,cfg,marca", COLISIONES,
                         ids=[c[0] for c in COLISIONES])
def test_lint_caza_las_colisiones(catalogo, nombre, tpl, cfg, marca):
    plan = [{"capa": "x", "template": tpl, "t": 0, "duracion": 2,
             "config": {**cfg, "duration": 2}}]
    errores, _ = lint_config.lint(plan, catalogo)
    assert any(marca in e for e in errores), \
        "no ha cazado «%s». errores: %s" % (nombre, errores)


def test_lint_no_se_queja_de_ancho_legitimo(catalogo):
    """`terminal` declara su propio `ancho` y usa `.tarjeta`, así que el motor
    se lo aplica: no es una clave muerta. Un falso positivo aquí haría que se
    dejara de leer el lint."""
    plan = [{"capa": "terminal", "template": "terminal.html", "t": 0,
             "duracion": 2, "config": {"ancho": 900, "duration": 2}}]
    errores, avisos = lint_config.lint(plan, catalogo)
    assert not [x for x in errores if "manifiesto" not in x]
    assert not avisos


def test_lint_cero_falsos_positivos_en_el_catalogo(catalogo):
    """Cada plantilla con SUS PROPIOS defaults como config: por definición todo
    lo que declara, lo lee ella o lo aplica el motor. Cualquier queja aquí es un
    falso positivo, y es la medida que decide si este lint sirve."""
    import re
    import reloj
    sucias = []
    for f in catalogo:
        src = reloj.sin_comentarios(
            open(os.path.join(reloj.PLANTILLAS, f), encoding="utf-8").read())
        blk = reloj.bloque_defaults(src)
        if not blk:
            continue
        # Se toma la clave CON SU VALOR declarado, no todas con un 1. Poniendo
        # un número a todo, un contenedor como `barridoEn: null` —que en
        # realidad es `{at, dur}` y cuyas hojas ya están clasificadas— pasaba a
        # parecer un tiempo suelto sin clasificar. El falso positivo era de la
        # prueba, no del lint: hay que reproducir cómo se usa la clave.
        prof, pares = 0, []
        for m in re.finditer(r"([A-Za-z_]\w*)\s*:\s*(-?[\d.]+|true|false|null|"
                             r"'[^']*'|\[|\{)|[\{\[\}\]]", blk):
            tk = m.group(0)
            if m.group(1):
                if prof == 0:
                    pares.append((m.group(1), m.group(2)))
                if m.group(2) in ("[", "{"):
                    prof += 1
            elif tk in "{[":
                prof += 1
            elif tk in "}]":
                prof = max(0, prof - 1)

        cfg = {}
        for k, v in pares:
            if k == "modo":       # colisiona a propósito: es un error de verdad
                continue
            if re.fullmatch(r"-?[\d.]+", v):
                cfg[k] = float(v)
            elif v.startswith("'"):
                cfg[k] = v.strip("'")
            elif v in ("true", "false"):
                cfg[k] = v == "true"
            # `null`, `[` y `{`: contenedores o desactivados. Se dejan fuera
            # porque su forma real no se puede reconstruir desde aquí, y el
            # auditor del catálogo ya cubre sus hojas.
        cfg["duration"] = 2
        plan = [{"capa": "x", "template": f, "t": 0, "duracion": 2,
                 "config": cfg}]
        e, a = lint_config.lint(plan, catalogo)
        e = [x for x in e if "manifiesto" not in x]
        if e or a:
            sucias.append((f, (e + a)[0]))
    assert not sucias, sucias
