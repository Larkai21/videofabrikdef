#!/usr/bin/env python3
"""Cruza el plan con las plantillas, el renderizador y el compositor.

Esto cubre una clase de fallo que ninguna prueba unitaria puede cubrir: la
coherencia ENTRE cuatro artefactos en dos lenguajes —`build/plan.json`, las
56 plantillas HTML, `render_playwright.js` y `composite_ffmpeg.py`— que hoy
nadie compara. Todos los fallos que caza han pasado de verdad:

  · `config.modo` colisiona con una clave que el renderizador reserva y
    sobrescribe. Pasó con `subtitles-showcase`, que salía SIEMPRE en rejilla
    aunque el plan pidiera vista individual; se renombró a `vista`. Y SIGUE
    PASANDO en `data-diagram`, cuyo modo «tabla» es inalcanzable por el
    pipeline aunque funcione en `hoja_contactos.js` — que es lo que lo hace
    difícil de ver.
  · `escala` escrita en la config de una plantilla que no la lee: el motor
    escala la maquetación con `zoom` y `escala` solo existe dentro de
    `code-mockup`. Escrita en cualquier otra no hace nada y no lo dice.
  · `zona` en cualquiera de las 48 plantillas que no usan `class="tarjeta"`:
    el motor solo la aplica a ese nodo.
  · una propiedad de composición que el compositor lee del manifiesto y el
    renderizador no copia: se pierde en silencio. Ya pasó dos veces, con
    `parallax` y con `dx`, y está documentado en `colocar.py`.
  · dos capas del plan con el mismo nombre: el renderizador vacía y reescribe
    el mismo directorio, así que un gráfico desaparece sin rastro.

Uso:
    python3 scripts/lint_config.py                       # sobre build/plan.json
    python3 scripts/lint_config.py --plan otro.json
    python3 scripts/lint_config.py --estricto            # avisos = error

Devuelve 1 si hay errores.
"""

from __future__ import annotations

import argparse
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import comun                                 # noqa: E402

import reloj                                 # noqa: E402
from comun import carga_json                 # noqa: E402

PLANTILLAS = os.path.join(RAIZ, "templates")
RENDERIZADOR = os.path.join(RAIZ, "scripts", "render_playwright.js")
COMPOSITOR = os.path.join(RAIZ, "scripts", "composite_ffmpeg.py")
MOTOR = os.path.join(PLANTILLAS, "_engine.js")

# Claves de `config` que aplica el MOTOR, no la plantilla. Una plantilla no
# tiene que leerlas para que funcionen, así que no cuentan como huérfanas.
# Salen de `_engine.js`: tema, duration, zoom, modo, zona, ancho.
DEL_MOTOR = {"tema", "duration", "zoom", "modo", "zona", "ancho"}

# `zona` y `ancho` las aplica el motor SOLO si la plantilla tiene un nodo
# `.tarjeta`; el resto de las claves del motor valen siempre.
SOLO_CON_TARJETA = {"zona", "ancho"}

# El renderizador construye la config con
#   Object.assign({}, capa.config || {}, { modo })
# así que su `modo` gana siempre. Cualquier `config.modo` del plan se pierde.
RESERVADAS_RENDERIZADOR = {"modo"}


# --------------------------------------------------------------------------
#  extracción: qué claves lee DE VERDAD una plantilla
# --------------------------------------------------------------------------
def _forma(v):
    """La forma de un valor del plan, con el mismo vocabulario que `formas`."""
    if isinstance(v, bool):
        return "booleano"
    if isinstance(v, (int, float)):
        return "número"
    if isinstance(v, str):
        return "texto"
    if isinstance(v, list):
        return "lista"
    if isinstance(v, dict):
        return "objeto"
    return None


def claves_de_plantilla(ruta: str) -> tuple[set, bool, bool, dict]:
    """(claves que lee, tiene nodo .tarjeta, se ha podido leer, forma de cada default).

    La unión de cuatro fuentes, y las cuatro hacen falta:

      1. `cfg.X` en el código, TRAS QUITAR COMENTARIOS. No es opcional:
         `_tokens.css`, `kinetic-captions` y `data-diagram` nombran claves en
         prosa explicativa, y contarlas enmascararía justo lo que se busca.
         Es la misma lección que aprendió `validar_plan.leer_orden` cuando
         aún leía `ORDEN` del fuente con una regex: un comentario dentro de
         los corchetes se colaba como si fuera una capa (hoy es un fichero
         de datos, guiones/capas.json).
      2. Las claves de primer nivel de `defaults:`. Una clave con valor por
         defecto se «lee» aunque solo la use el motor.
      3. La desestructuración `const { a, b } = cfg`. Hoy la usa una sola
         plantilla, pero sin cubrirla sería un agujero callado.
      4. `<meta name="config-extra" content="a,b">`, para claves que se
         resuelven dinámicamente. Mismo precedente que `capa-opaca`.
    """
    src = open(ruta, encoding="utf-8").read()
    limpio = reloj.sin_comentarios(src)

    claves = set(re.findall(r"cfg\.([A-Za-z_]\w*)", limpio))

    blk = reloj.bloque_defaults(limpio)
    if blk:
        prof = 0
        for m in re.finditer(r"([A-Za-z_]\w*)\s*:|[\{\[\}\]]", blk):
            tk = m.group(0)
            if tk in "{[":
                prof += 1
            elif tk in "}]":
                prof -= 1
            elif prof == 0 and m.group(1):
                claves.add(m.group(1))

    for m in re.finditer(r"(?:const|let|var)\s*\{([^}]*)\}\s*=\s*cfg", limpio):
        for x in m.group(1).split(","):
            x = x.split(":")[0].split("=")[0].strip()
            if re.fullmatch(r"[A-Za-z_]\w*", x):
                claves.add(x)

    m = re.search(r'<meta\s+name="config-extra"\s+content="([^"]*)"', src)
    if m:
        claves |= {x.strip() for x in m.group(1).split(",") if x.strip()}

    # La FORMA de cada valor por defecto, para poder contrastarla con la que
    # trae el plan. Solo el primer carácter significativo tras los dos puntos:
    # distinguir lista de cadena de número basta para cazar el fallo real, y
    # analizar JavaScript con expresiones regulares más allá de eso no sale a
    # cuenta. Lo que no se reconozca se queda sin forma y no se comprueba.
    formas = {}
    if blk:
        prof = 0
        for m in re.finditer(r"([A-Za-z_]\w*)\s*:\s*(\S+)|[\{\[\}\]]", blk):
            tk = m.group(0)
            if m.group(1) is None:
                prof += 1 if tk in "{[" else -1
            elif prof == 0:
                v, c = m.group(2), m.group(2)[0]
                # `true`/`false` COMPLETOS, no su inicial: `ico: filaIcono(x)`
                # empieza por «f» y no es un booleano. Ese atajo dio el primer
                # falso positivo de esta regla, y un lint que se equivoca es un
                # lint que se acaba desactivando.
                f = {"[": "lista", "{": "objeto", "'": "texto", '"': "texto",
                     "`": "texto"}.get(c)
                if f is None and re.match(r"(true|false)\b", v):
                    f = "booleano"
                if f is None and re.match(r"-?\d", v):
                    f = "número"
                if f:
                    formas[m.group(1)] = f

    tarjeta = bool(re.search(r'class="[^"]*\btarjeta\b', src))

    # Salvaguarda: si la extracción saca casi nada y no hay `defaults`, es que
    # esta plantilla no se entiende con expresiones regulares. Tiene que salir
    # como DESCONOCIDA, no como limpia — una plantilla que el extractor no lee
    # y que parece correcta es peor que no tener lint.
    legible = bool(blk) or len(claves) >= 3
    return claves, tarjeta, legible, formas


def catalogo(dir_plantillas: str = PLANTILLAS) -> dict:
    out = {}
    for f in sorted(os.listdir(dir_plantillas)):
        if not f.endswith(".html") or f.startswith("_"):
            continue
        claves, tarjeta, legible, formas_tpl = claves_de_plantilla(
            os.path.join(dir_plantillas, f))
        out[f] = {"claves": claves, "tarjeta": tarjeta,
                  "legible": legible, "formas": formas_tpl}
    return out


# --------------------------------------------------------------------------
#  el cruce renderizador <-> compositor
# --------------------------------------------------------------------------
def desajuste_manifiesto() -> list:
    """Propiedades que el compositor LEE del manifiesto y el renderizador no
    ESCRIBE. Quince líneas de expresión regular que convierten en imposible un
    fallo que ya ocurrió dos veces: el propio `colocar.py` lo comenta —«es la
    misma trampa que ya tuvo este proyecto con parallax y con dx»—. Sin esto,
    añadir una propiedad de composición y olvidar copiarla al manifiesto deja
    el vídeo sin paralaje, sin desplazamiento o sin escala, en silencio."""
    comp = open(COMPOSITOR, encoding="utf-8").read()
    rend = open(RENDERIZADOR, encoding="utf-8").read()

    lee = set(re.findall(r'capa\.get\("([a-zA-Z_]\w*)"', comp))
    lee |= set(re.findall(r'capa\["([a-zA-Z_]\w*)"\]', comp))

    escribe = set(re.findall(r"salida\.([a-zA-Z_]\w*)\s*=", rend))
    # las del literal inicial `const salida = { capa: ..., frames: ... }`
    m = re.search(r"const salida = \{(.*?)\};", rend, re.S)
    if m:
        escribe |= set(re.findall(r"([a-zA-Z_]\w*)\s*:", m.group(1)))
    # Y las que se añaden al montar el manifiesto, con propagación por spread:
    #   hechas.push({ ...r, t: capa.t, template: capa.template })
    # Hay que coger TODAS las claves del literal, no solo la primera después
    # del spread: con una sola, `template` salía como no escrita y el lint daba
    # un falso positivo — y un lint que grita en falso se deja de leer.
    for m in re.finditer(r"\{\s*\.\.\.\w+\s*,([^}]*)\}", rend):
        escribe |= set(re.findall(r"([a-zA-Z_]\w*)\s*:", m.group(1)))
    escribe |= set(re.findall(r"c\.([a-zA-Z_]\w*)\s*=", rend))

    # `dir` lo pone el renderizador con otro nombre local. El resto tiene que
    # aparecer de verdad en el código; enumerarlas aquí a mano sería reproducir
    # el fallo que este cruce evita.
    conocidas = escribe | {"dir"}
    return sorted(lee - conocidas)


# --------------------------------------------------------------------------
#  el lint
# --------------------------------------------------------------------------
def lint(plan: list, cat: dict) -> tuple[list, list]:
    errores, avisos = [], []

    if not isinstance(plan, list):
        return (["el plan debe ser una lista de capas"], [])

    # R8 · el cruce renderizador <-> compositor, una vez por plan
    perdidas = desajuste_manifiesto()
    if perdidas:
        errores.append(
            "el compositor lee del manifiesto %s y el renderizador no las "
            "escribe: se perderían en silencio. Cópialas en el bloque de "
            "propiedades de composición de render_playwright.js."
            % ", ".join("`%s`" % x for x in perdidas))

    # R6 · nombre de capa repetido
    cuenta: dict[str, int] = {}
    for c in plan:
        if isinstance(c, dict) and c.get("capa"):
            cuenta[c["capa"]] = cuenta.get(c["capa"], 0) + 1
    for nom, n in sorted(cuenta.items()):
        if n > 1:
            errores.append(
                "«%s» aparece %d veces: el renderizador vacía y reescribe el "
                "mismo directorio y el manifiesto indexa por nombre, así que "
                "solo sobrevive la última." % (nom, n))

    for i, capa in enumerate(plan):
        if not isinstance(capa, dict):
            errores.append("capa %d no es un objeto" % i)
            continue
        nom = capa.get("capa") or "<sin nombre>"
        etq = "«%s»" % nom
        tpl = capa.get("template") or ""
        cfg = capa.get("config") or {}
        info = cat.get(tpl)

        if not info:
            avisos.append("%s: no encuentro templates/%s en el catálogo"
                          % (etq, tpl))
            continue
        if not info["legible"]:
            errores.append(
                "%s: no he podido extraer las claves de %s con fiabilidad "
                "(sin bloque `defaults` y menos de 3 usos de `cfg.`). "
                "Declara las claves dinámicas con "
                '<meta name="config-extra" content="a,b"> para que el lint '
                "pueda comprobarlas." % (etq, tpl))
            continue

        lee = info["claves"]

        for clave in sorted(cfg):
            # R2 · colisión con lo que reserva el renderizador
            if clave in RESERVADAS_RENDERIZADOR:
                errores.append(
                    "%s: `config.%s` la reserva el renderizador y la "
                    "sobrescribe (`Object.assign({}, capa.config, { %s })`), "
                    "así que este valor no llega nunca a la plantilla. "
                    "Renombra la clave en %s, como se hizo con "
                    "`subtitles-showcase` -> `vista`." % (etq, clave, clave, tpl))
                continue

            # R4 · `zona`/`ancho` sin nodo .tarjeta
            if clave in SOLO_CON_TARJETA and not info["tarjeta"] \
                    and clave not in lee:
                errores.append(
                    "%s: `config.%s` no hace nada en %s. El motor solo la "
                    "aplica a un nodo con `class=\"tarjeta\"`, y esta "
                    "plantilla posiciona a sangre. Resuelve la banda con "
                    "`dy` de composición (colocar.py)." % (etq, clave, tpl))
                continue

            # R3 · `escala` donde el motor espera `zoom`
            if clave == "escala" and "escala" not in lee:
                errores.append(
                    "%s: `config.escala` no la lee %s. Para encoger la "
                    "maquetación usa `config.zoom`, que es la clave del motor; "
                    "para escalar el PNG al componer, `escala` va al NIVEL DE "
                    "CAPA, no dentro de config." % (etq, tpl))
                continue

            # R1 · clave que la plantilla no lee nunca
            if clave not in lee and clave not in DEL_MOTOR:
                avisos.append(
                    "%s: `config.%s` no la lee %s ni el motor: no hace nada."
                    % (etq, clave, tpl))
                continue

            # R1b · clave con la FORMA equivocada
            #
            # R1 caza el nombre y se le escapa el tipo, que es el otro modo de
            # fallar y es peor: la plantilla sí lee la clave, y revienta al
            # usarla. `code-mockup` espera `codigo` como LISTA de líneas; un
            # guion le pasó el fichero como una cadena con saltos de línea, y
            # `compas()` llamó a `.map` sobre un string. Cero fotogramas, y el
            # aviso solo apareció al abrir el log del renderizador —después de
            # diez minutos de render y con el compositor ya fallando detrás.
            esperado = (cat.get(tpl) or {}).get("formas", {}).get(clave)
            visto = _forma(cfg[clave])
            if esperado and visto and esperado != visto:
                avisos.append(
                    "%s: `config.%s` es %s y %s la espera %s (por su valor por "
                    "defecto). La plantilla la lee y falla al usarla."
                    % (etq, clave, visto, tpl, esperado))

        # R5 · claves de tiempo que la tabla de reloj no conoce
        #
        # Mi primera versión usaba `reloj.recolectar_tiempos`, que solo recoge
        # claves YA clasificadas como posición: por construcción no podía
        # encontrar nunca una sin clasificar, así que la regla estaba muerta.
        # Hay que recorrer la config con la MISMA heurística que propone
        # candidatas en `comprobar_relojes.py`.
        for ruta_clave in _candidatas_de_tiempo(cfg):
            hoja = ruta_clave.split(".")[-1].split("[")[0]
            if hoja not in reloj.SEMANTICA:
                errores.append(
                    "%s: `%s` parece un tiempo y no está en reloj.SEMANTICA, "
                    "así que silencios.py no lo remapea y ese gráfico se "
                    "desplazará sin dar error. Clasifícala con "
                    "scripts/comprobar_relojes.py." % (etq, ruta_clave))

    errores += _sonidos_del_director()
    return errores, avisos


def _sonidos_del_director() -> list:
    """Que las tablas del director citen sonidos que existen.

    Este es el único nivel del arnés que cruza cuatro artefactos en dos
    lenguajes, así que es su sitio: `dirigir.py` tiene TREINTA Y CINCO nombres
    de sonido escritos a mano en tres tablas —`SFX_POR_TIPO`,
    `SFX_POR_PLANTILLA` y `SFX_MICRO`— y hasta ahora no los cruzaba nadie con
    `hacer_sfx.EFECTOS`. Un nombre mal escrito ahí no da error en ningún paso:
    el plan se escribe, se renderiza, y el compositor descarta el cue en
    silencio.

    Se comprueba también el desajuste entre la tabla y el disco, porque son
    dos fallos distintos: una errata es que el nombre está mal, y un `.wav`
    que falta es que hay que regenerar.
    """
    try:
        import dirigir
        import hacer_sfx
    except Exception as e:                      # noqa: BLE001
        return ["no puedo comprobar los sonidos del director: %s" % e]

    cat = hacer_sfx.catalogo()
    fuera = []
    tablas = [("SFX_POR_TIPO", getattr(dirigir, "SFX_POR_TIPO", {})),
              ("SFX_POR_PLANTILLA", getattr(dirigir, "SFX_POR_PLANTILLA", {}))]
    for nombre, tabla in tablas:
        for k, v in tabla.items():
            sfx = v[0] if isinstance(v, (tuple, list)) else v
            if sfx not in cat:
                fuera.append("dirigir.%s[%r] pide «%s», que no está en "
                             "hacer_sfx.EFECTOS" % (nombre, k, sfx))
    fuera += hacer_sfx.desajuste_con_disco()
    return fuera


def _candidatas_de_tiempo(nodo, ruta: str = "") -> list:
    """Claves de la config con pinta de tiempo y valor numérico, a cualquier
    profundidad. Es el mismo criterio que el auditor del catálogo, aplicado al
    plan en vez de a las plantillas: una clave puede llegar en el plan sin
    estar declarada en los `defaults` de su plantilla."""
    fuera = []
    if isinstance(nodo, dict):
        for k, v in nodo.items():
            aqui = "%s.%s" % (ruta, k) if ruta else k
            numerico = isinstance(v, (int, float)) and not isinstance(v, bool)
            lista_num = isinstance(v, list) and all(
                isinstance(x, (int, float)) and not isinstance(x, bool)
                for x in v)
            if (numerico or (lista_num and v)) and reloj._suena_a_tiempo(k):
                fuera.append(aqui)
            elif isinstance(v, (dict, list)):
                fuera += _candidatas_de_tiempo(v, aqui)
    elif isinstance(nodo, list):
        for i, v in enumerate(nodo):
            fuera += _candidatas_de_tiempo(v, "%s[%d]" % (ruta, i))
    return fuera


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan",
                    default=os.path.join(comun.build_dir(), "plan.json"))
    ap.add_argument("--plantillas", default=PLANTILLAS)
    ap.add_argument("--estricto", action="store_true",
                    help="tratar los avisos como errores")
    args = ap.parse_args()

    cat = catalogo(args.plantillas)
    ilegibles = [f for f, v in cat.items() if not v["legible"]]
    con_tarjeta = sum(1 for v in cat.values() if v["tarjeta"])
    print("catálogo: %d plantillas · %d con nodo .tarjeta · %d ilegibles"
          % (len(cat), con_tarjeta, len(ilegibles)))
    if ilegibles:
        print("  ilegibles: %s" % ", ".join(ilegibles))

    plan = carga_json(args.plan)
    errores, avisos = lint(plan, cat)

    for e in errores:
        print("  ✗ %s" % e)
    for a in avisos:
        print("  ⚠ %s" % a)
    if not errores and not avisos:
        print("  ✓ %d capas, ninguna clave muerta ni colisión" % len(plan))

    print("\n%d errores, %d avisos" % (len(errores), len(avisos)))
    return 1 if errores or (args.estricto and avisos) else 0


if __name__ == "__main__":
    sys.exit(main())
