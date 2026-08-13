"""El director: reparto, guardias semánticas y refinado de copia.

Lo que se prueba son las reglas que BRAND_RULES declara medibles, no los
valores concretos del plan que sale. El plan cambia en cuanto se añade una
plantilla —`plantillas_disponibles()` lee el directorio— y una prueba que fije
el plan entero se pondría roja cada tanda y se desactivaría.
"""

from __future__ import annotations

import pytest

import dirigir as d
from conftest import palabras


# ==========================================================================
#  cámara (§11)
# ==========================================================================
def test_zoom_solo_devuelve_valores_del_catalogo():
    """§11 fija cuatro escalas. Cualquier otra rompería el `concat` del
    compositor, que exige que todos los tramos coincidan en relación de
    píxel."""
    vistos = {d.zoom_de(i, 20, i * 3.0, 60.0) for i in range(20)}
    assert vistos <= {1.00, 1.12, 1.15, 1.20}, vistos


def test_zoom_gancho_y_cierre():
    assert d.zoom_de(0, 20, 0.0, 60.0) == 1.15, "el gancho va a 1.15x"
    assert d.zoom_de(19, 20, 55.0, 60.0) == 1.20, "el cierre va a 1.20x"


@pytest.mark.parametrize("n", [0, 1, 2])
def test_zoom_aguanta_pocos_tramos(n):
    """Con 0 o 1 tramos el índice del cierre y el del gancho coinciden."""
    for i in range(max(1, n)):
        assert d.zoom_de(i, n, 0.0, 10.0) in {1.00, 1.12, 1.15, 1.20}


def test_zoom_es_determinista():
    """Sin `random`: el mismo índice da siempre la misma escala. Es la promesa
    entera del pipeline —mismas entradas, mismos frames—."""
    a = [d.zoom_de(i, 12, i * 4.0, 48.0) for i in range(12)]
    b = [d.zoom_de(i, 12, i * 4.0, 48.0) for i in range(12)]
    assert a == b


# ==========================================================================
#  riqueza: qué tramo merece un gráfico
# ==========================================================================
def test_riqueza_descarta_lo_corto():
    assert d.riqueza("dos palabras") < 0
    assert d.riqueza("") < 0


def test_riqueza_prefiere_contenido_a_muletillas():
    pobre = d.riqueza("y entonces pues es que lo que pasa es que bueno")
    rica = d.riqueza("OpenAI libera Codex Security con auditoría estática")
    assert rica > pobre


def test_riqueza_sube_con_cifras():
    sin = d.riqueza("el coste de auditar tu código baja mucho ahora mismo")
    con = d.riqueza("el coste de auditar tu código baja un 80 por ciento")
    assert con >= sin


# ==========================================================================
#  guardias semánticas (§13)
# ==========================================================================
GUARDIAS = [
    ("terminal", "instala ffmpeg con brew y ejecuta el script", True),
    ("terminal", "hoy hace muy buen tiempo en la playa", False),
    ("code-mockup", "esta función de la api devuelve un json", True),
    ("code-mockup", "me gusta pasear por el monte los domingos", False),
    ("search-bar", "¿cómo se audita un repositorio?", True),
    ("search-bar", "se audita el repositorio con un comando", False),
    ("chapter-card", "el primer paso es clonar el repo", True),
    ("chapter-card", "clonamos el repositorio y ya está", False),
]


@pytest.mark.parametrize("tpl,txt,esperado", GUARDIAS,
                         ids=["%s:%s" % (t, "sí" if e else "no")
                              for t, _, e in GUARDIAS])
def test_guardias_semanticas(tpl, txt, esperado):
    """Hay plantillas que AFIRMAN algo: `terminal` dice «esto es un comando» y
    `search-bar` dice «alguien preguntó esto». Ponerlas para rellenar un hueco
    convierte el vídeo en una mentira pequeña y constante."""
    assert d.permite(tpl, txt) is esperado


def test_guardias_insensibles_a_tildes():
    """Whisper devuelve tildes de forma inconsistente, así que el disparador
    tiene que casar escrito de las dos maneras."""
    assert d.permite("code-mockup", "esta funcion devuelve un json") is True
    assert d.permite("code-mockup", "esta función devuelve un json") is True


def test_plantilla_sin_guardia_pasa_siempre():
    assert d.permite("plantilla-que-no-existe", "cualquier cosa") is True


# ==========================================================================
#  micro-FX por palabra (§15)
# ==========================================================================
def test_microfx_respeta_limites_de_palabra():
    """«no» no puede casar dentro de «nota». Está escrito en §15 y es el tipo
    de fallo que llena el vídeo de destellos."""
    assert d.micro_de("no") is not None
    assert d.micro_de("nota") is None
    assert d.micro_de("nogal") is None


def test_microfx_con_y_sin_tilde():
    assert d.micro_de("jamás") == d.micro_de("jamas")


def test_microfx_todos_alcanzables():
    """Cada efecto tiene que ser alcanzable por su disparador. Uno inalcanzable
    es una plantilla que se mantiene y no se usa nunca — y este barrido lo
    comprueba de verdad, ejecutando `micro_de` con una palabra sacada de cada
    patrón, en vez de fiarse de que la tabla esté bien escrita."""
    import re
    for tpl, patron in d.MICRO_FX:
        # primera alternativa del grupo: `\b(no|jamas|...)\b` -> «no»
        m = re.search(r"\(([^)|]+)", patron)
        assert m, "no sé extraer una palabra de %s" % patron
        palabra = m.group(1)
        assert d.micro_de(palabra) is not None, \
            "«%s» debería disparar %s y no dispara nada" % (palabra, tpl)


def test_microfx_sin_plantillas_duplicadas():
    tpls = [tpl for tpl, _ in d.MICRO_FX]
    assert len(set(tpls)) == len(tpls), "hay efectos duplicados en MICRO_FX"


def test_microfx_todas_las_plantillas_existen():
    import os
    disp = d.plantillas_disponibles()
    faltan = [tpl for tpl, _ in d.MICRO_FX if tpl not in disp]
    assert not faltan, "MICRO_FX apunta a plantillas que no existen: %s" % faltan


def test_microfx_no_dispara_con_palabras_vacias():
    for p in ("de", "la", "que", "en", "un"):
        assert d.micro_de(p) is None, "«%s» no debería disparar nada" % p


# ==========================================================================
#  refinado de copia (§12)
# ==========================================================================
def test_titular_no_inventa_palabras():
    """§12: se escogen palabras que YA están en la frase. Un titular que añade
    términos que el guion no dice es una mentira en pantalla."""
    txt = "OpenAI acaba de liberar el repositorio oficial de Codex Security"
    tit = d.refinar_titular(txt, maximo=4, minimo=2)
    if tit:
        origen = {w.lower().strip(".,") for w in txt.split()}
        for w in tit.split():
            assert w.lower().strip(".,") in origen, "ha inventado «%s»" % w


def test_titular_no_acaba_en_colgante():
    """«…a un LLM, pero Kimi»: una conjunción al final abre una oración que no
    cierra."""
    for txt in ["esto es una prueba de algo y",
                "el coste baja mucho pero",
                "vamos a ver cómo se hace esto de"]:
        tit = d.refinar_titular(txt, maximo=4, minimo=2)
        if tit:
            ultima = d.sin_tildes(tit.split()[-1].lower().strip(".,"))
            assert ultima not in d.COLGANTES, "acaba en «%s»" % ultima


def test_frase_devuelve_none_en_vez_de_media_frase():
    """§12: «cuando no sale copia limpia, el componente NO se coloca. Un hueco
    es mejor que media frase». Esta rama es la que reventaba el director
    entero: `cola(None)` con un AttributeError."""
    assert d.refinar_frase("no", 10) is None
    assert d.refinar_frase("y", 10) is None


def test_frase_conserva_la_negacion():
    """Si la frase negaba y el resumen no, el titular dice lo CONTRARIO que la
    voz en off. Antes que eso, ningún titular."""
    r = d.refinar_frase("esto no te va a costar miles de dólares nunca", 6)
    if r is not None:
        assert d._niega(r), "ha perdido la negación: «%s»" % r


def test_contenido_de_nunca_revienta():
    """Barrido sobre todas las plantillas que el director sabe rellenar, con
    textos hostiles. La rama de `highlighter-text` era la única de las ocho que
    no comprobaba el None y se llevaba por delante toda la pasada."""
    plantillas = sorted({t for _, _, cands in d.INTENCIONES for t in cands}
                        | set(d.NEUTRAS))
    textos = ["", "no", "y", "de la que", "hola", "a" * 200,
              "OpenAI libera Codex Security con auditoría estática y modelos",
              "el 80 por ciento de los repos tienen alguna vulnerabilidad"]
    for tpl in plantillas:
        for txt in textos:
            d.contenido_de(tpl, txt, 0)     # no debe lanzar


# ==========================================================================
#  troceado en frases
# ==========================================================================
def test_frases_cubren_todas_las_palabras():
    ps = palabras(*[("p%d" % i, i * 0.4, i * 0.4 + 0.3) for i in range(12)])
    fs = d.frases(ps, 0.32)
    total = sum(len(f["palabras"]) if "palabras" in f
                else len(f["txt"].split()) for f in fs)
    assert total == len(ps)


def test_frases_ordenadas():
    ps = palabras(*[("p%d" % i, i * 0.4, i * 0.4 + 0.3) for i in range(12)])
    fs = d.frases(ps, 0.32)
    for a, b in zip(fs, fs[1:]):
        assert b["ini"] >= a["ini"]
        assert a["fin"] >= a["ini"]


# ==========================================================================
#  intención -> componente
# ==========================================================================
def test_intencion_siempre_devuelve_candidatas():
    for txt in ["", "cualquier cosa sin patrón reconocible",
                "¿cómo se hace esto?", "un estudio dice que sube un 40%"]:
        nombre, cands = d.intencion_de(txt)
        assert isinstance(nombre, str)
        assert cands, "«%s» se queda sin candidatas" % txt


# ==========================================================================
#  §11 · la cámara se mide en fracciones, no en segundos absolutos
# ==========================================================================
FRACCIONES = [
    ("pieza de 60 s, la de referencia", 60.0),
    ("pieza de 40 s", 40.0),
    ("pieza de 81 s", 81.0),
    ("Reel corto de 25 s", 25.0),
]


@pytest.mark.parametrize("nombre,dur", FRACCIONES,
                         ids=[c[0][:18] for c in FRACCIONES])
def test_zoom_coincide_con_los_actos(nombre, dur):
    """§11 y §13 tienen que hablar de la misma frontera. Con segundos absolutos
    —`ini < 3.0` y `ini > dur - 8.0`— el gancho de cámara cubría el 7,5 % de una
    pieza de 40 s mientras el gancho narrativo es el 10 %, y el cierre el 20 %
    frente al 25 %. O sea que dejaban de coincidir justo en las piezas cortas,
    que son las que se hacen."""
    n = 20
    fin_gancho = d.ACTOS[0][2] * dur
    ini_cierre = d.ACTOS[-1][1] * dur

    # justo dentro del gancho -> 1.15
    assert d.zoom_de(0, n, fin_gancho * 0.5, dur) == 1.15
    # justo pasado el gancho, y lejos del cierre -> desarrollo
    medio = (fin_gancho + ini_cierre) / 2
    assert d.zoom_de(5, n, medio, dur) in (1.00, 1.12)
    # dentro del cierre -> 1.20
    assert d.zoom_de(5, n, ini_cierre + (dur - ini_cierre) * 0.5, dur) == 1.20


def test_zoom_escala_con_la_duracion():
    """La misma FRACCIÓN de dos piezas de distinta duración da la misma escala.
    Con segundos absolutos no era así, y eso es lo que se ha arreglado."""
    for frac in (0.03, 0.25, 0.50, 0.80, 0.95):
        a = d.zoom_de(5, 20, frac * 40.0, 40.0)
        b = d.zoom_de(5, 20, frac * 81.0, 81.0)
        assert a == b, "fracción %.2f: %s en 40 s y %s en 81 s" % (frac, a, b)


# ==========================================================================
#  §12 · RELLENABLES se aplica de verdad
# ==========================================================================
def test_pasos_flow_y_compare_ab_fuera_del_reparto():
    """§12: «quedan para planes escritos a mano». Eran candidatas automáticas de
    las intenciones `estructura_lista` y `comparacion`, y sin el filtro de
    RELLENABLES podían colocarse con `desc` y `meta` vacíos: tres barras sin
    contenido, que es peor que no ponerlas."""
    for tpl in ("pasos-flow", "compare-ab", "split-versus"):
        assert tpl not in d.RELLENABLES, tpl
    disp = d.plantillas_disponibles()
    orden = d.candidatas_para(["pasos-flow", "compare-ab"],
                              ["pasos-flow", "compare-ab"], {}, None, disp)
    assert "pasos-flow" not in orden and "compare-ab" not in orden


def test_candidatas_respeta_el_orden_declarado():
    """Las preferidas del acto van primero: el acto manda sobre la frase."""
    disp = d.plantillas_disponibles()
    orden = d.candidatas_para(["cierre-cta"], ["pills", "cita"], {}, None, disp)
    assert orden[0] == "cierre-cta"


def test_candidatas_nunca_repite_la_anterior():
    disp = d.plantillas_disponibles()
    orden = d.candidatas_para(["pills"], ["pills"], {}, "pills", disp)
    assert "pills" not in orden


def test_candidatas_no_repite_una_ya_usada():
    """§13: cuatro gráficos, uno por acto. Con cuatro, ninguna plantilla se
    repite — más estricto que el «tope» calculado de §11, que era letra muerta."""
    disp = d.plantillas_disponibles()
    orden = d.candidatas_para(["pills"], [], {"pills": 1}, None, disp)
    assert "pills" not in orden


def test_candidatas_tiene_respaldo():
    """Cuando la intención agota sus candidatas se coge la MENOS usada del
    catálogo. Sin respaldo, un acto que agotaba sus opciones no colocaba nada, y
    §13 pide uno por acto."""
    disp = d.plantillas_disponibles()
    orden = d.candidatas_para([], [], {}, None, disp)
    assert orden, "sin respaldo, el acto se queda vacío"
    assert all(c in d.RELLENABLES for c in orden)


def test_candidatas_respeta_requiere_cifra():
    """Rellenar un componente de cifra con un número deducido es inventarse un
    dato, y un gráfico que inventa datos es peor que no poner gráfico."""
    disp = d.plantillas_disponibles()
    orden = d.candidatas_para([], [], {}, None, disp, hay_cifra=False)
    assert not (set(orden) & d.REQUIERE_CIFRA)


# ==========================================================================
#  contradicciones dentro del propio fichero
# ==========================================================================
def test_cromo_y_rellenables_no_se_pisan():
    """`cinta` estaba en CROMO —«no son gráficos de contenido»— y a la vez en
    RELLENABLES, en NEUTRAS y como candidata de `estructura_lista`. De las dos
    afirmaciones, la que decía la verdad es la segunda."""
    assert not (d.CROMO & d.RELLENABLES)


def test_las_guardias_apuntan_a_plantillas_que_existen():
    """`faq-card` no existe en templates/: la guardia era inofensiva pero mentía
    sobre el catálogo."""
    disp = d.plantillas_disponibles()
    faltan = [t for t in d.PREGUNTA if t not in disp]
    assert not faltan, faltan


def test_las_candidatas_de_las_intenciones_existen():
    disp = d.plantillas_disponibles()
    faltan = sorted({c for _, _, cs in d.INTENCIONES for c in cs
                     if c not in disp})
    assert not faltan, "INTENCIONES apunta a plantillas que no existen: %s" % faltan


def test_rellenables_existen():
    disp = d.plantillas_disponibles()
    faltan = sorted(d.RELLENABLES - disp)
    assert not faltan, faltan
