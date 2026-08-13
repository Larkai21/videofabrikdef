#!/usr/bin/env python3
"""Diez piezas de una sola grabación: cinco hooks × dos variantes de edición.

    python3 scripts/piezas.py guiones/idea.json            # qué saldría
    python3 scripts/piezas.py guiones/idea.json --montar    # las monta todas
    python3 scripts/piezas.py guiones/idea.json --montar --solo H1A

## Por qué existe

Un guion con `cuerpo` y `hooks` no es un vídeo: es una grabación y diez
montajes. Se graba UNA vez —los cinco hooks seguidos y después el cuerpo— y
de ahí salen diez piezas que solo se diferencian en los tres primeros
segundos. Es la prueba barata: el mismo material pasó de 6.307 a 144.000
visualizaciones cambiando nada más que la entrada.

## Cómo se recorta cada pieza, que es la parte que no es obvia

No hay que cortar el vídeo ni re-transcribir nada. La regla del reloj de este
repo ya lo resuelve: `timeline.words` está en reloj de ORIGEN —la grabación
entera, con los cinco hooks dentro— y `keep` es la ÚNICA traducción a salida.

Y `escaleta` emite un tramo de cámara POR ACTO y lo interseca con el `keep`.
Si el guion de una pieza son «el hook 2» + «el cuerpo», los actos solo reclaman
esas dos regiones.

Solos NO se caen los otros cuatro, y esto costó un montaje entero de creer lo
contrario: `plano()` ENCADENA —el hueco entre un tramo y el siguiente se rellena
solo, porque entre dos actos hay una respiración y cortarla deja la voz
pegada—, así que la primera pieza salió de 78,7 s con los cinco ganchos
seguidos, sin que ninguna etapa diera error. Por eso el guion sintetizado lleva
`metadata.descartar_no_reclamado`: con él, un hueco que contenga PALABRAS que
ningún acto reclama rompe la cadena y se cae. Se declara y no se mide porque el
umbral que separaría un hook de una respiración es un número inventado —en la
pieza de Codex ese hueco son tres palabras que sí deben quedarse—.

Por eso esto es un orquestador y no un motor: sintetiza un guion clásico por
pieza —el hook elegido como acto 1, el cuerpo detrás— y deja que la cadena de
siempre haga su trabajo. Cada pieza pasa por las mismas puertas que cualquier
montaje, y si una falla, falla con el nombre de la pieza delante.

Cada pieza trabaja en `build/piezas/<id>/` vía `EDITOR_BUILD` y deja su mp4 en
`renders/<id>.mp4`; por defecto van tres a la vez. `build/` deja de ser un
montaje y pasa a ser la FUENTE que las diez comparten, así que para mirar una
con el arnés hay que decir cuál:

    EDITOR_BUILD=build/piezas/H3B make rapido
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

from comun import carga_json, exige_ok  # noqa: E402

# El ÚNICO que se queda con `build/` a pelo, y a propósito: aquí `build/` no
# es un montaje sino la FUENTE que las diez piezas comparten —el timeline
# limpio y el rostro— y el sitio donde cuelga `piezas/`. Cada montaje recibe
# su `EDITOR_BUILD` en `prepara()`; si lo leyera también este, apuntar el
# arnés a una pieza haría que la siguiente tanda se montara dentro de ella.
BUILD = os.path.join(RAIZ, "build")
RENDERS = os.path.join(RAIZ, "renders")
PY = os.path.join(RAIZ, ".venv", "bin", "python")
if not os.path.exists(PY):
    PY = sys.executable


def combinaciones(g: dict) -> list:
    """(id, guion clásico) por cada hook × variante.

    El guion que sale de aquí es del dialecto de siempre —una lista `timeline`
    de actos— porque es lo que `leer_guion.py` sabe leer. La variante aporta
    lo VISUAL (tarjeta, micro-FX, modo de pantalla) y el hook aporta lo que se
    DICE: son dos cosas distintas y por eso viven separadas en el guion. Aquí
    se funden en un acto 1."""
    fuera = []
    for h in g.get("hooks") or []:
        hid = h.get("id") or "H?"
        variantes = h.get("variantes") or [{"id": "A"}]
        for v in variantes:
            acto = {
                "act": 1,
                "act_name": "hook %s%s · %s" % (hid, v.get("id", ""),
                                                (h.get("angulo") or {}).get("nombre", "")),
                "screen_mode": v.get("screen_mode", "MODE_A_ROLL"),
                "framing": v.get("framing", "FRAME_CLOSE_UP"),
                "spatial_position": v.get("spatial_position", "POS_CENTER"),
                "voice_speech": h["voice_speech"],
                "blue_highlight_words": h.get("blue_highlight_words") or [],
                "micro_fx": v.get("micro_fx") or [],
                "sfx": v.get("sfx") or [],
            }
            if v.get("visual_trigger"):
                acto["visual_trigger"] = v["visual_trigger"]
            clasico = {
                # `descartar_no_reclamado` es lo que tira los OTROS CUATRO
                # hooks. Aquí y no en el guion del usuario porque es una
                # propiedad de esta síntesis, no de la escaleta: en la
                # grabación hay cinco entradas seguidas y esta pieza usa una,
                # así que lo que ningún acto reclama sobra por construcción.
                # Sin él la primera pieza salía de 78,7 s con los cinco
                # ganchos encadenados, y ninguna etapa daba error.
                "metadata": dict(g.get("metadata") or {},
                                 descartar_no_reclamado=True,
                                 title="%s · %s%s" % (
                                     (g.get("metadata") or {}).get("title", "pieza"),
                                     hid, v.get("id", ""))),
                "timeline": [acto] + copy.deepcopy(g.get("cuerpo") or []),
            }
            # Los actos del cuerpo se renumeran detrás del hook: `leer_guion`
            # indexa los límites por `act` y dos actos con el mismo número se
            # pisarían el alineamiento.
            for i, a in enumerate(clasico["timeline"][1:], start=2):
                a["act"] = i
            fuera.append((hid + str(v.get("id", "")), clasico))
    return fuera


def corre(cmd: list, que: str, entorno: dict) -> None:
    exige_ok(subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True,
                            env=entorno),
             que, arregla="ejecútalo a mano para ver el informe entero")


def prepara(pid: str) -> tuple:
    """El directorio de trabajo de esta pieza, y el entorno que lo impone.

    Cada montaje escribe plan, manifiesto y miles de fotogramas; con un solo
    `build/` había que ir en serie porque cada pieza pisaba a la anterior —que
    es justo el desajuste que `comprobar_montaje.py` existe para cazar—. Con
    `EDITOR_BUILD` cada proceso trabaja en el suyo y las diez caben a la vez.

    Lo que se COPIA es lo que producen las etapas de antes y las diez
    comparten: la transcripción limpia y el rostro. Se copia y no se enlaza
    porque `silencios.py --aplicar` REESCRIBE el timeline al remapear el
    reloj: con un enlace, la primera pieza en terminar le cambiaría el reloj a
    las otras nueve a mitad de montaje, y ninguna daría error."""
    dir_pieza = os.path.join(BUILD, "piezas", pid)
    os.makedirs(dir_pieza, exist_ok=True)
    for f in ("timeline.json", "face.json"):
        origen = os.path.join(BUILD, f)
        if os.path.exists(origen):
            shutil.copy2(origen, os.path.join(dir_pieza, f))
    entorno = dict(os.environ, EDITOR_BUILD=dir_pieza)
    return dir_pieza, entorno


def monta(pid: str, guion: dict, args) -> str:
    """Una pieza, por la cadena de siempre y con las mismas puertas."""
    dir_pieza, entorno = prepara(pid)
    ruta = lambda f: os.path.join(dir_pieza, f)   # noqa: E731

    tmp = ruta("guion.json")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(guion, f, ensure_ascii=False, indent=1)

    corre([PY, "scripts/leer_guion.py", tmp, "--escribir",
           "--timeline", ruta("timeline.json")], "leer_guion " + pid, entorno)
    corre([PY, "scripts/silencios.py", "--timeline", ruta("timeline.json"),
           "--plan", ruta("plan.json"), "--minima", str(args.minima),
           "--aplicar"], "silencios " + pid, entorno)
    corre([PY, "scripts/validar_plan.py", ruta("plan.json")],
          "validar " + pid, entorno)

    frames = ruta("frames")
    if os.path.isdir(frames):
        shutil.rmtree(frames, ignore_errors=True)
    corre(["node", "scripts/render_playwright.js", "--plan", ruta("plan.json"),
           "--build", dir_pieza], "render " + pid, entorno)

    # `colocar` devuelve 1 cuando un gráfico pisa el rostro y no cabe en
    # ninguna banda. Eso es una cosa que hay que MIRAR, no una razón para no
    # montar: el vídeo sale igual y la decisión —encoger la tarjeta o
    # rediseñarla— es de dirección. Se enseña con el nombre de la pieza
    # delante y se sigue; abortar aquí dejaría nueve piezas sin montar por un
    # aviso de la primera.
    r = subprocess.run([PY, "scripts/colocar.py", "--plan", ruta("plan.json"),
                        "--layers", ruta("layers.json"),
                        "--face", ruta("face.json"),
                        "--timeline", ruta("timeline.json"), "--aplicar"],
                       cwd=RAIZ, capture_output=True, text=True, env=entorno)
    avisos = [l.strip() for l in (r.stdout + r.stderr).splitlines()
              if "✗" in l or "sin banda libre" in l] if r.returncode else []

    salida = os.path.join(RENDERS, "%s.mp4" % pid)
    corre([PY, "scripts/composite_ffmpeg.py", "--lut", args.lut,
           "--timeline", ruta("timeline.json"), "--layers", ruta("layers.json"),
           "--broll", ruta("broll_plan.json"), "--face", ruta("face.json"),
           "--output", salida], "componer " + pid, entorno)
    return salida, avisos


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("guion")
    ap.add_argument("--montar", action="store_true",
                    help="monta de verdad; sin esto solo dice qué saldría")
    ap.add_argument("--solo", default=None,
                    help="una sola pieza por su id (H1A, H3B…)")
    ap.add_argument("--lut", default="assets/luts/carbon_bronze.cube")
    ap.add_argument("--minima", type=float, default=0.42)
    # Tres y no diez: cada pieza abre su propio Chromium y rasteriza miles de
    # fotogramas, así que el techo real es la memoria y no los núcleos. Con
    # tres, las diez bajan de ~25 min a ~9 sin que la máquina se arrastre.
    ap.add_argument("--trabajos", "-j", type=int, default=3,
                    help="cuántas piezas a la vez (por defecto 3)")
    args = ap.parse_args()

    g = carga_json(args.guion)
    if not g.get("hooks"):
        print("«%s» no declara `hooks`: no es un guion de diez piezas.\n"
              "  Un guion clásico se monta con  python3 scripts/leer_guion.py "
              "%s --escribir" % (args.guion, args.guion), file=sys.stderr)
        return 2

    combos = combinaciones(g)
    if args.solo:
        combos = [c for c in combos if c[0] == args.solo]
        if not combos:
            print("no hay ninguna pieza «%s»" % args.solo, file=sys.stderr)
            return 2

    print("%d pieza(s) · %d hook(s) × sus variantes"
          % (len(combos), len(g["hooks"])))
    for pid, guion in combos:
        a1 = guion["timeline"][0]
        print("  %-5s %-46s %s" % (pid, a1["act_name"][:46],
                                   a1.get("screen_mode", "")))
    if not args.montar:
        print("\nSin --montar no se ha tocado nada. Añádelo para montarlas.")
        return 0

    if args.trabajos > 1:
        print("\n%d a la vez · cada una en su build/piezas/<id>/" % args.trabajos)
    hechas, fallos = [], []
    with ThreadPoolExecutor(max_workers=args.trabajos) as pool:
        lanzadas = {pool.submit(monta, pid, guion, args): pid
                    for pid, guion in combos}
        for fut in as_completed(lanzadas):
            pid = lanzadas[fut]
            try:
                salida, avisos = fut.result()
                for a in avisos:
                    print("  ⚠ %s: %s" % (pid, a))
                print("  ✓ %s → renders/%s.mp4" % (pid, pid))
                hechas.append(salida)
            except SystemExit as e:
                fallos.append(pid)
                print("  ✗ %s: %s" % (pid, e), file=sys.stderr)
            except Exception as e:                      # noqa: BLE001
                fallos.append(pid)
                print("  ✗ %s: %s" % (pid, e), file=sys.stderr)

    print("\n%d de %d montadas%s"
          % (len(hechas), len(combos),
             " · fallaron: " + ", ".join(sorted(fallos)) if fallos else ""))
    return 0 if not fallos else 1


if __name__ == "__main__":
    raise SystemExit(main())
