"""El reloj. Es la parte cuyo fallo queda grabado en los píxeles.

Se prueban INVARIANTES, no valores. Los umbrales de este pipeline se ajustan
—`--silencio`, `--minima`, `--minima-toma`— y una prueba que fija «aquí salen
13 tramos» se pone roja en cuanto alguien afina un umbral, aunque el
comportamiento siga siendo correcto. Un invariante como «ningún tramo está
invertido» sobrevive a cualquier ajuste y sigue cazando el fallo real.
"""

from __future__ import annotations

import pytest

import clean_transcript as ct
import reloj
import silencios as sil
from conftest import keep, palabras


# ==========================================================================
#  clean_transcript.tramos_utiles
# ==========================================================================
CASOS_TRAMOS = [
    ("normal", palabras(("uno", 0.0, 0.4), ("dos", 0.9, 1.4)), 3.0),
    ("con pausa larga", palabras(("a", 0.0, 0.5), ("b", 5.0, 5.5)), 8.0),
    ("una sola palabra", palabras(("x", 0.2, 0.6)), 3.0),
    ("sin dur_total", palabras(("x", 0.0, 0.5)), 0),
    # El caso que producía un tramo INVERTIDO: una alucinación de cola de
    # Whisper que empieza pasada la duración declarada. El margen real en la
    # pieza de Codex son 0,14 s, así que no es hipotético.
    ("cola alucinada", palabras(("uno", 0.0, 0.4), ("gracias", 4.9, 5.4)), 2.0),
    ("todas fuera", palabras(("x", 9.0, 9.5)), 2.0),
    ("justo en el borde", palabras(("x", 1.9, 2.0)), 2.0),
]


@pytest.mark.parametrize("nombre,ps,dur", CASOS_TRAMOS,
                         ids=[c[0] for c in CASOS_TRAMOS])
def test_tramos_nunca_invertidos(nombre, ps, dur):
    """Todo tramo cumple fin > inicio. De un tramo invertido salía una cascada
    silenciosa: palabras descartadas, duración negativa y reducción > 100 %."""
    for a, b in ct.tramos_utiles(ps, 0.35, 0.08, dur):
        assert b > a, "tramo invertido [%s, %s] en «%s»" % (a, b, nombre)


@pytest.mark.parametrize("nombre,ps,dur", CASOS_TRAMOS,
                         ids=[c[0] for c in CASOS_TRAMOS])
def test_tramos_dentro_del_video(nombre, ps, dur):
    for a, b in ct.tramos_utiles(ps, 0.35, 0.08, dur):
        assert a >= 0.0
        if dur:
            assert b <= dur + 1e-9


@pytest.mark.parametrize("nombre,ps,dur", CASOS_TRAMOS,
                         ids=[c[0] for c in CASOS_TRAMOS])
def test_tramos_ordenados_y_sin_solape(nombre, ps, dur):
    ts = ct.tramos_utiles(ps, 0.35, 0.08, dur)
    for (a1, b1), (a2, b2) in zip(ts, ts[1:]):
        assert a2 >= b1 - 1e-9, "solapan [%s,%s] y [%s,%s]" % (a1, b1, a2, b2)


def test_tramos_fusiona_los_que_se_tocan():
    """Con el colchón, dos tramos contiguos se convierten en uno: dejarlos
    partidos mete un corte que no corta nada."""
    ps = palabras(("a", 0.0, 0.5), ("b", 0.6, 1.0))
    assert len(ct.tramos_utiles(ps, 0.35, 0.08, 3.0)) == 1


# ==========================================================================
#  clean_transcript.remapear
# ==========================================================================
def test_remapear_no_inventa_ni_reordena():
    ps = palabras(("uno", 0.0, 0.4), ("dos", 0.9, 1.4), ("tres", 5.0, 5.4))
    tramos = ct.tramos_utiles(ps, 0.35, 0.08, 8.0)
    fuera, dur = ct.remapear(ps, tramos)
    assert dur >= 0.0
    assert [w["w"] for w in fuera] == [w["w"] for w in ps]
    for w in fuera:
        assert w["end"] >= w["start"]
        assert 0.0 <= w["start"] <= dur + 1e-6
    for a, b in zip(fuera, fuera[1:]):
        assert b["start"] >= a["start"]


def test_remapear_duracion_nunca_negativa():
    """Con un tramo invertido daba -1,68 s, y de ahí `reduccion_pct` > 100."""
    ps = palabras(("uno", 0.0, 0.4), ("gracias", 4.9, 5.4))
    _, dur = ct.remapear(ps, ct.tramos_utiles(ps, 0.35, 0.08, 2.0))
    assert dur >= 0.0


# ==========================================================================
#  clean_transcript.recortar_colas
# ==========================================================================
def test_recortar_colas_nunca_alarga_ni_invierte():
    ps = palabras(("pero", 1.0, 1.84), ("sí", 2.0, 2.1), ("x", 3.0, 3.05))
    fuera, _ = ct.recortar_colas(ps, 0.35)
    for antes, ahora in zip(ps, fuera):
        assert ahora["end"] <= antes["end"] + 1e-9, "ha alargado una palabra"
        assert ahora["end"] > ahora["start"]


def test_recortar_colas_es_idempotente():
    ps = palabras(("pero", 1.0, 1.84))
    una, _ = ct.recortar_colas(ps, 0.35)
    dos, _ = ct.recortar_colas(una, 0.35)
    assert [w["end"] for w in una] == [w["end"] for w in dos]


# ==========================================================================
#  clean_transcript.bloques_karaoke
# ==========================================================================
def test_bloques_cubren_todas_las_palabras_una_vez():
    ps = palabras(*[("p%d" % i, i * 0.5, i * 0.5 + 0.4) for i in range(11)])
    bs = ct.bloques_karaoke(ps, 4, 1.8, 0.35)
    dentro = [w["w"] for b in bs for w in b["palabras"]]
    assert len(dentro) == len(ps)
    assert [x.upper() for x in (w["w"] for w in ps)] == dentro


def test_bloques_respetan_el_tope_de_palabras():
    ps = palabras(*[("p%d" % i, i * 0.2, i * 0.2 + 0.15) for i in range(20)])
    for b in ct.bloques_karaoke(ps, 4, 1.8, 0.35):
        assert len(b["palabras"]) <= 4
        assert b["fin"] >= b["ini"]


def test_bloques_parten_por_pausa():
    """El criterio de pausa solo funciona si las palabras llegan en el reloj de
    ORIGEN: agrupándolas sobre las ya remapeadas, los cortes habían cerrado las
    pausas y este criterio no actuaba nunca."""
    ps = palabras(("a", 0.0, 0.3), ("b", 5.0, 5.3))
    assert len(ct.bloques_karaoke(ps, 4, 1.8, 0.35)) == 2


# ==========================================================================
#  clean_transcript.detectar_tomas_falsas
# ==========================================================================
def test_tomas_falsas_conserva_la_ultima():
    """La toma buena es la última: el locutor se traba y repite."""
    ps = palabras(("bueno", 0.0, 0.3), ("esto", 0.3, 0.6), ("es", 0.6, 0.8),
                  ("un", 0.8, 0.9),
                  ("bueno", 2.0, 2.3), ("esto", 2.3, 2.6), ("es", 2.6, 2.8),
                  ("un", 2.8, 2.9),
                  ("bueno", 4.0, 4.3), ("esto", 4.3, 4.6), ("es", 4.6, 4.8),
                  ("un", 4.8, 4.9), ("lío", 4.9, 5.2))
    grupos = ct.agrupar_por_pausa(ps, 0.35)
    fuera = ct.detectar_tomas_falsas(grupos, 4, 0.82, 3)
    assert len(grupos) - 1 not in fuera, "ha descartado la toma buena"
    assert fuera <= set(range(len(grupos)))


# ==========================================================================
#  reloj.Mapa
# ==========================================================================
def test_mapa_monotona():
    m = reloj.Mapa(keep((0, 10), (13, 20)))
    ant = -1.0
    for i in range(1000):
        v = m(i * 0.025)
        assert v >= ant - 1e-9, "el mapa retrocede en t=%.3f" % (i * 0.025)
        ant = v


def test_mapa_extremos():
    k = keep((0, 10), (13, 20))
    m = reloj.Mapa(k)
    assert m(0.0) == pytest.approx(k[0]["out_start"])
    assert m(20.0) == pytest.approx(m.duracion())
    assert m(999.0) == pytest.approx(m.duracion())


def test_mapa_ordena_un_keep_desordenado():
    """Se asumía ordenado sin comprobarlo. Desordenado devolvía el reloj de
    OTRO tramo, en silencio, para palabras, capas y configs. La garantía era
    accidental: solo `recortar` ordena."""
    desordenado = [{"src_start": 10, "src_end": 12, "out_start": 2},
                   {"src_start": 0, "src_end": 2, "out_start": 0}]
    assert reloj.Mapa(desordenado)(1.0) == pytest.approx(1.0)


def test_mapa_vacio_es_coherente():
    """Antes `__call__` era la identidad y `duracion()` daba 0: dos respuestas
    que se contradicen. De ahí salía `duration_final: 0` con los tiempos de las
    palabras intactos."""
    m = reloj.Mapa([])
    assert m(7.5) == m.duracion()
    assert not m.hay_metraje()


def test_mapa_dentro_de_un_silencio_va_al_borde():
    m = reloj.Mapa(keep((0, 10), (13, 20)))
    assert m(11.5) == pytest.approx(m(10.0))


# ==========================================================================
#  reloj.remapea — la semántica RELATIVA
# ==========================================================================
def test_remapea_es_relativo_a_la_capa():
    """`o' = mapa(t_capa + o) - mapa(t_capa)`. El código viejo los trataba como
    absolutos y acertaba solo porque las capas con listas de tiempos viven en
    t=0, donde la fórmula colapsa. Esta capa está en t>0."""
    m = reloj.Mapa(keep((0, 10), (13, 20)))
    cfg = {"palabras": [{"w": "x", "ini": 1.0, "fin": 1.5}], "pulsacion": 6.2}
    reloj.remapea(cfg, m, t_capa=8.0)
    base = m(8.0)
    assert cfg["palabras"][0]["ini"] == pytest.approx(m(9.0) - base, abs=1e-3)
    assert cfg["pulsacion"] == pytest.approx(m(14.2) - base, abs=1e-3)


def test_remapea_no_toca_las_duraciones():
    m = reloj.Mapa(keep((0, 10), (13, 20)))
    cfg = {"entrada": 0.55, "salida": 0.4, "cps": 44, "huecoMax": 0.42,
           "pop": 0.1, "at": 1.0}
    reloj.remapea(cfg, m, t_capa=0.0)
    assert cfg["entrada"] == 0.55 and cfg["salida"] == 0.4
    assert cfg["cps"] == 44 and cfg["huecoMax"] == 0.42 and cfg["pop"] == 0.1


def test_remapea_listas_de_numeros_sueltos():
    """`flashEn` es una lista de números, no de objetos: el código viejo
    descartaba explícitamente lo que no fuera un dict."""
    m = reloj.Mapa(keep((0, 10), (13, 20)))
    cfg = {"flashEn": [1.0, 15.0]}
    reloj.remapea(cfg, m, t_capa=0.0)
    assert cfg["flashEn"] == [pytest.approx(m(1.0)), pytest.approx(m(15.0))]


def test_remapea_no_toca_lo_que_no_es_tiempo():
    m = reloj.Mapa(keep((0, 10),))
    cfg = {"x": 540, "y": 880, "tam": 120, "giro": -9, "texto": "HOLA",
           "reparto": True}
    antes = dict(cfg)
    reloj.remapea(cfg, m, t_capa=0.0)
    assert cfg == antes


def test_tabla_de_reloj_al_dia():
    """Si una plantilla trae una clave de tiempo sin clasificar, `silencios.py`
    no la remapea y ese gráfico se desplaza sin dar error."""
    assert reloj.sin_clasificar() == {}


# ==========================================================================
#  silencios
# ==========================================================================
def test_recortar_encadena_la_salida_sin_huecos():
    k = keep((0, 20),)
    nuevos, _ = sil.recortar(k, [[5.0, 8.0]], 0.14, 0.05)
    cursor = 0.0
    for x in nuevos:
        assert x["out_start"] == pytest.approx(cursor, abs=1e-3)
        assert x["out_end"] - x["out_start"] == pytest.approx(
            x["src_end"] - x["src_start"], abs=1e-3)
        cursor = x["out_end"]


def test_recortar_solo_reduce():
    k = keep((0, 20),)
    nuevos, _ = sil.recortar(k, [[5.0, 8.0]], 0.14, 0.05)
    assert sum(x["src_end"] - x["src_start"] for x in nuevos) <= 20.0 + 1e-9


def test_recortar_conserva_el_zoom_por_tramo():
    k = [{"src_start": 0, "src_end": 10, "out_start": 0, "out_end": 10,
          "zoom": 1.15}]
    nuevos, _ = sil.recortar(k, [[4.0, 6.0]], 0.14, 0.05)
    assert nuevos and all(x["zoom"] == 1.15 for x in nuevos)


def test_recortar_aguanta_silencios_solapados():
    k = keep((0, 10),)
    nuevos, _ = sil.recortar(k, [[2.0, 4.0], [3.0, 5.0]], 0.14, 0.05)
    for x in nuevos:
        assert x["src_end"] > x["src_start"]


ASTILLAS = [
    # (nombre, piezas, ¿es un parpadeo de encuadre?)
    # La astilla toca solo por delante y con OTRO zoom: es el parpadeo real,
    # el que salió a 0,10 s —dos fotogramas y medio con otro encuadre entre dos
    # saltos—. El contador de fusiones solo cuenta estas.
    ("parpadeo por delante", [[0.0, 2.0, 1.15], [2.0, 2.1, 1.0]], True),
    # Toca solo por detrás, también con otro zoom.
    ("parpadeo por detrás", [[2.0, 2.1, 1.0], [2.1, 5.0, 1.2]], True),
    # Mismo zoom a los dos lados: se unen igual —dos tramos contiguos con el
    # mismo encuadre son un tramo— pero no había parpadeo que arreglar.
    ("unión de mismo zoom",
     [[0.0, 2.0, 1.0], [2.0, 2.1, 1.0], [2.1, 5.0, 1.0]], False),
]


@pytest.mark.parametrize("nombre,piezas,parpadeo", ASTILLAS,
                         ids=[c[0] for c in ASTILLAS])
def test_fusionar_astillas(nombre, piezas, parpadeo):
    """La astilla se pega al vecino con el que es continua y adopta SU zoom: no
    se pierde metraje, lo que cambia es el encuadre. Así el cambio de encuadre
    pasa a coincidir con el corte, que es lo que §11 pide de entrada."""
    antes = sum(b - a for a, b, _ in piezas)
    fuera, n = sil.fusionar_astillas([list(p) for p in piezas], 0.45)

    assert sum(b - a for a, b, _ in fuera) == pytest.approx(antes), \
        "se ha perdido metraje"
    assert len(fuera) < len(piezas), "no ha fusionado nada"
    assert n >= 1 if parpadeo else n == 0

    # Y el invariante de fondo: no queda ninguna astilla pegada a un vecino de
    # otro zoom, que es lo único que se ve como parpadeo.
    for a, b in zip(fuera, fuera[1:]):
        corta = (a[1] - a[0]) < 0.45 or (b[1] - b[0]) < 0.45
        contigua = abs(b[0] - a[1]) < 1e-9
        assert not (corta and contigua and a[2] != b[2]), \
            "queda una astilla con otro encuadre pegada a su vecino"


def test_fusionar_astillas_deja_las_aisladas():
    """Una astilla con silencio a los dos lados no está pegada a nada, así que
    no puede producir parpadeo: se deja como está."""
    piezas = [[0.0, 2.0, 1.0], [5.0, 5.2, 1.0], [9.0, 11.0, 1.0]]
    fuera, n = sil.fusionar_astillas([list(p) for p in piezas], 0.45)
    assert len(fuera) == 3 and n == 0


def test_fusionar_astillas_termina_siempre():
    piezas = [[i * 0.1, (i + 1) * 0.1, 1.0 + (i % 2) * 0.15] for i in range(40)]
    fuera, _ = sil.fusionar_astillas(piezas, 0.45)
    assert fuera


def test_protege_habla_no_pisa_palabras():
    ps = palabras(("hola", 1.0, 1.4))
    for a, b in sil.protege_habla([[0.0, 5.0]], ps, 0.05):
        assert b <= 1.0 - 0.05 + 1e-9 or a >= 1.0 + 1e-9


def test_protege_habla_solo_recorta():
    ps = palabras(("hola", 1.0, 1.4))
    fuera = sil.protege_habla([[0.0, 5.0]], ps, 0.05)
    assert all(0.0 <= a and b <= 5.0 for a, b in fuera)
    assert all(b > a for a, b in fuera)


def test_huecos_transcripcion_respeta_el_minimo():
    ps = palabras(("a", 0.0, 0.5), ("b", 0.6, 1.0), ("c", 3.0, 3.5))
    for a, b in sil.huecos_transcripcion(ps, 0.30):
        assert b - a >= 0.30
