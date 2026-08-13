#!/usr/bin/env python3
"""Mide la mezcla del máster antes de dar la pieza por buena.

El máster se calibró UNA vez —el limitador, el techo, la cama— y desde
entonces nada lo vigilaba por pieza: que la pieza real saliera a −14,1 LUFS
con el pico en −1,2 solo se supo porque alguien lo midió a mano. Y lo que no
se midió pasó sin una línea: los valles de la mezcla —−32/−36 LUFS momentary
en las pausas de voz, o sea «sonar a nada», que es como abre el ROADMAP— y
cuatro capas visuales sin ningún cue en la última pieza, que entraron EN MUDO.

Nada de eso da error en ninguna etapa. Este script existe para que lo dé, o
al menos para que se DIGA:

  · ERROR si la sonoridad integrada se aleja del objetivo más de la
    tolerancia, o si el pico supera el techo de entrega. Las dos cosas
    significan que alguien tocó la calibración o compuso sin máster, y las
    dos se entregan a una plataforma que corrige a ciegas.
  · AVISO si la dinámica es plana (una pieza corta puede serlo a propósito),
    por cada pausa de voz sin cama audible, y por cada capa visual muda.

Medir es barato a propósito: el grafo de solo audio de `composite_ffmpeg.py
--solo-audio` cuesta ~0,2 s de ffmpeg frente a los minutos del vídeo, así que
no hay ninguna razón para no medir en cada pasada.

Uso:
    python3 scripts/comprobar_sonido.py
    python3 scripts/comprobar_sonido.py --wav /tmp/master.wav   # y escúchalo

Devuelve 1 si hay errores.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import comun
from comun import FFMPEG, carga_json, exige_ffmpeg, exige_ok   # noqa: E402
import mezcla                                                  # noqa: E402

BUILD = comun.build_dir()   # `EDITOR_BUILD` lo redirige

# El objetivo es el mismo defecto que `composite_ffmpeg.py --lufs`: Reels,
# Shorts y TikTok normalizan alrededor de −14 LUFS. La tolerancia de ±1,5 LU
# está elegida para atrapar los dos fallos reales que hay que atrapar —una
# pieza compuesta con `--sin-normalizar` sale a ~−17,6 LUFS medidos, y un
# `--lufs` cambiado se aleja lo que se haya cambiado— y para dejar pasar lo
# que el limitador se come legítimamente al frenar los picos (décimas de LU).
OBJETIVO_LUFS = -14.0
TOLERANCIA_LU = 1.5

# El techo se comprueba sobre el WAV y es −1,0 y no −1,4: el limitador
# interno va a `mezcla.TECHO_DEFECTO` (−1,4) precisamente porque entre su
# `attack=5` y el AAC se pierden ~0,4 dB de margen —la tabla medida está
# sobre esa constante—. Un wav por encima de −1,0 significa que alguien subió
# `--techo-dbtp` o tocó el limitador, y el mp4 saldrá recortado por el
# codificador, no por nosotros.
TECHO_ENTREGA_DBFS = -1.0

# Por debajo de 4 LU la pieza es plana. Es AVISO y no error: una pieza corta
# y hablada de corrido puede ser plana legítimamente — las piezas reales
# rondan 3 LU, y rellenar los valles con la cama lo ESTRECHA más aún.
LRA_PLANA = 4.0

# Un valle es un tramo momentary por debajo de −30 LUFS durante ≥ 0,8 s.
# −30 porque los valles medidos de la pieza sin cama audible caían a −32/−36
# mientras la voz ronda −14: es el umbral de «aquí no suena nada». Y 0,8 s
# porque `silencios.py` ya recortó los silencios largos del A-Roll: las
# pausas que quedan son respiración, y por debajo de 0,8 s se leen como
# fraseo, no como hueco.
VALLE_LUFS = -30.0
VALLE_DUR = 0.8

# La ventana M de ebur128 es de 400 ms: hasta que se llena, mide silencio
# aunque no lo haya. Antes de medio segundo no hay medida honesta.
CALENTAMIENTO = 0.5

# Plantillas cuyo silencio es legítimo y no hay que avisar:
#   · los subtítulos acompañan la voz — sonarían encima de cada palabra;
#   · `capitulos` corre la pieza entera, como los subtítulos;
#   · `fondo` es la base opaca, no un evento que entre;
#   · `transicion` recibe su sonido por `config.cortes`, y un corte sin cue
#     ya lo avisa el propio compositor al recolectar.
# Se decide por PLANTILLA y no por nombre de capa: los nombres son libres
# («kinetic», «kinetic2»…) y la plantilla es lo que dice qué es la capa.
SIN_CUE_LEGITIMO = {
    "karaoke-subs.html", "kinetic-captions.html", "subtitles-showcase.html",
    "capitulos.html", "fondo.html", "transicion.html",
}


# --------------------------------------------------------------------------
#  parte pura: parsear y decidir, sin subprocess (la prueba tests/test_sonido.py)
# --------------------------------------------------------------------------

# Línea de progreso de ebur128 (una cada 100 ms): lleva t, M, S, I y LRA
# provisionales. La línea del resumen final lleva cada medida sola.
_PROGRESO = re.compile(r"\bt:\s*(-?\d+(?:\.\d+)?).*?\bM:\s*(-?\d+(?:\.\d+)?|nan)")
_I = re.compile(r"\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS")
_LRA = re.compile(r"\bLRA:\s*(-?\d+(?:\.\d+)?)\s*LU\b")
_PICO = re.compile(r"\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS")


def parsea_ebur128(texto: str) -> dict:
    """Saca I, TP, LRA y el perfil momentary del stderr de `ebur128`.

    Las líneas de PROGRESO también llevan «I: … LUFS» y «LRA: … LU» —los
    valores provisionales—, así que no vale quedarse con el primer match: se
    reconocen por su «t:» y se usan solo para el perfil momentary, y las
    medidas finales salen del resumen, que es lo último que ffmpeg escribe.
    «LRA low/high» no casan: la expresión exige `LRA:` seguido del número.

    Devuelve None en las medidas que no estén: un ffmpeg interrumpido deja
    progreso sin resumen, y eso tiene que distinguirse de una medida real.
    """
    res = {"I": None, "TP": None, "LRA": None, "momentary": []}
    for linea in texto.splitlines():
        m = _PROGRESO.search(linea)
        if m:
            # `M: nan` es la ventana aún vacía, no una medida de silencio.
            if m.group(2) != "nan":
                res["momentary"].append((float(m.group(1)), float(m.group(2))))
            continue
        for clave, rx in (("I", _I), ("LRA", _LRA), ("TP", _PICO)):
            m = rx.search(linea)
            if m:
                res[clave] = float(m.group(1))
    return res


def valles(momentary, umbral=VALLE_LUFS, dur_min=VALLE_DUR,
           desde=CALENTAMIENTO):
    """Tramos de ≥ `dur_min` s por debajo de `umbral`. `[(t0, t1, mínimo)]`.

    Los tiempos son los de las ventanas M de ebur128, que miden los 400 ms
    ANTERIORES a su t: el valle real empieza hasta 0,4 s antes de t0. Para
    encontrar la pausa con el reproductor sobra esa precisión.

    La comparación de duración lleva un épsilon: las ventanas van a décimas y
    `13.4 - 12.6` en coma flotante da `0.7999…`, o sea que el valle de ocho
    ventanas —0,8 s clavados— se descartaría por un error de redondeo, y
    justo en el límite que la constante promete.
    """
    tramos = []
    ini = fin = minimo = None

    def cuenta():
        return ini is not None and fin - ini >= dur_min - 1e-9

    for t, m in momentary:
        if t < desde:
            continue
        if m < umbral:
            if ini is None:
                ini, minimo = t, m
            fin, minimo = t, min(minimo, m)
        else:
            if cuenta():
                tramos.append((ini, fin, minimo))
            ini = fin = minimo = None
    if cuenta():
        tramos.append((ini, fin, minimo))
    return tramos


def capas_mudas(capas, config_por_capa=None):
    """Capas visuales sin ningún cue: las que entran en mudo. `[(capa, t, tpl)]`.

    Cuatro en la última pieza —el sello, el HUD, el candado y el check— y
    ningún log lo dijo: sus plantillas no publican cues propios y el plan no
    les declaró `sfx`, así que `mezcla.recolectar` simplemente no tenía nada
    que recolectar. Un descarte mudo más, y este ni siquiera descartaba: es
    que nunca hubo nada que descartar.

    `config.sinSonido` es el contrato para declarar el mudo como decisión
    —igual que `colocar: false` con la posición— y aquí se respeta: la
    diferencia entre decisión y olvido es exactamente lo que se comprueba.
    """
    config_por_capa = config_por_capa or {}
    mudas = []
    for c in capas:
        if not isinstance(c, dict):
            continue
        tpl = os.path.basename(c.get("template") or "")
        if tpl in SIN_CUE_LEGITIMO or c.get("cues"):
            continue
        if (config_por_capa.get(c.get("capa")) or {}).get("sinSonido"):
            continue
        mudas.append((c.get("capa") or "?", float(c.get("t") or 0.0), tpl))
    mudas.sort(key=lambda x: x[1])
    return mudas


# --------------------------------------------------------------------------
#  la medición
# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--layers", default=os.path.join(BUILD, "layers.json"))
    ap.add_argument("--plan", default=os.path.join(BUILD, "plan.json"),
                    help="solo para respetar `sinSonido`; si falta, se sigue "
                         "sin él")
    ap.add_argument("--wav", default=None,
                    help="conservar aquí el máster medido, para escucharlo")
    ap.add_argument("--objetivo", type=float, default=OBJETIVO_LUFS)
    ap.add_argument("--tolerancia", type=float, default=TOLERANCIA_LU)
    ap.add_argument("--techo", type=float, default=TECHO_ENTREGA_DBFS)
    ap.add_argument("--estricto", action="store_true",
                    help="tratar los avisos como errores")
    args = ap.parse_args()

    exige_ffmpeg("ffmpeg")
    man = carga_json(args.layers)
    capas = man.get("capas") or []

    errores, avisos = [], []

    # --- capas mudas: no necesita ffmpeg, va primero ---
    configs = {}
    if os.path.exists(args.plan):
        plan = carga_json(args.plan)
        if isinstance(plan, list):
            configs = {c.get("capa"): (c.get("config") or {})
                       for c in plan if isinstance(c, dict)}
    for nombre, t, tpl in capas_mudas(capas, configs):
        avisos.append(
            "«%s» (%s) entra EN MUDO en t=%.2f s: ni su plantilla publica "
            "cues ni el plan le declara `sfx`. Si es a propósito, dilo: "
            "`config.sinSonido: true`." % (nombre, tpl, t))

    # --- componer el máster de solo audio y medirlo ---
    # El wav es un artefacto de la MEDIDA, no del montaje: va a un directorio
    # temporal y no a build/ — build/ es del montaje y está sincronizado con
    # iCloud. Con `--wav` se conserva donde se pida, para escucharlo.
    with tempfile.TemporaryDirectory(prefix="comprobar_sonido_") as tmp:
        wav = args.wav or os.path.join(tmp, "master.wav")
        r = exige_ok(subprocess.run(
            [sys.executable,
             os.path.join(RAIZ, "scripts", "composite_ffmpeg.py"),
             "--solo-audio", "--layers", args.layers, "--output", wav],
            capture_output=True, text=True),
            "composite_ffmpeg.py --solo-audio (el máster que se mide)",
            arregla="python3 scripts/composite_ffmpeg.py --solo-audio "
                    "--dry-run")
        # El compositor avisa por stderr de lo que ve al recolectar —cues con
        # el nombre mal escrito, sobre todo—. Tragarse esos avisos sería
        # reinstaurar el descarte mudo que este script existe para cazar.
        for linea in (r.stderr or "").splitlines():
            limpia = linea.strip()
            if limpia.startswith("⚠") or limpia.startswith("aviso"):
                avisos.append("del compositor: %s" % limpia.lstrip("⚠ "))

        # `ebur128` escribe su resumen a nivel INFO: con `-v error` el filtro
        # corre y la medida se pierde. Misma trampa que `_medir_lufs` y que
        # `hacer_sfx.medir()` ya documentan; por eso el `-v info` explícito.
        r = exige_ok(subprocess.run(
            [FFMPEG, "-nostdin", "-hide_banner", "-v", "info", "-i", wav,
             "-af", "ebur128=peak=true", "-f", "null", "-"],
            capture_output=True, text=True),
            "ffmpeg ebur128 sobre el máster",
            arregla="%s -filters | grep ebur128" % FFMPEG)
    med = parsea_ebur128(r.stderr)

    if med["I"] is None or med["TP"] is None or med["LRA"] is None:
        print("ffmpeg corrió pero el resumen de ebur128 no trae todas las "
              "medidas (I=%s TP=%s LRA=%s).\n"
              "  Comprueba el filtro:  %s -filters | grep ebur128"
              % (med["I"], med["TP"], med["LRA"], FFMPEG), file=sys.stderr)
        return 2

    print("  · máster: I %.1f LUFS · pico %.1f dBFS · LRA %.1f LU"
          % (med["I"], med["TP"], med["LRA"]))

    if abs(med["I"] - args.objetivo) > args.tolerancia:
        errores.append(
            "sonoridad integrada %.1f LUFS: a %+.1f LU del objetivo %.1f "
            "(tolerancia ±%.1f). La plataforma la corregirá a ciegas. Si se "
            "compuso con --sin-normalizar, esta es su huella; si no, mira "
            "--lufs en composite_ffmpeg.py."
            % (med["I"], med["I"] - args.objetivo, args.objetivo,
               args.tolerancia))
    if med["TP"] > args.techo:
        errores.append(
            "pico real %.1f dBFS, por encima del techo de entrega %.1f. El "
            "limitador interno va a %.1f (mezcla.TECHO_DEFECTO) porque entre "
            "su ataque y el AAC se pierden ~0,4 dB: con este wav el mp4 sale "
            "recortado por el codificador. Mira --techo-dbtp en "
            "composite_ffmpeg.py." % (med["TP"], args.techo,
                                      mezcla.TECHO_DEFECTO))
    if med["LRA"] < LRA_PLANA:
        avisos.append(
            "LRA %.1f LU (< %.1f): la pieza es plana. Puede ser legítimo en "
            "una pieza corta hablada de corrido; si no lo es, la dinámica "
            "vive en la cama por actos (mezcla.PESO_ACTO) y en --ducking."
            % (med["LRA"], LRA_PLANA))

    for t0, t1, minimo in valles(med["momentary"]):
        avisos.append(
            "pausa de voz sin cama audible en %.1f–%.1f s (mínimo %.1f LUFS "
            "momentary). La cama existe para esto: sube --cama en "
            "composite_ffmpeg.py o regenera el fondo con  python3 "
            "scripts/hacer_sfx.py --solo cama" % (t0, t1, minimo))

    for e in errores:
        print("  ✗ %s" % e)
    for a in avisos:
        print("  ⚠ %s" % a)
    if not errores and not avisos:
        print("  ✓ máster en objetivo, con cama en las pausas y las %d capas "
              "con su sonido" % len(capas))

    print("\n%d errores, %d avisos" % (len(errores), len(avisos)))
    return 1 if errores or (args.estricto and avisos) else 0


if __name__ == "__main__":
    sys.exit(main())
