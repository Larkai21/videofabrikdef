#!/usr/bin/env python3
"""Escuchar y medir cada señal de sonido EN CONTEXTO, contra la voz.

El ROADMAP dejó esto abierto con una frase honesta: *«Pendiente de juicio
humano: el criterio estético del sonido. Las medidas dicen que está bien
colocado y no satura; si suena bien no lo puedo saber.»*

La respuesta no es un instrumento mejor: es **la muestra correcta**.
`galeria_video.py` ya escucha cada efecto **aislado**, con su onda y su nombre
— y aislado es exactamente donde no se puede detectar el fallo que costó este
sprint: `deslizar` medía −38,4 dB de RMS y sonaba perfecto en la galería,
mientras en la mezcla quedaba **1,9 dB por debajo del umbral del ducking** y no
apartaba la voz. Ese hecho solo existe contra la voz.

Dos modos:

    --informe   la tabla. Cada cue con su nivel real en la mezcla, si dispara
                el ducking y cuánto aporta en su banda. Es la tabla que no
                existía y en la que `deslizar` habría cantado desde el día uno.

    (defecto)   fichas de escucha. Por cada cue, tres pasadas del mismo tramo:
                sin el efecto, con él a su ganancia real, y con él +6 dB.
                La primera dice cómo suena sin; la segunda es el juicio; la
                tercera responde a «¿está siquiera ahí?».

El número dice si el efecto EXISTE; la escucha dice si está BIEN. Separar las
dos preguntas es lo que desbloquea el juicio humano — hasta ahora estaban
mezcladas y por eso no se podía responder ninguna.

Uso:
    python3 scripts/banco_sonido.py --informe
    python3 scripts/banco_sonido.py --solo deslizar,acierto
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hacer_sfx                                    # noqa: E402
import comun
from comun import exige_ffmpeg                      # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = comun.build_dir()   # `EDITOR_BUILD` lo redirige
SFX = os.path.join(RAIZ, "assets", "sfx")
# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
FFMPEG = comun.FFMPEG

# El umbral del `sidechaincompress` del compositor, en dBFS. Está escrito como
# `threshold=0.05`, que en decibelios son −26,02: un efecto que no lo alcanza
# NO aparta la voz, así que suena entero por debajo de ella. Es el número que
# convierte «este efecto no se oye» de impresión en dato.
UMBRAL_DUCKING_dB = 20 * math.log10(0.05)


def cues_del_manifiesto(ruta: str) -> list:
    with open(ruta, encoding="utf-8") as f:
        capas = json.load(f).get("capas", [])
    fuera = []
    for c in capas:
        for x in (c.get("cues") or []):
            fuera.append({"capa": c["capa"], "sfx": x["sfx"],
                          "t": float(x["t"]), "gain": float(x.get("gain", 1.0))})
    fuera.sort(key=lambda c: c["t"])
    return fuera


def informe(cues, sfx_vol: float) -> int:
    """La tabla. Devuelve cuántos cues no llegan al umbral del ducking."""
    medidas, mudos = {}, 0
    print("  %-9s %-12s %7s %6s %9s %10s  %s"
          % ("t", "sonido", "capa", "gain", "en mezcla", "umbral", ""))
    for c in cues:
        ruta = os.path.join(SFX, "%s.wav" % c["sfx"])
        if not os.path.exists(ruta):
            print("  %8.2f %-12s  FALTA EL FICHERO" % (c["t"], c["sfx"]))
            continue
        if c["sfx"] not in medidas:
            medidas[c["sfx"]] = hacer_sfx.medir(ruta)
        pico = medidas[c["sfx"]]["pico_dB"]
        en = pico + 20 * math.log10(max(c["gain"] * sfx_vol, 1e-6))
        pasa = en > UMBRAL_DUCKING_dB
        mudos += not pasa
        print("  %8.2f %-12s %7s %6.2f %8.1f dB %8.1f dB  %s"
              % (c["t"], c["sfx"], c["capa"][:7], c["gain"], en,
                 UMBRAL_DUCKING_dB,
                 "" if pasa else "⚠ NO APARTA LA VOZ"))
    print()
    print("  %d señales · %d sonidos distintos · %d por debajo del umbral"
          % (len(cues), len({c["sfx"] for c in cues}), mudos))
    if mudos:
        print("\n  Un efecto por debajo del umbral no es un efecto flojo: es un\n"
              "  efecto que suena ENTERO por debajo de la voz, así que se oye\n"
              "  como suciedad y no como acento. Súbele la ganancia en\n"
              "  dirigir.SFX_POR_PLANTILLA o recalíbralo en hacer_sfx.py.")
    return mudos


def fichas(cues, args) -> int:
    """Tres pasadas por cue: sin, con, y con +6 dB."""
    os.makedirs(args.salida, exist_ok=True)
    maestro = os.path.join(args.salida, "_voz.wav")
    if not os.path.exists(maestro) or args.rehacer:
        # La voz sola, con la cadena real pero sin ninguna señal. `--sin-sfx`
        # deja el lecho y la cama, que es lo correcto: el efecto se juzga
        # contra lo que de verdad va a haber debajo, no contra silencio.
        r = subprocess.run(
            [sys.executable, os.path.join(RAIZ, "scripts", "composite_ffmpeg.py"),
             "--solo-audio", "--sin-sfx", "--output", maestro],
            capture_output=True, text=True)
        if r.returncode != 0:
            print("no he podido rendir la voz sola:\n%s" % r.stderr[-800:],
                  file=sys.stderr)
            return 1

    hechas = 0
    for c in cues:
        ruta = os.path.join(SFX, "%s.wav" % c["sfx"])
        if not os.path.exists(ruta):
            continue
        # 1,2 s antes del golpe y 2,3 después: suficiente para oír el contexto
        # y no tanto como para perder el hilo entre fichas.
        ini = max(0.0, c["t"] - 1.2)
        destino = os.path.join(
            args.salida, "%06.2f_%s_%s.wav" % (c["t"], c["sfx"], c["capa"]))
        ret = int(round((c["t"] - ini) * 1000))
        g = c["gain"] * args.sfx_vol
        # sin · con · con +6 dB, encadenados con medio segundo de aire
        f = (
            "[0:a]atrim=start=%.3f:end=%.3f,asetpts=PTS-STARTPTS,asplit=3[v1][v2][v3];"
            "[1:a]asplit=2[e1][e2];"
            "[e1]volume=%.4f,adelay=%d|%d[s1];"
            "[e2]volume=%.4f,adelay=%d|%d[s2];"
            "[v2][s1]amix=inputs=2:duration=first:normalize=0[m2];"
            "[v3][s2]amix=inputs=2:duration=first:normalize=0[m3];"
            "[v1][m2][m3]concat=n=3:v=0:a=1[out]"
            % (ini, c["t"] + 2.3, g, ret, ret, g * 2.0, ret, ret))
        subprocess.run(
            [FFMPEG, "-nostdin", "-y", "-v", "error", "-i", maestro,
             "-i", ruta, "-filter_complex", f, "-map", "[out]",
             "-c:a", "pcm_s16le", destino], check=True)
        hechas += 1
    print("  %d fichas en %s" % (hechas, args.salida))
    print("  cada una: SIN el efecto · CON él · CON él +6 dB")
    return 0


def main() -> int:
    exige_ffmpeg("ffmpeg")
    ap = argparse.ArgumentParser()
    ap.add_argument("--layers", default=os.path.join(BUILD, "layers.json"))
    ap.add_argument("--salida", default=os.path.join(BUILD, "banco"))
    ap.add_argument("--solo", help="lista de sonidos separados por comas")
    ap.add_argument("--sfx-vol", type=float, default=0.55,
                    help="el mismo que use el compositor")
    ap.add_argument("--informe", action="store_true",
                    help="solo la tabla, sin producir audio")
    ap.add_argument("--rehacer", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.layers):
        print("falta %s — ejecuta antes render_playwright.js" % args.layers,
              file=sys.stderr)
        return 2
    cues = cues_del_manifiesto(args.layers)
    if args.solo:
        quiero = {x.strip() for x in args.solo.split(",")}
        cues = [c for c in cues if c["sfx"] in quiero]
    if not cues:
        print("no hay señales que escuchar", file=sys.stderr)
        return 1

    if args.informe:
        return 1 if informe(cues, args.sfx_vol) else 0
    return fichas(cues, args)


if __name__ == "__main__":
    raise SystemExit(main())
