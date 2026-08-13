"""La energía por palabra: la medida que modula la dinámica del subtítulo.

Lo que se prueba no es que un RMS sea un RMS: es el contrato que la
plantilla asume al leer `palabras[].energia`. Tres cosas concretas:

- La normalización es ROBUSTA: un golpe de micro no arrastra la escala
  (percentiles, no min/max), y el audio plano no divide por casi-cero.
- Lo mudo vale 0,5 —NEUTRO— y no 0. Una ventana muda es casi siempre un
  fallo de alineación de Whisper; con 0, la dinámica castigaría justo a
  esas palabras, que es el efecto contrario al buscado.
- La guarda de reloj ABORTA. Medir un timeline remapeado contra el audio
  fuente pone cada palabra sobre el audio de otra sin dar un solo error,
  que es la clase de fallo que este repo ya pagó con los subtítulos
  cinéticos (CLAUDE.md, paso 3c).
"""

from __future__ import annotations

import math

import pytest

from medir_energia import SR, aplicar, normaliza, percentil, rms_db


def seno(freq: float, dur: float, amp: float) -> list[float]:
    n = int(dur * SR)
    return [amp * math.sin(2 * math.pi * freq * i / SR) for i in range(n)]


def timeline(words, reloj="origen"):
    return {"reloj": reloj, "source": "no-importa.mp4", "words": words}


def palabra(w, a, b):
    return {"w": w, "start": a, "end": b, "p": 1.0}


# ---------------------------------------------------------------- percentil

def test_percentil_interpola_linealmente():
    assert percentil([0.0, 10.0], 50.0) == 5.0
    assert percentil([1.0, 2.0, 3.0, 4.0], 100.0) == 4.0
    assert percentil([7.0], 20.0) == 7.0


def test_percentil_lista_vacia_revienta():
    with pytest.raises(ValueError):
        percentil([], 50.0)


# ------------------------------------------------------------------ rms_db

def test_rms_db_mide_la_ventana_pedida():
    # 1 s fuerte y 1 s flojo: la ventana de cada tramo debe dar ~20 dB de
    # diferencia (0,5 frente a 0,05 de amplitud).
    x = seno(220, 1.0, 0.5) + seno(220, 1.0, 0.05)
    fuerte = rms_db(x, 0.0, 1.0)
    flojo = rms_db(x, 1.0, 2.0)
    assert fuerte is not None and flojo is not None
    assert 19.0 < fuerte - flojo < 21.0


def test_rms_db_ventana_muda_devuelve_none():
    x = [0.0] * SR
    assert rms_db(x, 0.0, 1.0) is None


def test_rms_db_fuera_del_audio_no_revienta():
    # Whisper alarga la última palabra más allá del final real del audio.
    x = seno(220, 0.5, 0.3)
    assert rms_db(x, 0.4, 9.0) is not None   # recorta al audio que hay
    assert rms_db(x, 8.0, 9.0) is None       # del todo fuera: mudo


# ---------------------------------------------------------------- normaliza

def test_normaliza_reparte_entre_0_y_1():
    es = normaliza([-30.0, -25.0, -20.0, -15.0, -10.0])
    assert es[0] == 0.0 and es[-1] == 1.0
    assert all(0.0 <= e <= 1.0 for e in es)
    assert es == sorted(es)  # monótona: más dB, más energía


def test_normaliza_un_golpe_no_arrastra_la_escala():
    # Cuarenta palabras parejas —el orden de una pieza real— y un golpe de
    # micro 40 dB por encima. Con min/max las cuarenta caerían aplastadas
    # en el cuarto inferior de la escala; con percentiles el grueso
    # conserva su reparto. El tamaño importa: con p95 sobre diez valores
    # el percentil interpola DENTRO del atípico y la escala se iría igual.
    parejas = [-25.0 + (i % 20) * 0.5 for i in range(40)]
    es = normaliza(parejas + [20.0])
    assert max(es[:40]) - min(es[:40]) > 0.5


def test_normaliza_mudas_y_audio_plano_valen_medio():
    assert normaliza([None, None]) == [0.5, 0.5]
    assert normaliza([-20.0, -20.0, None]) == [0.5, 0.5, 0.5]  # plano
    es = normaliza([-30.0, None, -10.0])
    assert es[1] == 0.5


# ------------------------------------------------------------------ aplicar

def test_aplicar_escribe_energia_en_cada_palabra():
    x = seno(220, 1.0, 0.5) + seno(220, 1.0, 0.05) + seno(220, 1.0, 0.2)
    tl = timeline([palabra("FUERTE", 0.0, 1.0),
                   palabra("flojo", 1.0, 2.0),
                   palabra("medio", 2.0, 3.0)])
    resumen = aplicar(tl, x)
    energias = [w["energia"] for w in tl["words"]]
    assert all(0.0 <= e <= 1.0 for e in energias)
    assert energias[0] > energias[2] > energias[1]
    assert resumen["palabras"] == 3 and resumen["mudas"] == 0


def test_aplicar_es_idempotente():
    x = seno(330, 2.0, 0.4)
    tl_a = timeline([palabra("una", 0.0, 1.0), palabra("dos", 1.0, 2.0)])
    tl_b = timeline([palabra("una", 0.0, 1.0), palabra("dos", 1.0, 2.0)])
    aplicar(tl_a, x)
    aplicar(tl_b, x)
    aplicar(tl_b, x)  # segunda pasada sobre el mismo timeline
    assert [w["energia"] for w in tl_a["words"]] == \
           [w["energia"] for w in tl_b["words"]]


def test_aplicar_rechaza_reloj_remapeado():
    tl = timeline([palabra("hola", 0.0, 0.5)], reloj="salida")
    with pytest.raises(SystemExit) as exc:
        aplicar(tl, seno(220, 1.0, 0.3))
    assert exc.value.code == 2


def test_el_umbral_de_la_plantilla_cae_dentro_de_la_escala():
    # `kinetic-captions.html` crece el grupo con energía >= 0.75. Si la
    # normalización dejara de llegar a esa zona, el efecto moriría en
    # silencio; que el techo real (p95) siga proyectando por encima.
    es = normaliza([-30.0 + i for i in range(21)])
    assert sum(1 for e in es if e >= 0.75) >= 2
