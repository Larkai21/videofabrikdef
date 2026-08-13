#!/usr/bin/env python3
"""Elige y exporta el fotograma de PORTADA de una pieza ya compuesta.

En todo el repo no había una sola línea sobre la portada, y la plataforma
enseña el FOTOGRAMA 0 mientras nadie le dé otro. Medido sobre
`renders/codex-s4.mp4`, ese fotograma 0 es lo PEOR que tiene la pieza: su
varianza del laplaciano es 184, mientras la mediana de los primeros cinco
segundos es 988 y la mejor candidata llega a 2132. O sea que la imagen con
la que se decide si se ve el vídeo es la más borrosa de todo el arranque, y
encima el primer gráfico entra en 0,55 s: hasta ahí solo hay una cara a
medio gesto sobre unos subtítulos que aún se están fundiendo.

Esto no es un fallo que dé error. Es de la familia de los que este repo
persigue: nada avisa, y solo se ve mirando la miniatura en el feed.

--------------------------------------------------------------------------
CÓMO SE ELIGE — la fórmula y su porqué
--------------------------------------------------------------------------

Se puntúan las candidatas de los primeros `--segundos` en una rejilla de
`--tasa` por segundo. Cuatro términos, y ninguno inventado: los cuatro se
miden sobre lo que hay.

    punt = 0,45·nitidez + 0,15·contraste + 0,25·rostro + gráfico

**nitidez (0,45)** — varianza del laplaciano sobre la luma. Es lo que más
pesa porque es lo único que distingue un fotograma USABLE de uno inservible:
un encuadre perfecto con arrastre de movimiento no se arregla, y en una
miniatura pequeña la falta de foco es lo primero que se lee como «vídeo
malo». Se normaliza con `v/(v+600)`, que satura suave y nunca llega a 1. El
600 no es redondo por casualidad: es el punto medio del rango medido en la
pieza real (184 el peor, 2132 el mejor), y ahí la curva tiene su pendiente
máxima, que es donde hace falta que discrimine.

**contraste (0,15)** — recorrido de luma entre los percentiles 5 y 95, no la
desviación típica: un cielo quemado o un fondo negro arrastran la desviación
sin aportar contraste visible. Se mapea lineal de 60 a 200 niveles. Por
debajo de 60 el fotograma es plano o está velado; por encima de 200 no hay
nada más que ganar. Pesa poco a propósito: el grado de marca ya fija el
contraste de la pieza entera, así que entre candidatas apenas separa
—medido: de 151 a 219 en cinco segundos— y subirle el peso sería darle voz a
un término casi constante.

**rostro (0,25)** — de `face.json`, que va en reloj de ORIGEN mientras el
vídeo compuesto va en reloj de SALIDA. La traducción es `keep`, la única que
existe, y la hace `colocar.banda_rostro`, que además replica el encuadre del
compositor: sin eso un bbox del fuente NO se multiplica por el alto del
lienzo, porque el A-Roll se escala y se recorta POR TRAMO (con z=1,16 un
bbox en 0,35 cae en el píxel 650 y no en el 672). Se puntúa la franja de
OJOS Y BOCA —lo que `banda_rostro` devuelve— y no el recuadro entero: el
pelo y el cuello no deciden si una portada se lee. Meseta entre 0,18 y 0,45
del alto, cayendo a cero en 0,06 y en 0,65. Los extremos: una miniatura
vertical en el feed mide unos 200x356 px, así que 0,06 son 21 px de cara
—un punto— y 0,65 es un primerísimo plano donde ya no cabe ningún rótulo.

Y una salvedad que costó la primera portada de esta pieza: **donde hay
B-Roll no hay A-Roll**, así que `face.json` no habla de ese fotograma. La
primera versión de este script eligió t=4,50 s de `codex-s4` con «rostro
1,00, franja 24 % del alto» — y al abrir el JPEG lo que había era un plano
de archivo de un centro de datos, sin una sola cara. La cara del 24 % era la
del A-Roll, medida en un fotograma que el compositor había sustituido.
`broll_plan.json` dice cuándo pasa eso (en reloj de salida, que es el del
vídeo), y en esos instantes el término se declara NEUTRO en vez de medirse
donde no se puede. Con eso la portada pasó a t=1,50 s: el presentador con la
tarjeta de titular asentada, que es la portada que se quería.

**gráfico (+0,10 / −0,30)** — el plan sabe cuándo entra y cuándo sale cada
capa. Una tarjeta a medio fundir se lee como un error de render, así que
castiga; una tarjeta ASENTADA es un extra, así que premia, pero tres veces
menos. La asimetría es deliberada: un defecto y una mejora no valen lo
mismo. Las ventanas de fundido salen de `entrada`/`salida` de la config, y
si la config no las trae, de los `defaults` de la plantilla; y si tampoco
—hay plantillas que no las declaran— de la moda del catálogo, 0,5 y 0,4.
Suponer cero sería declarar «asentado» un sello justo cuando está entrando.

El desempate es la candidata más TEMPRANA. Es arbitrario, pero tiene que
estar escrito: si no, dos ejecuciones sobre el mismo vídeo pueden devolver
fotogramas distintos y la portada deja de ser reproducible.

--------------------------------------------------------------------------
LO QUE NO HACE, Y POR QUÉ
--------------------------------------------------------------------------

**No dibuja texto.** Este ffmpeg no trae `libfreetype` ni `libass` —está
comprobado y escrito en CLAUDE.md—, así que un `drawtext` no fallaría con un
rótulo feo: fallaría entero.

**Y tampoco hace falta.** La variante «con el titular» existe (`--titular`)
y no rasteriza nada nuevo: RESTRINGE las candidatas a los instantes en que
una tarjeta con copy —la ranura de texto de su plantilla, según la tabla
`COPY` de `leer_guion`— está asentada en pantalla. El titular de esa portada
lo rasterizó Playwright desde una plantilla del catálogo, en el mismo render
que produjo la pieza. Componer un segundo titular por fuera sería un rótulo
que no existe en el vídeo, con otra tipografía y otro tema, y encima
obligaría a re-renderizar dentro de `build/`.

**No sabe si el rostro está TAPADO por un GRÁFICO.** Lo del B-Roll sí lo
sabe —lo dice `broll_plan.json`— pero una capa a sangre encima de la cara no
está declarada en ningún sitio. El término de gráfico lo roza; si algún día
importa de verdad, lo que hay que mirar es el alfa de los fotogramas de esa
capa, que es exactamente lo que ya hace `colocar.py`.

Uso:
    python3 scripts/portada.py --input renders/codex-s4.mp4
    python3 scripts/portada.py --input renders/codex-s4.mp4 --detalle
    python3 scripts/portada.py --input renders/codex-s4.mp4 --titular
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import colocar                                          # noqa: E402
import leer_guion                                       # noqa: E402
import reloj                                            # noqa: E402
import comun                                 # noqa: E402
from comun import FFMPEG, FFPROBE, carga_json, exige_ffmpeg, exige_ok  # noqa: E402

PLANTILLAS = os.path.join(RAIZ, "templates")

# --------------------------------------------------------------------------
#  la rejilla de candidatas
# --------------------------------------------------------------------------
# 5 s y 8 candidatas por segundo = 40 fotogramas. El arranque es donde la
# portada tiene sentido —es el mismo plano con el que empieza la pieza— y 8
# por segundo basta: a 30 fps, entre dos candidatas contiguas hay menos de
# cuatro fotogramas, y el mejor de esos cuatro no se distingue del elegido.
SEGUNDOS, TASA = 5.0, 8.0

# Se mide sobre la luma reducida a 192 px de ancho. El número está elegido
# por abajo, no por arriba: reducir MÁS borra justo la señal que se mide. Un
# arrastre real en 1080 son 10-30 px; a 192 (5,6x) quedan 2-5 px y se ve, a
# 128 (8,4x) quedan 1-3 y empieza a confundirse con la textura del grano.
ANCHO_M = 192

# --------------------------------------------------------------------------
#  normalización de cada término
# --------------------------------------------------------------------------
K_NITIDEZ = 600.0                 # punto medio del rango medido: 184..2132
CONTRASTE_PLANO, CONTRASTE_PLENO = 60.0, 200.0
TALLA_NULA, TALLA_BAJA = 0.06, 0.18
TALLA_ALTA, TALLA_LLENA = 0.45, 0.65
ROSTRO_SIN_DATO = 0.5             # ver `punt_rostro`

PESO_NITIDEZ, PESO_CONTRASTE, PESO_ROSTRO = 0.45, 0.15, 0.25
PREMIO_GRAFICO, CASTIGO_GRAFICO = 0.10, 0.30

# Moda del catálogo para las plantillas que no declaran su fundido: `entrada:
# 0.5` es la más repetida y `salida: 0.4` la suya. No es una estimación fina
# —cada plantilla tiene la que tiene— sino un valor que evita el error grave
# en la dirección grave: dar por asentado lo que está entrando.
ENTRADA_TIPO, SALIDA_TIPO = 0.5, 0.4

# El plan y el vídeo se emparejan por NADA: `build/` es compartido entre
# piezas y ningún contrato lleva id (la misma lección que motivó
# `comprobar_montaje.py`). Lo único comprobable es que el plan termine donde
# termina el vídeo. Si no coinciden, el término de gráfico se apaga: castigar
# con los tiempos de OTRO montaje es peor que no castigar, porque el número
# sale igual de convincente.
TOL_MONTAJE = 0.5

LIMITE = 500 * 1024
CALIDADES = (2, 3, 4, 5, 6, 7)    # `-q:v` de mjpeg, de mejor a peor

LIENZO_W, LIENZO_H = 1080, 1920


# --------------------------------------------------------------------------
#  medida
# --------------------------------------------------------------------------
def dimensiones(video: str) -> tuple:
    """(ancho, alto) CODIFICADOS con la rotación ya aplicada.

    `-noautorotate` NO se pasa a propósito: ffprobe con autorotación devuelve
    las dimensiones de PANTALLA, que son las que ffmpeg entrega al decodificar.
    Es el mismo error que motivó `comprobar_fuentes.py` —unos clips venían
    3840x2160 con rotación de 90°, o sea verticales— y aquí saldría como una
    rejilla de muestreo con la proporción cambiada."""
    r = exige_ok(
        subprocess.run([FFPROBE, "-v", "error", "-select_streams", "v:0",
                        "-show_entries", "stream=width,height",
                        "-of", "csv=p=0:s=x", video],
                       capture_output=True, text=True),
        "ffprobe sobre %s" % video,
        arregla="comprueba que el fichero es un vídeo y no un montaje a medias")
    m = re.search(r"(\d+)x(\d+)", r.stdout)
    if not m:
        print("ffprobe no dio dimensiones de vídeo para %s: ¿tiene pista de "
              "imagen?" % video, file=sys.stderr)
        raise SystemExit(2)
    return int(m.group(1)), int(m.group(2))


def nitidez(px: bytes, W: int, H: int) -> float:
    """Varianza del laplaciano 4-vecinos sobre la luma.

    Fila a fila y con `zip` de rebanadas, no con índices: el bucle por píxel
    de la versión ingenua tarda 1,6 s por las 40 candidatas de una pieza, y
    un paso que cuesta segundos en una máquina donde el resto del arnés cabe
    en 0,5 s se deja de ejecutar."""
    s = s2 = 0.0
    n = 0
    for y in range(1, H - 1):
        f = y * W
        centro = px[f + 1:f + W - 1]
        lap = [4 * c - a - b - u - d
               for c, a, b, u, d in zip(centro,
                                        px[f:f + W - 2],          # izquierda
                                        px[f + 2:f + W],          # derecha
                                        px[f - W + 1:f - 1],      # arriba
                                        px[f + W + 1:f + 2 * W - 1])]
        s += sum(lap)
        s2 += sum([v * v for v in lap])
        n += len(lap)
    if not n:
        return 0.0
    return s2 / n - (s / n) ** 2


def contraste(px: bytes) -> float:
    """Recorrido de luma entre los percentiles 5 y 95.

    El histograma se hace con 256 `bytes.count`, que corren en C, y no con un
    bucle Python sobre 65.000 píxeles: mismo resultado, un orden de magnitud
    menos de tiempo."""
    total = len(px)
    if not total:
        return 0.0
    h = [px.count(v) for v in range(256)]
    acc, p05, p95 = 0, 0, 255
    bajo, alto = total * 0.05, total * 0.95
    visto_bajo = False
    for v in range(256):
        acc += h[v]
        if not visto_bajo and acc >= bajo:
            p05, visto_bajo = v, True
        if acc >= alto:
            p95 = v
            break
    return float(p95 - p05)


def muestrea(video: str, segundos: float, tasa: float, ancho: int) -> tuple:
    """[(i, t, nitidez, contraste)] de la rejilla, y sus dimensiones.

    Una sola pasada de ffmpeg que decodifica los primeros `segundos` y
    entrega luma cruda. El alto se calcula aquí y se le pasa EXPLÍCITO al
    filtro en vez de usar `scale=W:-1`: con `-1` el alto lo decide ffmpeg y
    hay que adivinarlo para trocear el flujo crudo, y adivinarlo mal no da
    error — desplaza las filas y la varianza sale de una imagen cizallada."""
    W_v, H_v = dimensiones(video)
    Wm = ancho
    Hm = max(2, int(round(H_v * ancho / float(W_v))))
    r = exige_ok(
        subprocess.run([FFMPEG, "-nostdin", "-v", "error",
                        "-t", "%.3f" % segundos, "-i", video,
                        "-vf", "fps=%g,scale=%d:%d,format=gray" % (tasa, Wm, Hm),
                        "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                       capture_output=True),
        "ffmpeg (muestreo de candidatas de portada)",
        arregla="comprueba que %s se abre:  ffplay %s" % (video, video))
    crudo = r.stdout
    paso = Wm * Hm
    n = len(crudo) // paso
    if n == 0:
        print("%s no dio ni un fotograma en los primeros %.2f s.\n"
              "  Sube la ventana:  python3 scripts/portada.py --input %s "
              "--segundos 10" % (video, segundos, video), file=sys.stderr)
        raise SystemExit(2)
    filas = []
    for i in range(n):
        px = crudo[i * paso:(i + 1) * paso]
        filas.append({"i": i, "t": round(i / tasa, 3),
                      "nitidez": round(nitidez(px, Wm, Hm), 2),
                      "contraste": contraste(px)})
    return filas, (W_v, H_v)


# --------------------------------------------------------------------------
#  el término de gráfico: quién está entrando y quién está asentado
# --------------------------------------------------------------------------
_CACHE_FUNDIDO: dict = {}


def fundido_plantilla(template: str) -> tuple:
    """(entrada, salida) declaradas en los `defaults` de la plantilla.

    Se leen del bloque `defaults` con `reloj.bloque_defaults`, que es de donde
    los lee todo el mundo en este repo, y sobre el fuente SIN COMENTARIOS: hay
    plantillas que nombran `entrada:` en la prosa que explica su gesto, y
    contarla ahí daría el número de un ejemplo."""
    if template in _CACHE_FUNDIDO:
        return _CACHE_FUNDIDO[template]
    e, s = ENTRADA_TIPO, SALIDA_TIPO
    ruta = os.path.join(PLANTILLAS, template or "")
    if template and os.path.isfile(ruta):
        blk = reloj.bloque_defaults(
            reloj.sin_comentarios(open(ruta, encoding="utf-8").read())) or ""
        me = re.search(r"\bentrada\s*:\s*(-?\d[\d.]*)", blk)
        ms = re.search(r"\bsalida\s*:\s*(-?\d[\d.]*)", blk)
        if me:
            e = float(me.group(1))
        if ms:
            s = float(ms.group(1))
    _CACHE_FUNDIDO[template] = (e, s)
    return e, s


def capas_del_plan(plan: list) -> list:
    """Las capas con su ventana, su fundido y si llevan copy en pantalla."""
    fuera = []
    for c in plan:
        cfg = c.get("config") or {}
        e, s = fundido_plantilla(c.get("template", ""))
        e = float(cfg.get("entrada", e))
        s = float(cfg.get("salida", s))
        ranura = leer_guion.COPY.get(c.get("template", ""))
        ranuras = [ranura] if isinstance(ranura, str) else (ranura or [])
        fuera.append({
            "capa": c.get("capa", "?"),
            "t": float(c.get("t", 0.0)),
            "fin": float(c.get("t", 0.0)) + float(c.get("duracion", 0.0)),
            "entrada": e, "salida": s,
            "copy": any(str(cfg.get(k) or "").strip() for k in ranuras),
        })
    return fuera


def estado_grafico(t: float, capas: list) -> tuple:
    """(medio_fundido, asentada_con_copy, asentada) en el instante `t`.

    Basta con que UNA capa esté a medio fundir para castigar: la que se ve
    entrando es la que estropea la portada, y que haya otras cuatro asentadas
    no lo arregla."""
    medio = asentada = copy = False
    for c in capas:
        if not (c["t"] - 1e-9 <= t <= c["fin"] + 1e-9):
            continue
        if t < c["t"] + c["entrada"] or t > c["fin"] - c["salida"]:
            medio = True
        else:
            asentada = True
            copy = copy or c["copy"]
    return medio, copy, asentada


# --------------------------------------------------------------------------
#  puntuación
# --------------------------------------------------------------------------
def punt_nitidez(v: float) -> float:
    return v / (v + K_NITIDEZ) if v > 0 else 0.0


def punt_contraste(r: float) -> float:
    x = (r - CONTRASTE_PLANO) / (CONTRASTE_PLENO - CONTRASTE_PLANO)
    return min(1.0, max(0.0, x))


def punt_rostro(talla) -> float:
    """Meseta con caídas lineales. `None` —sin `face.json` o sin muestras en
    esa ventana— vale 0,5 y no 0 ni 1.

    Da igual para el RANKING, porque es la misma constante en todas las
    candidatas; importa para la cifra que se imprime, que si no premiaría o
    castigaría una ausencia de información como si fuera una medida."""
    if talla is None:
        return ROSTRO_SIN_DATO
    if talla <= TALLA_NULA or talla >= TALLA_LLENA:
        return 0.0
    if talla < TALLA_BAJA:
        return (talla - TALLA_NULA) / (TALLA_BAJA - TALLA_NULA)
    if talla > TALLA_ALTA:
        return (TALLA_LLENA - talla) / (TALLA_LLENA - TALLA_ALTA)
    return 1.0


def hay_broll(t: float, escenas: list) -> bool:
    """¿El compositor tapa el A-Roll en ese instante?

    `broll_plan.escenas` va en reloj de SALIDA —lo declara el contrato— que
    es el mismo del vídeo compuesto, así que aquí no hay traducción que hacer.
    """
    return any(t0 - 1e-9 <= t <= t1 + 1e-9 for t0, t1 in escenas)


def talla_rostro(face, keep, t, dt, W, H, W_src, H_src):
    """Franja de ojos y boca en ese instante, como fracción del alto.

    La ventana es la de UNA candidata, no la de una capa: `banda_rostro`
    admite las muestras a ±0,5 s, que es justo el paso del detector."""
    if not face or not keep:
        return None
    banda = colocar.banda_rostro(face, keep, t, t + dt, W, H, W_src, H_src)
    if not banda:
        return None
    return (banda[1] - banda[0]) / float(H)


def puntua(filas, capas, face, keep, geo, escenas=()) -> list:
    """Añade `rostro`, `grafico` y `punt` a cada candidata. Modifica en sitio
    y devuelve la lista, para poder encadenar."""
    W, H, W_src, H_src = geo
    dt = 1e-3
    for f in filas:
        f["broll"] = hay_broll(f["t"], escenas)
        # Sobre B-Roll no se mide el rostro: no está ahí. Ver la cabecera —
        # esta línea es la que separó «rostro 1,00» de un plano de archivo.
        talla = (None if f["broll"]
                 else talla_rostro(face, keep, f["t"], dt, W, H, W_src, H_src))
        medio, copy, asentada = estado_grafico(f["t"], capas)
        f["talla"] = None if talla is None else round(talla, 4)
        f["rostro"] = punt_rostro(talla)
        f["copy"] = copy
        f["grafico"] = (-CASTIGO_GRAFICO if medio
                        else PREMIO_GRAFICO if asentada else 0.0)
        f["estado"] = ("entrando" if medio
                       else "asentado" if asentada else "sin gráfico")
        if f["broll"]:
            f["estado"] += " · B-Roll"
        f["punt"] = round(
            PESO_NITIDEZ * punt_nitidez(f["nitidez"])
            + PESO_CONTRASTE * punt_contraste(f["contraste"])
            + PESO_ROSTRO * f["rostro"]
            + f["grafico"], 6)
    return filas


def elige(filas: list, solo_copy: bool = False):
    """La mejor candidata. Empata la más TEMPRANA — ver la cabecera."""
    aptas = [f for f in filas if f["copy"]] if solo_copy else filas
    if not aptas:
        return None
    return sorted(aptas, key=lambda f: (-f["punt"], f["i"]))[0]


# --------------------------------------------------------------------------
#  exportación
# --------------------------------------------------------------------------
def exporta(video, fila, tasa, segundos, destino, W_v, H_v, limite=LIMITE):
    """Escribe el JPEG y devuelve (calidad, bytes).

    Se selecciona por ÍNDICE dentro de la misma rejilla `fps=` que se midió,
    no con `-ss t`. Es la diferencia entre exportar el fotograma que se
    puntuó y exportar el que ffmpeg decida que cae en ese segundo: con `-ss`
    la elección depende de los keyframes y de la versión del binario, y la
    portada dejaría de ser reproducible sin que nada lo dijera.

    La calidad baja de 2 en 2 hasta caber en `limite`. El techo no es
    estético: una miniatura que la plataforma va a recomprimir no gana nada
    por encima de medio mega, y el peso sí se paga en cada subida."""
    escala = ""
    if (W_v, H_v) != (LIENZO_W, LIENZO_H):
        # Mismo encuadre que el compositor: cubrir y recortar, nunca deformar.
        escala = (",scale=%d:%d:force_original_aspect_ratio=increase,"
                  "crop=%d:%d,setsar=1"
                  % (LIENZO_W, LIENZO_H, LIENZO_W, LIENZO_H))
    for q in CALIDADES:
        exige_ok(
            subprocess.run(
                [FFMPEG, "-nostdin", "-v", "error", "-y",
                 "-t", "%.3f" % segundos, "-i", video,
                 "-vf", "fps=%g,select='eq(n\\,%d)'%s" % (tasa, fila["i"], escala),
                 "-fps_mode", "passthrough", "-frames:v", "1",
                 "-q:v", str(q), destino],
                capture_output=True),
            "ffmpeg (exportar la portada)",
            arregla="comprueba que %s se puede escribir"
                    % os.path.dirname(destino))
        peso = os.path.getsize(destino)
        if peso <= limite:
            return q, peso
    return CALIDADES[-1], os.path.getsize(destino)


# --------------------------------------------------------------------------
def main() -> int:
    exige_ffmpeg("ffmpeg", "ffprobe")
    ap = argparse.ArgumentParser(
        description="elige y exporta el fotograma de portada de una pieza")
    ap.add_argument("--input", help="la pieza COMPUESTA (renders/<pieza>.mp4)")
    ap.add_argument("--plan", default=os.path.join(comun.build_dir(), "plan.json"))
    ap.add_argument("--face", default=os.path.join(comun.build_dir(), "face.json"))
    ap.add_argument("--broll",
                    default=os.path.join(comun.build_dir(), "broll_plan.json"),
                    help="dice en qué instantes el A-Roll no está en pantalla")
    ap.add_argument("--timeline",
                    default=os.path.join(comun.build_dir(), "timeline.json"),
                    help="de aquí sale el `keep` que traduce salida→origen")
    ap.add_argument("--segundos", type=float, default=SEGUNDOS)
    ap.add_argument("--tasa", type=float, default=TASA)
    ap.add_argument("--salida", default=None,
                    help="por defecto renders/<pieza>-portada.jpg")
    ap.add_argument("--titular", action="store_true",
                    help="solo instantes con una tarjeta CON COPY asentada")
    ap.add_argument("--limite", type=int, default=LIMITE)
    ap.add_argument("--detalle", action="store_true",
                    help="la tabla entera de candidatas y sus términos")
    args = ap.parse_args()

    if not args.input:
        # CLAUDE.md: un paso que falla dice QUÉ falta y QUÉ COMANDO lo
        # arregla. Adivinar «el .mp4 más reciente de renders/» sería peor que
        # preguntar: ahí conviven piezas, catálogos y pruebas de sonido, y
        # una portada de la pieza equivocada no da error en ningún sitio.
        print("dime qué vídeo:  python3 scripts/portada.py --input "
              "renders/<pieza>.mp4", file=sys.stderr)
        rend = os.path.join(RAIZ, "renders")
        if os.path.isdir(rend):
            recientes = sorted(
                (f for f in os.listdir(rend) if f.endswith(".mp4")),
                key=lambda f: os.path.getmtime(os.path.join(rend, f)),
                reverse=True)[:3]
            for f in recientes:
                print("  · renders/%s" % f, file=sys.stderr)
        return 2
    if not os.path.isfile(args.input):
        print("falta %s: la pieza compuesta.\n"
              "  la produce:  python3 scripts/composite_ffmpeg.py --lut "
              "assets/luts/carbon_bronze.cube" % args.input, file=sys.stderr)
        return 2

    filas, (W_v, H_v) = muestrea(args.input, args.segundos, args.tasa, ANCHO_M)
    if W_v < LIENZO_W:
        # `--preview` compone a 540x960. Se exporta igual —a 1080x1920, que es
        # lo que pide la plataforma— pero ampliar no inventa detalle y en una
        # miniatura se nota justo donde más duele: en los ojos.
        print("  · %s mide %dx%d, menos que el lienzo: parece un render de "
              "--preview y la portada saldrá ampliada. Vuelve a componer sin "
              "--preview antes de subirla." % (args.input, W_v, H_v),
              file=sys.stderr)

    # --- el rostro, si se puede -------------------------------------------
    face, keep = None, []
    if os.path.exists(args.face) and os.path.exists(args.timeline):
        face = carga_json(args.face)
        tl = carga_json(args.timeline)
        reloj.exige_reloj(tl, "origen", "portada.py",
                          "python3 scripts/clean_transcript.py")
        keep = tl.get("keep") or []
        if not face.get("verificado"):
            print("  · face.json dice `verificado: false`: el detector no vio "
                  "una cara y el término de rostro no mide nada. Lo arregla:  "
                  "pip install pyobjc-framework-Vision", file=sys.stderr)
            face = None
    else:
        print("  · sin face.json o sin timeline.json: el término de rostro "
              "queda neutro (%.2f) en todas las candidatas y no decide nada."
              % ROSTRO_SIN_DATO, file=sys.stderr)

    # El fuente del A-Roll puede no estar ya en disco. Cuando falta se usan
    # las dimensiones del lienzo, y en este pipeline eso NO es una
    # aproximación: el A-Roll y la salida son ambos 1080x1920, así que la
    # escala del tramo sale exactamente igual. Deja de serlo el día que se
    # monte material 16:9, y por eso se dice en voz alta.
    W_src, H_src = W_v, H_v
    fuente = (face or {}).get("source")
    if fuente and os.path.isfile(fuente):
        W_src, H_src = dimensiones(fuente)
    elif face:
        print("  · el A-Roll de face.json ya no está en disco: la geometría "
              "del rostro se calcula con el lienzo (exacto mientras fuente y "
              "lienzo midan lo mismo).", file=sys.stderr)

    # --- el plan y el B-Roll, si son de ESTE montaje ----------------------
    capas, escenas = [], []
    if os.path.exists(args.plan):
        plan = carga_json(args.plan)
        capas = capas_del_plan(plan)
        fin_plan = max((c["fin"] for c in capas), default=0.0)
        dur = None
        r = subprocess.run([FFPROBE, "-v", "error", "-show_entries",
                            "format=duration", "-of", "csv=p=0", args.input],
                           capture_output=True, text=True)
        if r.returncode == 0:
            try:
                dur = float(r.stdout.strip())
            except ValueError:
                dur = None
        else:
            # Sonda: su contrato es devolver None y que el llamador decida.
            print("  · ffprobe no dio la duración de %s; no puedo comprobar "
                  "que el plan sea de este montaje." % args.input,
                  file=sys.stderr)
        if dur is not None and abs(dur - fin_plan) > TOL_MONTAJE:
            print("  ⚠ el plan termina en %.2f s y el vídeo dura %.2f s: no "
                  "son del mismo montaje.\n"
                  "    Ignoro los gráficos Y el B-Roll (medir con los tiempos "
                  "de otra pieza es peor que no medir: el número sale igual "
                  "de convincente).\n"
                  "    Pásame los suyos:  --plan ... --broll ..."
                  % (fin_plan, dur), file=sys.stderr)
            capas = []
        elif os.path.exists(args.broll):
            bp = carga_json(args.broll)
            # El B-Roll SÍ declara su reloj, y aquí importa: sus tiempos se
            # comparan directamente con los del vídeo compuesto. Uno en reloj
            # de origen desplazaría las ventanas de «aquí no hay cara» hasta
            # varios segundos, que es la deriva que describe CLAUDE.md.
            # …salvo que no haya ninguna. Un `broll_plan` VACÍO se sella en
            # reloj de origen a propósito —para que el de otra pieza no
            # sobreviva en build/— y exigirle salida paraba la portada de
            # toda pieza sin B-Roll, que son casi todas. Cero escenas no
            # tienen reloj: no hay tiempo que traducir mal.
            if bp.get("escenas"):
                reloj.exige_reloj(bp, "salida", "portada.py",
                                  "python3 scripts/generate_google_assets.py")
            escenas = [(float(e["t"]), float(e["t"]) + float(e.get("dur", 0.0)))
                       for e in bp.get("escenas", []) if "t" in e]
    else:
        print("  · sin plan: no puedo saber si un gráfico está entrando a "
              "medio fundido, ni si el A-Roll está tapado por B-Roll. "
              "Pásamelo con  --plan build/plan.json", file=sys.stderr)

    puntua(filas, capas, face, keep, (W_v, H_v, W_src, H_src), escenas)

    if args.detalle:
        print("    t     nitidez  contr  rostro  gráfico  estado                  punt")
        for f in sorted(filas, key=lambda x: x["i"]):
            print("  %5.3f  %8.1f  %5.0f  %6.2f  %+7.2f  %-20s  %.3f"
                  % (f["t"], f["nitidez"], f["contraste"], f["rostro"],
                     f["grafico"], f["estado"], f["punt"]))
        print("")

    mejor = elige(filas, solo_copy=args.titular)
    if mejor is None:
        print("ninguna candidata de los primeros %.2f s tiene una tarjeta con "
              "copy asentada.\n"
              "  Amplía la ventana:  python3 scripts/portada.py --input %s "
              "--titular --segundos %.0f"
              % (args.segundos, args.input, args.segundos * 2), file=sys.stderr)
        return 1

    pieza = os.path.splitext(os.path.basename(args.input))[0]
    destino = args.salida or os.path.join(
        RAIZ, "renders", "%s-portada%s.jpg"
        % (pieza, "-titular" if args.titular else ""))
    os.makedirs(os.path.dirname(os.path.abspath(destino)), exist_ok=True)
    q, peso = exporta(args.input, mejor, args.tasa, args.segundos,
                      destino, W_v, H_v, args.limite)

    cero = next((f for f in filas if f["i"] == 0), None)
    absoluto = os.path.abspath(destino)
    print("portada  %s" % (os.path.relpath(absoluto, RAIZ)
                           if absoluto.startswith(RAIZ + os.sep) else absoluto))
    print("  t = %.3f s  (candidata %d de %d)   punt %.3f"
          % (mejor["t"], mejor["i"] + 1, len(filas), mejor["punt"]))
    print("  nitidez %.0f · contraste %.0f · rostro %.2f%s · %s"
          % (mejor["nitidez"], mejor["contraste"], mejor["rostro"],
             " (franja %.0f%% del alto)" % (mejor["talla"] * 100)
             if mejor["talla"] is not None
             else " (no medible: %s)" % ("hay B-Roll en pantalla"
                                         if mejor.get("broll")
                                         else "sin dato de rostro"),
             mejor["estado"]))
    print("  jpeg -q:v %d, %d bytes (%.0f%% del techo de %d KB)"
          % (q, peso, 100.0 * peso / args.limite, args.limite // 1024))
    if cero is not None and cero is not mejor:
        print("  el fotograma 0, que es el que enseña la plataforma sin esto, "
              "puntúa %.3f (%+.0f%%)"
              % (cero["punt"],
                 100.0 * (cero["punt"] - mejor["punt"]) / max(mejor["punt"], 1e-9)))
    if peso > args.limite:
        print("\nno cabe en %d KB ni con -q:v %d: recorta la ventana o sube "
              "--limite" % (args.limite // 1024, CALIDADES[-1]), file=sys.stderr)
        return 1
    if not args.titular and any(f["copy"] for f in filas):
        print("  hay instantes con el titular de la pieza asentado en "
              "pantalla:  --titular")
    return 0


if __name__ == "__main__":
    sys.exit(main())
