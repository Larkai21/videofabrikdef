"""La elección del fotograma de portada: determinismo, foco y fundidos.

Tres cosas se prueban aquí, y son las tres que pueden fallar en silencio.

**Que la elección sea determinista.** Es el requisito del repo entero: mismas
entradas, mismos frames. Una portada que cambia entre dos ejecuciones sobre el
mismo vídeo no da error en ningún sitio — simplemente deja de ser el mismo
vídeo el que se publica. Por eso se mide dos veces y se exige la MISMA lista,
no solo el mismo ganador: si un término se vuelve inestable en la tercera
cifra, esto lo caza antes de que llegue a cambiar un ranking.

**Que prefiera lo nítido.** Se sintetiza un vídeo cuya primera mitad está
enfocada y la segunda desenfocada, con `boxblur`, y se exige que el elegido
caiga en la primera. No es una prueba de la fórmula: es una prueba de que la
fórmula está CONECTADA. La varianza del laplaciano separa las dos mitades por
un factor de 200, así que si algún día el peso de nitidez se queda a cero o el
signo se invierte, no hay forma de que esto siga en verde.

**Que respete el castigo del gráfico a medio fundido.** Ese término es el
único que no sale de los píxeles sino del plan, y es el que hace falta porque
en los píxeles no se distingue una tarjeta entrando de una tarjeta rara. Va
sin vídeo: son candidatas construidas a mano con la misma nitidez, así que lo
único que puede decidir es el fundido.

Y una cuarta, que sale de un fallo REAL de la primera versión: sobre B-Roll no
hay rostro que medir. `face.json` describe el A-Roll, y la primera portada de
`codex-s4` fue un plano de archivo de un centro de datos al que el script
atribuyó «rostro 1,00, franja 24 % del alto». La cara existía, pero en un
fotograma que el compositor había sustituido.
"""

from __future__ import annotations

import os
import subprocess

import pytest

import portada

# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
from comun import FFMPEG, FFPROBE               # noqa: E402

# La rejilla de las pruebas es más pequeña que la del script —96 px de ancho y
# 6 candidatas por segundo, contra 192 y 8— y el vídeo dura 2 s en vez de 5.
# El motivo es el presupuesto: el nivel rápido tiene que caber en 2 s enteros,
# y a tamaño real este fichero solo se comía 5. No cambia lo que se prueba: la
# varianza del laplaciano no depende del ancho, y a 96 la separación entre
# enfocado y desenfocado sigue siendo de un factor 200 (medido: 1279-1348
# contra 5,4-6,1). Lo que SÍ dependería del ancho es el valor absoluto, y aquí
# no se afirma ninguno.
ANCHO_P, TASA_P, DUR_P = 96, 6.0, 2.0


# --------------------------------------------------------------------------
#  el vídeo sintético: mitad enfocada, mitad desenfocada
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def mitad_y_mitad(tmp_path_factory):
    """2 s a 216x384: el primero con `testsrc2` tal cual y el segundo con
    `boxblur=8:2`.

    Pequeño a propósito. La medida se hace sobre la luma REDUCIDA, así que un
    lienzo de 1080x1920 no daría un veredicto distinto y costaría casi un
    segundo por prueba solo en decodificar."""
    ruta = str(tmp_path_factory.mktemp("portada") / "mitad.mp4")
    r = subprocess.run(
        [FFMPEG, "-nostdin", "-v", "error", "-y",
         "-f", "lavfi", "-i", "testsrc2=size=216x384:rate=10:duration=1",
         "-f", "lavfi", "-i", "testsrc2=size=216x384:rate=10:duration=1",
         "-filter_complex", "[1:v]boxblur=8:2[b];[0:v][b]concat=n=2:v=1[o]",
         "-map", "[o]", "-pix_fmt", "yuv420p", "-r", "10", ruta],
        capture_output=True)
    assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
    return ruta


def candidata(i, t, nitidez=1000.0, contraste=180.0):
    """Una fila de `muestrea` a mano, para las pruebas sin vídeo."""
    return {"i": i, "t": t, "nitidez": nitidez, "contraste": contraste}


def capa(t, dur, entrada=0.5, salida=0.4, copy=False, nombre="tarjeta"):
    return {"capa": nombre, "t": t, "fin": t + dur,
            "entrada": entrada, "salida": salida, "copy": copy}


# ==========================================================================
#  determinismo
# ==========================================================================
@pytest.mark.ffmpeg
def test_la_medida_es_identica_en_dos_pasadas(mitad_y_mitad):
    """Mismo vídeo, misma rejilla, mismos números. Hasta la última cifra: el
    ganador puede coincidir por suerte, la lista entera no."""
    a, geo_a = portada.muestrea(mitad_y_mitad, DUR_P, TASA_P, ANCHO_P)
    b, geo_b = portada.muestrea(mitad_y_mitad, DUR_P, TASA_P, ANCHO_P)
    assert geo_a == geo_b == (216, 384)
    assert a == b


@pytest.mark.ffmpeg
def test_el_fotograma_elegido_no_cambia_entre_ejecuciones(mitad_y_mitad):
    elegidos = []
    for _ in range(2):
        filas, (W, H) = portada.muestrea(mitad_y_mitad, DUR_P, TASA_P, ANCHO_P)
        portada.puntua(filas, [], None, [], (W, H, W, H))
        elegidos.append(portada.elige(filas))
    assert elegidos[0] == elegidos[1]


def test_el_empate_se_rompe_por_la_candidata_mas_temprana():
    """Sin esta regla escrita, dos candidatas con la misma puntuación —que
    con una rejilla de 8 por segundo sobre un plano fijo pasa— dejarían la
    portada a merced del orden de `sorted`."""
    filas = [candidata(3, 0.375), candidata(1, 0.125), candidata(7, 0.875)]
    portada.puntua(filas, [], None, [], (1080, 1920, 1080, 1920))
    assert len({f["punt"] for f in filas}) == 1      # de verdad empatan
    assert portada.elige(filas)["i"] == 1


# ==========================================================================
#  nitidez: lo enfocado gana
# ==========================================================================
@pytest.mark.ffmpeg
def test_un_fotograma_nitido_puntua_mas_que_uno_borroso(mitad_y_mitad):
    filas, _ = portada.muestrea(mitad_y_mitad, DUR_P, TASA_P, ANCHO_P)
    enfocadas = [f["nitidez"] for f in filas if f["t"] < 0.95]
    borrosas = [f["nitidez"] for f in filas if f["t"] >= 1.0]
    assert enfocadas and borrosas
    assert min(enfocadas) > 50 * max(borrosas), (
        "la varianza del laplaciano ya no separa enfoque de desenfoque: "
        "%.1f contra %.1f" % (min(enfocadas), max(borrosas)))


@pytest.mark.ffmpeg
def test_la_portada_cae_en_la_mitad_enfocada(mitad_y_mitad):
    """La prueba de que la fórmula está conectada, no de que sea buena."""
    filas, (W, H) = portada.muestrea(mitad_y_mitad, DUR_P, TASA_P, ANCHO_P)
    portada.puntua(filas, [], None, [], (W, H, W, H))
    assert portada.elige(filas)["t"] < 1.0


@pytest.mark.ffmpeg
def test_el_jpeg_exportado_es_el_fotograma_que_se_puntuo(mitad_y_mitad, tmp_path):
    """El eslabón que nadie mira: se puntúa el índice N de la rejilla y se
    exporta... ¿el índice N? Con `-ss t` en vez de `select`, la respuesta
    depende de los keyframes, y una portada borrosa exportada desde una
    medida nítida no delata nada.

    Se comprueba re-midiendo el JPEG. El recorrido de luma sobrevive a la
    compresión —es el mismo hasta el nivel—; la nitidez baja al ampliar de
    216 a 1080 px de ancho, así que de ella solo se exige que siga a dos
    órdenes de magnitud de la mitad borrosa."""
    filas, (W, H) = portada.muestrea(mitad_y_mitad, DUR_P, TASA_P, ANCHO_P)
    portada.puntua(filas, [], None, [], (W, H, W, H))
    mejor = portada.elige(filas)
    destino = str(tmp_path / "portada.jpg")

    q, peso = portada.exporta(mitad_y_mitad, mejor, TASA_P, DUR_P, destino, W, H)
    assert peso <= portada.LIMITE, "%d bytes con -q:v %d" % (peso, q)

    r = subprocess.run([FFMPEG, "-nostdin", "-v", "error", "-i", destino,
                        "-vf", "scale=192:341,format=gray",
                        "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                       capture_output=True)
    assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
    px = r.stdout
    assert portada.contraste(px) == pytest.approx(mejor["contraste"], abs=4)
    assert portada.nitidez(px, 192, 341) > 100


@pytest.mark.ffmpeg
def test_la_portada_sale_al_lienzo_aunque_el_video_sea_menor(mitad_y_mitad, tmp_path):
    """216x384 entra, 1080x1920 sale. Una miniatura con el tamaño del render
    de `--preview` la acepta la plataforma y la escala ella, peor."""
    destino = str(tmp_path / "portada.jpg")
    portada.exporta(mitad_y_mitad, candidata(4, 0.667), TASA_P, DUR_P,
                    destino, 216, 384)
    r = subprocess.run([FFPROBE, "-v", "error",
                        "-select_streams", "v:0", "-show_entries",
                        "stream=width,height", "-of", "csv=p=0:s=x", destino],
                       capture_output=True, text=True)
    assert r.stdout.strip() == "1080x1920"


# ==========================================================================
#  el gráfico a medio fundido
# ==========================================================================
def test_una_tarjeta_entrando_o_saliendo_es_medio_fundido():
    c = [capa(2.0, 3.0, entrada=0.6, salida=0.4)]        # ventana 2,0-5,0
    assert portada.estado_grafico(2.3, c)[0] is True     # entrando
    assert portada.estado_grafico(4.8, c)[0] is True     # saliendo
    assert portada.estado_grafico(3.5, c) == (False, False, True)
    assert portada.estado_grafico(6.0, c) == (False, False, False)


def test_basta_una_capa_a_medio_fundir_para_castigar():
    """La que se ve entrando estropea la portada aunque haya otras cuatro
    asentadas: no se compensan."""
    c = [capa(0.0, 10.0, nombre="subtitulos"), capa(3.0, 2.0, nombre="sello")]
    medio, _, asentada = portada.estado_grafico(3.2, c)
    assert medio and asentada


def test_el_castigo_decide_entre_dos_candidatas_iguales():
    """Misma nitidez, mismo contraste, mismo rostro. Lo único distinto es que
    una cae mientras la tarjeta entra."""
    filas = [candidata(0, 3.2), candidata(1, 4.0)]
    portada.puntua(filas, [capa(3.0, 3.0)], None, [], (1080, 1920, 1080, 1920))
    assert filas[0]["estado"] == "entrando"
    assert filas[1]["estado"] == "asentado"
    assert portada.elige(filas)["i"] == 1
    assert filas[1]["punt"] - filas[0]["punt"] == pytest.approx(
        portada.PREMIO_GRAFICO + portada.CASTIGO_GRAFICO)


def test_el_castigo_pesa_mas_que_el_premio():
    """Un defecto y una mejora no valen lo mismo, y si algún día alguien
    iguala los dos pesos esto lo dice."""
    assert portada.CASTIGO_GRAFICO > portada.PREMIO_GRAFICO


def test_una_capa_sin_hueco_asentado_nunca_esta_asentada():
    """Un micro-FX de 0,8 s con 0,5 de entrada y 0,4 de salida no llega a
    asentarse en ningún instante. Antes de tratarlo como un caso raro: es el
    caso NORMAL de los sellos del catálogo."""
    c = [capa(1.0, 0.8)]
    for t in (1.0, 1.2, 1.4, 1.6, 1.8):
        medio, _, asentada = portada.estado_grafico(t, c)
        assert medio and not asentada


def test_el_fundido_lo_declara_la_config_por_encima_de_la_plantilla():
    """`entrada`/`salida` son claves de DURACIÓN (`reloj.SEMANTICA`), así que
    el plan remapeado las trae tal cual y mandan sobre los `defaults`."""
    plan = [{"capa": "x", "template": "headline-clipper.html",
             "t": 1.0, "duracion": 4.0, "config": {"entrada": 1.5}}]
    c = portada.capas_del_plan(plan)[0]
    assert c["entrada"] == 1.5
    assert c["salida"] == 0.4          # el de headline-clipper.html


def test_una_plantilla_que_no_declara_fundido_cae_en_la_moda_del_catalogo():
    """Suponer cero sería dar por asentado lo que está entrando, que es
    exactamente el fallo que este término existe para evitar."""
    e, s = portada.fundido_plantilla("kinetic-captions.html")
    assert (e, s) == (portada.ENTRADA_TIPO, portada.SALIDA_TIPO)


def test_una_plantilla_inexistente_no_revienta():
    """Un plan puede citar una plantilla que ya no está. Eso lo caza
    `validar_plan.py`; aquí lo único que no vale es morir por el camino."""
    assert portada.fundido_plantilla("no-existe-jamas.html") == (
        portada.ENTRADA_TIPO, portada.SALIDA_TIPO)


# ==========================================================================
#  el rostro
# ==========================================================================
def test_sobre_broll_el_rostro_no_se_mide():
    """El fallo real: `broll_plan.escenas` va en reloj de SALIDA, el mismo
    del vídeo compuesto, y en esas ventanas el A-Roll no está en pantalla.
    Medir ahí `face.json` es medir un fotograma que ya no existe."""
    face = {"con_rostro": True,
            "samples": [{"t": t, "bbox": [0.3, 0.30, 0.7, 0.70]}
                        for t in (0.0, 1.0, 2.0, 3.0, 4.0, 5.0)]}
    k = [{"src_start": 0.0, "src_end": 6.0,
          "out_start": 0.0, "out_end": 6.0}]
    filas = [candidata(0, 1.0), candidata(1, 4.5)]
    portada.puntua(filas, [], face, k, (1080, 1920, 1080, 1920),
                   escenas=[(4.2, 5.2)])
    assert filas[0]["talla"] is not None and filas[0]["rostro"] == 1.0
    assert filas[1]["broll"] is True
    assert filas[1]["talla"] is None
    assert filas[1]["rostro"] == portada.ROSTRO_SIN_DATO
    assert "B-Roll" in filas[1]["estado"]


def test_sin_dato_de_rostro_el_termino_no_decide():
    """0,5 y no 0 ni 1: la misma constante en todas las candidatas no cambia
    ningún ranking, y ni premia ni castiga una ausencia de información."""
    filas = [candidata(0, 1.0), candidata(1, 2.0, nitidez=1500.0)]
    portada.puntua(filas, [], None, [], (1080, 1920, 1080, 1920))
    assert {f["rostro"] for f in filas} == {portada.ROSTRO_SIN_DATO}
    assert portada.elige(filas)["i"] == 1        # decide la nitidez


@pytest.mark.parametrize("talla,esperado", [
    (0.00, 0.0),      # no hay cara
    (0.06, 0.0),      # 21 px en una miniatura de feed: un punto
    (0.12, 0.5),      # subiendo
    (0.18, 1.0), (0.30, 1.0), (0.45, 1.0),
    (0.55, 0.5),      # bajando
    (0.65, 0.0),      # primerísimo plano: no cabe ningún rótulo
    (0.90, 0.0),
])
def test_la_meseta_del_tamano_de_cara(talla, esperado):
    assert portada.punt_rostro(talla) == pytest.approx(esperado, abs=1e-6)


def test_el_rostro_se_lee_en_reloj_de_ORIGEN_traducido_por_keep():
    """La regla del reloj, aplicada aquí: el vídeo compuesto va en SALIDA y
    `face.samples` en ORIGEN. Cara ARRIBA y pequeña en el segundo 2 de
    origen, grande en el 21; la candidata está en el 2 de SALIDA, que el
    `keep` traduce al 20 de origen. Sin la traducción se mediría la pequeña."""
    face = {"con_rostro": True,
            "samples": [{"t": 2.0, "bbox": [0.4, 0.05, 0.6, 0.13]},
                        {"t": 19.0, "bbox": [0.3, 0.30, 0.7, 0.70]},
                        {"t": 20.0, "bbox": [0.3, 0.30, 0.7, 0.70]}]}
    k = [{"src_start": 0.0, "src_end": 1.0, "out_start": 0.0, "out_end": 1.0},
         {"src_start": 18.0, "src_end": 30.0, "out_start": 1.0, "out_end": 13.0}]
    filas = [candidata(0, 2.0)]
    portada.puntua(filas, [], face, k, (1080, 1920, 1080, 1920))
    # 0,70 − 0,30 = 0,40 de recuadro, del que `banda_rostro` deja la franja
    # central de ojos y boca: 0,40 · (1 − 0,16 − 0,14) = 0,28.
    assert filas[0]["talla"] == pytest.approx(0.28, abs=0.01)


# ==========================================================================
#  normalización de los términos
# ==========================================================================
def test_la_nitidez_satura_pero_nunca_llega_a_uno():
    assert portada.punt_nitidez(0.0) == 0.0
    assert portada.punt_nitidez(portada.K_NITIDEZ) == pytest.approx(0.5)
    assert portada.punt_nitidez(1e9) < 1.0
    # monótona: más varianza, más puntuación, siempre
    vals = [portada.punt_nitidez(v) for v in (10, 200, 600, 2000, 5000)]
    assert vals == sorted(vals)


def test_el_contraste_se_recorta_por_los_dos_lados():
    assert portada.punt_contraste(20.0) == 0.0
    assert portada.punt_contraste(portada.CONTRASTE_PLANO) == 0.0
    assert portada.punt_contraste(130.0) == pytest.approx(0.5)
    assert portada.punt_contraste(255.0) == 1.0


def test_el_contraste_usa_percentiles_y_no_el_recorrido_entero():
    """Un puñado de píxeles quemados no es contraste. La imagen es gris plano
    con un 1 % de blanco puro: el recorrido crudo diría 195 y los percentiles
    dicen 0, que es lo que se ve."""
    plano = bytes([60]) * 9900 + bytes([255]) * 100
    assert portada.contraste(plano) == 0.0
