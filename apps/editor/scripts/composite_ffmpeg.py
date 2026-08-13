#!/usr/bin/env python3
"""Composición final: un solo pase de ffmpeg con todas las capas.

Orden de apilado (de abajo a arriba):

    1. A-Roll limpio      cortes del original según timeline.keep
    2. B-Rolls (Google)   insertos a pantalla completa en sus instantes
    3. PIP frame          marco neón + badge LIVE + ecualizador
    4. Code mockup        terminal cyber-tech
    5. Kicker HUD         título y caja de función
    6. Pills              badges glassmorphic
    7. Karaoke subs       subtítulos palabra a palabra
    +  audio limpio y SFX mezclados

Se hace en UN pase para no recomprimir capas intermedias: cada
generación perdería detalle en los bordes de las letras.

NOTA sobre este ffmpeg: no trae libass ni libfreetype, así que NO puede
dibujar texto. No es un problema: todo el texto viene ya rasterizado en
los PNG de Playwright.

Uso:
    python3 scripts/composite_ffmpeg.py
    python3 scripts/composite_ffmpeg.py --preview      # 480p rápido
    python3 scripts/composite_ffmpeg.py --dry-run      # solo el comando
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import zlib
import sys

import mezcla
import reloj
import comun
from comun import exige_ffmpeg

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = comun.build_dir()   # `EDITOR_BUILD` lo redirige
ASSETS = os.path.join(RAIZ, "assets")
RENDERS = os.path.join(RAIZ, "renders")
LUT_DEFECTO = os.path.join(ASSETS, "luts", "carbon_bronze.cube")
MAPA_DESP = os.path.join(ASSETS, "mapas", "cristal_displace.png")
# La resolución del binario (entorno > PATH > Homebrew) vive en comun.py:
# era el mismo `os.environ.get(...)` con el default de Homebrew repetido en
# quince scripts, y quince copias es como se desincronizan.
FFMPEG = comun.FFMPEG

ANCHO, ALTO = 1080, 1920   # se sobrescriben con el manifiesto o --formato
FORMATOS = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080)}

# Extensiones de VÍDEO admitidas en `escenas[].files`. La extensión basta
# para bifurcar —el plan lo escriben nuestros scripts y las descargas a mano
# llegan como .mp4/.mov—; sondear el contenedor con ffprobe costaría un
# proceso por escena para responder lo que ya dice el nombre.
EXT_VIDEO = (".mp4", ".mov", ".m4v", ".webm")

# Orden de apilado sobre el A-Roll, de abajo a arriba. Vive en
# guiones/capas.json como DATOS compartidos, no aquí como literal: lo lee
# también validar_plan.py, que antes lo sacaba de ESTE fichero con una
# expresión regular sobre el fuente —para no importar el compositor ni
# arrastrar sus dependencias— y esa regex ataba el formato del código (un
# comentario dentro de los corchetes se colaba como si fuera una capa).
# Un fichero de datos da el mismo desacoplo sin la fragilidad.
#
# Varias entradas pueden compartir plantilla ('diagram'/'tabla' usan
# data-diagram.html, 'kicker'/'kicker2'/'cierre' usan kicker-hud.html): el
# manifiesto indexa por NOMBRE DE CAPA, así que dos instancias necesitan
# nombres distintos. 'fondo' va el primero de todos: es la única plantilla
# opaca y su sitio es debajo de cualquier otra cosa. Las bandas (tarjetas,
# micro-FX, subtítulos, transiciones) están descritas en el propio JSON.
CAPAS_JSON = os.path.join(RAIZ, "guiones", "capas.json")


def cargar_orden(ruta: str = CAPAS_JSON) -> list:
    """La lista de capas del fichero de datos. Falla DICIENDO qué falta:
    sin ORDEN el compositor descartaría todas las capas en silencio, que es
    exactamente el fallo que esta lista existe para impedir."""
    if not os.path.exists(ruta):
        print("falta %s — es el orden de apilado del compositor y del "
              "validador.\n  Lo trae el repo: git checkout guiones/capas.json"
              % ruta, file=sys.stderr)
        raise SystemExit(2)
    with open(ruta, encoding="utf-8") as f:
        return list(json.load(f)["capas"])


ORDEN = cargar_orden()


def cargar(ruta, que):
    if not os.path.exists(ruta):
        print("falta %s — %s" % (ruta, que), file=sys.stderr)
        sys.exit(2)
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


def centro_x_en(face, t0, t1) -> float:
    """Posición horizontal media del rostro en ese tramo del original.

    Devuelve 0.5 si no hay dato: recorte central de toda la vida.
    """
    if not face:
        return 0.5
    xs = []
    for m in face.get("samples", []):
        if m.get("bbox") and t0 - 0.5 <= m["t"] <= t1 + 0.5:
            xs.append((m["bbox"][0] + m["bbox"][2]) / 2.0)
    if not xs:
        xs = [(m["bbox"][0] + m["bbox"][2]) / 2.0
              for m in face.get("samples", []) if m.get("bbox")]
    return sum(xs) / len(xs) if xs else 0.5


def filtro_aroll(keep, ancho, alto, lut=None, face=None, camara=0.0,
                 sufijo="", con_audio=True, solo_audio=False):
    """Corta el A-Roll a los tramos útiles, aplica el LUT y los concatena.

    El LUT va por tramo, antes del concat: aplicarlo después obligaría a
    ffmpeg a rehacer la conversión de espacio de color sobre el material
    ya unido, y en tramos con distinta exposición se nota el salto.

    El recorte a vertical NO es central: se centra en el rostro. Un 16:9
    llevado a 9:16 por el centro geométrico corta media cara en cuanto el
    presentador no está clavado en el eje, que es lo normal.

    `sufijo` y `con_audio` existen para poder pedir la MISMA cadena dos veces
    en el mismo grafo: la cortinilla de `antes-despues.html` necesita el
    metraje sin grading junto al que ya lo lleva, y tienen que coincidir
    fotograma a fotograma. Con la geometría replicada a mano se desalinearían
    en cuanto cambiara el recorte por rostro o el zoom por tramo; llamando dos
    veces a esta función, solo puede diferir lo que se le pasa.

    Que `[0:v]` se referencie desde las dos cadenas no es un problema: ya se
    referencia una vez POR TRAMO en la primera —trece veces en una pieza
    real—, así que ffmpeg ya estaba insertando los split que hicieran falta.
    La segunda no necesita audio: un label de salida sin consumir es un error
    de filtergraph, no un descarte silencioso.
    """
    grade = ",lut3d=file='%s'" % lut.replace("'", r"\'") if lut else ""

    partes_v, partes_a = [], []
    for i, k in enumerate(keep):
        # La etiqueta lleva el sufijo; el índice sigue siendo el índice.
        e = "%s%d" % (sufijo, i)
        a, b = k["src_start"], k["src_end"]
        cx = centro_x_en(face, a, b)
        # in_w/out_w los resuelve ffmpeg tras el escalado; clip evita
        # que el encuadre se salga del material por ningún lado
        # Deriva de cámara: se escala un pelín de más y se recorta con un
        # centro que se mueve muy despacio. Un plano absolutamente fijo
        # delata que el fondo es sintético; 14 px de vaivén en 1080 no se
        # ven conscientemente pero quitan esa sensación de cartón.
        # Zoom POR TRAMO. El A-Roll ya se corta en tramos y se concatena,
        # así que dar a cada uno su escala produce saltos de corte reales
        # —no una rampa— sin ninguna expresión por fotograma: el tamaño de
        # salida es constante y solo cambia cuánto material se recorta.
        z = float(k.get("zoom", 1.0))
        if z != 1.0:
            zw, zh = int(ancho * z), int(alto * z)
            escalado = "scale=%d:%d:force_original_aspect_ratio=increase," % (zw, zh)
            # `setsar=1` NO es opcional: al escalar por un factor no
            # entero ffmpeg deja una relación de píxel tipo 3224:3225, y
            # `concat` exige que todos los tramos coincidan. Sin esto el
            # montaje muere con "parameters do not match" en cuanto se
            # mezclan tramos con y sin zoom.
            recorte = ("crop=%d:%d:"
                       "x='clip(in_w*%.4f-out_w/2,0,in_w-out_w)':"
                       "y='clip((in_h-out_h)*0.42,0,in_h-out_h)',setsar=1"
                       % (ancho, alto, cx))
            # el LUT va en el MISMO punto que en la rama sin zoom: si se
            # aplicara antes o después del escalado, dos tramos contiguos
            # con y sin zoom saldrían con color distinto
            partes_v.append("[0:v]trim=start=%.3f:end=%.3f,setpts=PTS-STARTPTS%s,%s%s[v%s]"
                            % (a, b, grade, escalado, recorte, e))
            if con_audio:
                partes_a.append(
                    "[0:a]atrim=start=%.3f:end=%.3f,asetpts=PTS-STARTPTS%s[a%s]"
                    % (a, b, mezcla.declick(b - a), e))
            continue

        if camara > 0:
            margen = int(ancho * 0.035 * camara)
            escalado = "scale=%d:%d:force_original_aspect_ratio=increase," % (
                ancho + margen * 2, alto + margen * 2)
            recorte = ("crop=%d:%d:"
                       "x='clip((in_w-out_w)*%.4f+sin(t*0.19)*%d,0,in_w-out_w)':"
                       "y='clip((in_h-out_h)/2+cos(t*0.13)*%d,0,in_h-out_h)',setsar=1"
                       % (ancho, alto, cx, margen, int(margen * 0.7)))
        else:
            escalado = "scale=%d:%d:force_original_aspect_ratio=increase," % (
                ancho, alto)
            recorte = ("crop=%d:%d:x='clip(in_w*%.4f-out_w/2,0,in_w-out_w)':y=0,setsar=1"
                       % (ancho, alto, cx))
        partes_v.append(
            "[0:v]trim=start=%.3f:end=%.3f,setpts=PTS-STARTPTS%s,"
            "%s%s[v%s]" % (a, b, grade, escalado, recorte, e))
        if con_audio:
            partes_a.append(
                "[0:a]atrim=start=%.3f:end=%.3f,asetpts=PTS-STARTPTS%s[a%s]"
                % (a, b, mezcla.declick(b - a), e))

    # concat espera las entradas intercaladas [v0][a0][v1][a1]...
    n = len(keep)
    if solo_audio:
        # La cadena de SOLO audio existe para poder MEDIR la sonoridad antes de
        # normalizarla. Con el grafo completo no se puede: sus salidas de vídeo
        # quedarían sin consumir, y un label sin consumir es un error de
        # filtergraph. Es la misma razón por la que existe `con_audio=False`
        # para la cortinilla, por el otro lado.
        entradas = "".join("[a%s%d]" % (sufijo, i) for i in range(n))
        return (";".join(partes_a)
                + ";%sconcat=n=%d:v=0:a=1[aud%s]" % (entradas, n, sufijo))
    if con_audio:
        entradas = "".join("[v%s%d][a%s%d]" % (sufijo, i, sufijo, i)
                           for i in range(n))
        cola = ";%sconcat=n=%d:v=1:a=1[aroll%s][aud%s]" % (
            entradas, n, sufijo, sufijo)
    else:
        entradas = "".join("[v%s%d]" % (sufijo, i) for i in range(n))
        cola = ";%sconcat=n=%d:v=1:a=0[aroll%s]" % (entradas, n, sufijo)
    return ";".join(partes_v + partes_a) + cola


_MARCADOR = re.compile(r"\[@(\d+):a\]")


def _resolver_entradas(grafo: str, base: int) -> str:
    """Convierte los marcadores `[@n:a]` en índices reales de ffmpeg.

    Las entradas de audio se declaran mientras se construye su rama, pero su
    índice depende de cuántas entradas de VÍDEO haya delante, y eso solo se
    sabe al final. Con índices escritos a pelo, añadir una capa de vídeo movía
    todas las entradas de audio una posición y el grafo se construía igual —
    apuntando a otra cosa. Un desplazamiento así no da error: da un vídeo con
    el sonido equivocado.
    """
    return _MARCADOR.sub(lambda m: "[%d:a]" % (base + int(m.group(1))), grafo)


def _medir_lufs(cmd):
    """Sonoridad integrada de una pasada de solo audio. Aborta si no hay medida.

    `ebur128` escribe su resumen a nivel INFO. Con `-v error` el filtro corre y
    la medida se descarta: es la misma trampa que ya está documentada en
    `hacer_sfx.medir()` con `astats`, y la razón de que este comando lleve
    `-v info` aunque no queramos el resto del ruido.

    Antes esto devolvía `None` sin mirar `returncode`, y el llamador respondía
    componiendo SIN normalizar con un aviso que culpaba al filtro `ebur128`.
    O sea: cualquier error real de ffmpeg —un grafo mal montado, una entrada
    rota— acababa disfrazado de «te falta un filtro», y la pieza salía a
    ~-17,6 LUFS para que la plataforma la subiera 3,6 dB a ciegas. Ahora se
    distingue «ffmpeg falló» de «corrió pero no dejó la medida» y en los dos
    casos se aborta: componer sin máster se pide con `--sin-normalizar`, no
    se hereda de un fallo.
    """
    # returncode a mano y no `exige_ok`: hay que separar los dos fallos con
    # mensajes distintos, y los dos rematan con la salida legítima.
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        cola = [l for l in r.stderr.strip().splitlines() if l.strip()][-12:]
        print("ffmpeg falló midiendo LUFS:", file=sys.stderr)
        for linea in cola:
            print("  | %s" % linea, file=sys.stderr)
        print("  para componer sin normalizar (audible: ~3,5 dB por debajo "
              "de plataforma):  --sin-normalizar", file=sys.stderr)
        raise SystemExit(2)
    ultimo = None
    for linea in r.stderr.splitlines():
        m = re.search(r"I:\s*(-?\d+\.?\d*)\s*LUFS", linea)
        if m:
            ultimo = float(m.group(1))
    if ultimo is None:
        print("ffmpeg corrió pero no encontré la medida «I: … LUFS» en su "
              "salida.\n"
              "  Comprueba que este ffmpeg trae el filtro `ebur128`:  "
              "%s -filters | grep ebur128\n"
              "  para componer sin normalizar (audible: ~3,5 dB por debajo "
              "de plataforma):  --sin-normalizar" % FFMPEG, file=sys.stderr)
        raise SystemExit(2)
    return ultimo


def main() -> int:
    # Antes de nada: si falta el binario, decirlo con el comando que
    # lo arregla en vez de reventar con un FileNotFoundError crudo en
    # medio del trabajo.
    exige_ffmpeg("ffmpeg")
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeline", default=os.path.join(BUILD, "timeline.json"))
    ap.add_argument("--layers", default=os.path.join(BUILD, "layers.json"))
    ap.add_argument("--broll", default=os.path.join(BUILD, "broll_plan.json"))
    ap.add_argument("--output", default=os.path.join(RENDERS, "final_output.mp4"))
    ap.add_argument("--sfx", default=os.path.join(ASSETS, "sfx"))
    # NINGUNO por defecto, y es un cambio deliberado. El LUT es el grado de
    # ESTA marca: sobre una pieza propia se quiere, y `piezas.py` y los
    # comandos de CLAUDE.md lo piden explícitamente. Sobre el material de otro
    # es una alteración de su imagen que nadie ha pedido, y llegaba por la
    # puerta de atrás — `solo_subs.py` no pasaba `--lut`, su comentario decía
    # «sin LUT», y los cuatro clips salieron graduados igual porque el defecto
    # se aplicaba solo. Medido: la pared neutra salía beige y la piel más
    # cálida.
    #
    # Un defecto que altera la imagen tiene que pedirse, no evitarse.
    ap.add_argument("--lut", default="none",
                    help="archivo .cube de grading. Por defecto NINGUNO: el "
                         "grado de marca se pide (assets/luts/carbon_bronze.cube)")
    ap.add_argument("--face", default=os.path.join(BUILD, "face.json"),
                    help="datos de rostro para centrar el recorte vertical")
    ap.add_argument("--sin-seguir-rostro", action="store_true",
                    help="recorte central clásico, ignorando el rostro")
    ap.add_argument("--preview", action="store_true",
                    help="540x960 y CRF alto: para revisar rápido")
    ap.add_argument("--aroll", default="completo",
                    choices=["completo", "izquierda", "derecha"],
                    help="dónde va el metraje; con un lado, el otro queda "
                         "libre para los gráficos")
    ap.add_argument("--aroll-ancho", type=float, default=0.56,
                    help="fracción del lienzo que ocupa el metraje cuando "
                         "no es 'completo'")
    ap.add_argument("--formato", default=None, choices=sorted(FORMATOS),
                    help="fuerza el lienzo; por defecto se toma del manifiesto")
    ap.add_argument("--crf", type=int, default=17)
    ap.add_argument("--preset-x264", dest="preset_x264", default="slow",
                    choices=("veryfast", "fast", "medium", "slow", "slower",
                             "veryslow"),
                    help="más lento = mejor calidad por bit")
    ap.add_argument("--hw", action="store_true",
                    help="codificar con h264_videotoolbox (rápido, algo menos fino)")
    ap.add_argument("--sfx-vol", type=float, default=0.55,
                    help="volumen general de los efectos")
    ap.add_argument("--ducking", type=float, default=0.95,
                    help="cuánto se aparta la voz bajo los golpes (0 = nada)")
    ap.add_argument("--max-sfx", type=int, default=24)
    ap.add_argument("--lecho", type=float, default=0.5,
                    help="volumen del lecho ambiental (0 = sin lecho)")
    ap.add_argument("--sin-sfx", action="store_true")
    ap.add_argument("--camara", type=float, default=0.0,
                    help="deriva lenta de cámara sobre el A-Roll (0 = plano fijo)")
    ap.add_argument("--mapa-desplazamiento", default=MAPA_DESP,
                    help="PNG de turbulencia para la refracción del cristal")
    ap.add_argument("--cama", type=float, default=mezcla.CAMA_DEFECTO,
                    help="volumen de la cama armónica (0 = sin música). El "
                         "defecto está CALIBRADO midiendo los valles de las "
                         "pausas con ebur128 — ver mezcla.CAMA_DEFECTO")
    ap.add_argument("--lufs", type=float, default=-14.0,
                    help="sonoridad integrada objetivo. Reels, Shorts y TikTok "
                         "normalizan alrededor de -14 LUFS")
    ap.add_argument("--techo-dbtp", type=float, default=mezcla.TECHO_DEFECTO,
                    help="techo del limitador de master, en dBFS. El defecto "
                         "es -1.2 y no -1.0 porque el AAC sobrepasa 0,2 dB")
    ap.add_argument("--sin-normalizar", action="store_true",
                    help="no medir ni ajustar la sonoridad del master. Es la "
                         "ÚNICA vía de componer sin máster: si la medida "
                         "falla, el compositor aborta en vez de avisar y "
                         "seguir — 3,5 dB de diferencia son audibles y el "
                         "fallo se disfrazaba de éxito")
    ap.add_argument("--solo-audio", action="store_true",
                    help="renderiza SOLO el master de audio (0,2 s). Para "
                         "medir y para escuchar sin esperar el video")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    mapa_desp = args.mapa_desplazamiento

    tl = cargar(args.timeline, "ejecuta antes clean_transcript.py")
    capas = cargar(args.layers, "ejecuta antes render_playwright.js")
    # El manifiesto trae `dir`/`mask` RELATIVOS a su raíz (los absolutos de
    # un layers.json anterior se aceptan tal cual): se resuelven UNA vez
    # aquí y el resto del compositor sigue trabajando con rutas absolutas.
    capas = comun.resolver_manifiesto(
        capas, os.path.dirname(os.path.abspath(args.layers)))

    fps = capas.get("fps", 30)
    # El lienzo sale del MANIFIESTO: lo escribe quien renderizó, así que
    # componer no puede desalinearse del render aunque se olvide la opción.
    # `--formato` solo manda si se pide explícitamente.
    base_a, base_h = ANCHO, ALTO
    if args.formato:
        base_a, base_h = FORMATOS[args.formato]
    elif capas.get("ancho") and capas.get("alto"):
        base_a, base_h = capas["ancho"], capas["alto"]
    ancho, alto = ((base_a // 2, base_h // 2) if args.preview
                   else (base_a, base_h))
    escala_capa = ancho != ANCHO

    fuente = tl["source"]
    if not os.path.exists(fuente):
        print("no encuentro el vídeo original: %s" % fuente, file=sys.stderr)
        return 2

    lut = None
    if args.lut and args.lut.lower() != "none":
        if os.path.exists(args.lut):
            lut = os.path.abspath(args.lut)
        else:
            print("aviso: no existe el LUT %s — se compone sin grading.\n"
                  "       Genéralo con: python3 scripts/make_lut.py" % args.lut,
                  file=sys.stderr)

    face = None
    if not args.sin_seguir_rostro and os.path.exists(args.face):
        with open(args.face, encoding="utf-8") as f:
            face = json.load(f)
        if not face.get("con_rostro"):
            face = None

    # ---------------- ¿hay una cortinilla en el montaje? ----------------
    # Una capa `cortinilla` no se pinta encima del metraje: revela OTRA cosa
    # por debajo de su silueta. Y esa otra cosa puede ser de dos clases, que
    # hay que decidir antes de construir el grafo:
    #
    #   con `imagen`  la captura, el diseño viejo, el diff… lo que se compara
    #                 con lo que estás contando. Es la comparación que de
    #                 verdad hace una pieza técnica.
    #   sin `imagen`  una segunda cadena de A-Roll sin LUT, o sea el propio
    #                 metraje sin grading.
    #
    # El revelado sin imagen nació primero y **con este material casi no se
    # ve**: medido sobre la pieza real, el LUT de marca cambia la imagen una
    # mediana de 5/255 —un 2 %—, porque la cámara ya entrega S-Cinetone y al
    # grado le queda poco que hacer. No es un fallo del mecanismo: con un LUT
    # fuerte se lee de sobra. Es que «con grading frente a sin grading» era la
    # comparación equivocada para este pipeline. Se conserva porque el día que
    # se use un look fuerte sirve, y porque es el único revelado que no
    # necesita ningún asset.
    cortinillas = [c for c in capas["capas"] if c.get("cortinilla")]

    # Las que revelan una imagen se resuelven aparte: no dependen del LUT ni
    # del modo de encuadre, así que ninguno de los dos avisos les aplica.
    def ruta_imagen(c):
        p = c.get("imagen")
        if not p:
            return None
        return p if os.path.isabs(p) else os.path.join(RAIZ, p)

    faltan = [c for c in cortinillas
              if c.get("imagen") and not os.path.exists(ruta_imagen(c))]
    for c in faltan:
        print("aviso: la cortinilla «%s» revela una imagen que no existe: %s\n"
              "       Se compone sin revelado; el canto y el tirador sí salen."
              % (c["capa"], ruta_imagen(c)), file=sys.stderr)
    cortinillas = [c for c in cortinillas if c not in faltan]

    con_imagen = [c for c in cortinillas if c.get("imagen")]
    con_metraje = [c for c in cortinillas if not c.get("imagen")]

    # Los dos casos en los que el revelado POR METRAJE no se puede, con su
    # aviso: sin LUT los dos lados serían el mismo píxel —la cortinilla se
    # vería moverse sin revelar nada, que es peor que no ponerla porque parece
    # que funciona—; y con el metraje en columna (`--aroll izquierda|derecha`)
    # el lado crudo tendría que repetir el escalado, el relleno difuminado y el
    # overlay de la columna, y cualquier diferencia se vería como un salto en
    # el canto. Ninguno de los dos afecta al revelado por imagen.
    if con_metraje and not lut:
        print("aviso: la cortinilla (%s) revela METRAJE y se compone SIN LUT, "
              "así que los dos\n"
              "       lados serían idénticos. Se omite el revelado; el canto y "
              "el tirador sí salen.\n"
              "       Arréglalo con --lut, o dale una imagen que revelar:\n"
              "         \"imagen\": \"assets/broll/captura.png\""
              % ", ".join(c["capa"] for c in con_metraje), file=sys.stderr)
        con_metraje = []
    if con_metraje and args.aroll != "completo":
        print("aviso: la cortinilla (%s) revela METRAJE y necesita --aroll "
              "completo; con el\n"
              "       metraje en columna el lado crudo no coincidiría en el "
              "canto. Se omite el revelado."
              % ", ".join(c["capa"] for c in con_metraje), file=sys.stderr)
        con_metraje = []

    cmd = [FFMPEG, "-nostdin", "-y", "-hide_banner", "-i", fuente]
    filtros = [filtro_aroll(tl["keep"], ancho, alto, lut, face, args.camara)]
    ultimo = "aroll"

    # El mismo corte, el mismo recorte por rostro y el mismo zoom por tramo;
    # lo único que cambia es que no pasa por el LUT. Es lo que hace que el
    # «antes» sea el material de verdad y no una imitación del material.
    crudos = {}
    if con_metraje:
        filtros.append(filtro_aroll(tl["keep"], ancho, alto, None, face,
                                    args.camara, sufijo="cr", con_audio=False))
        # Una sola cadena cruda alimenta todas las cortinillas de la pieza, y
        # un label solo se puede consumir una vez: se reparte con split.
        if len(con_metraje) > 1:
            salidas = "".join("[crudo%d]" % i for i in range(len(con_metraje)))
            filtros.append("[arollcr]split=%d%s" % (len(con_metraje), salidas))
            crudos = {c["capa"]: "crudo%d" % i
                      for i, c in enumerate(con_metraje)}
        else:
            crudos = {con_metraje[0]["capa"]: "arollcr"}

    # Las imágenes se añaden como entradas dentro del bucle de capas, donde ya
    # se lleva la cuenta de `idx`. Aquí solo se anota cuáles hay.
    imagenes = {c["capa"]: ruta_imagen(c) for c in con_imagen}
    ajustes = {c["capa"]: c.get("ajuste", "cubrir") for c in con_imagen}

    # Cuánto dura la pieza montada. La imagen del revelado se acota a esto:
    # `-loop 1` a secas es una entrada INFINITA y, como `alphamerge` espera a
    # que terminen todas sus entradas, la codificación no acaba nunca. No da
    # error ni avisa — se queda ahí. Medido: diez minutos sin escribir un
    # fotograma más.
    #
    # Se le da la duración entera y no la de su capa, para que su reloj
    # coincida con el del A-Roll: la máscara viene desplazada a `t0` y si la
    # imagen empezara en 0 con una duración corta, `alphamerge` las emparejaría
    # descolocadas. Que la imagen exista fuera de su ventana no cuesta nada
    # porque el `enable=` del overlay ya decide cuándo se ve.
    fin_pieza = float(tl["keep"][-1]["out_end"]) if tl.get("keep") else 0.0

    # ---------------- colocación del metraje ----------------
    # Cuando el plano es tan cerrado que el rostro no deja hueco —medido:
    # 73 % del ancho y 95 % del alto en el clip de prueba—, mover los
    # gráficos no resuelve nada: no hay dónde. Lo que resuelve es HACER
    # sitio, metiendo el metraje en una columna y dejando la otra libre.
    # Así la ausencia de colisión es estructural, no una cuestión de
    # afinar coordenadas.
    if args.aroll != "completo":
        aw = max(1, int(ancho * args.aroll_ancho) // 2 * 2)
        ax = ancho - aw if args.aroll == "derecha" else 0
        # split porque el mismo flujo alimenta la columna y el relleno;
        # un label de ffmpeg solo se puede consumir una vez
        filtros.append("[%s]split=2[arA][arB]" % ultimo)
        filtros.append(
            "[arA]scale=%d:%d:force_original_aspect_ratio=increase,"
            "crop=%d:%d[arec]" % (aw, alto, aw, alto))
        # el hueco se rellena con el propio metraje muy difuminado: un
        # plano liso al lado de vídeo se ve como un error de render
        filtros.append(
            "[arB]scale=%d:%d:force_original_aspect_ratio=increase,"
            "crop=%d:%d,gblur=sigma=60,eq=brightness=-0.10:saturation=0.7[arfondo]"
            % (ancho, alto, ancho, alto))
        filtros.append("[arfondo][arec]overlay=%d:0[arcol]" % ax)
        ultimo = "arcol"
    idx = 1   # 0 es el A-Roll

    # ---------------- B-Rolls de Google GenAI ----------------
    brolls = []
    if os.path.exists(args.broll):
        with open(args.broll, encoding="utf-8") as f:
            plan = json.load(f)
        # `escenas[].t` es absoluto y se usa tal cual para colocar el overlay,
        # así que tiene que estar en el reloj de la pieza YA recortada. Con
        # escenas en reloj de origen el B-Roll aparece tarde y cada vez más
        # tarde. Es el mismo fallo de los subtítulos por otra ruta, y la única
        # que llega hasta aquí.
        if plan.get("escenas"):
            reloj.exige_reloj(plan, "salida", "composite_ffmpeg.py",
                              ".venv/bin/python scripts/silencios.py --aplicar")
        for e in plan.get("escenas", []):
            for ruta in (e.get("files") or []):
                if os.path.exists(ruta):
                    brolls.append((ruta, e["t"], e.get("dur", 2.5)))
                    break

    for ruta, t0, dur in brolls:
        etq = "br%d" % idx
        if os.path.splitext(ruta)[1].lower() in EXT_VIDEO:
            # `-loop 1` es una opción del demuxer de IMÁGENES: sobre un .mp4
            # ffmpeg la rechaza con «Option loop not found» y exit 8 — un
            # solo vídeo local en `escenas[].files` tumbaba la composición
            # ENTERA. El vídeo entra SIN loop, acotado con `-t` de ENTRADA
            # (solo se decodifica lo que se usa) y con `-an`: su pista de
            # audio no pinta nada aquí, la voz sigue siendo la del A-Roll.
            # `-an` no mueve los índices de entrada —un fichero es UNA
            # entrada tenga las pistas que tenga—, así que los marcadores
            # `[@n:a]` del audio no se descolocan.
            cmd += ["-an", "-t", "%.3f" % dur, "-i", ruta]
            # El mismo `increase`+crop del A-Roll recorta un 16:9 a 9:16
            # tirando los laterales: de un 3840x2160 sobreviven 1215 de los
            # 3840 px de ancho. Es lo correcto —estirarlo lo aplastaría—,
            # pero conviene saberlo al elegir el clip: el motivo tiene que
            # vivir en el centro del encuadre. Sin el 1.06 de los stills
            # (un vídeo ya se mueve solo) y sin `fps=` en la rama: `overlay`
            # emite al ritmo de su entrada PRINCIPAL, así que un clip a
            # 60 fps sobre el A-Roll sale a la cadencia del A-Roll y el
            # `-r` global de la salida remata la CFR — verificado componiendo
            # este mismo clip de 60 fps: la salida mantiene sus 30 fps. Si el
            # clip es más corto que la escena, el `eof_action=repeat` por
            # defecto del overlay sostiene su último fotograma hasta que
            # `enable` cierra la ventana.
            filtros.append(
                "[%d:v]scale=%d:%d:force_original_aspect_ratio=increase,"
                "crop=%d:%d,format=yuva420p,fade=t=in:st=0:d=0.25:alpha=1,"
                "fade=t=out:st=%.3f:d=0.25:alpha=1,"
                "setpts=PTS-STARTPTS+%.3f/TB[%s]"
                % (idx, ancho, alto, ancho, alto,
                   max(0.0, dur - 0.25), t0, etq))
        else:
            cmd += ["-loop", "1", "-t", "%.3f" % dur, "-i", ruta]
            # ligero zoom lento: un still fijo canta mucho en vídeo
            filtros.append(
                "[%d:v]scale=%d:%d:force_original_aspect_ratio=increase,"
                "crop=%d:%d,format=yuva420p,fade=t=in:st=0:d=0.25:alpha=1,"
                "fade=t=out:st=%.3f:d=0.25:alpha=1,setpts=PTS-STARTPTS+%.3f/TB[%s]"
                % (idx, int(ancho * 1.06), int(alto * 1.06), ancho, alto,
                   max(0.0, dur - 0.25), t0, etq))
        filtros.append("[%s][%s]overlay=0:0:enable='between(t,%.3f,%.3f)'[bg%d]"
                       % (ultimo, etq, t0, t0 + dur, idx))
        ultimo = "bg%d" % idx
        idx += 1

    # ---------------- capas de motion graphics ----------------
    por_nombre = {c["capa"]: c for c in capas["capas"]}

    # Una capa renderizada que no esté en ORDEN se descartaría en silencio y
    # el vídeo saldría sin ella sin que nada lo delate. Es exactamente lo que
    # pasó con 'fondo', y volvería a pasar con cada componente nuevo que se
    # olvide registrar aquí.
    # ORDEN es un orden de TIPOS de componente, no de instancias. El
    # director genera un nombre único por aparición (`pollrating_21`), así
    # que la posición se resuelve por la PLANTILLA de la capa y solo se cae
    # al nombre cuando el plan es de los escritos a mano.
    def rango(capa):
        tpl = str(capa.get("template", "")).replace(".html", "")
        alias = tpl.replace("-", "")
        for clave in (capa["capa"], tpl, alias):
            if clave in ORDEN:
                return ORDEN.index(clave)
        return None

    huerfanas = [c["capa"] for c in capas["capas"] if rango(c) is None]
    if huerfanas:
        print("AVISO: estas capas están renderizadas pero NO en ORDEN, así que\n"
              "no aparecerán en el vídeo: %s\n"
              "Añádelas a ORDEN en guiones/capas.json."
              % ", ".join(sorted(huerfanas)), file=sys.stderr)

    # Una capa del manifiesto sin fotogramas en disco ABORTA. El aviso por
    # stderr que había aquí no bastaba: el bucle de abajo hacía `continue`,
    # el resumen declaraba `capas_motion` contando la lista de ANTES del
    # filtro, y la cadena acababa con exit 0 — medido: «capas_motion: 10»
    # con 9 entradas reales en el grafo. Pasó de verdad: un vídeo salió sin
    # la capa del code-mockup y todo terminó «bien». Aplica también con
    # --dry-run: un preflight que calla el fallo no es un preflight.
    #
    # La excepción es --solo-audio: el máster se mide sobre un grafo sin
    # vídeo y los cues salen de capas[].cues del manifiesto, no de los PNG.
    # Abortar ahí bloqueaba el atajo documentado de escuchar la mezcla sin
    # esperar al render de fotogramas.
    sin_frames = [] if args.solo_audio else [
        c["capa"] for c in capas["capas"]
        if not c.get("dir") or not os.path.isdir(c["dir"])]
    if sin_frames:
        print("faltan los fotogramas de: %s\n"
              "  lo arregla:  node scripts/render_playwright.js "
              "--plan build/plan.json --only %s\n"
              "  (--only FUSIONA el manifiesto, no lo reemplaza: las demás "
              "capas se conservan)"
              % (", ".join(sorted(sin_frames)), ",".join(sorted(sin_frames))),
              file=sys.stderr)
        raise SystemExit(2)

    # Se ordenan por tipo y, dentro del mismo tipo, por instante: dos
    # apariciones del mismo componente tienen que respetar su cronología.
    ordenadas = sorted((c for c in capas["capas"] if rango(c) is not None),
                       key=lambda c: (rango(c), c.get("t", 0)))
    # `en_grafo` cuenta lo que este bucle mete DE VERDAD en el grafo, y es lo
    # que el resumen declara como `capas_motion`. Contar `ordenadas` era
    # contar intenciones: cuando una capa sin fotogramas se saltaba con
    # `continue`, el número mentía. Hoy esa capa aborta arriba y el guardián
    # del bucle sobra, pero la cuenta se queda pegada a los overlays para que
    # ningún filtro futuro vuelva a separar lo declarado de lo compuesto.
    en_grafo = 0
    for capa in ordenadas:
        nombre = capa["capa"]
        t0 = capa["t"]
        t1 = t0 + capa["dur"]

        # ---- refracción del cristal ----
        # ---- paralaje ----
        # Cada capa deriva a su propio ritmo. Sin esto todas las capas están
        # clavadas al mismo plano y la composición se ve como una diapositiva
        # con cosas encima; con esto hay profundidad aunque el metraje esté
        # quieto. La amplitud es de píxeles, no de porcentaje: pasarse de 30
        # ya se lee como un fallo de encuadre.
        #
        # Se calcula AQUÍ, antes del cristal, porque la máscara y el mapa de
        # refracción tienen que desplazarse EXACTAMENTE igual que la capa. Si
        # no, el panel viaja y su propio agujero difuminado se queda quieto:
        # el halo asoma por un lado y el cristal se despega de lo que refracta.
        par = float(capa.get("parallax", 0.0))
        if escala_capa:
            par *= ancho / float(ANCHO)
        px = py = "0"
        if par:
            # El desfase por capa evita que todas oscilen a la vez. Se
            # calcula con crc32 y NO con hash(): Python aleatoriza el hash
            # de cadenas en cada proceso, así que la fase cambiaba en cada
            # composición y dos montajes del mismo plan NO daban los mismos
            # fotogramas. Todo el proyecto se apoya en lo contrario.
            #
            # `faseCon` permite que una capa comparta desfase con otra: una
            # anotación anclada a la cifra tiene que oscilar EXACTAMENTE
            # igual que la cifra, o se despega de lo que señala.
            semilla = capa.get("faseCon") or nombre
            fase = (zlib.crc32(semilla.encode("utf-8")) % 100) / 100.0 * 6.283
            px = "sin(t*0.33+%.3f)*%.1f" % (fase, par)
            py = "cos(t*0.24+%.3f)*%.1f" % (fase, par * 0.6)

        def arrastra(cad, ancho=ancho, alto=alto):
            """Desplaza un flujo por el mismo paralaje que la capa.
            Se acolcha y se recorta con desplazamiento negativo: `crop`
            admite expresiones con `t`, pero no puede salirse del cuadro,
            así que primero hay que darle margen por los cuatro lados."""
            if not par:
                return cad
            m = int(abs(par)) + 2
            return (cad + ",pad=%d:%d:%d:%d:color=black@0"
                        ",crop=%d:%d:x='%d-(%s)':y='%d-(%s)'"
                    % (ancho + 2 * m, alto + 2 * m, m, m,
                       ancho, alto, m, px, m, py))

        # backdrop-filter no sobrevive a omitBackground: al capturar sobre
        # transparencia no hay píxeles que muestrear. La refracción se hace
        # aquí, difuminando el metraje y recortándolo con la silueta que la
        # plantilla emitió en su segunda pasada.
        if capa.get("mask") and os.path.isdir(capa["mask"]):
            cmd += ["-framerate", str(capa.get("fps") or fps), "-i",
                    os.path.join(capa["mask"], "%05d.png")]
            emk = "mk%d" % idx
            cadena = "[%d:v]format=rgba" % idx
            if escala_capa:
                # El format=rgba se REPITE tras el scale a propósito: al
                # escalar, ffmpeg puede negociar un formato sin alfa y
                # alphaextract se queda sin canal que extraer, muriendo con
                # un "could not choose their formats" que no dice nada. Solo
                # se manifestaba en --preview, que es donde hay scale.
                cadena += ",scale=%d:%d,format=rgba" % (ancho, alto)
            cadena = arrastra(cadena)
            cadena += ",setpts=PTS-STARTPTS+%.3f/TB,alphaextract[%s]" % (t0, emk)
            filtros.append(cadena)

            # El índice de la máscara identifica TODAS las etiquetas de este
            # bloque. Es imprescindible fijarlo aquí: si se incrementa idx a
            # mitad (al añadir el mapa de desplazamiento como nueva entrada),
            # las etiquetas dejan de casar entre sí y ffmpeg falla con un
            # escueto "Error binding filtergraph inputs/outputs".
            g = idx
            idx += 1

            # ---- cortinilla: el lado «antes» es el metraje SIN grading ----
            # Mismo mecanismo que el cristal —silueta, alphamerge, overlay— y
            # tratamiento distinto. Aquí NO hace falta el split de `ultimo`: el
            # «antes» no se deriva de lo que ya hay difuminándolo, es otra
            # cadena de A-Roll. Que sea el material de verdad y no una
            # imitación es todo el valor del componente: un «antes» falseado
            # bajando la saturación demuestra el efecto que se le aplique, no
            # el grading que lleva la pieza.
            if nombre in crudos or nombre in imagenes:
                if nombre in imagenes:
                    # `-loop 1` porque es un fotograma fijo y el revelado dura
                    # segundos: sin él la entrada se agota en el primero y el
                    # alphamerge se queda sin pareja a partir de ahí.
                    # `-t` NO es opcional: ver el comentario de `fin_pieza`.
                    cmd += ["-loop", "1", "-t", "%.3f" % max(fin_pieza, t1),
                            "-i", imagenes[nombre]]
                    # Se escala al lienzo, no al tamaño de la imagen: el
                    # alphamerge exige que los dos flujos midan lo mismo, y en
                    # `--preview` el lienzo es la mitad.
                    #
                    # `cubrir` llena el cuadro y recorta lo que sobra; es el
                    # defecto porque una captura con bandas al lado del metraje
                    # se lee como un error de montaje. `contener` cabe entera
                    # sobre el fondo de marca, para cuando lo que importa es
                    # ver la captura completa y no que case con el plano.
                    if ajustes.get(nombre) == "contener":
                        enc = ("scale=%d:%d:force_original_aspect_ratio=decrease,"
                               "pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=0x121212"
                               % (ancho, alto, ancho, alto))
                    else:
                        enc = ("scale=%d:%d:force_original_aspect_ratio=increase,"
                               "crop=%d:%d" % (ancho, alto, ancho, alto))
                    # La imagen NO pasa por el LUT: es un asset, no metraje.
                    # Graduar una captura de pantalla la tiñe de bronce y deja
                    # de ser la captura.
                    filtros.append("[%d:v]format=rgb24,%s,setsar=1[img%d]"
                                   % (idx, enc, g))
                    fuente_antes = "img%d" % g
                    idx += 1
                else:
                    fuente_antes = crudos[nombre]

                filtros.append("[%s][%s]alphamerge[an%d]"
                               % (fuente_antes, emk, g))
                filtros.append(
                    "[%s][an%d]overlay=0:0:enable='between(t,%.3f,%.3f)'[wp%d]"
                    % (ultimo, g, t0, t1, g))
                ultimo = "wp%d" % g

            else:
                sigma = float(capa.get("blur", 26))
                sat = float(capa.get("sat", 1.8))
                desp = float(capa.get("desplazar", 0.0))
                if escala_capa:                 # en preview el blur va a escala
                    sigma *= ancho / float(ANCHO)
                    desp *= ancho / float(ANCHO)
                filtros.append("[%s]split=2[bs%d][bl%d]" % (ultimo, g, g))
                filtros.append(
                    "[bl%d]gblur=sigma=%.2f,eq=saturation=%.2f:brightness=0.03[bb%d]"
                    % (g, sigma, sat, g))

                fuente_cristal = "bb%d" % g
                # ---- desplazamiento: el cristal DOBLA la luz, no solo la difumina ----
                # Sin esto el efecto se queda en plástico esmerilado. El mapa
                # lleva 128 = neutro; se comprime su rango para que el
                # desplazamiento sea de unos pocos píxeles y no una ola.
                if desp > 0 and os.path.exists(mapa_desp):
                    cmd += ["-loop", "1", "-i", mapa_desp]
                    emap = "dm%d" % g
                    # El mapa se arrastra con la capa. Fijo en coordenadas de
                    # pantalla, el dibujo de la refracción se queda quieto
                    # mientras el cristal pasa por encima: se lee como un
                    # estampado, no como un vidrio.
                    cad_mapa = (
                        "[%d:v]format=rgb24,scale=%d:%d,"
                        "lutrgb=r='128+(val-128)*%.3f':"
                        "g='128+(val-128)*%.3f':"
                        "b='128+(val-128)*%.3f'"
                        % (idx, ancho, alto, desp, desp, desp))
                    # el neutro del mapa es 128, no negro: al acolchar hay que
                    # rellenar con gris medio o el borde desplazaría a saco
                    cad_mapa = arrastra(cad_mapa).replace(
                        "color=black@0", "color=0x808080")
                    filtros.append(cad_mapa + ",split=2[%sx][%sy]" % (emap, emap))
                    idx += 1
                    filtros.append(
                        "[%s][%sx][%sy]displace=edge=smear[dp%d]"
                        % (fuente_cristal, emap, emap, g))
                    fuente_cristal = "dp%d" % g

                filtros.append("[%s][%s]alphamerge[cr%d]"
                               % (fuente_cristal, emk, g))
                filtros.append(
                    "[bs%d][cr%d]overlay=0:0:enable='between(t,%.3f,%.3f)'[gl%d]"
                    % (g, g, t0, t1, g))
                ultimo = "gl%d" % g

        patron = os.path.join(capa["dir"], "%05d.png")
        # Cada secuencia entra a SU frecuencia; ffmpeg sostiene los
        # fotogramas de las capas lentas hasta la siguiente. Usar el fps
        # global para todas haría que una capa renderizada a 4 fps se
        # reprodujera seis veces más rápido de lo que dura.
        cmd += ["-framerate", str(capa.get("fps") or fps), "-i", patron]
        etq = "l%d" % idx
        cadena = "[%d:v]format=rgba" % idx
        if escala_capa:
            cadena += ",scale=%d:%d" % (ancho, alto)
        # Escala de CAPA. Desplazar un gráfico a una columna no basta: las
        # plantillas se maquetan contra el lienzo entero, así que al
        # moverlas se salen por el borde. Encogerlas a la fracción de la
        # columna las hace caber sin tocar ni una plantilla, y el `dx` que
        # ya se calcula lleva su centro al centro de la columna.
        k = float(capa.get("escala", 1.0))
        if k != 1.0:
            cadena += ",scale=iw*%.4f:ih*%.4f,format=rgba" % (k, k)
        cadena += ",setpts=PTS-STARTPTS+%.3f/TB[%s]" % (t0, etq)
        filtros.append(cadena)

        # ---- paralaje ----
        # Cada capa deriva a su propio ritmo. Sin esto todas las capas están
        # clavadas al mismo plano y la composición se ve como una diapositiva
        # con cosas encima; con esto hay profundidad aunque el metraje esté
        # quieto. La amplitud es de píxeles, no de porcentaje: pasarse de 30
        # ya se lee como un fallo de encuadre.
        # Desplazamiento fijo por capa. Las plantillas se centran en el
        # lienzo; cuando el metraje ocupa una columna, los gráficos tienen
        # que vivir en la otra. Resolverlo aquí vale para TODAS las
        # plantillas a la vez, en vez de añadir una `x` a cada una.
        dx = float(capa.get("dx", 0.0))
        dy = float(capa.get("dy", 0.0))
        if escala_capa:
            dx *= ancho / float(base_a); dy *= alto / float(base_h)
        if par:
            pos = "x='%s%+.1f':y='%s%+.1f'" % (px, dx, py, dy)
        elif dx or dy:
            pos = "x=%.0f:y=%.0f" % (dx, dy)
        else:
            pos = "x=0:y=0"

        filtros.append(
            "[%s][%s]overlay=%s:eof_action=pass:enable='between(t,%.3f,%.3f)'[ov%d]"
            % (ultimo, etq, pos, t0, t1, idx))
        ultimo = "ov%d" % idx
        idx += 1
        en_grafo += 1

    # ---------------- audio ----------------
    # Toda la rama de audio se construye en una lista APARTE de la de vídeo,
    # y no por orden: es lo que permite pedir el grafo de solo audio para
    # medir la sonoridad antes de normalizarla (ver «el máster» más abajo).
    # El grafo completo no vale para eso porque sus salidas de vídeo quedarían
    # sin consumir, y un label sin consumir es un error de filtergraph.
    faudio, entradas_audio = [], []

    # Los actos, si el plan los escribió. Antes no los escribía nadie: vivían
    # en `escaleta.informe()`, que se imprime y se pierde. Se cargan AQUÍ
    # porque los usan dos ramas: la cama (volumen por actos) y los cues de
    # frontera de justo abajo.
    actos = (tl.get("actos") or {}).get("tramos") or []

    # ---- cues de frontera: los saltos de cámara del montaje ----
    # Los dos saltos de zoom de la pieza real eran MUDOS: los cues nacen en
    # las plantillas (`capas[].cues`) y el zoom por tramo vive en
    # `keep[].zoom`, donde ninguna plantilla mira. Se sintetizan aquí, de lo
    # que el compositor ya tiene —las fronteras de `keep` y los actos, los dos
    # en reloj de salida—. La regla y sus dos casos reales medidos (riser +
    # barrido en 3,78 s; solo barrido en 33,9 s) viven en
    # `mezcla.cues_de_frontera`. Entran por `recolectar` como una capa más
    # para pasar por los MISMOS controles que un cue de plantilla: fichero
    # que no existe → aviso, no silencio.
    if args.sin_sfx:
        sinteticos, avisos_frontera = [], []
    else:
        existentes = [c for cp in capas["capas"] for c in (cp.get("cues") or [])]
        sinteticos, avisos_frontera = mezcla.cues_de_frontera(
            tl["keep"], actos, existentes)
    capas_con_cues = capas["capas"] + (
        [{"capa": "fronteras", "cues": sinteticos}] if sinteticos else [])

    cues, avisos = mezcla.recolectar(capas_con_cues, args.sfx)
    for a in avisos_frontera + avisos:
        # El `if os.path.exists(...)` sin `else` que había aquí descartaba en
        # SILENCIO un cue con el nombre mal escrito. Es el mismo patrón que el
        # repo ya castigó con las capas fuera de ORDEN.
        print("  ⚠ %s" % a, file=sys.stderr)
    if args.sin_sfx:
        cues = []
    cues, aviso = mezcla.truncar(cues, args.max_sfx)
    if aviso:
        print("aviso: %s" % aviso, file=sys.stderr)

    # ---- fondo: la cama y el lecho ----
    # Van ANTES que los golpes para que el ducking actúe sobre la mezcla
    # completa, y sus fundidos van AQUÍ y no dentro del `.wav`: `lecho.wav`
    # los llevaba dentro y se reproduce en bucle, así que el fondo se caía a
    # nada una vez cada cuatro segundos —nueve veces y media en una pieza de
    # 38 s—. Un fondo que late no es un fondo.
    #
    # La CAMA es lo que hace que la pieza deje de «sonar a nada», que es como
    # abre el ROADMAP. El lecho nunca lo arregló y no podía: medido, se queda
    # 4,8 dB por DEBAJO del suelo del propio A-Roll, o sea enmascarado en todos
    # y cada uno de los instantes. Un fondo que la señal tapa siempre es un
    # fichero, no un fondo.
    voz = "aud"
    fondos = []
    for nombre, vol, fin_d, ini_d in (("cama", args.cama, 2.0, 1.5),
                                      ("lecho", args.lecho, 0.5, 0.5)):
        ruta = os.path.join(args.sfx, "%s.wav" % nombre)
        if vol <= 0 or not os.path.exists(ruta):
            continue
        entradas_audio.append(("-stream_loop", "-1", ruta))
        etq = "fondo_%s" % nombre
        # Solo la CAMA sigue a los actos. El lecho no: es un relleno de suelo
        # sin contenido tonal, y hacerle seguir la estructura sería darle una
        # intención que no tiene.
        vexpr = mezcla.volumen_por_actos(actos, vol) if nombre == "cama" else None
        if vexpr:
            v = "volume=volume='%s':eval=frame" % vexpr
        else:
            v = "volume=%.3f" % vol
        faudio.append(
            "[@%d:a]%s,afade=t=in:d=%.2f:curve=qsin,"
            "afade=t=out:st=%.3f:d=%.2f:curve=qsin[%s]"
            % (len(entradas_audio) - 1, v, ini_d,
               max(0.0, fin_pieza - fin_d), fin_d, etq))
        fondos.append("[%s]" % etq)
    if fondos:
        faudio.append("[aud]%samix=inputs=%d:duration=first:normalize=0[conamb]"
                      % ("".join(fondos), len(fondos) + 1))
        voz = "conamb"

    salida_audio = voz
    if cues:
        grupos = mezcla.agrupar(cues)
        # Las variantes se descubren AQUÍ, donde ya se toca el disco, y se
        # pasan como dato: `rama_cues` sigue siendo pura. Siete tecleos byte
        # a byte idénticos en 6,5 s eran la firma de lo sintético; con
        # `tecleo_v2..v4.wav` junto al base, cada aparición rota por módulo
        # (determinista). Sin variantes en disco, el grafo no cambia ni en
        # un label.
        variantes = {sfx: mezcla.variantes_de(lista[0]["ruta"])
                     for sfx, lista in grupos.items()}
        fcues, rutas, _ = mezcla.rama_cues(grupos, 0, args.sfx_vol, fin_pieza,
                                           variantes)
        # Las entradas de los cues se numeran con marcador `@n` y se resuelven
        # al final, cuando ya se sabe cuántas entradas de vídeo hay delante.
        base = len(entradas_audio)
        for i, ruta in enumerate(rutas):
            entradas_audio.append((ruta,))
        for f in fcues:
            for i in range(len(rutas)):
                f = f.replace("[%d:a]" % i, "[@%d:a]" % (base + i))
            faudio.append(f)
        faudio += mezcla.rama_ducking(voz, args.ducking)
        salida_audio = "mix"

    # ---- el máster ----
    # Medido sobre cinco montajes reales: la pieza sale a −17,6 LUFS con el
    # pico en −2,8 dBTP. Reels, Shorts y TikTok normalizan alrededor de −14, o
    # sea que la plataforma SUBE la pieza 3,6 dB a ciegas y sin limitador. El
    # trabajo de mezcla se decide fuera de aquí y no lo controla nadie.
    #
    # Se hace en DOS pasadas, y la primera es de solo audio: construir el mismo
    # grafo sin las ramas de vídeo cuesta **0,19 s medidos** —decodificar el
    # A-Roll, quince `atrim`, el concat, los cues y el sidechain— sobre un
    # render que el propio repo describe como «cuesta minutos». No hay ninguna
    # razón para no medir.
    ganancia_master = None
    if not args.sin_normalizar:
        graf_medida = ";".join(
            [filtro_aroll(tl["keep"], ancho, alto, lut, face, args.camara,
                          solo_audio=True)] + faudio)
        cmd_medida = [FFMPEG, "-nostdin", "-v", "info", "-i", fuente]
        for e in entradas_audio:
            cmd_medida += list(e[:-1]) + ["-i", e[-1]]
        # `ebur128` va DENTRO del grafo y no como `-af`: ffmpeg no admite las
        # dos cosas sobre la misma salida —«-af/-filter and -filter_complex
        # cannot be used together»— y ese error salía disfrazado de «no he
        # podido medir», que suena a que falta el filtro. Costó una vuelta;
        # hoy `_medir_lufs` aborta enseñando el stderr real, precisamente
        # para que esa clase de fallo no vuelva a esconderse.
        graf_medida = _resolver_entradas(graf_medida, 1)
        graf_medida += ";[%s]ebur128=peak=true[medido]" % salida_audio
        cmd_medida += ["-filter_complex", graf_medida,
                       "-map", "[medido]", "-f", "null", "-"]
        # `_medir_lufs` aborta si no hay medida, así que aquí siempre hay
        # número. El `if lufs is None: avisar y seguir` que había convertía
        # cualquier fallo real en una pieza sin máster con exit 0.
        lufs = _medir_lufs(cmd_medida)
        ganancia_master = mezcla.ganancia_para(lufs, args.lufs)
        faudio += mezcla.rama_master(salida_audio, ganancia_master,
                                     args.techo_dbtp)
        salida_audio = "master"
    else:
        # Componer sin máster es legítimo, pero tiene que verse: pedido con
        # el flag y con su consecuencia dicha, no callado.
        print("aviso: --sin-normalizar: se compone sin máster; la pieza sale "
              "a su sonoridad\n       natural (~-17,6 LUFS medidos) y la "
              "plataforma la subirá ~3,6 dB a ciegas.", file=sys.stderr)

    # Las entradas de audio van DETRÁS de las de vídeo, así que sus índices
    # solo se conocen aquí. Se marcaron con `@n` al construirlas.
    for e in entradas_audio:
        cmd += list(e[:-1]) + ["-i", e[-1]]
    filtros += [_resolver_entradas(f, idx) for f in faudio]

    filtro = ";".join(filtros)
    os.makedirs(os.path.dirname(os.path.abspath(args.output)) or ".", exist_ok=True)

    if args.hw:
        video = ["-c:v", "h264_videotoolbox", "-b:v",
                 "6M" if args.preview else "14M"]
    else:
        video = ["-c:v", "libx264",
                 "-preset", "veryfast" if args.preview else args.preset_x264,
                 "-crf", str(28 if args.preview else args.crf),
                 # Sobre material que NO se altera, todo lo que el codificador
                 # tire es pérdida pura contra el original. `+accurate_rnd`
                 # quita el redondeo rápido de swscale y `full_chroma_int`
                 # hace la interpolación de croma en entero completo: es donde
                 # aparecía el moteado en las zonas planas al pasar por el
                 # overlay RGBA y volver a yuv420p.
                 "-sws_flags", "+accurate_rnd+full_chroma_int"]

    if args.solo_audio:
        # Solo el máster. Cuesta 0,2 s frente a los minutos del vídeo, así que
        # se puede iterar sobre `--sfx-vol`, `--ducking` y las ganancias treinta
        # veces en el tiempo de un render. Es la diferencia entre poder juzgar
        # la mezcla y no poder.
        salida = args.output
        if salida.endswith(".mp4"):
            salida = salida[:-4] + ".wav"
        # A partir de aquí la salida REAL es el .wav. Sin esta línea, el
        # resumen y `tam_mb` miran el .mp4 que nunca se escribió; solo
        # «funcionaba» cuando un mp4 viejo del mismo nombre seguía en
        # renders/ — medido: con --output a un directorio limpio, ffmpeg
        # terminaba bien y el resumen moría con FileNotFoundError.
        args.output = salida
        # Se REHACE el comando desde cero en vez de recortar el que hay: las
        # entradas de vídeo (las secuencias de PNG) no hacen falta, y dejarlas
        # obligaría a ffmpeg a abrir miles de ficheros para no usarlos.
        cmd = [FFMPEG, "-nostdin", "-y", "-hide_banner", "-i", fuente]
        for e in entradas_audio:
            cmd += list(e[:-1]) + ["-i", e[-1]]
        cmd += ["-filter_complex", ";".join(
                    [filtro_aroll(tl["keep"], ancho, alto, lut, face,
                                  args.camara, solo_audio=True)]
                    + [_resolver_entradas(f, 1) for f in faudio]),
                "-map", "[%s]" % salida_audio,
                "-c:a", "pcm_s16le", "-ar", "48000", salida]
    else:
        cmd += [
            "-filter_complex", filtro,
            "-map", "[%s]" % ultimo, "-map", "[%s]" % salida_audio,
            *video,
            "-pix_fmt", "yuv420p", "-r", str(fps),
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            args.output,
        ]

    resumen = {
        "salida": args.output,
        "resolucion": "%dx%d" % (ancho, alto),
        "fps": fps,
        "lut": os.path.basename(lut) if lut else "sin grading",
        "encuadre": ("sigue al rostro (%s)" % ", ".join(
            "%.2f" % centro_x_en(face, k["src_start"], k["src_end"])
            for k in tl["keep"][:4])) if face else "central",
        "encoder": "h264_videotoolbox" if args.hw else "libx264",
        "tramos_aroll": len(tl["keep"]),
        "brolls": len(brolls),
        # Se cuenta lo que el bucle metió DE VERDAD en el grafo. Contar por
        # nombre exacto contra ORDEN daba 1 de 23 en cuanto el director
        # empezó a generar nombres únicos por instancia; y contar
        # `ordenadas` —la lista de antes del filtro de fotogramas— declaró
        # «capas_motion: 10» con 9 en el grafo y exit 0.
        "capas_motion": en_grafo,
        "sfx": len(cues),
        "entradas_totales": idx,
    }

    if args.dry_run:
        resumen["comando"] = " ".join(
            ("'%s'" % c if " " in c or ";" in c else c) for c in cmd)
        print(json.dumps(resumen, ensure_ascii=False, indent=2))
        return 0

    print(json.dumps(resumen, ensure_ascii=False, indent=2), file=sys.stderr)
    print("componiendo...", file=sys.stderr)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        cola = "\n".join(r.stderr.strip().splitlines()[-25:])
        print("ffmpeg falló:\n" + cola, file=sys.stderr)
        return 1

    resumen["tam_mb"] = round(os.path.getsize(args.output) / 1e6, 2)
    print(json.dumps(resumen, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
