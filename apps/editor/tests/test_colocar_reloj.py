"""La banda del rostro de `colocar.py`: reloj y sistema de coordenadas.

El fallo que motiva esta red se midió en la pieza de Codex: las capas del
plan remapeado van en reloj de SALIDA y `face.samples` en reloj de ORIGEN, y
`banda_rostro` consultaba los samples con la ventana de salida tal cual.
svgcheckmark (t 33,76 de salida) vive hacia los 36-37 s de origen: la banda
se midió EN OTRO MOMENTO, salió dy=-543 y el check aterrizó en la frente.
Nada dio error, porque la ventana equivocada también tenía samples.

Y el segundo fallo, solidario del primero: el compositor escala y recorta el
A-Roll POR TRAMO (`filtro_aroll`, zoom y recorte centrado en el rostro), así
que un bbox normalizado del fuente NO se multiplica por H sin más.

Se prueban invariantes donde se puede («la banda sale del origen, no de la
salida»; «se unen los sub-tramos») y el caso MEDIDO donde el invariante no
basta: la aritmética del encuadre con z=1.16 está calcada en un comentario de
`geometria_tramo` y aquí se le exige el mismo número.
"""

from __future__ import annotations

import pytest

import colocar
from conftest import keep


def cara(*muestras):
    """`cara((t, y0, y1), ...)`: face.json mínimo, rostro centrado en x.

    El bbox va normalizado sobre el fotograma de PANTALLA del fuente, igual
    que lo emite `detect_face_bbox.py`."""
    return {"con_rostro": True,
            "samples": [{"t": float(t), "bbox": [0.3, float(a), 0.7, float(b)]}
                        for t, a, b in muestras]}


# ==========================================================================
#  ventanas_origen: la traducción salida→origen, tramo a tramo
# ==========================================================================
def test_ventana_dentro_de_un_tramo():
    k = keep((18, 24))                       # out 0-6 ↔ src 18-24
    vs = colocar.ventanas_origen(k, 2.0, 4.0)
    assert [(a, b) for a, b, _ in vs] == [(20.0, 22.0)]


def test_ventana_que_cruza_un_silencio_quitado():
    """Una capa puede cruzar varios tramos: hay que consultar los samples de
    TODOS los sub-tramos, cada uno con su `keep` (la geometría cambia con
    él). svgcheckmark cruzaba de un tramo con zoom 1.0 a uno con 1.16."""
    k = keep((0, 10), (20, 30))              # out 10-20 ↔ src 20-30
    vs = colocar.ventanas_origen(k, 8.0, 12.0)
    assert [(a, b) for a, b, _ in vs] == [(8.0, 10.0), (20.0, 22.0)]
    # y cada sub-ventana viene con SU tramo, no con el primero
    assert vs[0][2] is k[0] and vs[1][2] is k[1]


def test_ventana_fuera_del_metraje():
    assert colocar.ventanas_origen(keep((0, 10)), 50.0, 52.0) == []


# ==========================================================================
#  banda_rostro: el reloj manda
# ==========================================================================
def test_la_banda_sale_del_origen_no_de_la_salida():
    """El bug de svgcheckmark, en miniatura. Rostro ARRIBA en t=2 de origen y
    ABAJO en t=21; la capa va en out [2, 4], que el keep traduce a src
    [20, 22]. El código viejo consultaba t≈2-4 y devolvía la banda ALTA: el
    gráfico se movía para esquivar una cara que en ese momento no está ahí."""
    face = cara((2.0, 0.05, 0.25), (21.0, 0.55, 0.75))
    k = keep((18, 24))                       # out 0-6 ↔ src 18-24
    banda = colocar.banda_rostro(face, k, 2.0, 4.0, 1080, 1920, 1080, 1920)
    assert banda is not None
    y0, y1 = banda
    # La banda es la de ABAJO (0.55-0.75 del alto): mitad inferior del lienzo.
    assert y0 > 1920 * 0.5, "usó la muestra de la ventana SIN traducir"
    # Y la muestra alta de t=2 no se coló en la unión.
    assert y1 <= 0.75 * 1920


def test_une_los_samples_de_todos_los_subtramos():
    """Rostro alto a un lado del corte y bajo al otro: la banda de una capa
    que cruza el corte tiene que cubrir los dos, no solo el sub-tramo donde
    empieza."""
    face = cara((9.0, 0.10, 0.20), (21.0, 0.60, 0.70))
    k = keep((0, 10), (20, 30))
    banda = colocar.banda_rostro(face, k, 8.0, 12.0, 1080, 1920, 1080, 1920)
    assert banda is not None
    y0, y1 = banda
    assert y0 < 0.20 * 1920          # llega arriba (muestra de src 9)
    assert y1 > 0.60 * 1920          # y abajo (muestra de src 21)


def test_sin_metraje_o_sin_cara_no_hay_banda():
    face = cara((2.0, 0.3, 0.5))
    assert colocar.banda_rostro(face, keep((0, 10)), 50.0, 52.0,
                                1080, 1920, 1080, 1920) is None
    assert colocar.banda_rostro(None, keep((0, 10)), 2.0, 4.0,
                                1080, 1920, 1080, 1920) is None


# ==========================================================================
#  geometria_tramo: el encuadre del compositor, no bbox·H
# ==========================================================================
def test_geometria_caso_medido_z116():
    """El caso medido de la pieza de Codex, calcado del comentario de
    `geometria_tramo`: fuente 1080x1920, lienzo 1080x1920, z=1.16 →
    s=1.16, in_h=2227.2 y crop_y = 0.42·(2227.2−1920) = 129.0."""
    face = cara((2.0, 0.5, 0.6))
    k = {"src_start": 0.0, "src_end": 5.0,
         "out_start": 0.0, "out_end": 5.0, "zoom": 1.16}
    s, crop_x, crop_y = colocar.geometria_tramo(k, face, 1080, 1920,
                                                1080, 1920)
    assert s == pytest.approx(1.16)
    assert crop_y == pytest.approx(0.42 * (1920 * 1.16 - 1920))
    # cx=0.5 (rostro centrado): crop_x = in_w·0.5 − W/2, dentro del clip
    assert crop_x == pytest.approx(1080 * 1.16 * 0.5 - 540)


def test_banda_con_zoom_no_es_bbox_por_H():
    """Con z=1.16 un bbox y=0.5-0.6 NO está en (960, 1152) de salida: está
    en 0.5·2227.2−129.0 ≈ 984.6 y 0.6·2227.2−129.0 ≈ 1207.3. Multiplicar
    por H a secas mide en el fuente y coloca en el lienzo."""
    face = cara((2.0, 0.5, 0.6))
    k = [{"src_start": 0.0, "src_end": 5.0,
          "out_start": 0.0, "out_end": 5.0, "zoom": 1.16}]
    banda = colocar.banda_rostro(face, k, 1.0, 3.0, 1080, 1920, 1080, 1920)
    assert banda is not None
    y0, y1 = 984.576, 1207.296
    alto = y1 - y0
    assert banda == (int(y0 + alto * colocar.REC_ARRIBA),
                     int(y1 - alto * colocar.REC_ABAJO))
    # y NO el resultado de bbox·H
    ingenua_y0, ingenua_y1 = 0.5 * 1920, 0.6 * 1920
    assert banda != (int(ingenua_y0 + (ingenua_y1 - ingenua_y0) * 0.16),
                     int(ingenua_y1 - (ingenua_y1 - ingenua_y0) * 0.14))


def test_fuente_apaisado_escala_por_cobertura():
    """Un 16:9 llevado a 9:16 se escala por el alto que CUBRE el lienzo
    (s = 1920/1080 ≈ 1.778), no por H a secas. El incidente de los clips
    3840x2160 con rotación enseñó que las dimensiones de pantalla mandan."""
    face = cara((2.0, 0.3, 0.5))
    k = {"src_start": 0.0, "src_end": 5.0, "out_start": 0.0, "out_end": 5.0}
    s, _, crop_y = colocar.geometria_tramo(k, face, 1080, 1920, 1920, 1080)
    assert s == pytest.approx(1920.0 / 1080.0)
    assert crop_y == 0.0             # la rama sin zoom lleva y=0 literal
    banda = colocar.banda_rostro(face, [k], 1.0, 3.0, 1080, 1920, 1920, 1080)
    assert banda is not None
    # la y de salida usa la escala real sobre el ALTO del fuente
    y0, y1 = 0.3 * 1080 * s, 0.5 * 1080 * s
    alto = y1 - y0
    assert banda == (int(y0 + alto * colocar.REC_ARRIBA),
                     int(y1 - alto * colocar.REC_ABAJO))
