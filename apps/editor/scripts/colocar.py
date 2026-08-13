#!/usr/bin/env python3
"""Comprueba y corrige DÓNDE cae cada gráfico: rostro y solapes.

Hasta ahora la colocación se hacía a ojo, mirando cuatro fotogramas y
poniendo un `dy` a mano. El resultado previsible: unos gráficos caían bien
y otros tapaban la cara, y nadie lo detectaba hasta ver el vídeo montado.

Este script mide en vez de suponer, y mide lo que de verdad hay:

  · El área que ocupa cada capa sale del ALFA de sus fotogramas, no de lo
    que declare su plantilla. Una tarjeta con sombra ocupa más que su caja
    y un texto corto ocupa mucho menos que su contenedor.
  · La zona del rostro sale de `face.json`, tomando la unión de las
    muestras que caen DENTRO de la ventana de esa capa. Usar la unión de
    todo el vídeo protege una banda que casi nunca está ocupada y empuja
    los gráficos a sitios peores.
  · La ventana de la capa va en reloj de SALIDA —el plan está remapeado— y
    `face.samples` en reloj de ORIGEN. Se traduce con el `keep` de
    `timeline.json`, que es la única traducción que existe, y el bbox del
    fuente se lleva a píxeles de salida replicando el encuadre del
    compositor (escala y recorte por tramo). Sin las dos cosas la banda se
    mide en otro momento y en otro sistema de coordenadas.

Con eso decide: si hay choque, propone el desplazamiento vertical mínimo
que lo resuelve, prefiriendo la banda libre más amplia.

Y una cosa más que NO decide, solo dice: la **zona segura de plataforma**.
`face.json` manda la UI al tercio inferior, que es exactamente donde Reels,
TikTok y Shorts pintan el caption, el usuario y el CTA — o sea que esquivar
la cara puede meter el gráfico DEBAJO de la interfaz de la app, donde no se
lee y donde este repo no puede verlo porque compone un 1080x1920 limpio. Se
avisa y no se mueve: la banda es conservadora y estimada (ver `PLATAFORMAS`),
y mover gráficos por una estimación es peor que enseñarla.

Uso:
    python3 scripts/colocar.py --plan build/plan.json
    python3 scripts/colocar.py --plan build/plan.json --aplicar
    python3 scripts/colocar.py --plan build/plan.json --plataforma tiktok
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

import composite_ffmpeg
import comprobar_fuentes
import comprobar_montaje
import comun
import reloj
from comun import carga_json, exige_ffmpeg

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
FFMPEG = comun.FFMPEG
CANONICO = re.compile(r"^\d+\.png$")
CROMO = {"karaoke", "kineticcaptions", "fondo", "transicion", "capitulos"}

# La medición del alfa va a escala reducida: para decidir en qué banda cabe
# un gráfico sobran los píxeles, y a resolución completa serían 2 millones
# de comparaciones por fotograma.
ANCHO_M, ALTO_M = 108, 192
UMBRAL = 24          # alfa por debajo de esto es sombra, no contenido

# Plantillas cuyo trabajo ES cubrir el cuadro. Marcarlas como choque sería
# marcar como error justo lo que se les pide.
A_SANGRE = {"kinetic-quote", "chapter-card", "transicion", "fondo",
            # Estos ocupan el lienzo entero por diseño: la onda de choque
            # y el aviso de desplome son efectos de pantalla, no cajas que
            # se puedan empujar a una banda libre.
            "head-explode", "red-crash"}

# Del recuadro que devuelve el detector, lo intocable es la franja central:
# arriba está el pelo y abajo el cuello, y taparlos no molesta a nadie. Lo
# que no se puede pisar son los ojos y la boca.
REC_ARRIBA, REC_ABAJO = 0.16, 0.14

# Dónde se lee: los subtítulos cinéticos viven en los ~300 px inferiores del
# lienzo. Si el ROSTRO baja hasta ahí, moverlos no es una opción —una banda
# de subtítulos que salta de sitio a mitad de pieza es peor que el solape—,
# así que lo único honesto es avisar a quien encuadra.
BANDA_SUBS = 300

# --------------------------------------------------------------------------
#  ZONA SEGURA DE PLATAFORMA
# --------------------------------------------------------------------------
# El vídeo se entrega a 1080x1920 limpios, pero NO se ve así: las tres apps
# dibujan encima. Abajo a la izquierda, el caption con el usuario y la pista
# de audio; abajo del todo, la barra de navegación o el CTA; a la derecha, la
# columna de acciones; arriba, la cabecera y el progreso. Un gráfico que
# aterrice ahí queda debajo de la interfaz, y desde aquí no se ve: el
# compositor produce el lienzo entero y la hoja de contactos también.
#
# FUENTE: **Reels está MEDIDO**; TikTok y Shorts, no.
#
# Reels, sobre dos capturas de iPhone (1179x2556) de reels DISTINTOS,
# 4-ago-2026, leídas con la retícula de `scripts/medir_zona_segura.py
# --regla`:
#
#   arriba   0 → 300 px   la barra de estado del sistema y la fila de
#                          navegación («+», For you / Friends, ajustes).
#                          Entre las dos se ve vídeo, pero la banda tiene
#                          que llegar a la más baja.
#   abajo    1905 → 2556   avatar y usuario, «Translate with AI», el copy,
#                          «Followed by», la barra de progreso y la barra
#                          de pestañas de la app.
#
#   0.117 y 0.255 del alto. La captura de copy CORTO daba 0,218 abajo y la
#   de copy largo 0,255: manda la larga, y con un copy de más líneas puede
#   crecer todavía. La estimación anterior era (0.12, 0.22) — el borde
#   superior estaba bien y el inferior se quedaba 67 px de lienzo corto,
#   justo donde viven los subtítulos.
#
# El móvil es 0,461 y el lienzo 0,5625: la app escala por el ALTO y recorta
# a los lados, así que la fracción vertical de pantalla es la del lienzo (y
# se pierden ~97 px por cada lado, que es otro aviso pendiente de modelar).
#
# TikTok y Shorts HEREDAN los números MEDIDOS de Reels (13-ago-2026, decisión
# del propietario): misma anatomía de UI y la medida real es más estricta que
# la estimación que tenían. Heredar una medición ajena declarándolo NO es el
# error que este comentario evita —ese error es inventar cifras propias para
# que la tabla parezca informada—, pero tampoco es medir: siguen fuera de
# MEDIDAS y el informe las enseña como heredadas. La línea que las medirá de
# verdad, con capturas de esas apps, sigue siendo:
#
#     python3 scripts/medir_zona_segura.py capturas/*.png --regla /tmp/regla
#
# Y una advertencia que la medición deja clara: la columna de iconos de la
# DERECHA (likes, comentarios, compartir) sube mucho más arriba que la
# banda inferior. Este modelo es de bandas horizontales y no la ve.
# Cuáles de las bandas de arriba salen de una MEDICIÓN y cuáles siguen
# siendo la estimación de partida. Está aquí y no en un comentario porque el
# informe lo dice en voz alta: enseñar una banda medida como «estimada» hace
# que quien la lea la descuente, y es la que no hay que descontar.
MEDIDAS = comun.MEDIDAS

# (arriba, abajo, ancho_derecha, desde_y_derecha).
#
# La derecha NO es una banda de altura completa y modelarla así marcaba
# cualquier gráfico ancho: la columna de iconos es un RECTÁNGULO que empieza
# a media altura. Medido: los iconos van de y=1191 a y=2195 de pantalla, que
# sobre el vídeo (y 104-2200 para 1920 de lienzo) es y 995-1914 — del 52 %
# del alto hacia abajo.
#
# Arriba 0.117 tal cual. Abajo se midió 0.255 y se rebaja un 5 % a 0.24: ese
# 0.255 salió de la captura con el copy MÁS LARGO que había —usuario,
# «Translate with AI», dos líneas de texto y «Followed by»—, y tratarlo como
# el caso normal reservaba de más. Derecha 0.115 medido (la columna de iconos
# empieza en x=1044 de 1179) y redondeado a 0.12.
#
# La tabla se MUDÓ a `comun.py` y aquí queda el nombre. No es cosmética: el
# que escribe el plan también la necesita —los subtítulos se maquetaban
# contra un `bottom` constante y caían 171 px dentro de la banda— y una tabla
# que solo conoce el comprobador solo sirve para avisar.
PLATAFORMAS = comun.PLATAFORMAS

# El defecto es `reels` y no `ninguna` por el mismo motivo por el que
# `comprobar_ritmo.py` no nace con sus puertas activadas, pero al revés: una
# comprobación que hay que pedir con un flag es una comprobación que no se
# ejecuta. Y `reels` porque es el destino que el resto del pipeline ya
# asume —`composite_ffmpeg.py --lufs` normaliza a −14 LUFS «porque Reels,
# Shorts y TikTok normalizan ahí»—. Con la tabla de arriba, elegir una u
# otra no cambia nada todavía; elegir `ninguna` sí: apaga el aviso.
PLATAFORMA_DEFECTO = "reels"


def banda_plataforma(W: int, H: int, plataforma: str) -> tuple:
    """`(y_arriba, y_abajo, x_derecha)`: dónde pinta la app.

    La tercera es la columna de la DERECHA —likes, comentarios, compartir,
    la miniatura—, que no estaba y es la que más arriba llega: en la captura
    medida arranca en x=1044 de 1179 y sube por medio cuadro, mucho más allá
    de donde acaba la banda inferior. Un gráfico pegado a la derecha se come
    esos iconos aunque esté a media altura y las dos bandas horizontales lo
    daban por bueno.

    Devuelve píxeles del lienzo para poder compararlos con las cajas, que ya
    están en píxeles. La fracción es lo que se declara; el píxel es un
    derivado de ella y del lado real, no un número escrito a mano."""
    return comun.banda_plataforma(W, H, plataforma)


def cabe_en_lienzo(x0: float, x1: float, dx: float, W: int) -> float:
    """El `dx` más cercano al pedido que NO saca el gráfico del lienzo.

    `CLAUDE.md` promete «el desplazamiento mínimo hacia la banda libre más
    amplia, SIN SALIRSE DEL LIENZO», y el eje vertical lo cumplía desde el
    principio. El horizontal no: cuando `leer_guion` empezó a traducir
    `POS_MID_RIGHT` a un `dx` fijo de +250, lo aplicó igual a un sello de
    860 px que a un mockup de 980 —y el mockup, el terminal y el sello se
    fueron 200, 190 y 140 px fuera del cuadro, con el código cortado a media
    línea—. Un desplazamiento que no cabe no es una colocación: es un
    recorte.

    Devuelve el `dx` recortado. Si el gráfico ya es más ancho que el lienzo
    no hay nada que recortar y se deja en 0: moverlo solo elige qué borde se
    come."""
    if x1 - x0 >= W:
        return 0.0
    return max(-x0, min(dx, W - x1))


def invade(y0: float, y1: float, banda: tuple) -> tuple:
    """Cuántos píxeles del gráfico caen dentro de cada banda reservada.

    `(px_arriba, px_abajo)`. Se mide la INTERSECCIÓN y no si el borde la
    cruza: una tarjeta que asoma 8 px por debajo no es el mismo problema que
    una que mete 190, y un aviso que no distinga las dos se ignora igual que
    un error que nace en rojo."""
    y_arriba, y_abajo = banda
    return (max(0.0, min(y1, y_arriba) - max(y0, 0.0)),
            max(0.0, y1 - max(y0, y_abajo)))


def caja_alfa(dir_capa: str, muestras: int = 5) -> tuple | None:
    """Caja del contenido a partir del canal alfa.

    `cropdetect` sobre el alfa da el rectángulo con píxeles no
    transparentes. Se toman varias muestras porque una capa se mueve y
    crece durante su entrada: quedarse con el primer fotograma mediría la
    animación, no el elemento."""
    fs = sorted(f for f in os.listdir(dir_capa) if CANONICO.match(f))
    if not fs:
        return None
    idx = sorted({min(len(fs) - 1, int(len(fs) * p))
                  for p in (0.35, 0.5, 0.65, 0.8, 0.95)[:muestras]})
    caja = None
    for i in idx:
        # Se extrae el alfa como gris crudo a escala reducida y se busca el
        # rectángulo con píxeles opacos. `cropdetect` sería lo obvio, pero
        # con un solo fotograma no emite nada: hay que medir a mano.
        r = subprocess.run(
            [FFMPEG, "-nostdin", "-v", "error", "-i", os.path.join(dir_capa, fs[i]),
             "-vf", "alphaextract,scale=%d:%d" % (ANCHO_M, ALTO_M),
             "-f", "rawvideo", "-pix_fmt", "gray", "-frames:v", "1", "-"],
            capture_output=True)
        # Esta función es una sonda: devolver None cuando no hay nada que
        # medir es su contrato, y el llamador salta la capa. Pero un PNG que
        # ffmpeg no puede decodificar no es «nada que medir», es un fotograma
        # roto, y tragárselo dejaba la capa entera SIN comprobar choques —el
        # trabajo por el que este script existe— sin una línea en ningún
        # sitio. El fallo se tolera; el silencio no: se avisa y se sigue con
        # las demás muestras.
        if r.returncode != 0:
            print("aviso: ffmpeg no pudo leer %s (código %d); se salta la muestra"
                  % (os.path.join(dir_capa, fs[i]), r.returncode),
                  file=sys.stderr)
            continue
        b = r.stdout
        if len(b) < ANCHO_M * ALTO_M:
            continue
        x0 = y0 = 10 ** 9; x1 = y1 = -1
        for fila in range(ALTO_M):
            base = fila * ANCHO_M
            franja = b[base:base + ANCHO_M]
            if max(franja) < UMBRAL:
                continue
            if fila < y0: y0 = fila
            if fila > y1: y1 = fila
            izq = next(k for k, v in enumerate(franja) if v >= UMBRAL)
            der = ANCHO_M - 1 - next(k for k, v in enumerate(reversed(franja))
                                     if v >= UMBRAL)
            if izq < x0: x0 = izq
            if der > x1: x1 = der
        if x1 < 0:
            continue
        c = (x0, y0, x1 + 1, y1 + 1)
        caja = c if caja is None else (min(caja[0], c[0]), min(caja[1], c[1]),
                                       max(caja[2], c[2]), max(caja[3], c[3]))
    return caja


def ventanas_origen(keep: list, t0: float, t1: float) -> list:
    """Sub-ventanas de ORIGEN que cubren la ventana [t0, t1) de SALIDA.

    Las capas del plan remapeado van en reloj de salida y `face.samples` en
    reloj de origen; `keep` es la única traducción (regla del reloj). Una
    ventana de capa puede cruzar varios tramos —svgcheckmark en la pieza de
    Codex empieza en un tramo con zoom 1.0 y acaba en uno con 1.16—, así que
    se devuelve una sub-ventana POR TRAMO, cada una con su `keep`: la
    geometría del encuadre cambia con él y hay que consultar los samples de
    TODOS los sub-tramos, no solo el del arranque."""
    fuera = []
    for k in keep:
        o0, o1 = float(k["out_start"]), float(k["out_end"])
        a, b = max(t0, o0), min(t1, o1)
        if b - a <= 1e-9:
            continue
        s0 = float(k["src_start"])
        fuera.append((s0 + (a - o0), s0 + (b - o0), k))
    return fuera


def geometria_tramo(k: dict, face: dict, W: int, H: int,
                    W_src: int, H_src: int) -> tuple:
    """Escala y recorte que el compositor aplica a ESTE tramo del A-Roll.

    Replica `composite_ffmpeg.filtro_aroll` con `--camara 0` (su valor por
    defecto): escala con `force_original_aspect_ratio=increase` al lienzo por
    el zoom del tramo y recorta centrado en el rostro en x. El centro
    horizontal se pide a `centro_x_en` —la doctrina de `filtro_aroll` es que
    la misma geometría se pide dos veces a la misma función— y con el MISMO
    rango que usa el compositor: el tramo entero, no la sub-ventana.

    En y, el zoom recorta con la holgura del 0.42 que lleva el filtro
    (`y='clip((in_h-out_h)*0.42,...)'`). Caso medido, la pieza de Codex:
    fuente 1080x1920, lienzo 1080x1920, z=1.16 →
        s      = max(1080·1.16/1080, 1920·1.16/1920) = 1.16
        in_h   = 1920·1.16 = 2227.2
        crop_y = 0.42·(2227.2 − 1920) = 129.0
    Un bbox con y=0.35 del fuente NO cae en 0.35·1920 = 672 de salida sino
    en 0.35·2227.2 − 129.0 = 650.5. Multiplicar por H sin más es medir en
    el sistema de coordenadas del fuente y colocar en el del lienzo.

    Devuelve (s, crop_x, crop_y). La deriva de `--camara` no se modela: con
    qué valor se va a componer no está escrito en ningún artefacto; si algún
    día se guarda en el manifiesto, este es el sitio donde leerlo."""
    z = float(k.get("zoom", 1.0))
    s = max(W * z / float(W_src), H * z / float(H_src))
    in_w, in_h = W_src * s, H_src * s
    cx = composite_ffmpeg.centro_x_en(
        face, float(k["src_start"]), float(k["src_end"]))
    crop_x = min(max(in_w * cx - W / 2.0, 0.0), max(in_w - W, 0.0))
    # La rama sin zoom del filtro lleva `y=0` literal; la del zoom, el 0.42.
    crop_y = min(max(0.42 * (in_h - H), 0.0), max(in_h - H, 0.0)) \
        if z != 1.0 else 0.0
    return s, crop_x, crop_y


def banda_rostro(face: dict, keep: list, t0: float, t1: float,
                 W: int, H: int, W_src: int, H_src: int) -> tuple | None:
    """Franja vertical del rostro, EN PÍXELES DE SALIDA, durante [t0, t1).

    `t0`/`t1` vienen en reloj de SALIDA. La versión anterior consultaba
    `face.samples` —reloj de ORIGEN— con esa ventana tal cual, y el fallo se
    midió en la pieza de Codex: svgcheckmark (t 33,76 de salida) vive hacia
    los 36-37 s de origen, así que la banda del rostro se midió EN OTRO
    MOMENTO de la grabación, salió dy=-543 y el check aterrizó en la frente
    (fotograma a 34,4 s). Nada dio error: la ventana equivocada también
    tenía samples."""
    if not face:
        return None
    ys = []
    for s_a, s_b, k in ventanas_origen(keep, t0, t1):
        s, _, crop_y = geometria_tramo(k, face, W, H, W_src, H_src)
        for m in face.get("samples", []):
            if m.get("bbox") and s_a - 0.5 <= m["t"] <= s_b + 0.5:
                ys.append((m["bbox"][1] * H_src * s - crop_y,
                           m["bbox"][3] * H_src * s - crop_y))
    if not ys:
        return None
    # El encuadre puede dejar parte del rostro fuera del lienzo: lo que no
    # se ve no se puede pisar.
    y0 = max(0.0, min(a for a, _ in ys))
    y1 = min(float(H), max(b for _, b in ys))
    if y1 <= y0:
        return None
    alto = y1 - y0
    return (int(y0 + alto * REC_ARRIBA), int(y1 - alto * REC_ABAJO))


def main() -> int:
    # Antes de nada: si falta el binario, decirlo con el comando que
    # lo arregla en vez de reventar con un FileNotFoundError crudo en
    # medio del trabajo.
    exige_ffmpeg("ffmpeg", "ffprobe")
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", default=os.path.join(comun.build_dir(), "plan.json"))
    ap.add_argument("--layers", default=os.path.join(comun.build_dir(), "layers.json"))
    ap.add_argument("--face", default=os.path.join(comun.build_dir(), "face.json"))
    ap.add_argument("--timeline",
                    default=os.path.join(comun.build_dir(), "timeline.json"),
                    help="de aquí sale el `keep` que traduce salida→origen")
    ap.add_argument("--margen", type=int, default=40,
                    help="holgura mínima entre gráfico y rostro, en px")
    ap.add_argument("--plataforma", default=PLATAFORMA_DEFECTO,
                    choices=sorted(PLATAFORMAS),
                    help="dónde pinta la app su interfaz; solo AVISA. "
                         "`ninguna` lo apaga (defecto: %s)"
                         % PLATAFORMA_DEFECTO)
    ap.add_argument("--aplicar", action="store_true",
                    help="escribe los `dy` propuestos en el plan")
    ap.add_argument("--reiniciar", action="store_true",
                    help="descarta los `dy` que ya haya antes de medir")
    args = ap.parse_args()

    plan = carga_json(args.plan)
    man = carga_json(args.layers)

    # Plan y manifiesto se emparejan solo por el string de la capa, y los
    # nombres se repiten entre piezas por diseño. Si vienen de montajes
    # distintos, este script mide el ALFA de los fotogramas de uno y decide el
    # `dy` con la VENTANA TEMPORAL del otro — y con `--aplicar` lo escribe en
    # los dos ficheros, sin avisar. El `dy` resultante no es un poco impreciso:
    # es de otra composición.
    #
    # Se comprueba antes de medir nada, y se aborta en vez de avisar: un `dy`
    # calculado con datos cruzados es peor que ninguno, porque el siguiente
    # que lo mire lo dará por bueno.
    errores, _ = comprobar_montaje.comprobar(
        plan, man, os.path.dirname(os.path.abspath(args.layers)))
    if errores:
        print("plan y manifiesto no son del mismo montaje; no se coloca nada:",
              file=sys.stderr)
        for e in errores[:6]:
            print("  ✗ %s" % e, file=sys.stderr)
        if len(errores) > 6:
            print("  … y %d más. Ejecuta:\n"
                  "      .venv/bin/python scripts/comprobar_montaje.py"
                  % (len(errores) - 6), file=sys.stderr)
        return 2

    W, H = man.get("ancho", 1080), man.get("alto", 1920)
    face = None
    if os.path.exists(args.face):
        face = carga_json(args.face)
        if not face.get("con_rostro"):
            face = None

    # El `keep` que traduce la ventana de cada capa (reloj de SALIDA) al
    # reloj de ORIGEN de `face.samples`. Se comprueba el sello del reloj
    # como manda la regla 2 de `reloj.py`: un timeline en el reloj
    # equivocado da bandas con buena pinta y todas en otro momento.
    tl = carga_json(args.timeline)
    reloj.exige_reloj(tl, "origen", "colocar.py",
                      ".venv/bin/python scripts/clean_transcript.py")
    keep_tl = tl.get("keep", [])
    if face and not keep_tl:
        print("el timeline no trae `keep`: sin él no hay traducción "
              "salida→origen y la banda del rostro se mediría en otro "
              "momento. Regenéralo:\n"
              "    .venv/bin/python scripts/clean_transcript.py",
              file=sys.stderr)
        return 2

    # Dimensiones de PANTALLA del fuente, no las codificadas: la sonda de
    # `comprobar_fuentes` aplica la rotación —el incidente de los clips
    # 3840x2160 con 90° que se montaron aplastados—, y el detector de rostro
    # muestrea con ffmpeg, que decodifica ya rotado: su bbox está normalizado
    # sobre el fotograma de pantalla.
    W_src, H_src = W, H
    if face:
        src = face.get("source", "")
        d = comprobar_fuentes.sonda(src) if src and os.path.exists(src) \
            else {"error": "no está en disco"}
        if "error" in d:
            print("aviso: no se puede sondear el fuente del rostro (%s: %s); "
                  "se asume el formato del lienzo %dx%d. Si el fuente no era "
                  "9:16, la banda saldrá desplazada."
                  % (src or "face.json sin `source`", d["error"], W, H),
                  file=sys.stderr)
        else:
            W_src, H_src = (int(x) for x in d["pantalla"].split("x"))

    # La corrección es INCREMENTAL: se mide la caja con el `dy` que ya
    # tenga y se le suma lo que falte. Eso está bien mientras los
    # fotogramas sean los mismos, pero si el plan se ha rehecho —otro
    # montaje, otros tiempos— el `dy` viejo pertenece a otra composición y
    # arrastra el gráfico fuera de cuadro. Pasó al recortar una pieza para
    # que hiciera bucle: una ventana de código acabó 218 px por encima del
    # borde superior.
    # Una capa con `colocar: false` lleva su `dy` puesto a mano: es una
    # decisión del plan, no una corrección de este script, y reiniciarla la
    # borraría dejando el gráfico donde la plantilla lo pinta —encima de la
    # cara— sin que nada lo dijera.
    exentos = {c["capa"] for c in plan if c.get("colocar") is False}
    if args.reiniciar:
        # Solo `dy`: es lo único que este script escribe. `dx` viene del
        # guion —reparto de columnas— y borrarlo aquí sería descartar una
        # decisión del plan por limpiar una corrección que no es suya.
        for c in plan:
            if c["capa"] not in exentos:
                c.pop("dy", None)
        for c in man.get("capas", []):
            if c["capa"] not in exentos:
                c.pop("dy", None)

    # Para LEER (medir el alfa de los fotogramas) se usa una vista con los
    # `dir` resueltos a absolutos: el manifiesto los trae relativos a su
    # raíz desde el cambio de formato, y los absolutos de uno anterior pasan
    # tal cual. Para ESCRIBIR (el `dy`/`dx` de --aplicar, más abajo) se sigue
    # usando `man`, el original: así el fichero conserva sus rutas tal y como
    # las escribió el renderizador.
    porcapa = {c["capa"]: c for c in comun.resolver_manifiesto(
        man, os.path.dirname(os.path.abspath(args.layers))).get("capas", [])}

    # Los subtítulos no entran en el reparto de choques —son cromo—, pero
    # SÍ ocupan sitio. Sin esto, el colocador resolvía un choque con la
    # cara empujando el gráfico a la banda inferior, que es exactamente
    # donde se está leyendo: cambiaba un solape por otro peor, porque el
    # de la cara se ve y el del texto sobre texto no se entiende.
    techo_subs = H
    cajas_subs = {}
    for nom, c in porcapa.items():
        if "caption" not in nom and "karaoke" not in nom:
            continue
        d = c.get("dir")
        if not d or not os.path.isdir(d):
            continue
        caja = caja_alfa(d, muestras=5)
        if caja:
            techo_subs = min(techo_subs, int(caja[1] * (H / float(ALTO_M))) - 30)
            # El BORDE INFERIOR de los subtítulos hace falta para la zona
            # segura de plataforma: los subtítulos son la primera víctima de
            # la interfaz de la app —viven abajo por diseño— y el reparto de
            # choques no los mide porque son cromo.
            ky = H / float(ALTO_M)
            dy_s = float(porcapa[nom].get("dy", 0))
            # El borde DERECHO también se guarda, medido. Antes se daba por
            # supuesto que el subtítulo ocupa el lienzo entero (se escribía
            # `W` directamente) y el aviso de la columna de likes salía
            # SIEMPRE con el mismo número —130 px— dijera lo que dijera la
            # capa: no podía mejorar ni empeorar, o sea que no medía nada.
            # Con la caja acotada a 820 px el bloque llega de verdad a 940 y
            # ya no toca la columna; el aviso constante lo habría tapado.
            cajas_subs[nom] = (caja[1] * ky + dy_s, caja[3] * ky + dy_s,
                               caja[2] * (W / float(ANCHO_M))
                               + float(porcapa[nom].get("dx", 0)))

    # Rostro contra subtítulos, tramo a tramo. Este script NO mueve los
    # subtítulos —una banda de lectura que salta de sitio a mitad de pieza es
    # peor que el solape— y tampoco puede mover la cara: solo puede decirlo,
    # con el tramo y el instante, para quien encuadra o ajusta el zoom.
    if face and keep_tl:
        umbral = min(techo_subs, H - BANDA_SUBS)
        for i, k in enumerate(keep_tl):
            b = banda_rostro(face, keep_tl,
                             float(k["out_start"]), float(k["out_end"]),
                             W, H, W_src, H_src)
            if b and b[1] > umbral:
                print("aviso: tramo %d (salida %.2f-%.2f s, origen %.2f-%.2f "
                      "s): el rostro baja hasta y=%d y pisa la banda de "
                      "subtítulos (y>%d). No se mueve nada; reencuadra o "
                      "baja el zoom de ese tramo."
                      % (i, k["out_start"], k["out_end"],
                         k["src_start"], k["src_end"], b[1], umbral),
                      file=sys.stderr)

    propuestas, choques, solapes = {}, [], []
    cajas, exentas = {}, []

    for c in plan:
        nom = c["capa"]
        tpl = str(c.get("template", "")).replace(".html", "")
        # `A_SANGRE` es una lista de PLANTILLAS, y hay componentes que ocupan
        # el lienzo entero solo con cierta configuración: `security-pipeline-
        # nodes` con `lienzo: true` tapa el A-Roll a propósito, y sin ella es
        # una superposición normal que sí hay que colocar. Eso no se puede
        # decidir por nombre de plantilla, así que el plan lo declara con
        # `colocar: false` — «esto está donde quiero que esté».
        #
        # Hace falta de verdad: sin ello, el colocador informaba de que el
        # lienzo «no cabe en ninguna banda, reduce su tamaño» —cierto y
        # también irrelevante— y empujaba el visor 644 px fuera del nodo
        # sobre el que la escaleta lo superpone, para esquivar una cara que
        # en esa ventana ya está tapada.
        if c.get("colocar") is False:
            exentas.append(nom)
            continue
        if nom in CROMO or tpl in A_SANGRE or nom not in porcapa:
            continue
        d = porcapa[nom].get("dir")
        if not d or not os.path.isdir(d):
            continue
        caja = caja_alfa(d)
        if not caja:
            continue
        # La medición va en la rejilla reducida; la cara y el lienzo, en
        # píxeles reales. Comparar sin escalar es comparar dos sistemas de
        # coordenadas distintos: no cruza nunca y el informe sale limpio
        # aunque el gráfico esté encima de la cara.
        kx, ky = W / float(ANCHO_M), H / float(ALTO_M)
        # La caja se mide donde el compositor la va a PONER: con su `dy` y
        # también con su `dx`. El guion empieza a repartir columnas con `dx`,
        # y medir sin él evalúa el choque donde el gráfico ya no está — el
        # mismo fallo que tuvo `dy`, por el otro eje.
        dy = float(c.get("dy", 0))
        dx = float(c.get("dx", 0))
        x0 = caja[0] * kx + dx; y0 = caja[1] * ky + dy
        x1 = caja[2] * kx + dx; y1 = caja[3] * ky + dy
        t0 = c["t"]; t1 = t0 + c["duracion"]
        cajas[nom] = (x0, y0, x1, y1, t0, t1)

        banda = banda_rostro(face, keep_tl, t0, t1, W, H, W_src, H_src)
        if not banda:
            continue
        fy0, fy1 = banda
        solapa = min(y1, fy1) - max(y0, fy0)
        if solapa <= 0:
            continue

        alto = y1 - y0
        libre_arriba = fy0 - args.margen
        libre_abajo = techo_subs - fy1 - args.margen
        # Se elige la banda donde QUEPA; a igualdad, la más amplia. Mover
        # un gráfico a un hueco donde no cabe solo cambia por dónde se sale.
        # El destino tiene que caber DENTRO del lienzo. Sin esta
        # comprobación el colocador resuelve el choque con la cara
        # empujando el gráfico fuera de cuadro, que es cambiar un problema
        # por otro peor: al menos el solape se ve, y el recorte no se
        # entiende.
        BORDE = 24
        opciones = []
        if alto <= libre_arriba:
            destino = fy0 - args.margen - alto
            if destino >= BORDE:
                opciones.append(("arriba", destino - y0, libre_arriba))
        if alto <= libre_abajo:
            destino = fy1 + args.margen
            if destino + alto <= techo_subs - BORDE:
                opciones.append(("abajo", destino - y0, libre_abajo))
        if opciones:
            lado, ndy, hueco = max(opciones, key=lambda o: o[2])
            propuestas[nom] = round(dy + ndy, 1)
            choques.append((nom, solapa, lado, round(dy + ndy, 1), hueco))
        else:
            choques.append((nom, solapa, None, None,
                            max(libre_arriba, libre_abajo)))

    # solapes entre gráficos que coinciden en el tiempo
    nombres = list(cajas)
    for i, a in enumerate(nombres):
        for b in nombres[i + 1:]:
            ax0, ay0, ax1, ay1, at0, at1 = cajas[a]
            bx0, by0, bx1, by1, bt0, bt1 = cajas[b]
            if min(at1, bt1) - max(at0, bt0) <= 0.05:
                continue
            sx = min(ax1, bx1) - max(ax0, bx0)
            sy = min(ay1, by1) - max(ay0, by0)
            if sx > 0 and sy > 0:
                solapes.append((a, b, sx * sy))

    print("Rostro: %s" % ("no detectado" if not face else
                          "%d muestras" % len(face.get("samples", []))))
    print("Lienzo: %dx%d   holgura: %d px" % (W, H, args.margen))
    # Se dicen en voz alta: una capa exenta que no debería estarlo es un
    # gráfico encima de la cara que nadie ha revisado.
    if exentas:
        print("Exentas por `colocar: false`: %s" % ", ".join(exentas))
    print()

    if choques:
        print("CHOQUES CON EL ROSTRO")
        for nom, sol, lado, ndy, hueco in choques:
            if lado:
                print("  ⚠ %-16s pisa %4d px → mover %s (dy %+.0f, hueco %d px)"
                      % (nom, sol, lado, ndy, hueco))
            else:
                print("  ✗ %-16s pisa %4d px y NO cabe en ninguna banda "
                      "(mayor hueco %d px): reduce su tamaño"
                      % (nom, sol, hueco))
    else:
        print("CHOQUES CON EL ROSTRO: ninguno")

    if solapes:
        print("\nSOLAPES ENTRE GRÁFICOS")
        for a, b, area in sorted(solapes, key=lambda x: -x[2]):
            print("  ⚠ %s y %s comparten %d px² en pantalla" % (a, b, int(area)))
    else:
        print("\nSOLAPES ENTRE GRÁFICOS: ninguno")

    # --- zona segura de plataforma ---
    # No mueve nada y no cambia el código de salida: la banda es una
    # estimación declarada (ver `PLATAFORMAS`) y un `dy` calculado sobre una
    # estimación se hereda como si fuera medido. Aquí solo se enseña.
    if args.plataforma != "ninguna":
        y_arriba, y_abajo, x_dcha, y_dcha = banda_plataforma(
            W, H, args.plataforma)
        f_arriba, f_abajo, f_dcha, _ = PLATAFORMAS[args.plataforma]

        # Las tres fuentes de cajas: las que ya se midieron para los choques,
        # los subtítulos (que el reparto de choques salta por ser cromo) y las
        # exentas por `colocar: false` — que son las colocadas A MANO, o sea
        # justo donde alguien puede haber bajado un gráfico de más para
        # esquivar la cara.
        # (y0, y1, x1): el borde DERECHO entra ahora en la cuenta. Las de
        # `cajas` ya vienen en píxeles de lienzo; las que se miden aquí
        # abajo salen de `caja_alfa`, que devuelve la escala reducida y sí
        # necesita el factor.
        kx = W / float(ANCHO_M)
        zona = {n: (v[1], v[3], v[2]) for n, v in cajas.items()}
        zona.update({n: (v[0], v[1], v[2]) for n, v in cajas_subs.items()})
        ky = H / float(ALTO_M)
        for c in plan:
            nom = c["capa"]
            tpl = str(c.get("template", "")).replace(".html", "")
            if nom in zona or nom not in exentos:
                continue
            if nom in CROMO or tpl in A_SANGRE or nom not in porcapa:
                continue
            d = porcapa[nom].get("dir")
            if not d or not os.path.isdir(d):
                continue
            caja = caja_alfa(d)
            if caja:
                dy = float(c.get("dy", 0))
                dx = float(c.get("dx", 0))
                zona[nom] = (caja[1] * ky + dy, caja[3] * ky + dy,
                             caja[2] * kx + dx)

        invasiones = []
        for nom in sorted(zona):
            y0, y1, x1 = zona[nom]
            arr, aba = invade(y0, y1, (y_arriba, y_abajo))
            # La columna de la derecha solo estorba donde LLEGA, y llega
            # bastante más arriba que la banda inferior: se mide contra el
            # tramo de altura que ocupa el gráfico, no contra el cuadro
            # entero. Un gráfico centrado no la toca por ancho que sea.
            der = (max(0, int(round(x1 - x_dcha)))
                   if y1 > y_dcha else 0)
            if arr > 0 or aba > 0 or der > 0:
                invasiones.append((nom, y0, y1, arr, aba, der))

        print("\nZONA SEGURA DE PLATAFORMA (%s): superior 0-%d px, "
              "inferior %d-%d px, derecha %d-%d px"
              % (args.plataforma, y_arriba, y_abajo, H, x_dcha, W))
        # Medido y estimado NO se enseñan igual: quien lea «estimada» sobre
        # una banda que sí se midió la va a descontar, y es justo la que no
        # hay que descontar.
        print("  (%s: %.0f %% arriba, %.0f %% abajo, %.0f %% a la derecha — "
              "ver PLATAFORMAS en este script)"
              % ("MEDIDA sobre capturas reales" if args.plataforma in MEDIDAS
                 else "estimada, sin capturas que la respalden",
                 100 * f_arriba, 100 * f_abajo, 100 * f_dcha))
        if not invasiones:
            print("  ✓ ningún gráfico entra en las bandas de interfaz")
        for nom, y0, y1, arr, aba, der in invasiones:
            donde = []
            if der > 0:
                donde.append("%d px en la DERECHA (likes, comentarios, "
                             "compartir)" % der)
            if arr > 0:
                donde.append("%d px en la superior (cabecera y progreso)" % arr)
            if aba > 0:
                donde.append("%d px en la inferior (caption, usuario y CTA)"
                             % aba)
            print("  ⚠ %-16s ocupa y %d-%d y mete %s"
                  % (nom, int(y0), int(y1), " y ".join(donde)))
        if invasiones:
            print("  No se mueve nada —mover por una banda es decisión de "
                  "dirección—. Si la invasión estorba, sube el gráfico con "
                  "`dy` en el plan y `colocar: false`, o reduce la caja de "
                  "subtítulos.")

    # La sincronización va con `--aplicar`, HAYA o no correcciones. Estando
    # dentro del `if propuestas`, un plan ya correcto no sincronizaba nada y
    # las capas bien colocadas a mano se quedaban sin su `dy` en el
    # manifiesto: se iban al centro sin que nada avisara.
    # `dx` RECORTADO AL LIENZO, antes de escribir nada. Nace en el plan —el
    # guion traduce POS_MID_RIGHT a un desplazamiento— y hasta ahora se
    # copiaba tal cual: un +250 sobre un mockup de 980 px de ancho lo sacó
    # 200 px del cuadro con el código cortado a media línea. Se recorta aquí
    # porque es aquí donde se mide el alfa, que es lo único que sabe cuánto
    # ocupa de verdad un gráfico. Se dice SIEMPRE, aplique o no: quien
    # escribió ese POS_ tiene que enterarse de que no cabía.
    recortes = []
    kx_l = W / float(ANCHO_M)
    for c in plan:
        dx = float(c.get("dx", 0) or 0)
        if not dx or c["capa"] not in porcapa:
            continue
        d = porcapa[c["capa"]].get("dir")
        if not d or not os.path.isdir(d):
            continue
        caja = caja_alfa(d)
        if not caja:
            continue
        # `escala` la aplica el COMPOSITOR, así que el alfa del PNG está a
        # tamaño completo: sin multiplicar aquí, el recorte creía que un
        # gráfico encogido seguía siendo ancho y lo devolvía al centro.
        k = float(c.get("escala", 1.0) or 1.0)
        cx = W / 2.0
        x0 = cx + (caja[0] * kx_l - cx) * k
        x1 = cx + (caja[2] * kx_l - cx) * k
        cabe = cabe_en_lienzo(x0, x1, dx, W)
        if abs(cabe - dx) > 0.5:
            # Por qué lado se sale, que no siempre es el derecho: el HUD del
            # acto 2 lleva dx negativo y se iba por la izquierda.
            fuera = (int(round(x1 + dx - W)), "derecha") if x1 + dx > W \
                else (int(round(-(x0 + dx))), "izquierda")
            recortes.append((c["capa"], dx, cabe, fuera))
            if args.aplicar:
                if cabe:
                    c["dx"] = round(cabe, 1)
                else:
                    c.pop("dx", None)
    if recortes:
        print("\nDESPLAZAMIENTOS QUE NO CABEN EN EL LIENZO")
        for nom, ped, dado, (px, lado) in recortes:
            print("  ⚠ %-16s dx %+d se salía %d px por la %s; %s"
                  % (nom, ped, px, lado,
                     "recortado a %+d" % dado if dado else "retirado"))
        print("  %s. El gráfico ocupa casi todo el ancho: si lo quieres a un "
              "lado hay que estrecharlo (`escala` en la capa), no empujarlo."
              % ("Escrito en el plan" if args.aplicar else
                 "Sin --aplicar no se ha tocado nada"))

    if args.aplicar:
        for c in plan:
            if c["capa"] in propuestas:
                c["dy"] = propuestas[c["capa"]]
        with open(args.plan, "w", encoding="utf-8") as f:
            json.dump(plan, f, ensure_ascii=False, indent=1)

        # También en el MANIFIESTO. `dy` llega al compositor a través de
        # layers.json, que lo escribe el renderizador: tocar solo el plan
        # no cambia nada hasta volver a renderizar, y renderizar de nuevo
        # por un desplazamiento es absurdo. Es la misma trampa que ya tuvo
        # este proyecto con `parallax` y con `dx`: propiedad de
        # COMPOSICIÓN que vive en el plan y se pierde por el camino.
        # Se sincroniza el `dy` de TODAS las capas, no solo el de las
        # corregidas. Escribir únicamente las correcciones deja sin
        # desplazamiento a las que ya estaban bien puestas en el plan, y
        # esas se van al centro sin que nada avise.
        dy_plan = {c["capa"]: c.get("dy") for c in plan}
        # `dx` también. Este script no lo propone —nace en el plan, del
        # reparto de columnas del guion—, pero sí lo sincroniza: es la misma
        # propiedad de COMPOSICIÓN que `dy` y que `parallax`, y sin copiarlo
        # al manifiesto el compositor no lo ve y la capa vuelve al centro
        # sin que nada avise.
        dx_plan = {c["capa"]: c.get("dx") for c in plan}
        for c in man.get("capas", []):
            v = propuestas.get(c["capa"], dy_plan.get(c["capa"]))
            if v:
                c["dy"] = v
            else:
                c.pop("dy", None)
            vx = dx_plan.get(c["capa"])
            if vx:
                c["dx"] = vx
            else:
                c.pop("dx", None)
        with open(args.layers, "w", encoding="utf-8") as f:
            json.dump(man, f, ensure_ascii=False, indent=2)

        print("\n%d desplazamiento(s) escritos en el plan Y en el "
              "manifiesto. Vuelve a componer; no hace falta re-renderizar."
              % len(propuestas))
    elif propuestas:
        print("\n%d corrección(es) propuestas. Aplícalas con --aplicar."
              % len(propuestas))

    # Devolver 0 siempre era mentir por omisión: este script puede imprimir
    # «✗ no cabe en ninguna banda» —o sea, hay un gráfico encima de la cara
    # que NO ha podido arreglar— y aun así dejar pasar el pipeline. Los
    # choques irresolubles y las correcciones pendientes son las dos cosas
    # que exigen que alguien mire, así que valen 1.
    #
    # Un choque resuelto y aplicado NO cuenta: ahí el script ha hecho su
    # trabajo y parar el pipeline sería castigar el éxito.
    # `choques` son tuplas `(nombre, solapa, lado, dy, hueco)` y `lado` es
    # None exactamente cuando no se encontró banda: ese es el irresoluble.
    #
    # Y solo el irresoluble SIN declarar. Una capa con `colocar: false` es
    # una decisión del plan —«esto está donde quiero que esté»— y devolver 1
    # por ella sería castigar el diseño. Hoy las exentas se saltan antes de
    # medir y no llegan a `choques`, pero el contrato del código de salida
    # se escribe aquí, donde se cobra: si mañana se miden también las
    # exentas (p. ej. para más avisos), no se convierten en fallo.
    irresolubles = [c[0] for c in choques
                    if c[2] is None and c[0] not in exentos]
    if irresolubles:
        print("\n%d gráfico(s) sin banda libre donde caber: %s.\n"
              "Reduce su tamaño con `zoom` (lo aplica el motor a toda la "
              "maquetación) o con `escala` si la plantilla la lee, o declara "
              "la colocación a mano con `colocar: false` y un `dy` en el plan."
              % (len(irresolubles), ", ".join(irresolubles)), file=sys.stderr)
        return 1
    if propuestas and not args.aplicar:
        print("\nHay correcciones sin aplicar. Vuelve a llamar con --aplicar.",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
