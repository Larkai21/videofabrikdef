#!/usr/bin/env python3
"""Valida un plan de capas ANTES de renderizar.

Renderizar el plan entero para descubrir que una capa se descartó en
silencio cuesta minutos. Todos los avisos de aquí salen de fallos que ya
han pasado de verdad en este repo:

  · una capa fuera de `ORDEN` se renderiza y el compositor la tira sin
    decir nada (le pasó a `fondo`);
  · `flashEn` y `at` van en tiempo RELATIVO al inicio de la capa, y es muy
    fácil escribirlos en tiempo absoluto porque el resto del plan lo está;
  · una capa que empieza después de que acabe la locución no se ve, y no
    hay ningún error;
  · dos capas del mismo carril solapadas se tapan la una a la otra;
  · una cortinilla mal declarada no falla al renderizar: se ve en el
    fotograma COMPUESTO, que es el sitio caro.

Uso:
    python3 scripts/validar_plan.py build/plan.json
    python3 scripts/validar_plan.py build/plan.json --duracion 23.4
    python3 scripts/validar_plan.py build/plan.json --estricto   # avisos = error
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import reloj
import comun                                 # noqa: E402
from comun import carga_json

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANTILLAS = os.path.join(RAIZ, "templates")
CAPAS_JSON = os.path.join(RAIZ, "guiones", "capas.json")

# Claves de configuración cuyo valor es un instante RELATIVO al inicio de
# la capa. Si alguna supera la duración de su capa, casi seguro que se
# escribió en tiempo absoluto.
#
# Se DERIVA de `reloj.SEMANTICA` en vez de mantenerse a mano. Había dos
# registros de esto en el repo, indexados por ejes distintos —uno por
# contenedor y este por hoja— y se contradecían sobre {ini, fin, at}: uno los
# llamaba relativos y el otro los remapeaba como absolutos. Ahora hay uno.
# De paso este validador gana cobertura: `espera`, `salto`, `vsEn` y `sugEn`
# también son instantes relativos y antes no se comprobaban.
CLAVES_RELATIVAS = reloj.RELATIVAS


def leer_orden() -> list[str]:
    """Lee ORDEN de `guiones/capas.json`, el MISMO fichero de datos que carga
    el compositor. Antes se sacaba del fuente de composite_ffmpeg.py con una
    expresión regular —para no importarlo: importarlo arrastra sus
    dependencias y este script tiene que poder correr solo— y esa regex era
    frágil por construcción: un comentario dentro de los corchetes se colaba
    como capa. El fichero de datos conserva el desacoplo y mata la regex.

    Devuelve [] si el fichero falta o no se puede leer: un catálogo vacío
    desactiva ESTA comprobación (`if orden` abajo) en vez de tumbar el
    validador entero, que tiene que poder correr sobre un plan sin más
    contexto — es el mismo criterio que `_cargar_catalogo`."""
    try:
        with open(CAPAS_JSON, encoding="utf-8") as f:
            return list(json.load(f)["capas"])
    except (OSError, ValueError, KeyError):
        return []


def recolectar_sobres(nodo, salida=None):
    """Todas las referencias `sobre: "capa.clave"` de una config."""
    if salida is None:
        salida = []
    if isinstance(nodo, dict):
        v = nodo.get("sobre")
        if isinstance(v, str):
            salida.append(v)
        for x in nodo.values():
            recolectar_sobres(x, salida)
    elif isinstance(nodo, list):
        for x in nodo:
            recolectar_sobres(x, salida)
    return salida


def anclas_conocidas(manifiesto: str) -> dict:
    """Anclas ya publicadas, si hay un manifiesto de un render anterior.
    Sin él solo se puede validar el orden, no los nombres de clave."""
    try:
        with open(manifiesto, encoding="utf-8") as f:
            capas = json.load(f).get("capas", [])
    except (OSError, ValueError):
        return {}
    return {"%s.%s" % (c["capa"], k): v
            for c in capas for k, v in (c.get("anclas") or {}).items()}


def _cargar_catalogo() -> set:
    """Los nombres de sonido válidos, o vacío si no se pueden leer.

    Se importa PEREZOSAMENTE y se traga el fallo a propósito: este validador
    tiene que poder correr sobre un plan sin más contexto —lo hace `make
    lint`— y `hacer_sfx` necesita que el repo esté completo. Un catálogo vacío
    desactiva la comprobación en vez de tumbar el validador entero, que es lo
    que decidiría por nosotros cuándo se puede validar un plan.
    """
    try:
        import hacer_sfx
        return hacer_sfx.catalogo()
    except Exception:
        return set()


_CATALOGO = _cargar_catalogo()


def _sonidos_de(capa: dict):
    """Todos los nombres de sonido que una capa cita, con de dónde salen."""
    if capa.get("sfx"):
        yield "sfx", capa["sfx"]
    cfg = capa.get("config") or {}
    for c in (cfg.get("cortes") or []):
        if isinstance(c, dict) and c.get("sfx"):
            yield "config.cortes[].sfx", c["sfx"]
    for c in (cfg.get("cues") or []):
        if isinstance(c, dict) and c.get("sfx"):
            yield "config.cues[].sfx", c["sfx"]


def _parecido(nombre: str, opciones) -> str | None:
    """El candidato más cercano, para que el error proponga en vez de solo
    negar. Un error que dice «no existe» obliga a ir a buscar la lista; uno
    que dice «¿querías X?» se arregla leyéndolo."""
    import difflib
    c = difflib.get_close_matches(str(nombre), sorted(opciones), n=1, cutoff=0.6)
    return c[0] if c else None


# Los números del compás son LOS DE LAS PLANTILLAS, copiados con su valor:
# `compas()` de code-mockup.html arranca en 0,4 s, tarda len/cps por línea y
# deja 0,09 s (PAUSA) entre líneas; terminal.html teclea cada comando a cps
# desde su `at` y revela las respuestas en el `at` mismo. Si alguna plantilla
# cambia su ritmo, esto tiene que cambiar con ella — es el precio de poder
# validar sin abrir un navegador.
# El compás vive en reloj.py: leer_guion dimensiona, esto vigila y
# silencios re-alarga tras el remapeo — tres consumidores del MISMO número.
# Las copias locales ya habían divergido una vez (terminal: 3,21 s contra
# 6,31 s sobre las mismas líneas) y por eso se centralizó.
LECTURA_CPS = reloj.LECTURA_CPS
COLA_MIN = reloj.LECTURA_MIN


def _tecleo_de(cfg: dict) -> list:
    """El compás único de reloj.py, con la firma que esta regla siempre usó."""
    return reloj.tecleo_filas(cfg)


def validar(plan: list, duracion: float | None,
            anclas: dict | None = None) -> tuple[list, list]:
    errores, avisos = [], []
    orden = leer_orden()
    anclas = anclas or {}

    if not isinstance(plan, list):
        return (["el plan debe ser una lista de capas"], [])

    nombres_plan = {c.get("capa") for c in plan if isinstance(c, dict)}
    orden_plan = {c.get("capa"): i for i, c in enumerate(plan)
                  if isinstance(c, dict)}

    vistos = {}
    for i, capa in enumerate(plan):
        nom = capa.get("capa") or "<sin nombre>"
        etq = "capa %d (%s)" % (i, nom)

        # --- estructura mínima ---
        for clave in ("capa", "template", "t", "duracion"):
            if clave not in capa:
                errores.append("%s: falta `%s`" % (etq, clave))
        if "template" in capa:
            ruta = os.path.join(PLANTILLAS, capa["template"])
            if not os.path.exists(ruta):
                errores.append("%s: no existe templates/%s" % (etq, capa["template"]))

        # --- nombres de sonido ---
        # Aquí es el sitio barato: este es el PASO 4, antes de renderizar. Un
        # nombre mal escrito hoy no lo cazaba nadie —`grep sfx` sobre este
        # fichero, `lint_config.py` y `contratos.py` daba cero en los tres— y
        # el compositor lo descartaba en silencio, así que el vídeo salía sin
        # ese sonido y ni el log ni el resumen decían nada. Es el mismo
        # descarte silencioso que este validador existe para cazar en las
        # capas, y llevaba todo este tiempo abierto por el lado del audio.
        for clave, valor in _sonidos_de(capa):
            if valor not in _CATALOGO:
                cerca = _parecido(valor, _CATALOGO)
                errores.append(
                    "%s: `%s` pide el sonido «%s», que no existe%s"
                    % (etq, clave, valor,
                       ". ¿Querías «%s»?" % cerca if cerca else ""))

        t0 = float(capa.get("t", 0) or 0)
        dur = float(capa.get("duracion", 0) or 0)
        t1 = t0 + dur
        if dur <= 0:
            errores.append("%s: duración %.2f s" % (etq, dur))
        if t0 < 0:
            errores.append("%s: empieza en t=%.2f, negativo" % (etq, t0))

        # --- el fallo de `fondo`: fuera de ORDEN se descarta en silencio ---
        # Mismo criterio que el compositor: ORDEN son TIPOS. Una capa vale
        # si su plantilla está registrada, aunque su nombre sea único.
        tpl_base = str(capa.get("template", "")).replace(".html", "")
        conocida = (nom in orden or tpl_base in orden
                    or tpl_base.replace("-", "") in orden)
        if orden and not conocida:
            errores.append(
                "%s: no está en ORDEN (guiones/capas.json) — se renderiza "
                "y el compositor la descarta sin avisar" % etq)

        # --- duración del plan frente a la locución ---
        if duracion is not None:
            if t0 >= duracion:
                errores.append("%s: empieza en t=%.2f, después del final "
                               "(%.2f s): no se verá" % (etq, t0, duracion))
            elif t1 > duracion + 0.05:
                avisos.append("%s: acaba en %.2f, %.2f s más allá del final"
                              % (etq, t1, t1 - duracion))

        # --- tiempos relativos escritos en absoluto ---
        cfg = capa.get("config") or {}
        dcfg = cfg.get("duration")
        if dcfg is not None and abs(float(dcfg) - dur) > 0.06:
            avisos.append("%s: `config.duration` (%.2f) no coincide con "
                          "`duracion` (%.2f); la plantilla usa la suya para "
                          "calcular la salida" % (etq, float(dcfg), dur))
        for ruta_clave, val in reloj.recolectar_tiempos(cfg):
            if val > dur + 0.01:
                avisos.append(
                    "%s: `%s` = %.2f supera la duración de la capa (%.2f). "
                    "Estos tiempos son RELATIVOS al inicio de la capa; "
                    "¿está escrito en tiempo absoluto?" % (etq, ruta_clave, val, dur))

        # --- cortinilla: el contrato con la segunda pasada ---
        # `cristal` y `cortinilla` comparten mecanismo —la plantilla emite una
        # silueta y ffmpeg trata con ella una región del metraje— y son dos
        # tratamientos distintos: el cristal difumina una copia de lo que ya
        # hay, la cortinilla revela otra cosa por debajo. Declarar los dos en
        # la misma capa no tiene sentido y el compositor no lo hace; hasta
        # aquí eso se descubría componiendo (minutos), no validando (0,1 s).
        if capa.get("cristal") and capa.get("cortinilla"):
            errores.append(
                "%s: declara `cristal` y `cortinilla` a la vez. Son dos "
                "tratamientos de la misma silueta y el compositor solo aplica "
                "uno: quita el que sobre" % etq)
        if capa.get("cortinilla"):
            # La plantilla dimensiona el viaje del canto con `config.duration`
            # y decide dónde se para con `config.hasta`. Sin ellos anima con
            # sus valores nominales y la silueta que recibe ffmpeg deja de
            # corresponder a la capa: el plan tiene que decirlo explícito.
            for clave, arreglo in (
                    ("duration", "`config.duration` = `duracion` (%.2f)" % dur),
                    ("hasta",
                     "`config.hasta` (fracción del ancho, p. ej. 0.64)")):
                if cfg.get(clave) is None:
                    errores.append(
                        "%s: `cortinilla` sin `config.%s`. Añade %s"
                        % (etq, clave, arreglo))
            # Desde el plan no se sabe si el paso 7 llevará `--lut`: eso vive
            # en la línea de comandos del compositor, que ya avisa y omite el
            # revelado. Este aviso llega ANTES de renderizar, que es cuando
            # aún es barato darle una `imagen` que revelar.
            if not capa.get("imagen"):
                avisos.append(
                    "%s: cortinilla sin imagen revela el metraje sin LUT: "
                    "solo se ve con un look fuerte — §17" % etq)

        # --- permanencia del contenido tecleable ---
        # La puerta gemela de lo que `leer_guion.py` dimensiona: una capa que
        # muere antes de que su contenido termine de ESCRIBIRSE no da ningún
        # error al renderizar — el tecleo se corta y ya. Pasó en la pieza de
        # Codex: `codemockup` con 195 caracteres a 42 cps en una capa de
        # 3,0 s. El compás termina en 5,85 s, así que las cuatro últimas
        # líneas del YAML —incluida `fail-on: high`, que era el remate— no se
        # vieron JAMÁS, y ni el renderizador ni el compositor dijeron nada.
        # El fin del tecleo se deriva replicando el compás real de la
        # plantilla, más una cola de lectura mínima para la última línea.
        tecleo = _tecleo_de(cfg)
        if tecleo and dur > 0:
            txt_ult, fin_ult = max(tecleo, key=lambda p: p[1])
            cola = max(COLA_MIN, len(txt_ult.strip()) / LECTURA_CPS)
            necesario = fin_ult + cola
            if necesario > dur + 0.01:
                perdidas = [
                    "línea %d («%s»)" % (n, (txt.strip() or "·")[:32])
                    for n, (txt, fin) in enumerate(tecleo, 1)
                    if fin > dur + 0.01]
                detalle = (
                    "no llegan a verse: %s" % ", ".join(perdidas)
                    if perdidas else
                    "la última línea muere %.2f s después de escribirse y "
                    "leerla pide %.1f s" % (dur - fin_ult, cola))
                errores.append(
                    "%s: el contenido tecleado necesita %.2f s (el tecleo "
                    "termina en %.2f s + %.1f s de cola de lectura) y la capa "
                    "muere en %.2f s — %s. Alarga `duracion` (y "
                    "`config.duration`) a >= %.1f s o recorta las líneas"
                    % (etq, necesario, fin_ult, cola, dur, detalle, necesario))

        # --- referencias `sobre:` ---
        # Una capa solo puede anclarse a otra que se haya renderizado
        # ANTES: las anclas se publican al renderizar y se leen del
        # manifiesto. Una referencia hacia adelante funciona por accidente
        # —si quedó un manifiesto de una pasada previa— y falla en limpio.
        for ref in recolectar_sobres(cfg):
            destino = ref.split(".")[0]
            if destino not in nombres_plan:
                errores.append(
                    "%s: se ancla a «%s», que no existe en el plan" % (etq, ref))
            elif orden_plan[destino] > i:
                errores.append(
                    "%s: se ancla a «%s», pero esa capa va DESPUÉS en el "
                    "plan. Las anclas se publican al renderizar: muévela "
                    "antes." % (etq, ref))
            elif anclas and ref not in anclas:
                avisos.append(
                    "%s: el ancla «%s» no está en el manifiesto. Claves "
                    "conocidas de esa capa: %s" % (
                        etq, ref,
                        ", ".join(sorted(k for k in anclas
                                         if k.startswith(destino + "."))) or "ninguna"))

        vistos.setdefault(nom, []).append((t0, t1, i))

    # --- nombre de capa repetido: un gráfico desaparece sin rastro ---
    # `composite_ffmpeg.py` documenta que dos instancias de la misma plantilla
    # necesitan nombres distintos, y no lo comprobaba nadie. El renderizador
    # vacía y reescribe `build/frames/<capa>` por nombre, y el manifiesto
    # indexa por nombre: de dos entradas homónimas solo sobrevive la última, y
    # los fotogramas de la primera se han borrado ya.
    #
    # Es ERROR y no aviso porque no hay ninguna configuración en la que
    # funcione. Y va aparte del solape de abajo: el solape solo lo detectaba
    # cuando además coincidían en el tiempo, y dos apariciones de la misma
    # tarjeta en momentos distintos es justo el caso que NO solapa.
    for nom, tramos in sorted(vistos.items()):
        if len(tramos) > 1:
            errores.append(
                "«%s» aparece %d veces en el plan (capas %s). Solo sobrevivirá "
                "la última y las demás se renderizan y se borran: el "
                "renderizador reescribe el mismo directorio. Dales nombres "
                "distintos («%s», «%s2»…)."
                % (nom, len(tramos), ", ".join(str(t[2]) for t in tramos),
                   nom, nom))

    # --- dos capas en el mismo carril, solapadas ---
    for nom, tramos in vistos.items():
        tramos.sort()
        for a, b in zip(tramos, tramos[1:]):
            if b[0] < a[1] - 0.01:
                avisos.append(
                    "carril «%s»: las capas %d y %d se solapan entre %.2f y "
                    "%.2f — la segunda tapa a la primera"
                    % (nom, a[2], b[2], b[0], min(a[1], b[1])))

    # --- huecos sin nada en pantalla ---
    if duracion is not None and plan:
        # Solo cuenta lo que cae DENTRO del vídeo: una capa que empieza
        # después del final ya se ha marcado como error, y dejarla aquí
        # inventaba huecos en un tramo que no existe.
        tramos = []
        for c in plan:
            if c.get("capa") == "fondo":
                continue
            a = float(c.get("t", 0) or 0)
            b = a + float(c.get("duracion", 0) or 0)
            a, b = max(0.0, a), min(duracion, b)
            if b > a:
                tramos.append((a, b))
        tramos.sort()
        cursor, huecos = 0.0, []
        for a, b in tramos:
            if a > cursor + 1.2:
                huecos.append((cursor, a))
            cursor = max(cursor, b)
        if cursor < duracion - 1.2:
            huecos.append((cursor, duracion))
        for a, b in huecos:
            avisos.append("hueco de %.1f s sin ningún gráfico (%.2f → %.2f)"
                          % (b - a, a, b))

    return errores, avisos


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("plan")
    ap.add_argument("--duracion", type=float, default=None,
                    help="duración de la locución en segundos")
    ap.add_argument("--manifiesto",
                    default=os.path.join(comun.build_dir(), "layers.json"),
                    help="para comprobar además los nombres de ancla")
    ap.add_argument("--estricto", action="store_true",
                    help="tratar los avisos como errores")
    args = ap.parse_args()

    plan = carga_json(args.plan)

    errores, avisos = validar(plan, args.duracion,
                              anclas_conocidas(args.manifiesto))

    for e in errores:
        print("  ✗ %s" % e)
    for a in avisos:
        print("  ⚠ %s" % a)
    if not errores and not avisos:
        print("  ✓ plan válido: %d capas" % len(plan))

    print("\n%d errores, %d avisos" % (len(errores), len(avisos)))
    if errores or (args.estricto and avisos):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
