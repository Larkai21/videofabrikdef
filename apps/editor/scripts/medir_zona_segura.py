#!/usr/bin/env python3
"""Mide DÓNDE tapa la interfaz de una app, sobre capturas reales del teléfono.

    python3 scripts/medir_zona_segura.py capturas/reels_*.png --plataforma reels

`colocar.py` avisa de los gráficos que caen bajo la interfaz de Reels, TikTok
o Shorts, y hasta hoy sus fracciones eran una banda conservadora ELEGIDA A
OJO: el propio comentario de `PLATAFORMAS` lo dice y pide que alguien las
mida. Esto es ese alguien.

## Dos métodos, y el segundo es el que funciona en Instagram

**Por coincidencia** (`--auto`): la interfaz se dibuja ENCIMA del vídeo, así
que en capturas de piezas distintas los píxeles que coinciden son los suyos.
Funciona con interfaces OPACAS —barras sólidas— y se cae con las que son
texto suelto sobre el vídeo. Medido en Reels con dos capturas: el suelo de
coincidencia entre dos vídeos cualesquiera es del 10 % y el texto de la
interfaz da 0,15-0,30; indistinguibles. La primera versión de esto devolvió
«banda superior: 0 px» sobre capturas que tienen barra de estado y
navegación a la vista, y una medida falsa es peor que ninguna: se cree.
Por eso ahora COMPRUEBA que la señal se separe del ruido y se niega si no.

**Por regla** (`--regla`, el que se usó de verdad): emite las capturas con
una retícula de coordenadas dibujada encima, para leer a ojo en qué píxel
empieza y acaba cada elemento. Es manual y es exacto, que en una medición
que se hace una vez cada versión de la app es el reparto correcto.

Comparar dos momentos del MISMO reel no vale en ninguno de los dos: un
plano fijo tiene medio cuadro idéntico entre fotograma y fotograma.

## Lo que NO puede medir, y por eso lo dice

- **La caja de texto del pie** cambia de alto con la longitud del copy, y
  una captura solo enseña el que tuviera esa pieza. Se mide lo que tapa EN
  ESAS capturas; el informe avisa de que un pie más largo sube la banda.
- **El recorte del teléfono.** Un móvil más alto que 9:16 recorta el vídeo
  arriba y abajo, así que una banda medida sobre la PANTALLA no es la misma
  fracción del LIENZO. Se calcula la conversión y se enseñan las dos.
- **La interfaz cambia con la versión de la app.** La medida lleva fecha.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

from comun import exige_ffmpeg, exige_ok        # noqa: E402

# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
from comun import FFMPEG, FFPROBE               # noqa: E402

# El ancho al que se comparan las capturas. La interfaz son bandas de cientos
# de píxeles: para saber en qué FILA empieza a tapar sobran los detalles, y a
# resolución completa cada captura son ocho millones de valores que comparar.
ANCHO = 270

# Cuánto puede variar un píxel entre capturas y seguir contando como interfaz.
# No es cero por dos motivos medidos: el JPEG del teléfono mete ruido de
# compresión, y las apps dibujan un DEGRADADO oscuro bajo el texto —así que
# el píxel del velo cambia con el vídeo que hay debajo, aunque el velo esté
# siempre—. 12/255 recoge las dos cosas sin tragarse cielos planos.
TOLERANCIA = 12

# Dónde ACABA la banda. No es un umbral fijo, y probarlo contra una interfaz
# sembrada a propósito es lo que lo demostró: con dos capturas cualesquiera
# hay un suelo de coincidencia —dos vídeos con cielo, o con la misma pared
# oscura— que en la prueba fue del 33 %, y un corte fijo en el 22 % se comió
# 324 px de vídeo tratándolos como interfaz.
#
# Lo que sí es inequívoco es el DESPEÑE: la banda real coincide casi al 100 %
# y el suelo está muy por debajo. Se corta a la mitad del valor del BORDE
# —que es interfaz por construcción— con un mínimo absoluto para que una
# captura sin apenas interfaz no arrastre el corte hasta el ruido.
CAIDA = 0.5
FRACCION_MINIMA = 0.35


def dimensiones(ruta: str) -> tuple[int, int]:
    r = exige_ok(subprocess.run(
        [FFPROBE, "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", ruta],
        capture_output=True, text=True),
        "ffprobe sobre %s" % os.path.basename(ruta),
        arregla="comprueba que la captura es una imagen legible")
    w, h = r.stdout.strip().split("x")[:2]
    return int(w), int(h)


def gris(ruta: str, ancho: int, alto: int) -> bytes:
    """La captura en gris, al tamaño de comparación. Sin PIL: este repo se
    apoya en ffmpeg para todo lo que sea píxeles, y añadir una dependencia
    para leer un PNG no sale a cuenta."""
    r = exige_ok(subprocess.run(
        [FFMPEG, "-v", "error", "-i", ruta,
         "-vf", "scale=%d:%d:flags=area,format=gray" % (ancho, alto),
         "-f", "rawvideo", "-"],
        capture_output=True),
        "ffmpeg leyendo %s" % os.path.basename(ruta),
        arregla="comprueba que la captura no está corrupta")
    return r.stdout


def mascara(capturas: list[bytes], n: int) -> list[bool]:
    """True donde el píxel es el MISMO en todas las capturas: la interfaz."""
    fuera = []
    for i in range(n):
        v = [c[i] for c in capturas]
        fuera.append(max(v) - min(v) <= TOLERANCIA)
    return fuera


# Una banda solo es MEDIBLE por coincidencia si es OPACA: sus filas tienen
# que coincidir casi enteras. Con 0,67 en la mejor fila —lo que dio Reels—
# no hay banda que delimitar, hay texto suelto: entre letra y letra se ve el
# vídeo, que cambia. Y el borde de la banda deja de existir como frontera.
#
# El número sale de las dos medidas que hay: una interfaz opaca sembrada a
# propósito da 1,00, y la de Instagram 0,67 arriba y 0,49 abajo. 0,80 separa
# las dos sin quedarse pegado a ninguna.
FILA_SOLIDA = 0.80


def fiable(perfil: list[float], alto: int) -> tuple[bool, float, float, float]:
    """(se puede medir, suelo de ruido, pico arriba, pico abajo).

    El suelo se estima en el TERCIO CENTRAL, donde ninguna app dibuja: lo que
    coincida ahí entre dos vídeos distintos es casualidad. Los picos, en el
    15 % de cada borde, y no en la fila del borde mismo: la interfaz superior
    de Instagram son DOS elementos —barra de estado y navegación— con vídeo
    en medio, así que la primera fila puede no ser suya."""
    centro = perfil[alto // 3: 2 * alto // 3]
    suelo = sum(centro) / max(1, len(centro))
    m = max(1, int(alto * 0.15))
    return (max(max(perfil[:m]), max(perfil[-m:])) >= FILA_SOLIDA,
            suelo, max(perfil[:m]), max(perfil[-m:]))


def bandas(mask: list[bool], ancho: int, alto: int) -> tuple[int, int, list]:
    """(última fila de la banda superior, primera de la inferior, perfil).

    Se buscan desde los BORDES hacia dentro y se paran en la primera fila
    limpia: la interfaz cuelga de los bordes, y una coincidencia suelta en
    mitad del cuadro —dos vídeos con el mismo gris de fondo— no es una banda.
    """
    perfil = []
    for y in range(alto):
        fila = mask[y * ancho:(y + 1) * ancho]
        perfil.append(sum(fila) / float(ancho))

    corte_sup = max(FRACCION_MINIMA, perfil[0] * CAIDA)
    arriba = -1
    for y in range(alto):
        if perfil[y] < corte_sup:
            break
        arriba = y
    corte_inf = max(FRACCION_MINIMA, perfil[-1] * CAIDA)
    abajo = alto
    for y in range(alto - 1, -1, -1):
        if perfil[y] < corte_inf:
            break
        abajo = y
    return arriba, abajo, perfil


def regla(capturas: list[str], destino: str, paso: int) -> int:
    """Copia cada captura con una retícula de coordenadas encima.

    Las líneas alternan color cada `paso` para poder contarlas sin
    perderse, y el informe imprime a qué píxel corresponde cada una: este
    ffmpeg no trae libfreetype y no puede escribir el número al lado, lo
    cual está documentado y no es un problema que merezca una fuente.
    """
    os.makedirs(destino, exist_ok=True)
    for c in capturas:
        W, H = dimensiones(c)
        cajas = []
        for i, y in enumerate(range(0, H, paso)):
            color = "red" if i % 2 == 0 else "yellow"
            cajas.append("drawbox=0:%d:%d:2:%s@0.85:t=fill" % (y, W, color))
        fuera = os.path.join(destino, "regla_" + os.path.basename(c))
        exige_ok(subprocess.run(
            [FFMPEG, "-y", "-v", "error", "-i", c, "-vf", ",".join(cajas),
             fuera], capture_output=True),
            "ffmpeg dibujando la retícula sobre %s" % os.path.basename(c),
            arregla="comprueba que la captura es legible")
        print("  %s   %dx%d" % (fuera, W, H))
    print("\n  la retícula va cada %d px; empieza en y=0 y alterna ROJO y\n"
          "  AMARILLO, así que la enésima roja es y = %d * 2 * (n-1)."
          % (paso, paso))
    print("  Lee: dónde ACABA el último elemento de la app por arriba y\n"
          "  dónde EMPIEZA el primero por abajo — el pie crece con el copy,\n"
          "  así que manda la captura de copy más largo.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("capturas", nargs="+",
                    help="capturas de REELS DISTINTOS (2 o más)")
    ap.add_argument("--plataforma", default="reels")
    ap.add_argument("--lienzo", default="1080x1920",
                    help="el lienzo que produce el pipeline")
    ap.add_argument("--detalle", action="store_true",
                    help="el perfil fila a fila")
    ap.add_argument("--regla", metavar="DIR",
                    help="emite las capturas con la retícula de coordenadas "
                         "dibujada, para leer las fronteras a ojo")
    ap.add_argument("--paso", type=int, default=100,
                    help="separación de la retícula en píxeles (100)")
    a = ap.parse_args()
    exige_ffmpeg("ffmpeg", "ffprobe")

    if len(a.capturas) < 2:
        print("hacen falta AL MENOS DOS capturas, y de REELS DISTINTOS: la\n"
              "interfaz se aísla porque el vídeo de debajo cambia. Con dos\n"
              "momentos del mismo reel, un plano fijo saldría como interfaz.",
              file=sys.stderr)
        return 2

    if a.regla:
        return regla(a.capturas, a.regla, a.paso)

    dims = {dimensiones(c) for c in a.capturas}
    if len(dims) != 1:
        print("las capturas no miden lo mismo: %s\n"
              "  Tienen que ser del MISMO teléfono y la misma orientación."
              % ", ".join("%dx%d" % d for d in sorted(dims)), file=sys.stderr)
        return 2
    W, H = dims.pop()
    alto = max(1, round(ANCHO * H / W))

    grises = [gris(c, ANCHO, alto) for c in a.capturas]
    n = ANCHO * alto
    if any(len(g) < n for g in grises):
        print("ffmpeg no devolvió la imagen entera", file=sys.stderr)
        return 2

    mask = mascara([g[:n] for g in grises], n)
    arriba, abajo, perfil = bandas(mask, ANCHO, alto)

    f_sup = (arriba + 1) / float(alto)
    f_inf = (alto - abajo) / float(alto)

    ok, suelo, p_sup, p_inf = fiable(perfil, alto)
    if not ok:
        print("\nESTA INTERFAZ NO SE PUEDE MEDIR ASÍ · %s" % a.plataforma)
        print("-" * 62)
        print("  fila más coincidente arriba: %.2f" % p_sup)
        print("  fila más coincidente abajo:  %.2f" % p_inf)
        print("  suelo de casualidad:         %.2f  (tercio central)" % suelo)
        print("\n  Una banda opaca coincide casi entera (1,00) y estas no")
        print("  llegan a %.2f: la app dibuja TEXTO SUELTO sobre el vídeo, y"
              % FILA_SOLIDA)
        print("  entre letra y letra se ve lo de debajo, que cambia. No hay")
        print("  frontera que delimitar, y devolver una sería inventarla —la")
        print("  primera versión de esto devolvió «0 px arriba» sobre unas")
        print("  capturas que tienen la barra de estado a la vista—.\n")
        print("  Mídela A OJO, que para una vez por versión de la app sobra:")
        print("    python3 scripts/medir_zona_segura.py \\")
        print("      %s \\" % " ".join(a.capturas))
        print("      --regla /tmp/regla")
        print("  Y lee dónde acaba el último elemento por arriba y dónde")
        print("  empieza el primero por abajo, sobre la captura de copy MÁS")
        print("  LARGO, que es la que manda.\n")
        return 1

    print("\nZONA SEGURA · %s" % a.plataforma)
    print("-" * 62)
    print("  %d capturas de %dx%d  (proporción %.3f)"
          % (len(a.capturas), W, H, W / float(H)))
    for c in a.capturas:
        print("    · %s" % os.path.basename(c))
    print("\n  SOBRE LA PANTALLA DEL TELÉFONO")
    print("    interfaz superior   0 → %d px   (%.3f del alto)"
          % (round(f_sup * H), f_sup))
    print("    interfaz inferior   %d → %d px   (%.3f del alto)"
          % (round((1 - f_inf) * H), H, f_inf))
    print("    zona libre          %.1f %% del alto"
          % (100 * (1 - f_sup - f_inf)))

    # --- conversión al lienzo del pipeline -------------------------------
    # Un teléfono más alto que 9:16 no enseña el vídeo entero: la app lo
    # recorta arriba y abajo para llenar la pantalla, así que una banda del
    # 12 % de la PANTALLA no es el 12 % del LIENZO. La conversión es la
    # misma que hace `composite_ffmpeg.filtro_aroll` al recortar a vertical.
    lw, lh = (int(x) for x in a.lienzo.split("x"))
    prop_tel, prop_lienzo = W / float(H), lw / float(lh)
    print("\n  SOBRE EL LIENZO %dx%d (lo que produce el pipeline)" % (lw, lh))
    if abs(prop_tel - prop_lienzo) < 0.005:
        print("    el teléfono ya es %s: las fracciones no cambian" % a.lienzo)
        s_sup, s_inf = f_sup, f_inf
    else:
        # Escala de «cubrir»: el lienzo se agranda hasta llenar la pantalla y
        # se recorta lo que sobra por arriba y por abajo, a partes iguales.
        alto_mostrado = W / prop_lienzo          # alto del lienzo al ancho del móvil
        recorte = (alto_mostrado - H) / 2.0      # lo que se pierde por cada lado
        if recorte < 0:
            # La pantalla es MÁS ALTA que 9:16 (los móviles de hoy: 0,46
            # contra 0,5625). Para llenarla, la app escala el lienzo por su
            # ALTO, así que sobra ancho y lo que se recorta son los LADOS.
            # Verticalmente el lienzo entra ENTERO, y por eso la fracción de
            # pantalla y la de lienzo son la misma. Este mensaje decía
            # «más ancha» y era justo al revés: la medida salía bien y la
            # explicación mentía, que es la peor mitad de las dos.
            print("    la pantalla es MÁS ALTA que el lienzo (%.3f contra\n"
                  "    %.3f): la app escala por el alto y recorta a los\n"
                  "    LADOS, así que el lienzo entra entero de arriba abajo\n"
                  "    y la fracción vertical no cambia. Lo que sí se pierde\n"
                  "    son %d px por cada lado del lienzo."
                  % (prop_tel, prop_lienzo,
                     round(lw * (1 - prop_tel / prop_lienzo) / 2)))
            s_sup, s_inf = f_sup, f_inf
        else:
            s_sup = (recorte + f_sup * H) / alto_mostrado
            s_inf = (recorte + f_inf * H) / alto_mostrado
            print("    el móvil es más alto: la app recorta %d px del lienzo\n"
                  "    por arriba y otros tantos por abajo, así que la banda\n"
                  "    tapada del LIENZO es MAYOR que la de la pantalla."
                  % round(recorte * lh / alto_mostrado))
        print("    interfaz superior   %.3f del lienzo  (%d px de %d)"
              % (s_sup, round(s_sup * lh), lh))
        print("    interfaz inferior   %.3f del lienzo  (%d px de %d)"
              % (s_inf, round(s_inf * lh), lh))

    print("\n  PARA scripts/colocar.py:")
    print('    "%s":   (%.2f, %.2f),' % (a.plataforma, s_sup, s_inf))

    print("\n  LO QUE ESTA MEDIDA NO SABE")
    print("    · el pie de texto crece con el copy: estas capturas traían el")
    print("      suyo, y uno más largo sube la banda inferior.")
    print("    · la interfaz cambia con la versión de la app: anota la fecha.")
    if len(a.capturas) == 2:
        print("    · con dos capturas, un fondo que se repita en las dos se")
        print("      cuela como interfaz. Con cuatro deja de ser posible.")

    if a.detalle:
        print("\n  PERFIL (fracción de fila que es interfaz)")
        for y in range(0, alto, max(1, alto // 48)):
            barra = "#" * int(perfil[y] * 40)
            print("    y=%4d  %.2f  %s" % (round(y * H / alto), perfil[y], barra))
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
