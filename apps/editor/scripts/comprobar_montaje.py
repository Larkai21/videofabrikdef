#!/usr/bin/env python3
"""Comprueba que plan, manifiesto y fotogramas sean del MISMO montaje.

`build/` es compartido entre piezas y ningún contrato lleva id, hash ni
nombre: `plan.json` y `layers.json` se emparejan solo por el string de la
capa, y los nombres se repiten por diseño —`kicker`, `pip`, `diagram`,
`karaoke`—. Pasó de verdad: en el mismo `build/` convivieron artefactos de
tres piezas distintas.

Lo que resulta de eso no da error en ninguna etapa:

  · el compositor itera `layers.json` y coloca cada capa donde diga SU
    entrada, así que un gráfico de otro montaje aparece en el momento
    equivocado de la narración nueva;
  · `colocar.py` mide el alfa de los fotogramas de una pieza y decide el `dy`
    con la ventana temporal de la otra, y con `--aplicar` lo escribe en los
    dos ficheros;
  · una capa cuyo directorio no existe se descarta en silencio y el vídeo
    sale sin ella.

**No hace falta inventar un campo de identidad.** El plan ya dice qué capas
tiene esta pieza, con qué plantilla y en qué instante; el manifiesto dice qué
se renderizó y cuántos fotogramas hay en disco. Que las tres cosas cuadren ES
la identidad, y comprobarlo no obliga a cambiar ningún formato.

Uso:
    python3 scripts/comprobar_montaje.py
    python3 scripts/comprobar_montaje.py --build otro/

Devuelve 1 si hay errores.
"""

from __future__ import annotations

import argparse
import math
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import comun                                 # noqa: E402

from comun import carga_json                # noqa: E402

# Los fotogramas canónicos son `00042.png`. El filtro por NOMBRE COMPLETO es
# necesario, no cosmético: el repo vive en ~/Documents sincronizado con iCloud
# y el sincronizador deja copias tipo «00140 3.png», que contarían como
# fotograma de más y harían fallar la comprobación de recuento por un motivo
# que no tiene nada que ver con el render.
CANONICO = re.compile(r"^\d+\.png$")

# «cierrecta 2», «kineticcaptions 3»: lo que deja iCloud al resolver un
# conflicto sobre un directorio que el renderizador acaba de recrear.
CONFLICTO_ICLOUD = re.compile(r"^.+ \d+$")

# La variante de FICHERO lleva el sufijo entre el nombre y la extensión:
# «00140 3.png», «plan.origen 2.json». Hace falta la segunda expresión porque
# la de arriba, aplicada a un nombre con extensión, no casa nunca —termina en
# «.png», no en dígito— y así fue como 185 PNG y 3 JSON de conflicto pasaron
# sin una línea mientras la comprobación solo miraba directorios.
CONFLICTO_FICHERO = re.compile(r"^.+ \d+\.[^.]+$")

# Holgura al comparar tiempos: `silencios.py` redondea a milisegundos.
TOL_T = 0.02


def fotogramas(d: str) -> int:
    try:
        return sum(1 for f in os.listdir(d) if CANONICO.match(f))
    except OSError:
        return -1


def esperados(dur: float, fps: float) -> int:
    """Cuántos fotogramas debería haber para esa duración.

    `math.floor(x + 0.5)` y NO `round`: el renderizador usa el `Math.round` de
    JavaScript, que redondea 62.5 a 63, mientras el `round` de Python usa
    redondeo del banquero y da 62. Con `round` esta comprobación nacía en rojo
    para cualquier capa cuya duración cayera en un medio exacto, y una
    comprobación que falla sin motivo se desactiva."""
    return max(1, math.floor(dur * fps + 0.5))


def conflictos_icloud(build: str) -> list:
    """Copias de conflicto de iCloud en TODO `build/`, como error.

    Antes esto era un aviso, solo miraba directorios y solo al primer nivel de
    `build/frames`. Medido en esta máquina: 185 PNG («00140 3.png»), 4
    directorios («codemockup 3») y 3 JSON («plan.origen 2.json») acumulados, y
    `make rapido` en verde. Es error y no aviso porque una copia de conflicto
    no viene sola: aparece cuando iCloud ha resuelto una colisión entre DOS
    montajes, y el fichero canónico que queda al lado puede ser el de la otra
    pieza. Un fotograma ajeno dentro de una secuencia `%05d.png` es
    indetectable a ojo y compone un vídeo mezclado sin ningún error — que es
    exactamente lo que este script existe para impedir.

    Un solo `os.walk` casando el NOMBRE, sin `stat` por fichero: sobre los
    ~2500 PNG del build actual tarda ~0,02 s (medido), así que no hay motivo
    para muestrear ni limitar la profundidad."""
    recuento: dict[str, list] = {}
    # iCloud también duplica el directorio ENTERO: en esta máquina apareció
    # un «build 2/» en la RAÍZ del repo, fuera del alcance de cualquier
    # recorrido de build/. Se mira el nivel de al lado antes de bajar.
    raiz_repo = os.path.dirname(os.path.abspath(build))
    hermanos = [d for d in os.listdir(raiz_repo)
                if CONFLICTO_ICLOUD.match(d)
                and os.path.isdir(os.path.join(raiz_repo, d))]
    if hermanos:
        recuento["(raíz del repo)"] = sorted(d + "/" for d in hermanos)
    for raiz, dirs, ficheros in os.walk(build):
        hallados = [d + "/" for d in dirs if CONFLICTO_ICLOUD.match(d)]
        hallados += [f for f in ficheros if CONFLICTO_FICHERO.match(f)]
        # En un directorio de conflicto TODO el contenido es copia: contarlo
        # fotograma a fotograma infla el recuento sin añadir información.
        dirs[:] = [d for d in dirs if not CONFLICTO_ICLOUD.match(d)]
        if hallados:
            rel = os.path.relpath(raiz, build)
            recuento["build" if rel == "." else "build/" + rel] = sorted(hallados)
    if not recuento:
        return []
    # Se nombran ejemplos, no el inventario entero: con los 185 PNG del
    # incidente la lista taparía el comando de limpieza, que es lo que importa.
    detalle = ", ".join(
        "%s (%d: %s%s)" % (d, len(ns), ", ".join(ns[:3]),
                           "…" if len(ns) > 3 else "")
        for d, ns in sorted(recuento.items()))
    return [
        "%d copia(s) de conflicto de iCloud dentro de build/: %s.\n"
        "      No son de ESTE montaje: las deja el sincronizador al resolver "
        "una colisión, y el fichero canónico de al lado puede ser el de la "
        "otra pieza. Límpialas:\n"
        # «[0-9]*.*» y no «[0-9].*»: la detección casa \\d+, y con el glob de
        # un solo dígito un « 12.png» se detectaría en cada pasada sin que el
        # comando propuesto lo borrara — un error cuyo arreglo no arregla.
        "        find build/ -name '* [0-9]*.*' -delete && "
        "find build/ -depth -type d -name '* [0-9]*' -exec rm -rf {} +"
        % (sum(len(ns) for ns in recuento.values()), detalle)]


def aviso_icloud(build: str) -> str | None:
    """Aviso —no error, es específico de esta máquina— si `build/` sigue
    expuesto a iCloud: no es un symlink y su ruta real cae bajo un directorio
    sincronizado. El arreglo que usa este repo es un symlink a `*.nosync`,
    que iCloud no sincroniza; con él puesto, las copias de conflicto dejan de
    fabricarse en origen en vez de limpiarse después.

    Lo que se mira es el `build/` de la RAÍZ y no el que venga por argumento:
    quien decide si iCloud entra ahí es el enlace de arriba, y una pieza de
    `build/piezas/H4A/` jamás será un symlink. Comprobando el argumento, el
    aviso saltaba SIEMPRE que el arnés se apuntaba a una pieza —con el enlace
    correctamente puesto— y un aviso que sale siempre deja de leerse."""
    if sys.platform != "darwin":
        return None
    build = os.path.join(RAIZ, "build")
    if os.path.islink(os.path.normpath(build)):
        return None
    real = os.path.realpath(build)
    hogar = os.path.expanduser("~")
    sincronizados = (os.path.join(hogar, "Documents"),
                     os.path.join(hogar, "Desktop"))
    if "Mobile Documents" not in real and not any(
            real.startswith(d + os.sep) for d in sincronizados):
        return None
    return ("build/ está sincronizado con iCloud (no es symlink y vive en %s); "
            "arréglalo:  mv build build.nosync && ln -s build.nosync build"
            % real)


def comprobar(plan: list, man: dict, build: str) -> tuple[list, list]:
    errores, avisos = [], []

    # El manifiesto trae `dir`/`mask` RELATIVOS al build (los absolutos de un
    # layers.json anterior al cambio de formato se aceptan tal cual). Se
    # resuelve sobre una copia: quien nos llama puede querer escribir el
    # manifiesto de vuelta con sus rutas intactas (colocar.py lo hace).
    man = comun.resolver_manifiesto(man, build)

    # Va ANTES que todo lo demás y sin depender de plan ni manifiesto: la
    # contaminación de build/ invalida cualquier otra conclusión del script.
    errores += conflictos_icloud(build)
    a = aviso_icloud(build)
    if a:
        avisos.append(a)

    if not isinstance(plan, list):
        return (errores + ["el plan debe ser una lista de capas"], avisos)

    # --- nombres duplicados en el plan (F6) ---
    # `composite_ffmpeg.py` documenta que dos instancias de la misma plantilla
    # necesitan nombres distintos, y nadie lo comprobaba. Con dos entradas del
    # mismo nombre, `vaciar()` borra los fotogramas de la primera y el
    # manifiesto se queda solo con la última: UN GRÁFICO DESAPARECE del vídeo
    # sin dejar rastro. `validar_plan.py` solo lo pilla si además solapan en el
    # tiempo, y dos apariciones de la misma tarjeta en momentos distintos es
    # justo el caso que no solapa.
    vistos: dict[str, int] = {}
    for c in plan:
        if isinstance(c, dict) and c.get("capa"):
            vistos[c["capa"]] = vistos.get(c["capa"], 0) + 1
    for nom, n in sorted(vistos.items()):
        if n > 1:
            errores.append(
                "«%s» aparece %d veces en el plan. Solo sobrevivirá la última: "
                "el renderizador vacía y reescribe el mismo directorio, y el "
                "manifiesto indexa por nombre. Dales nombres distintos "
                "(«%s», «%s2»…)." % (nom, n, nom, nom))

    capas_man = man.get("capas") or []
    if not capas_man:
        return (errores + ["el manifiesto no tiene capas — ejecuta "
                           "node scripts/render_playwright.js"], avisos)

    fps_man = float(man.get("fps") or 0)
    if fps_man <= 0:
        errores.append("el manifiesto no declara `fps`")

    por_plan = {c["capa"]: c for c in plan if isinstance(c, dict) and c.get("capa")}
    por_man = {c["capa"]: c for c in capas_man}

    # --- capas del plan que no se han renderizado ---
    for nom in por_plan:
        if nom not in por_man:
            errores.append(
                "«%s» está en el plan y NO en el manifiesto: el vídeo saldría "
                "sin ella. Rehazla:\n"
                "      node scripts/render_playwright.js --only %s" % (nom, nom))

    # --- capas del manifiesto que no están en el plan ---
    for nom in por_man:
        if nom not in por_plan:
            errores.append(
                "«%s» está en el manifiesto y NO en el plan: es de otro "
                "montaje y el compositor la colocaría igual, en el instante "
                "que diga su entrada." % nom)

    for nom, m in sorted(por_man.items()):
        p = por_plan.get(nom)
        if p is None:
            continue

        # --- misma plantilla, mismos tiempos ---
        if p.get("template") and m.get("template") \
                and p["template"] != m["template"]:
            errores.append("«%s»: el plan pide %s y el manifiesto trae %s"
                           % (nom, p["template"], m["template"]))
        if abs(float(p.get("t", 0)) - float(m.get("t", 0))) > TOL_T:
            errores.append(
                "«%s»: el plan la pone en t=%.3f y el manifiesto en t=%.3f. "
                "Los fotogramas llevan grabado el reloj con el que se "
                "renderizaron: rehazla." % (nom, p.get("t", 0), m.get("t", 0)))
        dur_p, dur_m = float(p.get("duracion", 0)), float(m.get("dur", 0))
        if abs(dur_p - dur_m) > 0.05:
            errores.append("«%s»: el plan dura %.3f y el manifiesto %.3f"
                           % (nom, dur_p, dur_m))

        # --- los fotogramas están y son los que dice ---
        d = m.get("dir")
        if not d or not os.path.isdir(d):
            errores.append(
                "«%s»: su directorio de fotogramas no existe (%s). El "
                "compositor la descarta y el vídeo sale sin ella." % (nom, d))
            continue
        n_disco = fotogramas(d)
        n_dice = int(m.get("frames") or 0)
        fps_capa = float(m.get("fps") or fps_man or 25)
        n_esperado = esperados(dur_m, fps_capa)
        if n_disco != n_dice:
            errores.append("«%s»: el manifiesto dice %d fotogramas y en disco "
                           "hay %d" % (nom, n_dice, n_disco))
        elif abs(n_disco - n_esperado) > 1:
            avisos.append("«%s»: %d fotogramas para %.3f s a %g fps; se "
                          "esperaban %d" % (nom, n_disco, dur_m, fps_capa,
                                            n_esperado))

        # --- la máscara de una capa de cristal, si la hay ---
        if m.get("mask"):
            nm = fotogramas(m["mask"])
            if nm < 0:
                errores.append("«%s»: declara máscara y su directorio no "
                               "existe (%s)" % (nom, m["mask"]))
            elif nm != n_disco:
                errores.append(
                    "«%s»: la máscara tiene %d fotogramas y la capa %d. La "
                    "silueta se acaba antes y la refracción se desincroniza "
                    "sin ningún aviso." % (nom, nm, n_disco))

    # --- fotogramas huérfanos en disco ---
    dir_frames = os.path.join(build, "frames")
    if os.path.isdir(dir_frames):
        usados = {os.path.realpath(m["dir"]) for m in capas_man if m.get("dir")}
        usados |= {os.path.realpath(m["mask"]) for m in capas_man if m.get("mask")}
        for n in sorted(os.listdir(dir_frames)):
            ruta = os.path.join(dir_frames, n)
            if not os.path.isdir(ruta) or os.path.realpath(ruta) in usados:
                continue
            # Las copias de conflicto de iCloud ya las ha contado —como
            # ERROR y en todo build/— `conflictos_icloud()`; repetirlas aquí
            # daría dos diagnósticos con dos arreglos para el mismo
            # directorio. Este aviso queda para lo que sí es del proyecto:
            # restos de otro montaje con nombre canónico.
            if CONFLICTO_ICLOUD.match(n):
                continue
            avisos.append(
                "build/frames/%s no lo usa ninguna capa: sobra de otro "
                "montaje y ocupa disco (%d fotogramas)"
                % (n, fotogramas(ruta)))

    return errores, avisos


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", default=comun.build_dir())
    ap.add_argument("--plan", default=None)
    ap.add_argument("--layers", default=None)
    ap.add_argument("--estricto", action="store_true",
                    help="tratar los avisos como errores")
    args = ap.parse_args()

    plan = carga_json(args.plan or os.path.join(args.build, "plan.json"))
    man = carga_json(args.layers or os.path.join(args.build, "layers.json"))

    errores, avisos = comprobar(plan, man, args.build)
    for e in errores:
        print("  ✗ %s" % e)
    for a in avisos:
        print("  ⚠ %s" % a)
    if not errores and not avisos:
        print("  ✓ plan, manifiesto y fotogramas son del mismo montaje "
              "(%d capas)" % len(man.get("capas") or []))

    print("\n%d errores, %d avisos" % (len(errores), len(avisos)))
    return 1 if errores or (args.estricto and avisos) else 0


if __name__ == "__main__":
    sys.exit(main())
