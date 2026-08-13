#!/usr/bin/env python3
"""Comprueba que todas las secuencias de fotogramas tienen canal alfa.

Este script existe por un fallo concreto y muy caro de diagnosticar: si un
fotograma cubre el lienzo entero, Chromium lo codifica **sin canal alfa**
(PNG de tipo 2 en vez de 6). La secuencia queda con formatos mezclados,
ffmpeg reconfigura el grafo a mitad del vídeo y el archivo sale truncado,
sin un solo error en el log.

La comprobación es barata: el tipo de color de un PNG vive en la cabecera
IHDR, en el byte 25. No hace falta decodificar la imagen ni llamar a
ffprobe una vez por fotograma — se leen 26 bytes de cada archivo.

    tipo 0 = gris          tipo 3 = paleta
    tipo 2 = RGB           tipo 4 = gris + alfa
    tipo 6 = RGBA  ← el único válido aquí

Uso:
    python3 scripts/comprobar_alfa.py
    python3 scripts/comprobar_alfa.py --frames build/frames --capa dock
"""

from __future__ import annotations

import argparse
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import comun                                    # noqa: E402

# `comun.build_dir()` y no `build/` a pelo: con diez piezas de una grabación
# el montaje que hay que inspeccionar no está en `build/` sino en
# `build/piezas/<id>/`, y sin esto el arnés no podía mirar ninguno. La misma
# variable que AÍSLA un montaje lo SELECCIONA:
#     EDITOR_BUILD=build/piezas/H3B make rapido
FRAMES = os.path.join(comun.build_dir(), "frames")

# El compositor lee las secuencias con el patrón `%05d.png`. Solo esos
# archivos acaban en el vídeo, así que solo esos hay que comprobar.
# Cualquier otro `.png` del directorio —típicamente copias de conflicto de
# iCloud, «00140 3.png»— es ruido: ffmpeg ni las abre.
CANONICO = re.compile(r"^\d+\.png$")

NOMBRE_TIPO = {0: "gris", 2: "RGB (sin alfa)", 3: "paleta",
               4: "gris+alfa", 6: "RGBA"}
CON_ALFA = (4, 6)


def tipo_color(ruta: str) -> int | None:
    """Lee el tipo de color del IHDR. Devuelve None si no es un PNG."""
    try:
        with open(ruta, "rb") as f:
            cab = f.read(26)
    except FileNotFoundError:
        return None
    if len(cab) < 26 or cab[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    # 8 firma + 4 longitud + 4 'IHDR' + 4 ancho + 4 alto + 1 bits = byte 25
    return cab[25]


def revisar_capa(dir_capa: str) -> dict:
    # El listado de capas y su lectura no son atómicos: un render en curso
    # puede crear o borrar directorios entre medias. Que eso reviente la
    # comprobación sería peor que el fallo que busca.
    try:
        archivos = sorted(f for f in os.listdir(dir_capa) if CANONICO.match(f))
    except FileNotFoundError:
        return {"total": 0, "tipos": {}, "malos": [], "corruptos": []}
    tipos, malos, corruptos = {}, [], []
    for nombre in archivos:
        t = tipo_color(os.path.join(dir_capa, nombre))
        if t is None:
            corruptos.append(nombre)
            continue
        tipos[t] = tipos.get(t, 0) + 1
        if t not in CON_ALFA:
            malos.append(nombre)
    return {"total": len(archivos), "tipos": tipos,
            "malos": malos, "corruptos": corruptos}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", default=FRAMES)
    ap.add_argument("--capa", default=None, help="revisar solo esta capa")
    ap.add_argument("--muestra", type=int, default=6,
                    help="cuántos fotogramas problemáticos listar por capa")
    args = ap.parse_args()

    if not os.path.isdir(args.frames):
        print("  ✗ no existe %s" % args.frames)
        return 1

    capas = sorted(d for d in os.listdir(args.frames)
                   if os.path.isdir(os.path.join(args.frames, d)))
    if args.capa:
        capas = [c for c in capas if c == args.capa]
    if not capas:
        print("  ✗ sin capas que revisar en %s" % args.frames)
        return 1

    errores, avisos, vacias = 0, 0, 0
    for capa in capas:
        r = revisar_capa(os.path.join(args.frames, capa))
        if r["total"] == 0:
            vacias += 1
            continue

        resumen = ", ".join(
            "%s×%d" % (NOMBRE_TIPO.get(t, "tipo %d" % t), n)
            for t, n in sorted(r["tipos"].items()))
        mezclado = len(r["tipos"]) > 1
        opaca = not mezclado and not any(t in CON_ALFA for t in r["tipos"])
        tiene_mascara = os.path.isdir(os.path.join(args.frames, capa + "__mask"))

        if r["corruptos"] or mezclado:
            # ESTE es el fallo caro. Con formatos mezclados ffmpeg
            # reconfigura el grafo a mitad de la secuencia y el archivo
            # sale truncado sin un solo error en el log.
            errores += 1
            print("  ✗ %-16s %4d fotogramas — %s" % (capa, r["total"], resumen))
            if mezclado:
                print("      FORMATOS MEZCLADOS. El primero sin alfa es %s "
                      "(%d de %d)." % (r["malos"][0], len(r["malos"]), r["total"]))
            if r["corruptos"]:
                print("      no son PNG: %s"
                      % ", ".join(r["corruptos"][:args.muestra]))
        elif opaca and tiene_mascara:
            # Una capa de cristal sin alfa deja su máscara sin nada que
            # recortar: la refracción se aplica al fotograma entero.
            errores += 1
            print("  ✗ %-16s %4d fotogramas — %s (es de cristal y no tiene "
                  "alfa)" % (capa, r["total"], resumen))
        elif opaca:
            avisos += 1
            print("  ⚠ %-16s %4d fotogramas — %s: tapa por completo todo lo "
                  "que tenga debajo" % (capa, r["total"], resumen))
        else:
            print("  ✓ %-16s %4d fotogramas — %s" % (capa, r["total"], resumen))

    if vacias:
        print("  · %d directorio(s) vacío(s), ignorados" % vacias)

    print("")
    if errores:
        print("%d capa(s) con formatos mezclados o cristal sin alfa. Componer "
              "así da un archivo TRUNCADO sin error en el log." % errores)
        print("Arreglo: `body { opacity: 0.998 }` obliga a Chromium a "
              "conservar el alfa. OJO: no sirve si la plantilla pinta fondo "
              "sobre `html` — el fondo del elemento raíz se propaga al lienzo "
              "y queda FUERA del grupo de opacidad del body.")
        return 1

    print("%d capa(s) revisadas, %d aviso(s)." % (len(capas) - vacias, avisos))
    return 0


if __name__ == "__main__":
    sys.exit(main())
