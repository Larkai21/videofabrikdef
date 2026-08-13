#!/usr/bin/env python3
"""El SRT que se sube junto al vídeo, derivado del mismo timeline que el vídeo.

Los subtítulos cinéticos son un GRÁFICO: van rasterizados en los píxeles, en
caja alta, de tres en tres palabras y al ritmo de la pieza. Sirven para que el
vídeo se entienda con el sonido apagado y no sirven para nada más — la
plataforma no los indexa, un lector de pantalla no los lee, no se pueden
traducir y no se pueden apagar. Eso es lo que hace este fichero: el OTRO canal,
el de texto, con el mismo contenido y otras reglas de lectura.

Y son otras reglas a propósito. Tres palabras en pantalla medio segundo es el
gesto correcto para el gráfico y el peor formato posible para un subtítulo de
texto: obligaría a leer 39 cambios de línea en 45 s. Aquí se agrupa por
UNIDADES DE LECTURA —dos líneas de 42 caracteres como mucho, mínimo un segundo
en pantalla—, que es lo que asumen las plataformas y lo que aguanta el ojo.

--------------------------------------------------------------------------
EL RELOJ, QUE ES DONDE ESTO SE PUEDE ROMPER SIN DAR ERROR
--------------------------------------------------------------------------

`timeline.words` está en el reloj del vídeo ORIGINAL y el fichero que se sube
es el de SALIDA. `keep` es la única traducción entre los dos, así que cada
palabra pasa por `reloj.Mapa(keep)`. Escribir el SRT con los tiempos de origen
no da error en ningún sitio: el fichero es válido, la sintaxis correcta y los
subtítulos van cada vez más tarde según avanza la pieza. Medido sobre la pieza
de Codex, que es la de este repo: 49,70 s de origen contra 45,30 s de salida,
o sea 4,40 s de desfase acumulado al final —tres frases enteras— y 1,20 s ya
en el primer corte, a los 5 s.

Por lo mismo, una palabra que el montaje ha cortado NO entra en el SRT: no se
oye, y un subtítulo de algo que no suena es peor que no tenerlo. Es la misma
regla que aplica `escaleta._ajusta_subtitulos` a las palabras del gráfico, y
por el mismo motivo.

--------------------------------------------------------------------------
Uso
--------------------------------------------------------------------------

    python3 scripts/exportar_srt.py
    python3 scripts/exportar_srt.py --video renders/codex_v4.mp4
    python3 scripts/exportar_srt.py --salida /tmp/prueba.srt

El nombre por defecto sale del VÍDEO y no del timeline: las plataformas
emparejan la pista de texto con el vídeo por nombre de fichero, así que
`final_output.mp4` quiere `final_output.srt` al lado y no `aroll_codex.srt`.
"""

from __future__ import annotations

import argparse
import os
import re
import sys

import comun
import escaleta
import reloj

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = comun.build_dir()   # `EDITOR_BUILD` lo redirige
RENDERS = os.path.join(RAIZ, "renders")

# --------------------------------------------------------------------------
#  Las reglas de lectura, en un sitio
# --------------------------------------------------------------------------
# 42 caracteres y dos líneas es lo que piden las guías de las plataformas
# (Netflix, BBC y YouTube coinciden en 42 ± 5) y lo que cabe sin invadir el
# tercio útil de un 1080×1920. Más ancho no se lee de una pasada; una tercera
# línea tapa el metraje.
ANCHO_LINEA = 42
LINEAS = 2
# Un segundo es el mínimo por el que un subtítulo se ve como texto y no como
# un parpadeo. Se consigue estirando el final hasta donde empiece el
# siguiente, y si ni así llega, fusionando con él.
MIN_DUR = 1.0
# Una pausa mayor que esto rompe la unidad de lectura. Es MÁS ANCHA que el
# `huecoMax` de 0,42 s del gráfico a propósito: allí una pausa corta separa dos
# grupos de tres palabras, y aquí partiría una frase por respirar.
PAUSA = 0.6
# Y un techo por arriba. Sin él, 84 caracteres dichos despacio se quedaban
# 7,4 s fijos en pantalla —medido en el cue 7 de la pieza de Codex—: el texto
# sigue siendo correcto, pero deja de acompañar a la voz y el espectador lo ha
# leído tres veces. Las guías de las plataformas cortan entre 6 y 7 s.
MAX_DUR = 6.0

_FIN_FRASE = re.compile(r"[.!?…]['\"»)]*$")


# --------------------------------------------------------------------------
def palabras_de_salida(tl: dict) -> list:
    """Las palabras que SE OYEN, en reloj de salida.

    Dos cosas a la vez porque son la misma: `Mapa` lleva al borde del corte lo
    que cae dentro de un hueco, así que una palabra descartada por el montaje
    no desaparece al remapear — se queda pegada al corte con duración cero y
    se colaría en el SRT encima de la siguiente. Se filtra ANTES, en origen,
    que es el único reloj donde `keep` dice la verdad sobre ella.
    """
    mapa = reloj.Mapa(tl["keep"])
    tramos = [(float(k["src_start"]), float(k["src_end"])) for k in tl["keep"]]
    fuera = []
    for w in tl.get("words") or []:
        a, b = float(w["start"]), float(w["end"])
        if not any(min(b, y) - max(a, x) > 0 for x, y in tramos):
            continue
        fuera.append({"w": str(w["w"]).strip(),
                      "ini": round(mapa(a), 3), "fin": round(mapa(b), 3)})
    return [p for p in fuera if p["w"]]


def envuelve(texto: str, ancho: int = ANCHO_LINEA,
             lineas: int = LINEAS) -> list:
    """El texto repartido en líneas EQUILIBRADAS, no rellenadas hasta el tope.

    Un reparto ávido deja «41 caracteres / 4 caracteres», que se lee peor que
    «23 / 22» aunque las dos versiones cumplan el ancho: el ojo salta a una
    segunda línea que casi no está. Se prueban todos los cortes y gana el que
    deja las líneas más parecidas.
    """
    ws = texto.split()
    if not ws:
        return []
    if len(texto) <= ancho or lineas < 2:
        return [texto]
    mejor = None
    for i in range(1, len(ws)):
        a, b = " ".join(ws[:i]), " ".join(ws[i:])
        if len(a) > ancho:
            break
        if len(b) > ancho:
            # La cola aún no cabe en una línea; con `lineas > 2` habría que
            # seguir partiendo, y hoy nadie pide más de dos.
            continue
        d = abs(len(a) - len(b))
        if mejor is None or d < mejor[0]:
            mejor = (d, [a, b])
    # Sin corte válido —una sola palabra más larga que el ancho, o un cue
    # fusionado por el mínimo de duración— se devuelve entero y se dice en el
    # informe. Partir una palabra por la mitad sería peor.
    return mejor[1] if mejor else [texto]


def cabe(palabras: list, ancho: int = ANCHO_LINEA,
         lineas: int = LINEAS) -> bool:
    """¿Este grupo cabe en `lineas` líneas de `ancho`? Se mide por reparto
    ávido, que es el que menos líneas usa: si no cabe así, no cabe."""
    n, act = 1, ""
    for p in palabras:
        w = p["w"]
        if not act:
            act = w
        elif len(act) + 1 + len(w) <= ancho:
            act += " " + w
        else:
            n += 1
            act = w
            if n > lineas:
                return False
    return len(act) <= ancho or len(palabras) == 1


def reparte(palabras: list, ancho: int = ANCHO_LINEA, lineas: int = LINEAS,
            pausa: float = PAUSA, max_dur: float = MAX_DUR) -> list:
    """Las palabras agrupadas en unidades de lectura.

    Corta por lo que un lector nota: final de frase, pausa larga, techo de
    tiempo o falta de sitio. Los dos primeros los pide la propia locución y
    caen donde toca; los dos últimos son topes nuestros y parten por donde
    sea — de ahí el arrastre de abajo.

    Cuando el corte lo fuerza un TOPE y la última palabra que cabía era un
    enlace, ese enlace se va con el cue siguiente. Sin eso, el primer
    subtítulo de la pieza de Codex acababa en «…miles de dólares o» y el
    segundo empezaba en «muchísimo trabajo»: el ojo lee una conjunción,
    espera la segunda mitad y se la encuentra en otro plano. La lista de
    enlaces se IMPORTA de `escaleta` en vez de copiarse: ya vive en dos
    sitios —ahí y en `kinetic-captions.html`— y tres copias de la misma
    lista es como divergen.
    """
    cues, act = [], []
    for p in palabras:
        if act:
            hueco = p["ini"] - act[-1]["fin"]
            tope = (not cabe(act + [p], ancho, lineas)
                    or p["fin"] - act[0]["ini"] > max_dur)
            if _FIN_FRASE.search(act[-1]["w"]) or hueco > pausa or tope:
                arrastra = []
                if tope and len(act) > 1 \
                        and escaleta.limpia(act[-1]["w"]) in escaleta.ENLACES:
                    arrastra = [act.pop()]
                cues.append(act)
                act = arrastra
        act.append(p)
    if act:
        cues.append(act)
    return [{"palabras": c, "ini": c[0]["ini"], "fin": c[-1]["fin"]}
            for c in cues]


def reequilibra(cues: list, min_dur: float = MIN_DUR,
                ancho: int = ANCHO_LINEA, lineas: int = LINEAS) -> list:
    """Le devuelve palabras al cue que se quedó demasiado corto.

    Un subtítulo de una palabra suelta no es un subtítulo, es un parpadeo. Sale
    del techo de tiempo: el corte cae a una palabra de acabar la frase y deja
    «tiempo.» solo, 0,56 s, en la pieza de este repo. Fusionarlo con el
    siguiente no vale —el de delante ya va lleno, que es justo por lo que se
    cortó ahí— así que se hace lo que haría quien subtitula a mano: se le pasa
    la última palabra del cue ANTERIOR, que sí tiene de sobra.

    Solo se mueven palabras hacia atrás en el tiempo, así que el orden y la
    ausencia de solapes se conservan por construcción.
    """
    for i in range(1, len(cues)):
        c, ant = cues[i], cues[i - 1]
        while (c["fin"] - c["ini"] < min_dur
               and len(ant["palabras"]) > 1
               and cabe([ant["palabras"][-1]] + c["palabras"], ancho, lineas)):
            c["palabras"].insert(0, ant["palabras"].pop())
            c["ini"] = c["palabras"][0]["ini"]
            ant["fin"] = ant["palabras"][-1]["fin"]
    return cues


def ajusta_tiempos(cues: list, min_dur: float = MIN_DUR,
                   ancho: int = ANCHO_LINEA, lineas: int = LINEAS):
    """Estira cada cue hasta el mínimo legible sin pisar al siguiente.

    Devuelve `(cues, cortos)`. `cortos` son los que no llegan al mínimo ni
    estirando ni fusionando, y salen en el informe en vez de arreglarse a la
    fuerza: el único arreglo posible sería solapar dos subtítulos o meter una
    tercera línea, y las dos cosas rompen lo que este fichero promete. Medido
    sobre la pieza de este repo: cero.
    """
    i, cortos = 0, []
    while i < len(cues):
        c = cues[i]
        sig = cues[i + 1] if i + 1 < len(cues) else None
        tope = sig["ini"] if sig else float("inf")
        fin = min(max(c["fin"], min(c["ini"] + min_dur, tope)), tope)
        if fin - c["ini"] < min_dur - 1e-3 and sig is not None:
            if cabe(c["palabras"] + sig["palabras"], ancho, lineas):
                c["palabras"] = c["palabras"] + sig["palabras"]
                c["fin"] = sig["fin"]
                del cues[i + 1]
                continue                      # se vuelve a medir el fusionado
            cortos.append(c)
        c["ini"], c["fin"] = round(c["ini"], 3), round(fin, 3)
        i += 1
    return cues, cortos


def sello(t: float) -> str:
    """`HH:MM:SS,mmm`. La coma decimal es del formato, no un descuido: un SRT
    con punto lo rechazan los reproductores estrictos y lo aceptan callando
    los demás, que es la peor combinación."""
    ms = int(round(max(0.0, float(t)) * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


def texto_srt(cues: list, ancho: int = ANCHO_LINEA,
              lineas: int = LINEAS) -> str:
    bloques = []
    for n, c in enumerate(cues, 1):
        txt = " ".join(p["w"] for p in c["palabras"])
        bloques.append("%d\n%s --> %s\n%s\n"
                       % (n, sello(c["ini"]), sello(c["fin"]),
                          "\n".join(envuelve(txt, ancho, lineas))))
    return "\n".join(bloques)


def construir(tl: dict, ancho: int = ANCHO_LINEA, lineas: int = LINEAS,
              min_dur: float = MIN_DUR, pausa: float = PAUSA,
              max_dur: float = MAX_DUR):
    """Del timeline al SRT, sin tocar disco. Función pura: la usan el CLI y
    las pruebas."""
    ws = palabras_de_salida(tl)
    cues = reequilibra(reparte(ws, ancho, lineas, pausa, max_dur),
                       min_dur, ancho, lineas)
    cues, cortos = ajusta_tiempos(cues, min_dur, ancho, lineas)
    return cues, cortos, ws


# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--timeline", default=os.path.join(BUILD, "timeline.json"))
    ap.add_argument("--video",
                    default=os.path.join(RENDERS, "final_output.mp4"),
                    help="de quién toma el nombre el .srt (no hace falta que "
                         "exista todavía)")
    ap.add_argument("--salida", default=None)
    ap.add_argument("--ancho", type=int, default=ANCHO_LINEA)
    ap.add_argument("--min", type=float, default=MIN_DUR, dest="min_dur")
    a = ap.parse_args()

    tl = comun.carga_json(a.timeline)
    reloj.exige_reloj(tl, "origen", "exportar_srt.py",
                      ".venv/bin/python scripts/clean_transcript.py")
    if not (tl.get("words") and tl.get("keep")):
        print("%s no trae palabras o no trae keep: sin las dos no hay SRT "
              "posible.\n  lo produce:  .venv/bin/python "
              "scripts/clean_transcript.py" % a.timeline, file=sys.stderr)
        return 2
    if not reloj.Mapa(tl["keep"]).hay_metraje():
        print("el `keep` de %s no conserva metraje: el montaje está vacío y "
              "un SRT sobre él subtitularía un vídeo que no existe.\n"
              "  míralo con:  .venv/bin/python scripts/comprobar_reloj.py"
              % a.timeline, file=sys.stderr)
        return 2

    cues, cortos, ws = construir(tl, a.ancho, LINEAS, a.min_dur)
    if not cues:
        print("ninguna palabra sobrevive al montaje: el SRT saldría vacío.",
              file=sys.stderr)
        return 2

    salida = a.salida or os.path.join(
        RENDERS, os.path.splitext(os.path.basename(a.video))[0] + ".srt")
    os.makedirs(os.path.dirname(os.path.abspath(salida)), exist_ok=True)
    with open(salida, "w", encoding="utf-8") as f:
        f.write(texto_srt(cues, a.ancho, LINEAS))

    perdidas = len(tl["words"]) - len(ws)
    print("%s   %d subtítulos, %d palabras, %.2f s"
          % (salida, len(cues), len(ws), cues[-1]["fin"]))
    print("  reloj de SALIDA: %.2f s de origen → %.2f s montados"
          % (float(tl.get("duration_original") or 0),
             reloj.Mapa(tl["keep"]).duracion()))
    if perdidas:
        print("  %d palabra(s) fuera del montaje, no subtituladas (no se oyen)"
              % perdidas)
    for c in cortos:
        print("  AVISO: «%s» dura %.2f s (mínimo %.1f) y no se puede estirar: "
              "el siguiente empieza antes y el texto fusionado no cabría en "
              "%d líneas de %d."
              % (" ".join(p["w"] for p in c["palabras"]),
                 c["fin"] - c["ini"], a.min_dur, LINEAS, a.ancho),
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
