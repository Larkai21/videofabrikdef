"""La parte pura del comprobador de sonido, sin ffmpeg y en milisegundos.

Lo que estas pruebas fijan no son gustos de mezcla —eso se juzga oyendo—
sino las propiedades que, al romperse, no dan error:

  · el parseo tiene que quedarse con el RESUMEN de ebur128 y no con los
    valores provisionales de las líneas de progreso, que llevan las mismas
    etiquetas «I:» y «LRA:»; y «LRA low/high» no son LRA;
  · un ffmpeg interrumpido deja progreso sin resumen, y eso tiene que salir
    como None —«no hay medida»—, no como el último provisional;
  · un valle solo cuenta si dura, y la ventana M vacía del arranque no es un
    valle: es que aún no hay medida;
  · los subtítulos, el fondo y la transición no son capas mudas, y
    `config.sinSonido` declara el mudo como decisión — la diferencia entre
    decisión y olvido es exactamente lo que se comprueba. En la última pieza
    fueron cuatro capas en mudo y ningún log lo dijo.
"""

from __future__ import annotations

import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import comprobar_sonido as cs    # noqa: E402


# --------------------------------------------------------------------------
#  material sintético: la salida de ebur128 tal como la escribe ffmpeg
# --------------------------------------------------------------------------
def progreso(t, m):
    """Una línea de progreso real de `ebur128`, con sus I y LRA provisionales
    —los valores trampa que el parseo NO debe confundir con el resumen—."""
    return ("[Parsed_ebur128_0 @ 0x600000c74000] t: %-10.5f TARGET:-23 LUFS  "
            "  M: %s S: -26.1     I: -70.0 LUFS       LRA:   0.0 LU  "
            "FTPK: -9.7 -9.7 dBFS  TPK: -5.2 -5.2 dBFS" % (t, m))


RESUMEN = """[Parsed_ebur128_0 @ 0x600000c74000] Summary:

  Integrated loudness:
    I:         -14.1 LUFS
    Threshold: -24.6 LUFS

  Loudness range:
    LRA:         3.1 LU
    Threshold: -34.9 LUFS
    LRA low:   -16.4 LUFS
    LRA high:  -13.3 LUFS

  True peak:
    Peak:       -1.2 dBFS
"""


def perfil(*tramos, paso=0.1):
    """`perfil((0.5, 5.0, -20), (5.0, 6.0, -34))` → ventanas M cada 100 ms."""
    puntos = []
    for a, b, m in tramos:
        t = a
        while t < b - 1e-9:
            puntos.append((round(t, 3), float(m)))
            t += paso
    return puntos


def capa(nombre, template, t=1.0, cues=0):
    c = {"capa": nombre, "template": template, "t": t,
         "dur": 1.3, "frames": 39, "fps": 30}
    if cues:
        c["cues"] = [{"t": t, "sfx": "impacto", "gain": 1.0}] * cues
    return c


# --------------------------------------------------------------------------
#  parseo de ebur128
# --------------------------------------------------------------------------
def test_el_resumen_manda_sobre_las_lineas_de_progreso():
    """LA trampa del formato: cada línea de progreso lleva «I: -70.0 LUFS» y
    «LRA: 0.0 LU» provisionales. Quedarse con el primer match daría −70 de
    sonoridad; quedarse con «LRA low: -16.4» daría un LRA negativo."""
    texto = "\n".join([progreso(0.1, "-120.7"), progreso(0.2, "-25.0"),
                       RESUMEN])
    med = cs.parsea_ebur128(texto)
    assert med["I"] == -14.1
    assert med["TP"] == -1.2
    assert med["LRA"] == 3.1


def test_sin_resumen_no_hay_medida():
    """Un ffmpeg interrumpido deja progreso sin resumen. Eso es «no hay
    medida», no «la medida es el último provisional»: el llamador aborta con
    exit 2 en vez de comparar −70 contra el objetivo."""
    med = cs.parsea_ebur128("\n".join([progreso(0.1, "-25.0"),
                                       progreso(0.2, "-24.0")]))
    assert med["I"] is None and med["TP"] is None and med["LRA"] is None
    assert len(med["momentary"]) == 2


def test_el_perfil_momentary_sale_de_las_lineas_de_progreso():
    med = cs.parsea_ebur128("\n".join([progreso(0.5, "-25.9"),
                                       progreso(0.6, "-31.2"), RESUMEN]))
    assert med["momentary"] == [(0.5, -25.9), (0.6, -31.2)]


def test_una_ventana_nan_no_es_una_medida():
    """`M: nan` es la ventana de 400 ms aún vacía. Convertirla en número la
    haría contar como valle en el arranque de cada pieza."""
    med = cs.parsea_ebur128("\n".join([progreso(0.1, "nan"),
                                       progreso(0.5, "-20.0")]))
    assert med["momentary"] == [(0.5, -20.0)]


# --------------------------------------------------------------------------
#  valles
# --------------------------------------------------------------------------
def test_valle_largo_detectado_con_su_timestamp_y_su_fondo():
    v = cs.valles(perfil((0.5, 12.0, -20), (12.0, 13.5, -34), (13.5, 20.0, -18)))
    assert len(v) == 1
    t0, t1, minimo = v[0]
    assert abs(t0 - 12.0) < 0.11 and abs(t1 - 13.4) < 0.11
    assert minimo == -34


def test_valle_corto_es_fraseo_no_hueco():
    """Por debajo de 0,8 s una caída es respiración: `silencios.py` ya quitó
    los silencios largos y avisar de cada coma sería gritar en falso."""
    assert cs.valles(perfil((0.5, 5.0, -20), (5.0, 5.4, -35),
                            (5.4, 10.0, -20))) == []


def test_valle_en_el_limite_cuenta():
    # 0,8 s justos entre la primera y la última ventana por debajo del umbral.
    v = cs.valles(perfil((0.5, 2.0, -20), (2.0, 2.9, -33), (2.9, 6.0, -20)))
    assert len(v) == 1


def test_el_calentamiento_no_es_un_valle():
    """La ventana M mide los 400 ms anteriores: al arrancar mide silencio
    aunque no lo haya. Sin el descarte, TODAS las piezas abrirían con una
    «pausa sin cama» falsa y el aviso se dejaría de leer en dos días."""
    assert cs.valles(perfil((0.0, 0.5, -80), (0.5, 6.0, -20))) == []


def test_dos_valles_separados_no_se_funden():
    v = cs.valles(perfil((0.5, 3.0, -35), (3.0, 4.0, -20), (4.0, 7.0, -36)))
    assert len(v) == 2
    assert v[0][2] == -35 and v[1][2] == -36


# --------------------------------------------------------------------------
#  capas mudas
# --------------------------------------------------------------------------
def test_una_capa_visual_sin_cue_se_nombra_con_su_t():
    """El caso real: cuatro micro-FX cuyas plantillas no publican cues y a
    los que el plan no declaró `sfx`. Entraron en mudo y nadie lo dijo."""
    mudas = cs.capas_mudas([capa("stampbanned", "stamp-banned.html", t=3.64),
                            capa("codemockup", "code-mockup.html", cues=2)])
    assert mudas == [("stampbanned", 3.64, "stamp-banned.html")]


def test_subtitulos_fondo_y_transicion_no_son_mudas():
    """Su silencio es legítimo: los subtítulos sonarían encima de cada
    palabra, el fondo es la base opaca y la transición recibe su sonido por
    `config.cortes`. Avisar de ellas sería gritar en falso."""
    assert cs.capas_mudas([
        capa("kineticcaptions", "kinetic-captions.html"),
        capa("karaoke", "karaoke-subs.html"),
        capa("capitulos", "capitulos.html"),
        capa("fondo", "fondo.html"),
        capa("transicion", "transicion.html")]) == []


def test_sin_sonido_declara_el_mudo_como_decision():
    """`config.sinSonido: true` es el contrato para callar una capa a
    propósito —como `colocar: false` con la posición— y se respeta: lo que
    se caza es el olvido, no la decisión."""
    capas = [capa("targethud", "target-hud.html")]
    assert cs.capas_mudas(capas, {"targethud": {"sinSonido": True}}) == []
    assert len(cs.capas_mudas(capas, {"targethud": {}})) == 1


def test_las_mudas_salen_ordenadas_por_tiempo():
    mudas = cs.capas_mudas([capa("b", "svg-checkmark.html", t=33.76),
                            capa("a", "stamp-banned.html", t=3.64)])
    assert [m[0] for m in mudas] == ["a", "b"]
