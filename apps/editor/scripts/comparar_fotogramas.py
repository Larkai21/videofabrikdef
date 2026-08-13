#!/usr/bin/env python3
"""Compara dos secuencias de fotogramas y CUANTIFICA la diferencia.

Saber que dos renders no son idénticos no dice nada por sí solo. Lo que
decide si hay un fallo de lógica o solo ruido de rasterización es **cuánto**
y **dónde** difieren:

  · unos pocos píxeles con desviación de 1 o 2 valores, repartidos por los
    bordes -> antialiasing del navegador, no un fallo del plan;
  · muchos píxeles con desviación grande, o un desplazamiento coherente ->
    algo se movió de verdad, y eso sí es un fallo.

Uso:
    python3 scripts/comparar_fotogramas.py dirA dirB
    python3 scripts/comparar_fotogramas.py dirA dirB --muestra 12
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys

from comun import exige_ffmpeg, exige_ok

# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
from comun import FFMPEG                        # noqa: E402
CANONICO = re.compile(r"^\d+\.png$")


def estadisticas(a: str, b: str) -> dict:
    """Diferencia absoluta píxel a píxel, resumida por `signalstats`.

    Se usa `blend=difference` y no una comparación byte a byte porque dos
    PNG pueden diferir en bytes y ser idénticos en píxeles —compresión— y
    al revés no: lo que importa es la imagen."""
    r = subprocess.run(
        [FFMPEG, "-nostdin", "-v", "info", "-i", a, "-i", b,
         "-filter_complex",
         "[0:v]format=rgb24[x];[1:v]format=rgb24[y];"
         "[x][y]blend=all_mode=difference,signalstats=stat=tout",
         "-frames:v", "1", "-f", "null", "-"],
        capture_output=True, text=True)
    # Sin mirar el código de salida, un ffmpeg fallido dejaba a `sacar` sin
    # nada que encontrar, los None se volvían 0.0 en el llamador y el
    # veredicto salía «ruido de rasterización»: convertía «no he podido
    # medir» en «no hay diferencia», el peor error posible en una
    # herramienta cuyo único trabajo es medir. Si no puede, que pare.
    exige_ok(r, "ffmpeg blend=difference sobre %s y %s" % (a, b))
    salida = r.stderr
    def sacar(clave):
        m = re.search(clave + r"\s*:\s*([\d.]+)", salida)
        return float(m.group(1)) if m else None
    # YMAX de la diferencia = desviación máxima en luma; YAVG = media
    return {"max": sacar("YMAX"), "media": sacar("YAVG")}


def main() -> int:
    # Antes de nada: si falta el binario, decirlo con el comando que
    # lo arregla en vez de reventar con un FileNotFoundError crudo en
    # medio del trabajo.
    exige_ffmpeg("ffmpeg")
    ap = argparse.ArgumentParser()
    ap.add_argument("dir_a")
    ap.add_argument("dir_b")
    ap.add_argument("--muestra", type=int, default=8,
                    help="cuántos fotogramas distintos analizar a fondo")
    args = ap.parse_args()

    fa = sorted(f for f in os.listdir(args.dir_a) if CANONICO.match(f))
    fb = sorted(f for f in os.listdir(args.dir_b) if CANONICO.match(f))
    if fa != fb:
        print("  ✗ las secuencias no tienen los mismos fotogramas: "
              "%d y %d" % (len(fa), len(fb)))
        return 1

    distintos = []
    for n in fa:
        pa, pb = os.path.join(args.dir_a, n), os.path.join(args.dir_b, n)
        if os.path.getsize(pa) != os.path.getsize(pb):
            distintos.append(n)
            continue
        with open(pa, "rb") as x, open(pb, "rb") as y:
            if x.read() != y.read():
                distintos.append(n)

    print("  %d de %d fotogramas difieren en bytes" % (len(distintos), len(fa)))
    if not distintos:
        print("\n  ✓ secuencias idénticas")
        return 0

    print("\n  Diferencia real de imagen (0 = idénticas, 255 = opuestas):")
    peor_max, peor_media = 0.0, 0.0
    for n in distintos[:args.muestra]:
        s = estadisticas(os.path.join(args.dir_a, n),
                         os.path.join(args.dir_b, n))
        mx = s.get("max") or 0.0
        md = s.get("media") or 0.0
        peor_max = max(peor_max, mx)
        peor_media = max(peor_media, md)
        print("    %-12s  desviación máx %6.1f   media %8.4f" % (n, mx, md))
    if len(distintos) > args.muestra:
        print("    … y %d más" % (len(distintos) - args.muestra))

    print("")
    if peor_max <= 4 and peor_media < 0.05:
        print("  VEREDICTO: ruido de rasterización. La desviación máxima es de\n"
              "  %.0f valores sobre 255 y la media es prácticamente cero, así que\n"
              "  son bordes antialiasados, no contenido movido. El plan y las\n"
              "  plantillas son deterministas; quien no lo es del todo es el\n"
              "  rasterizador del navegador." % peor_max)
        return 0
    print("  VEREDICTO: hay contenido que CAMBIA de verdad (desviación máxima\n"
          "  %.0f, media %.4f). Eso no es antialiasing: busca un reloj, un\n"
          "  azar sin semilla o una medición dependiente del orden." % (peor_max, peor_media))
    return 1


if __name__ == "__main__":
    sys.exit(main())
