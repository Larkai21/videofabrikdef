"""El arco por actos, las variantes y los cues de frontera — sin ffmpeg.

Tres incidentes medidos sostienen este fichero:

  · `PESO_ACTO` se buscaba con `get(nombre)` EXACTO y los actos de la vía del
    guion se llaman «prueba / ejecución» y «outro y bucle infinito»: caían al
    defecto 1.0 sin una línea de log. Medido por actos con ebur128 sobre la
    pieza real: el cierre perdió su realce justo en la resolución y el acto
    que el diseño quiere más retirado salió el MÁS alto de la pieza.
  · Siete tecleos byte a byte idénticos en 6,5 s: cada grupo de cues se
    alimentaba entero desde `lista[0]["ruta"]`. La firma de lo sintético.
  · Los dos saltos de zoom del montaje real eran MUDOS y el riser —PRIORIDAD
    1— no sonaba jamás: ningún cue nace de `keep[].zoom`.

Lo que estas pruebas fijan es lo de siempre en este repo: que un nombre que no
casa AVISE en vez de desaparecer, que el reparto sea determinista —módulo, no
azar— y que la regla de frontera reproduzca EXACTAMENTE los dos casos reales.
"""

from __future__ import annotations

import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import mezcla                    # noqa: E402


def test_los_nombres_reales_del_guion_caen_en_su_peso(capsys):
    """Los cuatro actos tal y como llegan de `leer_guion.py`. La base es 2.0
    para que cada peso deje un literal distinguible en la expresión: con base
    1.0, el 1.00 de «prueba» y el defecto son el mismo número y la prueba no
    probaría nada."""
    actos = [{"nombre": "hook", "ini": 0.0, "fin": 4.0},
             {"nombre": "concepto", "ini": 4.0, "fin": 12.0},
             {"nombre": "prueba / ejecución", "ini": 12.0, "fin": 20.0},
             {"nombre": "outro y bucle infinito", "ini": 20.0, "fin": 24.0}]
    e = mezcla.volumen_por_actos(actos, 2.0)
    assert e is not None
    # 2.0 × {1.20, 0.65, 1.35} — cada acto en su peso, no en el defecto 2.0000.
    # Los pesos son los del contraste medido: con 0.80↔1.25 el arco era de
    # 3,9 dB sobre una cama ~13 dB bajo la voz — inaudible, y no se oía.
    assert "2.4000" in e, "hook tiene que pesar 1.20: %s" % e
    assert "1.3000" in e, "concepto tiene que pesar 0.65: %s" % e
    assert "2.7000" in e, "outro tiene que pesar 1.35, no el defecto: %s" % e
    # El tramo prueba→outro: parte de 2.0000 (peso 1.00) y sube 0.7000 hacia
    # el 2.7000 del cierre. Este literal solo existe si los DOS casaron.
    assert "(2.0000+(0.7000)" in e, e
    # Y ni un aviso: los cuatro nombres casan, ninguno cayó al defecto.
    assert capsys.readouterr().err == ""


def test_un_nombre_inventado_cae_al_defecto_y_avisa(capsys):
    """El defecto sin aviso es el mismo descarte mudo que el repo ya castigó
    con las capas fuera de `ORDEN` y con los cues sin `else`: aquí un acto
    mal nombrado apagaba el arco musical sin que nada se quejara."""
    assert mezcla.peso_de_acto("interludio z") == mezcla.PESO_POR_DEFECTO
    err = capsys.readouterr().err
    assert "interludio z" in err, "el aviso tiene que decir QUÉ nombre no casó"
    assert "gancho" in err and "outro" in err, \
        "y QUÉ claves valen, para poder corregirlo: %s" % err


# --------------------------------------------------------------------------
#  round-robin de variantes
# --------------------------------------------------------------------------
def test_el_reparto_de_variantes_es_modulo_puro():
    """La aparición i-ésima (por orden temporal) usa `variantes[i % n]`.
    Con los siete tecleos reales y tres variantes: b,2,3,b,2,3,b — ningún
    fichero suena dos veces seguidas, y el reparto es el MISMO en cada
    composición porque es aritmética, no azar."""
    vs = ["tecleo.wav", "tecleo_v2.wav", "tecleo_v3.wav"]
    assert [mezcla.variante_para(i, vs) for i in range(7)] == [
        "tecleo.wav", "tecleo_v2.wav", "tecleo_v3.wav",
        "tecleo.wav", "tecleo_v2.wav", "tecleo_v3.wav", "tecleo.wav"]


def test_sin_variantes_todo_cae_en_el_unico_fichero():
    """n=1 es el caso de hoy (las variantes aún se están grabando) y tiene
    que ser EXACTAMENTE el comportamiento de siempre."""
    assert [mezcla.variante_para(i, ["tic.wav"]) for i in range(5)] == \
        ["tic.wav"] * 5


def test_variantes_de_solo_recoge_las_que_existen_y_en_orden_fijo():
    """El contrato: junto a `<sfx>.wav` pueden existir `_v2`…`_v4`. El orden
    es fijo —base, v2, v3, v4— y no una lista de directorio, que depende del
    filesystem. `existe` se inyecta: nada de disco en el nivel rápido."""
    en_disco = {"sfx/tecleo_v3.wav", "sfx/tecleo_v2.wav"}
    assert mezcla.variantes_de("sfx/tecleo.wav", existe=en_disco.__contains__) \
        == ["sfx/tecleo.wav", "sfx/tecleo_v2.wav", "sfx/tecleo_v3.wav"]
    # sin ninguna variante: la lista es [base] y nada cambia
    assert mezcla.variantes_de("sfx/pop.wav", existe=lambda _: False) \
        == ["sfx/pop.wav"]


def test_rama_cues_reparte_las_apariciones_entre_las_variantes():
    """El grafo, con variantes inyectadas como dato (la función sigue pura):
    cada variante entra UNA vez con `-i` y alimenta solo sus apariciones."""
    cues = [{"sfx": "tecleo", "t": float(i), "gain": 1.0, "ruta": "b.wav"}
            for i in range(4)]
    filtros, entradas, _ = mezcla.rama_cues(
        mezcla.agrupar(cues), 0, 0.55, 20.0,
        variantes={"tecleo": ["b.wav", "v2.wav"]})
    assert entradas == ["b.wav", "v2.wav"]
    # apariciones 0 y 2 desde la entrada 0; 1 y 3 desde la 1
    assert "[0:a]asplit=2[tecleo_v0_0][tecleo_v0_2]" in filtros[0]
    assert "[1:a]asplit=2[tecleo_v1_1][tecleo_v1_3]" in filtros[1]


# --------------------------------------------------------------------------
#  cues de frontera: los dos casos reales, cableados
# --------------------------------------------------------------------------
# El keep y los actos del montaje real (build/timeline.json, reloj de salida),
# reducidos a lo que la regla mira. Dos saltos de zoom: 3,78 s (1.16→1.0,
# el gancho muere ahí y el concepto llega 1,48 s después) y 33,9 s
# (1.0→1.16, el outro no llega hasta 36,18 s). Y un corte SIN zoom en 36,1 s
# pegado al arranque del outro.
KEEP_REAL = [
    {"out_start": 0.0, "out_end": 3.78, "zoom": 1.16},
    {"out_start": 3.78, "out_end": 5.18, "zoom": 1.0},
    {"out_start": 5.18, "out_end": 18.48, "zoom": 1.0},
    {"out_start": 18.48, "out_end": 24.36, "zoom": 1.0},
    {"out_start": 24.36, "out_end": 33.9, "zoom": 1.0},
    {"out_start": 33.9, "out_end": 36.1, "zoom": 1.16},
    {"out_start": 36.1, "out_end": 45.3, "zoom": 1.16},
]
ACTOS_REAL = [
    {"nombre": "hook", "ini": 0.0, "fin": 3.78},
    {"nombre": "concepto", "ini": 5.26, "fin": 18.48},
    {"nombre": "prueba / ejecución", "ini": 18.48, "fin": 33.9},
    {"nombre": "outro y bucle infinito", "ini": 36.18, "fin": 45.3},
]


def test_la_pieza_real_da_riser_en_3_78_y_solo_barrido_en_33_9():
    """LA prueba de la regla. Los dos saltos de zoom eran MUDOS; con la regla:

      3,78 s abre acto (el concepto llega a 1,48 s ≤ la carrera del riser)
             → riser terminando EN la frontera + barrido;
      33,9 s no lo abre (el outro tarda 2,28 s > 1,8) → solo barrido;
      36,1 s corta sin cambiar el zoom → nada, aunque el outro arranque al
             lado: un riser sin evento visual promete algo que no llega."""
    cues, avisos = mezcla.cues_de_frontera(KEEP_REAL, ACTOS_REAL)
    assert avisos == []
    assert [(c["sfx"], c["t"], c["gain"]) for c in cues] == [
        ("riser", 1.98, 0.75),      # 3.78 − DUR_RISER: termina EN el corte
        ("barrido", 3.78, 0.5),
        ("barrido", 33.9, 0.5),
    ]


def test_un_riser_ya_planificado_no_se_duplica_pero_avisa():
    """Si una escaleta ya anunció el corte con `transicion(riser=True)`,
    sonar dos risers a la vez es un error de montaje; callarse el descarte,
    el patrón que este repo lleva seis sprints castigando."""
    ya = [{"sfx": "riser", "t": 1.98, "gain": 0.75}]
    cues, avisos = mezcla.cues_de_frontera(KEEP_REAL, ACTOS_REAL, ya)
    assert [(c["sfx"], c["t"]) for c in cues] == [
        ("barrido", 3.78), ("barrido", 33.9)]
    assert len(avisos) == 1 and "riser" in avisos[0]


def test_sin_carrera_no_hay_medio_riser():
    """Medio riser suena a error de montaje, no a tensión: si la frontera
    llega antes de que quepa la carrera entera, barrido y aviso."""
    keep = [{"out_start": 0.0, "out_end": 1.0, "zoom": 1.16},
            {"out_start": 1.0, "out_end": 9.0, "zoom": 1.0}]
    actos = [{"nombre": "hook", "ini": 0.0, "fin": 1.0},
             {"nombre": "outro", "ini": 1.4, "fin": 9.0}]
    cues, avisos = mezcla.cues_de_frontera(keep, actos)
    assert [c["sfx"] for c in cues] == ["barrido"]
    assert len(avisos) == 1 and "carrera" in avisos[0]
