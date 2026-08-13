#!/usr/bin/env python3
"""Genera el LUT 3D 'Papel y Tinta' en formato .cube.

Prefiero generarlo a incrustar un binario opaco: así el grading es
legible, versionable y afinable parámetro a parámetro.

La transformación, en orden:

  1. Curva S          contraste suave, sin machacar extremos
  2. Piso de negros   los negros no bajan de #121212: el material
                      respira y encaja con los mockups
  3. Split-tone       sombras hacia la TINTA (azul frío), luces hacia el
                      PAPEL (crema cálido). Es el eje entero de la marca
                      puesto sobre el metraje: lo oscuro es tinta, lo claro
                      es papel. Hasta la tanda 16 mandaba las luces a
                      BRONCE, y eso teñía de dorado cada píxel de la pieza
                      —no solo los gráficos—, que es de donde venía la
                      mitad del aire de «generado por IA».
  4. Desaturación     ~15% hacia luma: sobriedad, nada estridente

Uso:
    python3 scripts/make_lut.py
    python3 scripts/make_lut.py --size 33 --fuerza 1.2 --salida otro.cube
"""

from __future__ import annotations

import argparse
import os

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# El nombre del fichero se conserva: lo citan `CLAUDE.md`, el `README`, el
# compositor y cualquier comando que alguien tenga a mano. Cambiar el grading
# no debería obligar a cambiar la línea de órdenes.
DESTINO = os.path.join(RAIZ, "assets", "luts", "carbon_bronze.cube")

# Anclas de la marca. Son los mismos valores que `_tokens.css`: el grading del
# metraje y el color de los gráficos tienen que salir del MISMO sitio, o la
# pieza se parte en dos capas que no se hablan.
CARBON = (0x16 / 255, 0x16 / 255, 0x1A / 255)   # piso de negros · la tinta
BRONCE = (0xED / 255, 0xE8 / 255, 0xDF / 255)   # tinte de altas luces · el papel
GRAFITO = (0x1F / 255, 0x27 / 255, 0x33 / 255)  # tinte de sombras · tinta fría

LUMA = (0.2126, 0.7152, 0.0722)


def curva_s(x: float, k: float) -> float:
    """S suave centrada en 0.5. k=0 -> identidad."""
    if k <= 0:
        return x
    return x + k * (x - 0.5) * (1.0 - abs(2.0 * x - 1.0)) * 0.9


def mezcla(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def transformar(r: float, g: float, b: float, cfg) -> tuple[float, float, float]:
    # 1 · contraste
    r, g, b = (curva_s(c, cfg["contraste"]) for c in (r, g, b))

    y = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b

    # 3 · split-tone: peso de sombras y de luces según luminancia
    peso_sombra = max(0.0, 1.0 - y * 2.0) ** 1.5
    peso_luz = max(0.0, (y - 0.42) / 0.58) ** 1.25

    f = cfg["fuerza"]
    r = mezcla(r, GRAFITO[0], peso_sombra * 0.16 * f)
    g = mezcla(g, GRAFITO[1], peso_sombra * 0.16 * f)
    b = mezcla(b, GRAFITO[2], peso_sombra * 0.22 * f)

    # Las luces van al papel, y el reparto por canal es MENOS desigual que
    # con el bronce: aquel abría 0,20/0,11/0,05 —quince puntos entre el rojo y
    # el azul— y eso es lo que producía el tinte dorado. El papel es cálido
    # pero de lejos: 0,14/0,12/0,09, seis puntos. Se nota como temperatura, no
    # como color.
    r = mezcla(r, BRONCE[0], peso_luz * 0.14 * f)
    g = mezcla(g, BRONCE[1], peso_luz * 0.12 * f)
    b = mezcla(b, BRONCE[2], peso_luz * 0.09 * f)

    # 4 · desaturación hacia luma
    y2 = LUMA[0] * r + LUMA[1] * g + LUMA[2] * b
    d = cfg["desaturacion"]
    r, g, b = (mezcla(c, y2, d) for c in (r, g, b))

    # 2 · piso de negros, SOLO en las sombras.
    #     Un `mezcla(CARBON, 1.0, x)` global sube todos los valores por
    #     igual y en material bien iluminado eso es un velo lechoso: la
    #     imagen se ve lavada, no cinematográfica. El lift debe morir
    #     antes de llegar a los medios.
    # `piso` lleva SIGNO. Con material ya levantado en cámara —S-Cinetone
    # trae su propio pie— volver a levantar deja la imagen lechosa: hay que
    # poder tirar del negro hacia abajo, no solo hacia arriba.
    k_piso = cfg.get("piso", 1.0)

    def lift(c, piso):
        caida = max(0.0, 1.0 - c / cfg["rango_lift"])   # 1 en negro, 0 al salir
        return c + k_piso * piso * caida * caida

    r = lift(r, CARBON[0])
    g = lift(g, CARBON[1])
    b = lift(b, CARBON[2])

    # Hombro: comprime lo que ya está alto en vez de recortarlo. Sin esto,
    # subir contraste sobre un perfil que YA tiene rolloff suave devuelve
    # los blancos al recorte y se pierde el detalle que el perfil guardaba.
    h = cfg.get("hombro", 0.0)
    if h > 0:
        ini = 1.0 - h
        def techo(c):
            if c <= ini:
                return c
            x = (c - ini) / h
            # Parábola por (0,0) y (1,1) con pendiente 1.25 al entrar y
            # 0.75 al salir: comprime SOLO al acercarse al blanco y deja
            # que el blanco siga siendo blanco. La versión anterior no
            # llegaba a 1 —mandaba 0.98 a 0.887— y los blancos salían
            # grises, que es peor que el recorte que quería evitar.
            return ini + h * (1.25 * x - 0.25 * x * x)
        r, g, b = techo(r), techo(g), techo(b)

    return (min(1.0, max(0.0, r)),
            min(1.0, max(0.0, g)),
            min(1.0, max(0.0, b)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=33,
                    help="lado de la retícula (33 es el estándar)")
    ap.add_argument("--fuerza", type=float, default=1.0,
                    help="intensidad del split-tone bronce")
    ap.add_argument("--contraste", type=float, default=0.28)
    ap.add_argument("--desaturacion", type=float, default=0.15)
    ap.add_argument("--rango-lift", type=float, default=0.22,
                    help="hasta qué nivel llega el levantado de negros")
    ap.add_argument("--preset", default="carbon",
                    choices=["carbon", "paper", "scinetone"],
                    help="grado base: carbon hunde negros, paper los abre, "
                         "scinetone parte de material ya perfilado en cámara")
    ap.add_argument("--piso", type=float, default=1.0,
                    help="signo y fuerza del pie de negro (negativo = densifica)")
    ap.add_argument("--hombro", type=float, default=0.0,
                    help="tramo alto que se comprime en vez de recortarse")
    ap.add_argument("--salida", default=None)
    args = ap.parse_args()

    # Paper & Ink pide lo contrario que Carbon: en vez de hundir negros y
    # calentar altas luces, abre los medios y deja el blanco casi limpio.
    # Reusar el grado oscuro sobre material claro lo apaga y lo ensucia.
    if args.preset == "paper":
        PRESET = {"fuerza": 0.45, "contraste": 0.16,
                  "desaturacion": 0.06, "rango_lift": 0.10}
        globals()["BRONCE"] = (0xC2 / 255, 0x41 / 255, 0x0C / 255)
        globals()["GRAFITO"] = (0xE4 / 255, 0xE0 / 255, 0xD9 / 255)
        globals()["CARBON"] = (0x0E / 255, 0x0E / 255, 0x10 / 255)
        for k, v in PRESET.items():
            if getattr(args, k, None) == ap.get_default(k):
                setattr(args, k, v)

    # S-Cinetone sale de cámara YA perfilado: pie levantado, hombro suave y
    # piel desaturada a propósito. No es log, así que no hay que
    # «revelarlo» — un grado pensado para material plano lo sobrecarga.
    # Lo que necesita es densidad en el negro (piso negativo), contraste
    # contenido y que el hombro que trae de fábrica no se pierda.
    if args.preset == "scinetone":
        PRESET = {"fuerza": 0.55, "contraste": 0.17,
                  "desaturacion": 0.04, "rango_lift": 0.20,
                  "piso": -0.35, "hombro": 0.22}
        for k, v in PRESET.items():
            if getattr(args, k, None) == ap.get_default(k):
                setattr(args, k, v)

    cfg = {"fuerza": args.fuerza, "contraste": args.contraste,
           "desaturacion": args.desaturacion, "rango_lift": args.rango_lift,
           "piso": args.piso, "hombro": args.hombro}
    n = args.size
    if not args.salida:
        nombres = {"paper": "paper_ink", "scinetone": "scinetone_s11"}
        args.salida = os.path.join(
            RAIZ, "assets", "luts",
            "%s.cube" % nombres.get(args.preset, "carbon_bronze"))
    os.makedirs(os.path.dirname(args.salida), exist_ok=True)

    lineas = [
        "# Carbon & Bronze — generado por scripts/make_lut.py",
        "# fuerza=%.2f contraste=%.2f desaturacion=%.2f"
        % (args.fuerza, args.contraste, args.desaturacion),
        "TITLE \"%s\" % args.preset",
        "LUT_3D_SIZE %d" % n,
        "DOMAIN_MIN 0.0 0.0 0.0",
        "DOMAIN_MAX 1.0 1.0 1.0",
        "",
    ]
    # el .cube itera con R en el bucle más interno
    for ib in range(n):
        for ig in range(n):
            for ir in range(n):
                r, g, b = transformar(ir / (n - 1), ig / (n - 1),
                                      ib / (n - 1), cfg)
                lineas.append("%.6f %.6f %.6f" % (r, g, b))

    with open(args.salida, "w", encoding="utf-8") as f:
        f.write("\n".join(lineas) + "\n")

    print("LUT escrito: %s  (%d entradas, %.1f KB)"
          % (args.salida, n ** 3, os.path.getsize(args.salida) / 1024))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
