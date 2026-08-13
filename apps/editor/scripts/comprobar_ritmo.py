#!/usr/bin/env python3
"""Mide el RITMO: cuánto rato pasa la pieza sin que entre NADA nuevo.

Todo lo demás de este repo comprueba que cada gráfico esté bien —que no pise
la cara, que tenga alfa, que suene, que su reloj cuadre— y ninguno mira lo
único que decide si el vídeo se termina de ver: **cada cuánto pasa algo**. La
referencia de Reels y Shorts es un estímulo nuevo cada 2-3 s, y la última
pieza montada, medida con este script sobre `build/plan.json` +
`build/layers.json`:

    45,30 s de pieza · 11 entradas de capa · 11 ventanas
    un estímulo cada 4,12 s de media
    la mayor:  10,87 s (5,81 → 16,68 s), con 0,00 s a cara sola
    ventanas > 3,5 s: 5, que suman 34,4 s = el 75,8 % de la pieza
    a cara sola (sin ningún gráfico en pantalla): 13,1 s = el 28,9 %

O sea: la mitad del acto 2 transcurre bajo un mismo gráfico de 12,7 s que
entró una vez y ya no vuelve a cambiar. Que ese gráfico esté en movimiento no
es lo mismo que un estímulo nuevo, y por eso se cuenta la ENTRADA y no la
presencia.

Qué NO cuenta como estímulo, y por qué:

  · **Los subtítulos.** Corren de 0 a 45,3 s: su entrada es un único evento
    en t=0 y contarla dejaría toda la pieza «cubierta» por definición. La
    regla no es una lista de plantillas sino una fracción —una capa que dura
    ≥ 90 % de la pieza corre todo el rato, se llame como se llame—, más la
    lista para las que además se sabe qué son (`CONTINUAS`).
  · **Lo que no se renderizó.** Una capa del plan sin fotogramas en el
    manifiesto no entra en pantalla, así que no es un estímulo. Se dice por
    stderr en vez de descartarla en silencio.

Las dos medidas del veredicto están calibradas sobre esa pieza, y las dos
DISPARARÍAN hoy (10,87 > 6, y 75,8 % > 50 %). Por eso salen como AVISO y no
como error mientras no se pase `--puerta`: una puerta que nace en rojo se
desactiva a la semana —se ejecuta, se ve el ✗, se aprende a ignorarlo— y
entonces no queda ni la puerta ni el aviso. Cuando una pieza pase en verde,
`--puerta` pasa a ser el defecto y esta línea se borra.

Y el cruce que hace falta mirar primero: **pausa de voz larga + pantalla
quieta**. Es el instante exacto en el que se abandona el vídeo, y ninguno de
los dos datos por separado lo dice. La pausa se mide en la MEZCLA compuesta,
no en los huecos entre palabras de Whisper (que alarga la última palabra de
cada frase hasta el siguiente ataque: por sus tiempos casi no hay huecos).

    silencedetect NO sirve aquí. Medido sobre `renders/codex-s4.mp4` con
    `noise=-35dB:d=0.6`: cero tramos. Y es correcto — la cama de fondo existe
    justamente para que no haya silencio absoluto, y `comprobar_sonido.py`
    da error si falta. Así que la pausa se mide RELATIVA: un tramo de ≥ 0,6 s
    con la sonoridad momentary ≥ 8 LU por debajo de la integrada. En esa
    mezcla (I = −14,2 LUFS → umbral −22,2) salen dos, y las dos caen dentro
    de una ventana muerta: 9,7–10,7 s y 18,9–20,0 s.

Uso:
    python3 scripts/comprobar_ritmo.py
    python3 scripts/comprobar_ritmo.py --todas          # lista cada ventana
    python3 scripts/comprobar_ritmo.py --sin-mezcla     # sin tocar ffmpeg
    python3 scripts/comprobar_ritmo.py --puerta         # con las dos puertas

Devuelve 1 si hay errores.
"""

from __future__ import annotations

import argparse
import glob
import os
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import comun
from comun import FFMPEG, FFPROBE, carga_json, exige_ffmpeg, exige_ok  # noqa: E402
import comprobar_sonido                                               # noqa: E402

BUILD = comun.build_dir()   # `EDITOR_BUILD` lo redirige
RENDERS = os.path.join(RAIZ, "renders")

# La referencia de la plataforma: un estímulo nuevo cada 2-3 s. No es un
# umbral —no se puede exigir que el ritmo sea exactamente ese— sino la vara
# con la que se lee el informe, y por eso se imprime junto a la media.
REFERENCIA_S = 2.5

# AVISO por ventana. 3,5 s es el primer valor por encima del extremo de la
# referencia (3 s) que no marca como problema el respiro normal entre dos
# tarjetas: en la pieza medida deja fuera las seis ventanas de ≤ 3,1 s —que
# son fraseo— y señala las cinco que de verdad son huecos.
AVISO_S = 3.5

# ERROR. 6 s es el doble del extremo de la referencia: a partir de ahí ya no
# es un respiro, es una pieza distinta. La suma se compara contra la mitad de
# la pieza porque «más tiempo quieto que en movimiento» es la frase que
# describe el problema sin necesidad de calibrar nada.
ERROR_S = 6.0
ERROR_FRACCION = 0.50

# Una capa que dura ≥ 90 % de la pieza corre todo el rato: su entrada no
# reparte la pieza en ventanas, la cubre entera. 90 % y no 100 % porque los
# subtítulos suelen arrancar unas décimas después del primer fotograma.
FRACCION_CONTINUA = 0.90

# Y las que además se sabe qué son. Se decide por PLANTILLA y no por nombre
# de capa —los nombres son libres, «kinetic», «kinetic2»…— igual que en
# `comprobar_sonido.SIN_CUE_LEGITIMO`, y por la misma razón: la plantilla es
# lo que dice qué es la capa.
CONTINUAS = {
    "karaoke-subs.html", "kinetic-captions.html", "subtitles-showcase.html",
    "capitulos.html",
}

# Pausa de voz: ≥ 0,6 s por debajo de (integrada − 8 LU). El 8 sale de barrer
# el umbral sobre `renders/codex-s4.mp4` (I = −14,2 LUFS), no de redondear:
#
#     4 LU → 5 tramos    7 LU → 3    9 LU → 2    12 LU → 0
#     6 LU → 4 tramos    8 LU → 2   10 LU → 1
#
# La meseta es [8, 9] y se toma su borde bajo. Es estrecha, y hay que decirlo:
# está calibrada sobre UNA mezcla, así que esto avisa y no cierra ninguna
# puerta. Los mínimos de las pausas reales caen a −28 LUFS, 14 LU por debajo
# de la voz; lo que entra al aflojar son transitorios de fraseo.
PAUSA_MIN_S = 0.6
PAUSA_REL_LU = 8.0


# --------------------------------------------------------------------------
#  parte pura: dónde están las ventanas y qué cae dentro. Sin subprocess.
#  (la prueba es tests/test_ritmo.py, con datos sintéticos)
# --------------------------------------------------------------------------
def duracion_capa(c: dict) -> float:
    """El plan la llama `duracion` y el manifiesto `dur`. Aquí se cruzan los
    dos ficheros, así que se aceptan las dos y no se elige por el llamador:
    elegir mal daba duración 0 y una capa «continua» dejaba de serlo."""
    for clave in ("dur", "duracion"):
        if c.get(clave) is not None:
            return float(c[clave])
    return 0.0


def es_estimulo(c: dict, dur_pieza: float, continuas=CONTINUAS,
                fraccion: float = FRACCION_CONTINUA) -> bool:
    """¿La entrada de esta capa es un estímulo nuevo, o corre todo el rato?"""
    tpl = os.path.basename(str(c.get("template") or ""))
    if tpl in continuas:
        return False
    d = duracion_capa(c)
    return not (dur_pieza > 0 and d >= fraccion * dur_pieza)


def _cubierto(intervalos: list, t0: float, t1: float) -> float:
    """Segundos de [t0, t1) tapados por la UNIÓN de `intervalos`.

    Unión y no suma: en la pieza medida `fondo` y `securitypipelinenodes` se
    solapan casi por completo, y sumarlos daba una cobertura de 25 s en una
    ventana de 12,7 — o sea «cara sola» negativo.
    """
    tramos = sorted((max(t0, float(a)), min(t1, float(b)))
                    for a, b in intervalos
                    if min(t1, float(b)) - max(t0, float(a)) > 1e-9)
    total, cur = 0.0, None
    for a, b in tramos:
        if cur is None:
            cur = [a, b]
        elif a <= cur[1]:
            cur[1] = max(cur[1], b)
        else:
            total += cur[1] - cur[0]
            cur = [a, b]
    if cur:
        total += cur[1] - cur[0]
    return total


def ventanas_muertas(capas: list, dur_pieza: float, continuas=CONTINUAS,
                     fraccion: float = FRACCION_CONTINUA) -> list:
    """Ventanas sin ninguna ENTRADA nueva. `[(t0, t1, s_a_cara_sola)]`.

    Los tiempos van en reloj de SALIDA: es el reloj del plan remapeado y del
    manifiesto, y el único en el que la pregunta «cuánto lleva el espectador
    sin ver algo nuevo» significa algo.

    La tercera componente es cuántos de esos segundos transcurren SIN NINGÚN
    gráfico en pantalla —cara sola—, que no es lo mismo: 10 s bajo un
    diagrama que sigue animándose se leen distinto que 7 s de plano fijo. Se
    informa de las dos y no se mezclan en una nota.

    Las capas continuas no cuentan tampoco como PRESENCIA, y es a propósito:
    los subtítulos están en pantalla todo el rato, así que contarlos dejaría
    «a cara sola» en cero para siempre y la medida no diría nada.
    """
    vivas = [c for c in capas if es_estimulo(c, dur_pieza, continuas, fraccion)]
    intervalos = [(float(c["t"]), float(c["t"]) + duracion_capa(c))
                  for c in vivas]
    marcas = sorted({round(float(c["t"]), 3) for c in vivas
                     if 0.0 < float(c["t"]) < dur_pieza})
    bordes = [0.0] + marcas + [float(dur_pieza)]

    fuera = []
    for a, b in zip(bordes, bordes[1:]):
        if b - a <= 1e-9:
            continue
        fuera.append((round(a, 3), round(b, 3),
                      round(b - a - _cubierto(intervalos, a, b), 3)))
    return fuera


def resumen(ventanas: list, dur_pieza: float, aviso: float = AVISO_S) -> tuple:
    """`(mayor, suma_de_las_que_avisan, fracción_de_la_pieza, cara_sola)`."""
    mayor = max((b - a for a, b, _ in ventanas), default=0.0)
    suma = sum(b - a for a, b, _ in ventanas if b - a > aviso)
    cara = sum(s for _, _, s in ventanas)
    frac = suma / dur_pieza if dur_pieza > 0 else 0.0
    return round(mayor, 2), round(suma, 2), frac, round(cara, 2)


def cruza_pausas(ventanas: list, pausas: list, minimo: float = AVISO_S) -> list:
    """Pausas de voz que caen dentro de una ventana muerta.

    `[(p0, p1, minimo_lufs, v0, v1, solape)]`, ordenado por el solape.

    Solo se cruzan las ventanas que ya avisan por sí solas (`minimo`): una
    pausa de 0,6 s dentro de un hueco de 1 s es respiración con la pantalla
    quieta durante medio segundo, que es exactamente como se habla. Lo que
    hace daño es la pausa DENTRO del hueco largo.
    """
    fuera = []
    for p0, p1, lufs in pausas:
        for v0, v1, _ in ventanas:
            if v1 - v0 <= minimo:
                continue
            solape = min(p1, v1) - max(p0, v0)
            if solape > 1e-9:
                fuera.append((p0, p1, lufs, v0, v1, round(solape, 2)))
    fuera.sort(key=lambda x: -x[5])
    return fuera


def sin_fotogramas(plan: list, capas_man: list) -> list:
    """Capas del plan que el manifiesto no conoce: no salen en pantalla.

    No es un detalle: si la única capa de una ventana de 10 s resulta que no
    se renderizó, el informe de ritmo estaba midiendo una pieza que nadie va
    a ver. `comprobar_montaje.py` cubre el caso general —plan y manifiesto de
    montajes distintos— y aquí basta con nombrar las que faltan.
    """
    hay = {c.get("capa") for c in capas_man if isinstance(c, dict)}
    return [c.get("capa") for c in plan
            if isinstance(c, dict) and c.get("capa") not in hay]


# --------------------------------------------------------------------------
#  la mezcla: pausas de voz medidas sobre el máster compuesto
# --------------------------------------------------------------------------
def mezcla_reciente(dir_renders: str, desde: float) -> str | None:
    """El .mp4 más nuevo de `renders/`, si es posterior a `desde`.

    Una mezcla más VIEJA que el plan es de otro montaje —`renders/` guarda
    los catálogos, las galerías y todas las versiones anteriores— y cruzar
    sus pausas con estas ventanas es cruzar dos piezas distintas. En ese caso
    no se mide: se dice y se sigue.
    """
    cands = [p for p in glob.glob(os.path.join(dir_renders, "*.mp4"))
             if os.path.getmtime(p) > desde]
    if not cands:
        return None
    return max(cands, key=os.path.getmtime)


def duracion_media(ruta: str) -> float:
    """Duración del contenedor, con ffprobe."""
    r = exige_ok(subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", ruta], capture_output=True, text=True),
        "ffprobe sobre %s" % ruta,
        arregla="comprueba la ruta y FFPROBE_BIN")
    try:
        return float((r.stdout or "").strip().splitlines()[0])
    except (IndexError, ValueError):
        return 0.0


def pausas_de_voz(ruta: str, minimo: float = PAUSA_MIN_S,
                  rel_lu: float = PAUSA_REL_LU) -> tuple:
    """`([(t0, t1, mínimo_lufs)], integrada)` sobre la mezcla compuesta.

    El parseo y la detección de valles son los de `comprobar_sonido.py`, sin
    copiarlos: la cabecera de `reloj.py` cuenta lo que cuesta tener TRES
    registros de la misma cosa que no coinciden. Lo único propio de aquí es
    el umbral, que es RELATIVO a la sonoridad integrada porque la cama de
    fondo impide medir la pausa en absoluto (ver la cabecera del fichero).
    """
    # `-v info` explícito: ebur128 escribe su resumen a nivel INFO y con
    # `-v error` el filtro corre y la medida se pierde. Misma trampa que ya
    # documentan `comprobar_sonido.py` y `hacer_sfx.medir()`.
    r = exige_ok(subprocess.run(
        [FFMPEG, "-nostdin", "-hide_banner", "-v", "info", "-i", ruta,
         "-af", "ebur128=peak=true", "-f", "null", "-"],
        capture_output=True, text=True),
        "ffmpeg ebur128 sobre %s" % ruta,
        arregla="%s -filters | grep ebur128" % FFMPEG)
    med = comprobar_sonido.parsea_ebur128(r.stderr)
    if med["I"] is None or not med["momentary"]:
        return [], None
    umbral = med["I"] - rel_lu
    return (comprobar_sonido.valles(med["momentary"], umbral=umbral,
                                    dur_min=minimo),
            med["I"])


def anclas(ventanas: list, timeline: str, pausas: list, aviso: float) -> list:
    """Para cada ventana muerta, la PALABRA sobre la que anclar el estímulo.

    Decir «mete un micro-FX por palabra» y no decir cuál deja el trabajo a
    medias, y el trabajo que queda es el caro: cruzar a mano los tiempos del
    informe —que van en reloj de SALIDA— con `timeline.words`, que va en
    ORIGEN. Esa conversión es exactamente lo que `reloj.Mapa` hace, así que
    hacerla aquí cuesta veinte líneas y ahorra la arqueología que costó esta
    misma tanda.

    El criterio, en este orden:

      · si hay una pausa de voz dentro de la ventana, la primera palabra
        DESPUÉS de la pausa. Voz parada y pantalla quieta es el punto de
        abandono, y lo que lo rompe es algo que entre justo al reanudar;
      · si no, la palabra más cercana al centro de la ventana, que es donde
        parte el hueco en dos mitades parecidas.

    Se devuelve la palabra en reloj de SALIDA y en ORIGEN: la primera para
    reconocerla en el informe, la segunda porque el guion y la escaleta
    anclan por TEXTO y quien escribe quiere saber que es esa y no otra igual
    veinte segundos después."""
    import reloj                                            # local: solo aquí
    tl = carga_json(timeline)
    if not tl or not tl.get("words") or not tl.get("keep"):
        return []
    mapa = reloj.Mapa(tl["keep"])
    palabras = [(mapa(float(w["start"])), float(w["start"]), w["w"])
                for w in tl["words"]]
    fuera = []
    for t0, t1, _sola in ventanas:
        if t1 - t0 <= aviso:
            continue
        dentro = [p for p in palabras if t0 < p[0] < t1]
        if not dentro:
            continue
        tras = [p for pa in pausas for p in dentro
                if t0 < pa[1] < t1 and p[0] >= pa[1]]
        elegida = tras[0] if tras else min(
            dentro, key=lambda p: abs(p[0] - (t0 + t1) / 2.0))
        fuera.append((t0, t1, elegida, bool(tras)))
    return fuera


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", default=os.path.join(BUILD, "plan.json"))
    ap.add_argument("--layers", default=os.path.join(BUILD, "layers.json"))
    ap.add_argument("--duracion", type=float, default=None,
                    help="duración de la pieza en SALIDA; por defecto, el "
                         "final de la última capa del manifiesto")
    ap.add_argument("--aviso", type=float, default=AVISO_S)
    ap.add_argument("--error", type=float, default=ERROR_S)
    ap.add_argument("--todas", action="store_true",
                    help="lista todas las ventanas, no solo las que avisan")
    ap.add_argument("--mezcla", default=None,
                    help="mp4 compuesto del que sacar las pausas de voz")
    ap.add_argument("--sin-mezcla", action="store_true",
                    help="no medir el audio (no toca ffmpeg)")
    ap.add_argument("--puerta", action="store_true",
                    help="las dos medidas calibradas pasan de AVISO a ERROR")
    ap.add_argument("--estricto", action="store_true",
                    help="tratar todos los avisos como errores")
    ap.add_argument("--sugerir", action="store_true",
                    help="para cada ventana muerta, la PALABRA sobre la que "
                         "anclar el estímulo que falta")
    ap.add_argument("--timeline", default=os.path.join(BUILD, "timeline.json"),
                    help="de dónde salen las palabras de --sugerir")
    args = ap.parse_args()

    plan = carga_json(args.plan)
    man = carga_json(args.layers)
    if not isinstance(plan, list):
        print("el plan debe ser una lista de capas", file=sys.stderr)
        return 2
    capas_man = man.get("capas") or []
    if not capas_man:
        print("el manifiesto no tiene capas — ejecuta\n"
              "    node scripts/render_playwright.js", file=sys.stderr)
        return 2

    errores, avisos = [], []

    # La ventana y la duración salen del MANIFIESTO —lo que de verdad se
    # rasterizó, `frames/fps`— y la plantilla del PLAN, que es quien dice qué
    # es cada capa. Cruzarlos es el trabajo: con solo el plan se cuentan
    # estímulos que nunca llegaron a pantalla.
    tpl = {c.get("capa"): c.get("template") for c in plan if isinstance(c, dict)}
    capas = [dict(c, template=tpl.get(c.get("capa"))) for c in capas_man
             if isinstance(c, dict)]

    huerfanas = sin_fotogramas(plan, capas_man)
    for nom in huerfanas:
        avisos.append(
            "«%s» está en el plan y no en el manifiesto: no tiene fotogramas, "
            "así que no entra en pantalla y no cuenta como estímulo. "
            "Renderízala:  node scripts/render_playwright.js --only %s"
            % (nom, nom))

    dur = args.duracion or max(
        (float(c.get("t") or 0.0) + duracion_capa(c) for c in capas),
        default=0.0)
    if dur <= 0:
        print("no se puede deducir la duración de la pieza del manifiesto; "
              "dila con --duracion", file=sys.stderr)
        return 2

    ventanas = ventanas_muertas(capas, dur)
    estimulos = sum(1 for c in capas if es_estimulo(c, dur))
    mayor, suma, frac, cara = resumen(ventanas, dur, args.aviso)

    print("Pieza: %.2f s · %d entradas de capa (%d capas, %d continuas)"
          % (dur, estimulos, len(capas), len(capas) - estimulos))
    print("Ritmo: un estímulo cada %.2f s de media (la referencia de Reels y "
          "Shorts es cada %.1f-3 s)"
          % (dur / estimulos if estimulos else dur, REFERENCIA_S))
    print("Ventanas sin entrada nueva: %d · la mayor %.2f s · %.1f s a cara "
          "sola (%.0f %% de la pieza)" % (len(ventanas), mayor, cara,
                                          100.0 * cara / dur))
    print()

    listadas = [v for v in ventanas if args.todas or v[1] - v[0] > args.aviso]
    if listadas:
        print("VENTANAS SIN ESTÍMULO NUEVO")
        for t0, t1, sola in listadas:
            marca = "⚠" if t1 - t0 > args.aviso else "·"
            print("  %s %6.2f → %6.2f s   %5.2f s%s"
                  % (marca, t0, t1, t1 - t0,
                     "   (%.2f s a cara sola)" % sola if sola > 0.05 else ""))
    else:
        print("VENTANAS SIN ESTÍMULO NUEVO: ninguna por encima de %.1f s"
              % args.aviso)

    # --- las dos medidas calibradas ---
    # Con `--puerta` son errores; sin ella, avisos con el mismo texto. Lo que
    # NO cambia es lo que se mide ni lo que se dice: el flag mueve el código
    # de salida, no el diagnóstico.
    graves = []
    if mayor > args.error:
        graves.append(
            "la mayor ventana dura %.2f s (> %.1f): a partir de ahí no es un "
            "respiro, es otra pieza. Parte el gráfico largo en dos entradas o "
            "mete un micro-FX por palabra (BRAND_RULES §15)."
            % (mayor, args.error))
    if frac > ERROR_FRACCION:
        graves.append(
            "las ventanas de más de %.1f s suman %.1f s = el %.1f %% de la "
            "pieza (> %.0f %%): más tiempo quieto que en movimiento."
            % (args.aviso, suma, 100.0 * frac, 100.0 * ERROR_FRACCION))
    (errores if args.puerta else avisos).extend(graves)
    if graves and not args.puerta:
        avisos.append(
            "las dos medidas de arriba serían ERROR con `--puerta`. Hoy no lo "
            "son porque la pieza medida las dispara, y una puerta que nace en "
            "rojo se desactiva: cuando un montaje pase en verde, `--puerta` "
            "pasa a ser el defecto.")

    # --- el cruce con la voz ---
    pausas = []
    if not args.sin_mezcla:
        ruta = args.mezcla
        if not ruta:
            ruta = mezcla_reciente(RENDERS, os.path.getmtime(args.plan))
        if not ruta:
            print("\nSin mezcla posterior al plan en %s: no se cruzan las "
                  "pausas de voz. Compón la pieza\n"
                  "    python3 scripts/composite_ffmpeg.py\n"
                  "o pásala con --mezcla, o silencia esto con --sin-mezcla."
                  % os.path.relpath(RENDERS, RAIZ))
        else:
            exige_ffmpeg("ffmpeg", "ffprobe")
            d_mix = duracion_media(ruta)
            # Una mezcla que dura otra cosa es otra pieza —en `renders/` viven
            # los catálogos de plantillas y las versiones anteriores—, y
            # cruzar sus pausas con estas ventanas sería inventarse el dato.
            if abs(d_mix - dur) > 0.5:
                avisos.append(
                    "%s dura %.2f s y la pieza %.2f: no son el mismo montaje, "
                    "así que no se cruzan las pausas de voz. Compón esta "
                    "pieza (python3 scripts/composite_ffmpeg.py) o señala la "
                    "buena con --mezcla."
                    % (os.path.relpath(ruta, RAIZ), d_mix, dur))
            else:
                pausas, integrada = pausas_de_voz(ruta)
                print("\nMezcla: %s (%.2f s, I %.1f LUFS) · %d pausa(s) de "
                      "voz de más de %.1f s"
                      % (os.path.relpath(ruta, RAIZ), d_mix,
                         integrada if integrada is not None else float("nan"),
                         len(pausas), PAUSA_MIN_S))
                for p0, p1, lufs, v0, v1, sol in cruza_pausas(
                        ventanas, pausas, args.aviso):
                    avisos.append(
                        "pausa de voz %.1f–%.1f s (%.1f LUFS) DENTRO de la "
                        "ventana muerta %.2f–%.2f s: %.1f s con la voz parada "
                        "y la pantalla quieta. Es el punto exacto de abandono; "
                        "si algo tiene que entrar, que entre aquí."
                        % (p0, p1, lufs, v0, v1, sol))

    if args.sugerir:
        prop = anclas(ventanas, args.timeline, pausas, args.aviso)
        print("\nDÓNDE ANCLAR LO QUE FALTA")
        if not prop:
            print("  nada que proponer: o no hay ventanas por encima de "
                  "%.1f s, o %s no tiene palabras"
                  % (args.aviso, os.path.relpath(args.timeline, RAIZ)))
        for t0, t1, (sal, orig, w), tras_pausa in prop:
            print("  %6.2f → %6.2f s   ancla=«%s»  (salida %.2f s, origen "
                  "%.2f s)%s" % (t0, t1, w, sal, orig,
                                 "  ← justo tras la pausa de voz"
                                 if tras_pausa else ""))
        if prop:
            print("  En el guion:  {\"trigger_word\": \"%s\", \"fx_id\": "
                  "\"…\"}   ·   en la escaleta:  e.microfx_en(…, ancla=\"%s\")"
                  % (prop[0][2][2], prop[0][2][2]))
            print("  Ojo al presupuesto de §15: seis micro-FX por pieza y "
                  "cada efecto UNA vez. Si ya están gastados, lo que toca es "
                  "partir el gráfico largo en dos entradas.")

    print()
    for e in errores:
        print("  ✗ %s" % e)
    for a in avisos:
        print("  ⚠ %s" % a)
    if not errores and not avisos:
        print("  ✓ ninguna ventana pasa de %.1f s y la voz no se para sobre "
              "una pantalla quieta" % args.aviso)

    print("\n%d errores, %d avisos" % (len(errores), len(avisos)))
    return 1 if errores or (args.estricto and avisos) else 0


if __name__ == "__main__":
    sys.exit(main())
