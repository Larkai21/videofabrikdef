#!/usr/bin/env python3
"""Regenera los goldens. NUNCA se ejecuta automáticamente.

    make oro          # o: python3 scripts/oro.py

Un golden creado sobre un bug lo convierte en especificación, así que esto va
al final del arnés y a mano. Los de aquí salen del `transcript_44s.json`, que
es el de la pieza que el usuario aprobó MIRÁNDOLA: codifican comportamiento
verificado, no solo el actual.

## Qué se fija y qué no

SE FIJA, porque es determinista y su fallo es invisible:

  · `timeline.json` completo desde el transcript congelado. `clean_transcript`
    es una función pura de punta a punta: sin ffmpeg y sin reloj.
  · el resultado de `silencios --aplicar` con la lista de silencios INYECTADA.
    Es **el golden de más valor del repo**: fija la etapa cuyo fallo es
    invisible por definición, y sin necesitar audio ni ffmpeg.
  · el md5 del `.cube`. `make_lut.transformar` es pura, y el grading no tenía
    ninguna red: un cambio de curva salía en el vídeo y en ningún log.
  · de los SFX, las DURACIONES y los PICOS, no los bytes. `hacer_sfx.medir` ya
    existe; los bytes cambiarían con cualquier versión de ffmpeg.
  · las `anclas()` de cada plantilla, ±2 px. Son `getBoundingClientRect` a un
    instante fijo: MAQUETACIÓN, no rasterización, y por eso sí son estables.

NO SE FIJA:

  · **píxeles de un render multicapa a 25 fps.** El ítem J del ROADMAP lo
    cierra: dos renders del plan completo dan fotogramas distintos en la capa
    `kinetic`, aunque aislada o a 5 fps coincidan. Un golden así nace
    inestable, y una prueba que falla al azar se desactiva y se lleva por
    delante a las buenas.
  · el `plan.json` COMPLETO. `dirigir.plantillas_disponibles()` lee el
    directorio, así que añadir una plantilla cambia el plan, y en este repo eso
    pasa cada tanda: el golden se pondría rojo constantemente. Se fija su
    RESUMEN —cuántas capas, histograma de plantillas, separación mínima, los
    pares (t, plantilla) redondeados a 0,1 s—, que sobrevive a lo cosmético y
    sigue cazando «el director dejó de emitir micro-FX».
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

FIX = os.path.join(RAIZ, "tests", "fixtures")
ORO = os.path.join(FIX, "oro")
PY = sys.executable

import clean_transcript as ct                # noqa: E402
import hacer_sfx                             # noqa: E402
from comun import FFPROBE, exige_ok          # noqa: E402


def md5(ruta: str) -> str:
    h = hashlib.md5()
    with open(ruta, "rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


# --------------------------------------------------------------------------
def timeline_desde_transcript() -> dict:
    """`clean_transcript` sobre el transcript congelado y SU audio congelado.

    Desde que el recorte de colas mide la envolvente en vez de estimarla por
    letras, esto ya no es puro: llama a ffmpeg. Sigue siendo exacto —mismo
    audio, mismo resultado— pero el audio tiene que ser una FIXTURE. Con el
    valor por defecto de `--audio` el golden medía `build/aroll_codex.mp4`,
    que es desechable, así que borrar `build/` cambiaba el golden."""
    with tempfile.TemporaryDirectory() as d:
        salida = os.path.join(d, "timeline.json")
        r = subprocess.run(
            [PY, os.path.join(RAIZ, "scripts", "clean_transcript.py"),
             "--input", os.path.join(FIX, "transcript_44s.json"),
             "--audio", os.path.join(FIX, "aroll_44s.m4a"),
             "--output", salida],
            capture_output=True, text=True, cwd=RAIZ)
        if r.returncode:
            raise SystemExit("clean_transcript falló:\n%s" % r.stderr)
        return json.load(open(salida, encoding="utf-8"))


def silencios_aplicados() -> dict:
    """`silencios --aplicar` con la lista inyectada, sobre un plan mínimo con
    una capa en t>0 y tiempos relativos dentro. La capa en t>0 no es un detalle:
    es el caso que el remapeo viejo hacía mal y que solo acertaba porque las
    capas con listas de tiempos viven en t=0."""
    tl = timeline_desde_transcript()
    ws = tl["words"]
    plan = [
        {"capa": "kineticcaptions", "template": "kinetic-captions.html",
         "t": 0.0, "duracion": round(tl["keep"][-1]["src_end"], 3),
         "config": {"duration": round(tl["keep"][-1]["src_end"], 3),
                    "palabras": [{"w": w["w"], "ini": w["start"],
                                  "fin": w["end"]} for w in ws]}},
        {"capa": "cierrecta", "template": "cierre-cta.html",
         "t": round(ws[-6]["start"], 3), "duracion": 3.0,
         "config": {"duration": 3.0, "pulsacion": 0.9}},
    ]
    with tempfile.TemporaryDirectory() as d:
        p_tl = os.path.join(d, "timeline.json")
        p_pl = os.path.join(d, "plan.json")
        json.dump(tl, open(p_tl, "w", encoding="utf-8"), ensure_ascii=False)
        json.dump(plan, open(p_pl, "w", encoding="utf-8"), ensure_ascii=False)
        r = subprocess.run(
            [PY, os.path.join(RAIZ, "scripts", "silencios.py"),
             "--timeline", p_tl, "--plan", p_pl,
             "--silencios", os.path.join(FIX, "silencios_44s.json"),
             "--aplicar"],
            capture_output=True, text=True, cwd=RAIZ)
        if r.returncode:
            raise SystemExit("silencios falló:\n%s" % r.stderr)
        informe = json.loads(r.stdout)
        # El informe lleva las rutas de los ficheros escritos, y aquí son de un
        # directorio temporal distinto en cada pasada: dejarlas dentro hacía que
        # este golden cambiara SIEMPRE. Un golden que nunca coincide no fija
        # nada, y además entrena a ignorar `make oro --diff`.
        informe.pop("escrito", None)
        informe.pop("ATENCION", None)
        return {"timeline": json.load(open(p_tl, encoding="utf-8")),
                "plan": json.load(open(p_pl, encoding="utf-8")),
                "informe": informe}


def luts() -> dict:
    fuera = {}
    for preset, nombre in (("carbon", "carbon_bronze"), ("paper", "paper_ink"),
                           ("scinetone", "scinetone_s11")):
        with tempfile.TemporaryDirectory() as d:
            salida = os.path.join(d, "%s.cube" % nombre)
            r = subprocess.run(
                [PY, os.path.join(RAIZ, "scripts", "make_lut.py"),
                 "--preset", preset, "--salida", salida],
                capture_output=True, text=True, cwd=RAIZ)
            if r.returncode:
                raise SystemExit("make_lut %s falló:\n%s" % (preset, r.stderr))
            fuera[nombre] = {"md5": md5(salida),
                             "bytes": os.path.getsize(salida)}
    return fuera


def sfx() -> dict:
    """Duración, pico y RMS. NO los bytes: cambian con la versión de ffmpeg y no
    dicen nada del sonido, mientras que un pico que se mueve 3 dB sí.

    `hacer_sfx.medir` devuelve `pico_dB` y `rms_dB` —no `pico`/`rms`, que es lo
    que puse la primera vez y dejó el golden con seis diccionarios vacíos—. La
    duración la da ffprobe, que ya está disponible.
    """
    dir_sfx = os.path.join(RAIZ, "assets", "sfx")
    fuera = {}
    for n in sorted(hacer_sfx.EFECTOS):
        ruta = os.path.join(dir_sfx, "%s.wav" % n)
        if not os.path.exists(ruta):
            continue
        m = hacer_sfx.medir(ruta)
        # Sin mirar el código de salida, un ffprobe fallido dejaba `dur: 0.0`
        # —por el `or 0` de abajo— y el golden lo CONGELABA como
        # especificación: exactamente el fallo contra el que abre la
        # cabecera de este fichero.
        r = exige_ok(subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries",
             "format=duration", "-of", "csv=p=0", ruta],
            capture_output=True, text=True),
            "ffprobe sobre %s" % ruta)
        fuera[n] = {
            "dur": round(float(r.stdout.strip() or 0), 3),
            "pico_dB": round(float(m["pico_dB"]), 1),
            "rms_dB": round(float(m["rms_dB"]), 1),
        }
    return fuera


def anclas() -> dict:
    """Las cajas que cada plantilla publica, a un instante fijo. Es maquetación
    medida con `getBoundingClientRect`, no rasterización, y por eso es estable
    entre ejecuciones: es la única cosa geométrica que sí se puede congelar."""
    # El humo emite el JSON completo AUNQUE haya fichas con problemas, y
    # entonces sale con 1. Mirar solo el stdout —lo que se hacía— congelaba
    # las anclas de una plantilla rota: «un golden creado sobre un bug lo
    # convierte en especificación», que es la primera línea de este fichero.
    # La cola de stderr que enseña `exige_ok` es justo la lista de ✗.
    r = exige_ok(subprocess.run(
        ["node", os.path.join(RAIZ, "scripts", "humo_plantillas.js")],
        capture_output=True, text=True, cwd=RAIZ, timeout=900),
        "node scripts/humo_plantillas.js",
        arregla="node scripts/humo_plantillas.js  (enseña qué plantilla "
                "falla y por qué)")
    if not r.stdout.strip():
        raise SystemExit("el humo no ha emitido JSON:\n%s" % r.stderr[-1500:])
    d = json.loads(r.stdout)
    # Por VARIANTE y no por fichero: cuatro plantillas se muestran en dos
    # vistas y con la clave del fichero la segunda pisaba a la primera, así
    # que la mitad de sus anclas y de sus cues no estaba congelada.
    # Solo las NUESTRAS. Este golden congela una maquetación que se decidió y
    # que no debe moverse sin querer; las importadas todavía se están
    # vistiendo —maqueta vertical, tokens, ranuras de texto— así que
    # congelarlas sería convertir un trabajo a medias en especificación, que
    # es exactamente lo que la cabecera de este fichero prohíbe.
    return {x.get("variante") or x["plantilla"]: {
                "duration": x.get("duration"),
                "anclas": x.get("anclas", 0),
                "cues": x.get("cues", 0)}
            for x in d["resultados"]
            if not (x.get("variante") or x["plantilla"]).startswith("hf-")}


def estilo(solo: str = "propias") -> dict:
    """Las métricas de MONOTONÍA del catálogo, POR MITADES.

    Dos goldens y no uno, y la razón es que un promedio sobre las 183 no mide
    nada: las 126 importadas escriben `font-size` a pelo y usan su paleta
    —643 píxeles sueltos contra los 2 de siempre— así que hundían la media, y
    a partir de ahí una plantilla NUESTRA podía llenarse de números a pelo sin
    que saltara nada, porque cabía de sobra bajo el listón diluido. El
    trinquete dejaba de proteger justo lo que existía para proteger.

    No congela cómo se ve una plantilla —eso no se puede— sino cuánta variedad
    hay en el conjunto: cuántas curvas distintas, cuántas plantillas se salen
    de `opacity + transform`, cuántos hex sueltos, cuánta textura.

    Es el único golden que se lee al REVÉS que los demás: no dice «esto tiene
    que seguir igual», dice «esto no puede empeorar». La monotonía es una
    propiedad del catálogo y ninguna prueba por plantilla puede verla.
    """
    # Con `--json` el auditor devuelve siempre 0 tras emitir el JSON (lo hace
    # antes de evaluar nada), así que un código distinto de 0 aquí no es una
    # auditoría suspendida: es node reventando, y se enseña en vez de seguir.
    r = exige_ok(subprocess.run(
        ["node", os.path.join(RAIZ, "scripts", "auditar_estilo.js"), "--json",
         "--solo", solo],
        capture_output=True, text=True, cwd=RAIZ, timeout=120),
        "node scripts/auditar_estilo.js --json --solo " + solo)
    if not r.stdout.strip():
        raise SystemExit("auditar_estilo no ha emitido JSON:\n%s" % r.stderr[-800:])
    d = json.loads(r.stdout)
    # `_ease_inexistente` es una lista de diagnóstico, no una medida: fuera.
    return {k: v for k, v in d.items() if not k.startswith("_")}


def resumen_de_plan() -> dict:
    """El RESUMEN del plan del director, no el plan. Sobrevive a que se añada
    una plantilla —que cambia el reparto— y sigue cazando que el director deje
    de emitir micro-FX o que un acto se quede vacío."""
    with tempfile.TemporaryDirectory() as d:
        p_pl, p_tl = os.path.join(d, "plan.json"), os.path.join(d, "tl.json")
        # `dirigir` puede escribir el plan y fallar DESPUÉS —al escribir el
        # timeline—, y comprobar solo que el fichero existe daba por bueno
        # un artefacto a medias sin enseñar el stderr que decía por qué.
        exige_ok(subprocess.run(
            [PY, os.path.join(RAIZ, "scripts", "dirigir.py"),
             "--transcript", os.path.join(FIX, "transcript_44s.json"),
             "--salida", p_pl, "--timeline", p_tl],
            capture_output=True, text=True, cwd=RAIZ),
            "dirigir.py sobre el transcript congelado")
        if not os.path.exists(p_pl):
            raise SystemExit("dirigir.py no ha escrito el plan")
        plan = json.load(open(p_pl, encoding="utf-8"))
        tl = json.load(open(p_tl, encoding="utf-8"))

    usos: dict[str, int] = {}
    for c in plan:
        usos[c["template"]] = usos.get(c["template"], 0) + 1

    # Las tarjetas de acto y los micro-FX van en CARRILES distintos, con
    # presupuestos distintos (§15: «si entraran en el reparto de actos,
    # volveríamos al problema que ese reparto vino a resolver»). Medirlos
    # juntos daba una «separación mínima» de 0,7 s que no significa nada: era
    # la distancia entre una tarjeta y un destello, que por diseño pueden estar
    # cerca. El número que §13 fija es el de tarjeta a tarjeta.
    tarjetas = sorted((c for c in plan
                       if c["capa"] != "kineticcaptions" and "_fx" not in c["capa"]),
                      key=lambda c: c["t"])
    microfx = sorted((c for c in plan if "_fx" in c["capa"]),
                     key=lambda c: c["t"])
    separaciones = [round(b["t"] - (a["t"] + a["duracion"]), 1)
                    for a, b in zip(tarjetas, tarjetas[1:])]
    sep_fx = [round(b["t"] - a["t"], 1)
              for a, b in zip(microfx, microfx[1:])]
    return {
        "_por_que": (
            "RESUMEN y no el plan entero: `dirigir.plantillas_disponibles()` lee "
            "el directorio, así que añadir una plantilla cambia el reparto y un "
            "golden completo se pondría rojo cada tanda. Esto sobrevive a lo "
            "cosmético y sigue cazando que el director deje de emitir micro-FX "
            "o que un acto se quede vacío."),
        "capas": len(plan),
        "reparto": dict(sorted(usos.items())),
        "tarjetas_de_acto": len(tarjetas),
        "microfx": len(microfx),
        # §13 pide 12 s entre TARJETAS; §15 pide 7 s entre micro-FX. Son dos
        # carriles y dos números.
        "separacion_minima_tarjetas": min(separaciones) if separaciones else None,
        "separacion_minima_microfx": min(sep_fx) if sep_fx else None,
        "zooms": sorted({k.get("zoom", 1.0) for k in tl["keep"]}),
        "cronologia": [[round(c["t"], 1), c["template"]] for c in tarjetas],
        "cronologia_microfx": [[round(c["t"], 1), c["template"]]
                               for c in microfx],
    }


# --------------------------------------------------------------------------
GENERADORES = {
    "timeline.json": timeline_desde_transcript,
    "silencios.json": silencios_aplicados,
    "luts.json": luts,
    "sfx.json": sfx,
    "anclas.json": anclas,
    "estilo.json": estilo,
    # El de las importadas empieza donde están HOY y solo puede mejorar: es
    # la deuda de vestirlas, con un número que baja cuando alguien la paga.
    "estilo-importadas.json": lambda: estilo("importadas"),
    "resumen_plan.json": resumen_de_plan,
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo", default=None, help="regenerar solo ese golden")
    ap.add_argument("--diff", action="store_true",
                    help="no escribe: solo dice qué cambiaría")
    args = ap.parse_args()

    os.makedirs(ORO, exist_ok=True)
    cambios = 0
    for nombre, gen in GENERADORES.items():
        if args.solo and args.solo not in nombre:
            continue
        nuevo = gen()
        ruta = os.path.join(ORO, nombre)
        # El `\n` final va DENTRO de la comparación. Sin él, `--diff` decía que
        # los seis cambiarían justo después de haberlos escrito, y un
        # comparador que siempre dice «cambia» es igual de inútil que uno que
        # siempre dice «igual».
        texto = json.dumps(nuevo, ensure_ascii=False, indent=1,
                           sort_keys=True) + "\n"
        viejo = open(ruta, encoding="utf-8").read() if os.path.exists(ruta) else None
        if viejo == texto:
            print("  = %-20s sin cambios" % nombre)
            continue
        cambios += 1
        if args.diff:
            print("  ~ %-20s CAMBIARÍA%s" % (nombre, "" if viejo else " (nuevo)"))
        else:
            open(ruta, "w", encoding="utf-8").write(texto)
            print("  %s %-20s %d bytes"
                  % ("+" if viejo is None else "~", nombre, len(texto)))

    print("\n%d golden(s) %s" % (cambios, "cambiarían" if args.diff
                                 else "escritos" if cambios else "al día"))
    return 1 if (args.diff and cambios) else 0


if __name__ == "__main__":
    sys.exit(main())
