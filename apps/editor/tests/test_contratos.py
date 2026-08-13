"""Los contratos, por los dos lados: artefactos rotos y los reales de build/.

Cada prueba de «roto» construye el artefacto mínimo que incumple UNA invariante.
Así, si mañana alguien afloja una comprobación, se sabe cuál.
"""

from __future__ import annotations

import json
import os

import pytest

import contratos


# ==========================================================================
#  lo que hay en build/, si hay algo
# ==========================================================================
@pytest.mark.parametrize("nombre", sorted(contratos.TODOS))
def test_artefactos_reales_cumplen(raiz, nombre):
    """Sobre los artefactos de verdad. Es lo que convierte esto en una red que
    protege al que edita, y no solo al que escribió las pruebas."""
    ruta = os.path.join(raiz, "build", nombre)
    if not os.path.exists(ruta):
        pytest.skip("no hay build/%s en este árbol" % nombre)
    with open(ruta, encoding="utf-8") as f:
        d = json.load(f)
    mal = contratos.TODOS[nombre](d)
    assert not mal, mal


# ==========================================================================
#  transcript.json
# ==========================================================================
def _transcript(**extra):
    d = {"source": "x.mp4", "duration": 10.0,
         "words": [{"w": "hola", "start": 0.0, "end": 0.4, "p": 1.0},
                   {"w": "mundo", "start": 0.5, "end": 1.0, "p": 0.9}]}
    d.update(extra)
    return d


def test_transcript_bueno():
    assert contratos.transcript(_transcript()) == []


def test_transcript_cola_alucinada():
    """La invariante que dispara el tramo invertido. En la pieza de Codex el
    margen son 0,14 s: `duration` 49,84 y la última palabra en 49,70."""
    d = _transcript(duration=0.8)
    mal = contratos.transcript(d)
    assert any("alucinado una cola" in x for x in mal), mal


def test_transcript_desordenado():
    d = _transcript(words=[{"w": "b", "start": 5.0, "end": 5.4},
                           {"w": "a", "start": 0.0, "end": 0.4}])
    assert any("no está ordenado" in x for x in contratos.transcript(d))


def test_transcript_palabra_vacia():
    d = _transcript(words=[{"w": "  ", "start": 0.0, "end": 0.4}])
    assert any("está vacía" in x for x in contratos.transcript(d))


def test_transcript_probabilidad_fuera_de_rango():
    d = _transcript(words=[{"w": "x", "start": 0.0, "end": 0.4, "p": 1.7}])
    assert any("fuera de [0,1]" in x for x in contratos.transcript(d))


def test_transcript_admite_claves_extra():
    """`alineado_con_guion` no está en el contrato escrito de CLAUDE.md y sí en
    el fichero real. El contrato permite claves extra a propósito: uno cerrado
    estaría en rojo desde el primer día."""
    assert contratos.transcript(_transcript(alineado_con_guion=True)) == []


# ==========================================================================
#  timeline.json
# ==========================================================================
def _timeline(**extra):
    d = {"reloj": "origen", "source": "x.mp4",
         "duration_original": 10.0, "duration_final": 7.0,
         "keep": [{"src_start": 0.0, "src_end": 4.0,
                   "out_start": 0.0, "out_end": 4.0},
                  {"src_start": 7.0, "src_end": 10.0,
                   "out_start": 4.0, "out_end": 7.0}],
         "words": [{"w": "hola", "start": 0.0, "end": 0.4},
                   {"w": "adiós", "start": 9.0, "end": 9.5}],
         "blocks": [{"ini": 0.0, "fin": 9.5, "palabras": []}]}
    d.update(extra)
    return d


def test_timeline_bueno():
    assert contratos.timeline(_timeline()) == []


def test_timeline_reloj_equivocado():
    mal = contratos.timeline(_timeline(reloj="salida"))
    assert any("van SIEMPRE" in x for x in mal), mal


def test_timeline_keep_invertido():
    d = _timeline(keep=[{"src_start": 4.0, "src_end": 2.0,
                         "out_start": 0.0, "out_end": 0.0}])
    assert any("invertido" in x for x in contratos.timeline(d))


def test_timeline_duraciones_que_no_cuadran():
    d = _timeline(keep=[{"src_start": 0.0, "src_end": 4.0,
                         "out_start": 0.0, "out_end": 9.0}])
    mal = contratos.timeline(d)
    assert any("en origen y" in x for x in mal), mal


def test_timeline_salida_sin_encadenar():
    d = _timeline(keep=[{"src_start": 0.0, "src_end": 4.0,
                         "out_start": 0.0, "out_end": 4.0},
                        {"src_start": 7.0, "src_end": 10.0,
                         "out_start": 6.0, "out_end": 9.0}])
    assert any("debería encadenar" in x for x in contratos.timeline(d))


def test_timeline_words_fuera_del_original():
    d = _timeline(words=[{"w": "x", "start": 0.0, "end": 0.4},
                         {"w": "y", "start": 30.0, "end": 30.5}])
    mal = contratos.timeline(d)
    assert any("fuera del vídeo" in x for x in mal), mal


def test_timeline_blocks_en_otro_reloj():
    """El fallo que estaba vivo en disco: `blocks` acabando 5,533 s fuera de la
    pieza porque `silencios.py` nunca lo remapeaba."""
    d = _timeline(blocks=[{"ini": 0.0, "fin": 4.2, "palabras": []}])
    mal = contratos.timeline(d)
    assert any("relojes distintos" in x for x in mal), mal


def test_timeline_keep_vacio():
    assert any("no se conserva metraje" in x
               for x in contratos.timeline(_timeline(keep=[])))


# ==========================================================================
#  face.json
# ==========================================================================
def _face(**extra):
    d = {"engine": "vision", "verificado": True,
         "zones": [{"t0": 0.0, "t1": 50.0, "safe": "bottom", "y_ui": 0.72}]}
    d.update(extra)
    return d


def test_face_bueno():
    assert contratos.face(_face()) == []


def test_face_y_ui_fuera_de_rango():
    d = _face(zones=[{"t0": 0, "t1": 5, "safe": "bottom", "y_ui": 1.4}])
    assert any("fuera de (0,1)" in x for x in contratos.face(d))


def test_face_safe_desconocido():
    d = _face(zones=[{"t0": 0, "t1": 5, "safe": "medio", "y_ui": 0.5}])
    assert any("top/bottom" in x for x in contratos.face(d))


def test_face_bbox_sin_normalizar():
    d = _face(samples=[{"t": 1.0, "bbox": [0.1, 0.2, 1080, 1920]}])
    assert any("normalizado" in x for x in contratos.face(d))


# ==========================================================================
#  layers.json
# ==========================================================================
def _layers(**extra):
    d = {"fps": 25, "ancho": 1080, "alto": 1920,
         "capas": [{"capa": "x", "dir": "/no/importa", "frames": 50,
                    "dur": 2.0, "t": 0.0}]}
    d.update(extra)
    return d


def test_layers_bueno_sin_disco():
    assert contratos.layers(_layers(), comprobar_disco=False) == []


def test_layers_recuento_de_fotogramas():
    d = _layers(capas=[{"capa": "x", "dir": "/d", "frames": 10, "dur": 2.0,
                        "t": 0.0}])
    mal = contratos.layers(d, comprobar_disco=False)
    assert any("se esperaban 50" in x for x in mal), mal


def test_layers_redondeo_del_banquero():
    """2.5 s a 25 fps son 62.5 fotogramas. El renderizador usa el `Math.round`
    de JS y escribe 63; el `round` de Python daría 62. Con `round`, esta
    comprobación nacía en rojo sin motivo — y una comprobación así se
    desactiva."""
    d = _layers(capas=[{"capa": "x", "dir": "/d", "frames": 63, "dur": 2.5,
                        "t": 0.0}])
    assert contratos.layers(d, comprobar_disco=False) == []


def test_layers_nombre_duplicado():
    d = _layers(capas=[{"capa": "x", "dir": "/d", "frames": 50, "dur": 2.0,
                        "t": 0.0},
                       {"capa": "x", "dir": "/d", "frames": 50, "dur": 2.0,
                        "t": 5.0}])
    assert any("aparece 2 veces" in x
               for x in contratos.layers(d, comprobar_disco=False))


def test_layers_formato_desconocido():
    d = _layers(ancho=1234, alto=567)
    assert any("formatos soportados" in x
               for x in contratos.layers(d, comprobar_disco=False))


def test_layers_directorio_ausente():
    mal = contratos.layers(_layers(), comprobar_disco=True)
    assert any("no existe" in x for x in mal), mal


# ==========================================================================
#  broll_plan.json
# ==========================================================================
def test_broll_vacio_es_valido():
    assert contratos.broll({"reloj": "salida", "escenas": []}) == []


def test_broll_escenas_solapadas():
    d = {"reloj": "salida",
         "escenas": [{"id": "a", "t": 0.0, "dur": 3.0, "tipo": "broll"},
                     {"id": "b", "t": 1.0, "dur": 2.0, "tipo": "broll"}]}
    assert any("se solapan" in x for x in contratos.broll(d))


def test_broll_fichero_ausente():
    d = {"reloj": "salida",
         "escenas": [{"id": "a", "t": 0.0, "dur": 2.0, "tipo": "broll",
                      "files": ["/no/existe.png"]}]}
    assert any("no existe" in x for x in contratos.broll(d))
