"""La parte pura del comprobador de ritmo, sin ffmpeg y en milisegundos.

Lo que se fija aquí no es gusto de montaje —cada cuánto tiene que pasar algo
se discute mirando la pieza— sino las propiedades que, al romperse, dejan el
informe con buena pinta y midiendo otra cosa:

  · **una capa que corre todo el rato no reparte la pieza en ventanas**. Los
    subtítulos van de 0 al final: contar su entrada dejaría toda la pieza
    «con estímulo» por definición, que es justo el informe inútil. Se
    descartan por plantilla Y por fracción de duración, porque los nombres de
    capa son libres y la lista de plantillas siempre va por detrás;
  · **la cola cuenta**. La ventana entre la última entrada y el final es la
    que decide si el vídeo se termina, y es la que se olvida al recorrer
    pares de entradas;
  · **dos capas que entran en el mismo instante son UN estímulo**, no dos
    ventanas de longitud cero (`targethud` y `padlockunlock` entran las dos
    en 16,68 s);
  · **«a cara sola» se mide con la UNIÓN de las capas presentes**, no con la
    suma: `fondo` y `securitypipelinenodes` se solapan casi enteros y
    sumarlos daba cobertura negativa;
  · **una pausa de voz solo importa dentro de una ventana LARGA**. Dentro de
    un hueco de un segundo es respirar; dentro de uno de diez es el punto de
    abandono.

Y el caso MEDIDO donde el invariante no basta: la pieza de Codex entera, con
sus doce capas copiadas de `build/layers.json`, tiene que dar los mismos
números que la cabecera de `comprobar_ritmo.py` promete —10,87 s la mayor y
el 75,8 % de la pieza—. Esos números están escritos en la documentación y en
el argumento de por qué las puertas nacen desactivadas: si el cálculo cambia,
la prueba lo dice antes que la prosa.
"""

from __future__ import annotations

import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import comprobar_ritmo as cr    # noqa: E402


def capa(nombre, t, dur, template="tarjeta.html"):
    """Una capa del manifiesto ya cruzada con la plantilla del plan."""
    return {"capa": nombre, "t": float(t), "dur": float(dur),
            "template": template}


# La pieza real, copiada de `build/layers.json` (reloj de SALIDA). Se copia y
# no se lee del disco a propósito: `build/` es desechable y se regenera desde
# otra pieza, y una prueba que dependa de él mide lo que haya hoy.
CODEX = [
    capa("headlineclipper", 0.55, 2.5, "headline-clipper.html"),
    capa("securitypipelinenodes", 5.81, 12.67, "security-pipeline-nodes.html"),
    capa("codemockup", 19.03, 6.73, "code-mockup.html"),
    capa("cierrecta", 38.14, 2.554, "cierre-cta.html"),
    capa("fondo", 5.26, 13.22, "fondo.html"),
    capa("stampbanned", 3.64, 1.3, "stamp-banned.html"),
    capa("targethud", 16.68, 1.3, "target-hud.html"),
    capa("padlockunlock", 16.68, 1.3, "padlock-unlock.html"),
    capa("terminal", 25.4, 3.71, "terminal.html"),
    capa("svgcheckmark", 33.76, 1.3, "svg-checkmark.html"),
    capa("cursortap", 40.92, 1.3, "cursor-tap.html"),
    capa("kineticcaptions", 0.0, 45.3, "kinetic-captions.html"),
]
DUR_CODEX = 45.3


# ==========================================================================
#  qué cuenta como estímulo
# ==========================================================================
def test_los_subtitulos_no_son_un_estimulo():
    subs = capa("kineticcaptions", 0.0, 45.3, "kinetic-captions.html")
    assert not cr.es_estimulo(subs, DUR_CODEX)


def test_una_capa_que_dura_toda_la_pieza_tampoco_aunque_no_este_en_la_lista():
    """La lista de plantillas continuas siempre va por detrás del catálogo.
    La fracción no: dura lo que dura."""
    larga = capa("loquesea", 0.0, 44.0, "plantilla-nueva-de-mañana.html")
    assert not cr.es_estimulo(larga, DUR_CODEX)


def test_una_tarjeta_normal_si_lo_es():
    assert cr.es_estimulo(capa("t", 5.0, 2.5), DUR_CODEX)


def test_la_duracion_se_lee_del_plan_o_del_manifiesto():
    """El plan la llama `duracion` y el manifiesto `dur`; este script cruza
    los dos. Leer solo una daba 0 y una capa continua dejaba de serlo."""
    assert cr.duracion_capa({"dur": 3.0}) == 3.0
    assert cr.duracion_capa({"duracion": 3.0}) == 3.0
    assert cr.duracion_capa({}) == 0.0
    assert not cr.es_estimulo(
        {"capa": "s", "t": 0.0, "duracion": 45.3, "template": "x.html"},
        DUR_CODEX)


# ==========================================================================
#  dónde están las ventanas
# ==========================================================================
def test_ventanas_entre_entradas_con_cabeza_y_cola():
    capas = [capa("a", 1.0, 0.5), capa("b", 4.0, 0.5)]
    assert cr.ventanas_muertas(capas, 10.0) == [
        (0.0, 1.0, 1.0),      # antes de la primera
        (1.0, 4.0, 2.5),      # entre las dos
        (4.0, 10.0, 5.5),     # la cola, hasta el final de la pieza
    ]


def test_dos_capas_en_el_mismo_instante_son_un_solo_estimulo():
    """`targethud` y `padlockunlock` entran las dos en 16,68 s."""
    juntas = cr.ventanas_muertas(
        [capa("a", 2.0, 1.0), capa("b", 2.0, 1.0)], 6.0)
    assert [(t0, t1) for t0, t1, _ in juntas] == [(0.0, 2.0), (2.0, 6.0)]


def test_a_cara_sola_usa_la_union_y_no_la_suma():
    """Dos capas solapadas cubren lo que cubren, no el doble."""
    capas = [capa("a", 0.0, 4.0), capa("b", 1.0, 4.0), capa("c", 8.0, 0.5)]
    v = cr.ventanas_muertas(capas, 10.0)
    # ventana 1.0→8.0: cubierta hasta 5.0, o sea 3.0 s a cara sola
    assert (1.0, 8.0, 3.0) in v


def test_una_ventana_bajo_un_grafico_largo_no_es_cara_sola():
    """El caso del acto 2: 10,87 s sin ninguna entrada nueva, pero con un
    diagrama en pantalla todo el rato. Son cosas distintas y se informan por
    separado."""
    capas = [capa("diagrama", 0.0, 12.0), capa("otra", 11.0, 1.0)]
    v = cr.ventanas_muertas(capas, 20.0)
    assert (0.0, 11.0, 0.0) in v
    # y lo que queda tras el diagrama sí es cara sola
    assert (11.0, 20.0, 8.0) in v


def test_los_subtitulos_no_tapan_la_cara_sola():
    """No cuentan como estímulo Y tampoco como presencia: están en pantalla
    todo el rato, así que contarlos dejaría «a cara sola» en cero siempre."""
    capas = [capa("subs", 0.0, 20.0, "kinetic-captions.html"),
             capa("t", 2.0, 1.0)]
    assert cr.ventanas_muertas(capas, 20.0) == [(0.0, 2.0, 2.0),
                                                (2.0, 20.0, 17.0)]


def test_una_capa_que_empieza_despues_del_final_no_abre_ventana():
    """Eso lo caza `validar_plan.py`; aquí solo hay que no inventarse una
    ventana fuera de la pieza."""
    v = cr.ventanas_muertas([capa("a", 1.0, 1.0), capa("tarde", 99.0, 1.0)],
                            10.0)
    assert [(t0, t1) for t0, t1, _ in v] == [(0.0, 1.0), (1.0, 10.0)]


# ==========================================================================
#  el veredicto
# ==========================================================================
def test_resumen_solo_suma_las_ventanas_que_avisan():
    ventanas = [(0.0, 1.0, 0.0), (1.0, 9.0, 2.0), (9.0, 14.0, 5.0)]
    mayor, suma, frac, cara = cr.resumen(ventanas, 14.0, aviso=3.5)
    assert mayor == 8.0
    assert suma == 13.0            # las de 8 y 5 s; la de 1 s no
    assert round(frac, 3) == round(13.0 / 14.0, 3)
    assert cara == 7.0


def test_resumen_sin_ventanas_no_revienta():
    assert cr.resumen([], 0.0) == (0.0, 0.0, 0.0, 0.0)


# ==========================================================================
#  el cruce con la voz
# ==========================================================================
def test_la_pausa_dentro_de_una_ventana_larga_se_avisa():
    ventanas = [(5.0, 16.0, 0.0)]
    cruce = cr.cruza_pausas(ventanas, [(9.7, 10.7, -28.1)], minimo=3.5)
    assert cruce == [(9.7, 10.7, -28.1, 5.0, 16.0, 1.0)]


def test_la_pausa_dentro_de_una_ventana_corta_no():
    """Medio segundo de pantalla quieta mientras se respira es hablar."""
    assert cr.cruza_pausas([(5.0, 6.0, 0.0)], [(5.2, 5.9, -28.0)],
                           minimo=3.5) == []


def test_la_pausa_a_caballo_cuenta_solo_lo_que_solapa():
    """La pausa medida entre 18,9 y 20,0 s empieza en una ventana corta y
    termina dentro de la larga: lo que hace daño es el trozo de dentro."""
    ventanas = [(16.68, 19.03, 0.0), (19.03, 25.4, 0.0)]
    cruce = cr.cruza_pausas(ventanas, [(18.9, 20.0, -28.3)], minimo=3.5)
    assert len(cruce) == 1
    assert cruce[0][3:] == (19.03, 25.4, 0.97)


def test_se_ordena_por_solape_lo_peor_primero():
    ventanas = [(0.0, 10.0, 0.0)]
    cruce = cr.cruza_pausas(ventanas, [(1.0, 1.8, -28.0), (3.0, 6.0, -30.0)],
                            minimo=3.5)
    assert [c[0] for c in cruce] == [3.0, 1.0]


# ==========================================================================
#  plan y manifiesto: lo que no se renderizó no está en pantalla
# ==========================================================================
def test_una_capa_del_plan_sin_fotogramas_se_nombra():
    plan = [{"capa": "a"}, {"capa": "fantasma"}]
    assert cr.sin_fotogramas(plan, [{"capa": "a"}]) == ["fantasma"]


# ==========================================================================
#  el caso MEDIDO: la pieza de Codex entera
# ==========================================================================
def test_la_pieza_medida_da_los_numeros_de_la_cabecera():
    ventanas = cr.ventanas_muertas(CODEX, DUR_CODEX)
    mayor, suma, frac, cara = cr.resumen(ventanas, DUR_CODEX, aviso=3.5)

    assert len(ventanas) == 11
    assert mayor == 10.87                       # 5,81 → 16,68 s
    assert round(suma, 1) == 34.4               # cinco ventanas > 3,5 s
    assert round(100 * frac, 1) == 75.8         # el % que la cabecera cita
    assert round(cara, 1) == 13.1               # a cara sola
    # Y la mayor transcurre BAJO un gráfico, no a cara sola: es el argumento
    # de por qué se cuentan las entradas y no la presencia.
    assert (5.81, 16.68, 0.0) in ventanas


def test_las_dos_puertas_dispararian_hoy():
    """Este es el motivo de que nazcan desactivadas, y conviene que esté
    escrito como prueba y no solo como prosa: el día que una pieza pase en
    verde, esta prueba falla y toca cambiar el defecto a `--puerta`."""
    mayor, _, frac, _ = cr.resumen(
        cr.ventanas_muertas(CODEX, DUR_CODEX), DUR_CODEX, aviso=cr.AVISO_S)
    assert mayor > cr.ERROR_S
    assert frac > cr.ERROR_FRACCION
