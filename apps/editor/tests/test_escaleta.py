"""La escaleta: anclaje por palabra y auditoría de §12, §13 y §15.

`auditar()` es pura, así que se prueba con planes construidos a mano. Lo que se
comprueba es que cada regla se detecte POR SEPARADO y con el reparto correcto
entre error y desviación: esa distinción es lo que hace utilizable la auditoría.
Si todo fuera error, la pieza de Codex —que baja el aire de 12 s a 7,9 s a
propósito— no se podría escribir; si todo fuera aviso, repetir un micro-FX
pasaría desapercibido.
"""

from __future__ import annotations

import json
import os

import pytest

import escaleta
from conftest import keep, palabras


def tarjeta(capa, t, dur, template="pills.html", **extra):
    c = {"capa": capa, "template": template, "t": t, "duracion": dur,
         "config": {"duration": dur}}
    c.update(extra)
    return c


# ==========================================================================
#  Guion · anclar por palabra
# ==========================================================================
@pytest.fixture
def g():
    return escaleta.Guion(palabras(
        ("Auditar", 0.0, 0.5), ("fallos", 0.5, 0.9), ("de", 0.9, 1.0),
        ("dólares", 3.5, 3.8), ("trabajo.", 4.5, 5.1),
        ("de", 6.0, 6.1), ("Codex", 9.7, 10.1)))


def test_guion_encuentra_por_palabra(g):
    assert g.ini("Auditar") == pytest.approx(0.0)
    assert g.fin("trabajo") == pytest.approx(5.1)


def test_guion_ignora_tildes_y_puntuacion(g):
    """Whisper devuelve tildes de forma inconsistente y pega la puntuación a la
    palabra, así que la escaleta no puede depender de acertar ninguna de las
    dos."""
    assert g.ini("dolares") == g.ini("dólares")
    assert g.fin("trabajo") == g.fin("trabajo.")


def test_guion_respeta_desde(g):
    """«de» aparece dos veces. Sin `desde`, una escaleta que ancle a la segunda
    aparición cogería la primera y el gráfico caería 5 s antes."""
    assert g.ini("de") == pytest.approx(0.9)
    assert g.ini("de", desde=5.0) == pytest.approx(6.0)


def test_guion_aborta_con_una_pista(g):
    with pytest.raises(SystemExit) as e:
        g.ini("inexistente")
    assert "no encuentro la palabra" in str(e.value)


def test_guion_sugiere_lo_parecido(g):
    """Cuando el guion y la grabación no coinciden, decir qué se parece ahorra
    abrir el JSON a mano."""
    with pytest.raises(SystemExit) as e:
        g.ini("Auditoria")
    assert "Auditar" in str(e.value)


# ==========================================================================
#  §13 · densidad
# ==========================================================================
def test_aire_corto_es_desviacion_no_error():
    """La pieza de Codex baja el aire a 7,9 s a propósito, porque su acto 2 es
    full-motion y en 44 s no caben las dos cosas. Si esto fuera error, esa pieza
    no se podría escribir; si no se dijera nada, parecería cumplir §13."""
    err, desv = escaleta.auditar(
        [tarjeta("a", 0.0, 3.0), tarjeta("b", 8.0, 3.0)], [], 30.0, n_actos=2)
    assert not err
    assert any("aire entre" in d for d in desv)


def test_tarjetas_solapadas_si_son_error():
    err, _ = escaleta.auditar(
        [tarjeta("a", 0.0, 3.0), tarjeta("b", 2.0, 3.0)], [], 30.0, n_actos=2)
    assert any("se solapan" in e for e in err)


def test_duracion_fuera_de_rango_es_desviacion():
    _, desv = escaleta.auditar([tarjeta("a", 0.0, 8.0)], [], 30.0, n_actos=1)
    assert any("fuera de 2.5-3.5" in d for d in desv)


def test_numero_de_tarjetas():
    _, desv = escaleta.auditar([tarjeta("a", 0.0, 3.0)], [], 30.0, n_actos=4)
    assert any("para 4 actos" in d for d in desv)


def test_plan_conforme_no_dice_nada():
    ts = [tarjeta("a", 0.0, 3.0), tarjeta("b", 15.0, 3.0),
          tarjeta("c", 30.0, 3.0), tarjeta("d", 45.0, 3.0)]
    err, desv = escaleta.auditar(ts, [], 60.0, n_actos=4)
    assert not err and not desv, (err, desv)


# ==========================================================================
#  §15 · presupuesto de micro-FX
# ==========================================================================
def test_tope_de_microfx_es_error():
    """Sin presupuesto, «no» y «modelo» aparecen tantas veces en un guion
    técnico que el vídeo se llena de destellos: el efecto pasa de subrayar a
    ser ruido.

    Los 45 s son los de la pieza sobre la que se calibró el seis."""
    ms = [tarjeta("m%d" % i, i * 5.0, 1.0, template="t%d.html" % i)
          for i in range(7)]
    err, _ = escaleta.auditar([], ms, 45.0, n_actos=0)
    assert any("el tope es 6" in e for e in err)


def test_el_presupuesto_de_microfx_crece_con_la_pieza():
    """Lo que §15 protege es la DENSIDAD, no el número. Seis acentos en 45 s
    es un acento cada 7,5 s; los mismos seis en 90 s es la mitad de gramática,
    y aplicar la cifra tal cual no conserva la regla: la aprieta. El tope sube
    con la duración y nunca baja de seis, que es donde deja de haber
    vocabulario."""
    assert escaleta.tope_microfx(45.0) == 6
    assert escaleta.tope_microfx(20.0) == 6      # nunca menos de seis
    assert escaleta.tope_microfx(90.0) == 12
    ms = [tarjeta("m%d" % i, i * 5.0, 1.0, template="t%d.html" % i)
          for i in range(7)]
    err, _ = escaleta.auditar([], ms, 90.0, n_actos=0)
    assert not any("el tope es" in e for e in err), err


def test_repetir_un_efecto_es_error():
    """El mismo destello tres veces deja de significar algo: se lee como un tic
    del montaje, no como una decisión. No hay ninguna configuración en la que
    esté bien, así que es error y no aviso."""
    ms = [tarjeta("m1", 0.0, 1.0, template="stamp-banned.html"),
          tarjeta("m2", 20.0, 1.0, template="stamp-banned.html")]
    err, _ = escaleta.auditar([], ms, 60.0, n_actos=0)
    assert any("UNA vez" in e for e in err)


def test_separacion_corta_es_desviacion():
    ms = [tarjeta("m1", 0.0, 1.0, template="a.html"),
          tarjeta("m2", 3.0, 1.0, template="b.html")]
    err, desv = escaleta.auditar([], ms, 60.0, n_actos=0)
    assert not err
    assert any("entre «m1» y «m2»" in d for d in desv)


def test_microfx_dentro_de_tarjeta():
    ts = [tarjeta("c", 0.0, 3.0)]
    ms = [tarjeta("m", 1.0, 1.0, template="a.html")]
    _, desv = escaleta.auditar(ts, ms, 60.0, n_actos=1)
    assert any("cae DENTRO" in d for d in desv)


def test_microfx_dentro_de_tarjeta_declarado():
    """La composición que la pieza de Codex pide: el visor superpuesto al tercer
    nodo del lienzo full-motion, donde no hay cara que esquivar. Se declara con
    `colocar=False`, la misma marca que respeta `colocar.py`."""
    ts = [tarjeta("c", 0.0, 3.0)]
    ms = [tarjeta("m", 1.0, 1.0, template="a.html", colocar=False)]
    _, desv = escaleta.auditar(ts, ms, 60.0, n_actos=1)
    assert not any("cae DENTRO" in d for d in desv)


def test_aire_alrededor_de_tarjeta():
    ts = [tarjeta("c", 0.0, 3.0)]
    ms = [tarjeta("m", 3.2, 1.0, template="a.html")]   # 0,2 s < 0,6
    _, desv = escaleta.auditar(ts, ms, 60.0, n_actos=1)
    assert any("a 0.20 s de" in d for d in desv)


# ==========================================================================
#  §12 · el cierre
# ==========================================================================
def test_cierre_fuera_del_ultimo_15_pct():
    ts = [tarjeta("cierrecta", 10.0, 3.0, template="cierre-cta.html")]
    _, desv = escaleta.auditar(ts, [], 60.0, n_actos=1)
    assert any("último 15" in d for d in desv)


def test_cierre_en_su_sitio():
    ts = [tarjeta("cierrecta", 52.0, 3.0, template="cierre-cta.html")]
    _, desv = escaleta.auditar(ts, [], 60.0, n_actos=1)
    assert not any("último 15" in d for d in desv)


# ==========================================================================
#  que todo quepa
# ==========================================================================
def test_capa_que_se_sale_del_final_es_error():
    err, _ = escaleta.auditar([tarjeta("a", 28.0, 3.0)], [], 30.0, n_actos=1)
    assert any("y la pieza dura" in e for e in err)


def test_t_negativo_es_error():
    err, _ = escaleta.auditar([tarjeta("a", -1.0, 3.0)], [], 30.0, n_actos=1)
    assert any("negativo" in e for e in err)


# ==========================================================================
#  la Escaleta completa
# ==========================================================================
def _timeline():
    ws = palabras(("uno", 0.0, 0.4), ("dos", 1.0, 1.4), ("tres", 2.0, 2.4),
                  ("cuatro", 3.0, 3.4), ("cinco", 4.0, 4.4))
    return {"reloj": "origen", "source": "x.mp4", "words": ws, "blocks": [],
            "keep": keep((0.0, 5.0)),
            "duration_original": 5.0, "duration_final": 5.0}


def test_escaleta_exige_reloj_de_origen():
    tl = _timeline()
    tl["reloj"] = "salida"
    with pytest.raises(SystemExit):
        escaleta.Escaleta(tl)


def test_escaleta_deriva_las_ventanas_de_las_tarjetas():
    """§12: los subtítulos se clavan abajo mientras hay una tarjeta en pantalla.
    Las ventanas se DERIVAN de las tarjetas para que no se puedan olvidar."""
    e = escaleta.Escaleta(_timeline())
    e.tarjeta("a", "pills.html", dur=1.0, ancla="dos")
    e.subtitulos()
    v = e.subs["config"]["ventanas"]
    assert v == [{"ini": 1.0, "fin": 2.0}]


def test_escaleta_quita_las_marcas_internas_del_plan():
    """`_ancla` es documentación de la escaleta, no del plan: si llegara al
    fichero, el lint la vería como una clave de config muerta."""
    e = escaleta.Escaleta(_timeline())
    e.tarjeta("a", "pills.html", dur=1.0, ancla="dos")
    assert all(not k.startswith("_") for c in e.plan() for k in c)


def test_escaleta_duration_va_primero_en_la_config():
    """El orden de las claves es el que sale al fichero. Añadir `duration` al
    final cambiaba el JSON byte a byte sin cambiar el contenido, y eso enseña
    ruido en los diffs y descuadra los goldens sin motivo."""
    e = escaleta.Escaleta(_timeline())
    c = e.tarjeta("a", "pills.html", dur=1.0, ancla="dos",
                  config={"y": 900, "tam": 60})
    assert list(c["config"])[0] == "duration"


def test_camara_interseca_en_vez_de_reemplazar():
    """Reemplazar los `keep` descartaba el recorte que clean_transcript acababa
    de calcular. Salía bien de milagro porque silencios.py vuelve a medir el
    audio, pero un recorte que solo supiera el timeline —una toma falsa por
    Levenshtein, que el audio no delata— se perdía en silencio."""
    tl = _timeline()
    tl["keep"] = keep((0.0, 2.0), (3.0, 5.0))     # ya hay un corte
    e = escaleta.Escaleta(tl)
    e.plano(hasta=1.0, zoom=1.15, desde=0.0)
    e.plano(hasta=5.0, zoom=1.00)
    k = e.keep_con_camara()

    # el corte de silencio en [2,3] sigue ahí
    assert not any(x["src_start"] < 3.0 < x["src_end"] for x in k)
    # y los tramos de cámara han partido el primero
    assert {x["zoom"] for x in k} == {1.15, 1.00}
    # la salida sigue encadenada
    cursor = 0.0
    for x in k:
        assert x["out_start"] == pytest.approx(cursor, abs=1e-3)
        cursor = x["out_end"]


def test_camara_no_alarga_el_metraje():
    tl = _timeline()
    e = escaleta.Escaleta(tl)
    e.plano(hasta=2.0, zoom=1.15, desde=0.0)
    e.plano(hasta=5.0, zoom=1.20)
    antes = sum(k["src_end"] - k["src_start"] for k in tl["keep"])
    ahora = sum(k["src_end"] - k["src_start"] for k in e.keep_con_camara())
    assert ahora <= antes + 1e-9


# ==========================================================================
#  la escaleta real de la pieza
# ==========================================================================
def test_la_escaleta_de_codex_se_construye(raiz):
    """Se construye contra el timeline real y se audita, sin escribir nada. Es
    la prueba de que el módulo sirve para lo que se extrajo."""
    p = os.path.join(raiz, "build", "timeline.json")
    if not os.path.exists(p):
        pytest.skip("no hay build/timeline.json")
    import plan_codex
    tl = json.load(open(p, encoding="utf-8"))
    if tl.get("reloj") != "origen":
        pytest.skip("el timeline está remapeado; hace falta clean_transcript")
    # `build/` es de la pieza EN CURSO, y esta prueba es de la de Codex. Con
    # otra pieza montada, `escaleta` aborta buscando «Auditar» —la primera
    # ancla del plan— y la prueba salía en rojo por tener otro trabajo
    # encima, no por una regresión. Se comprueba que el timeline sea el suyo
    # antes de exigirle nada: la alternativa es que `make rapido` se ponga
    # rojo cada vez que alguien monta otra cosa.
    #
    # «auditar» sola no basta y por poco: el guion de sesgos con hooks trae
    # «¿Auditar el sesgo de tu IA…», así que el guardián dejaba pasar una
    # pieza que no es la de Codex y la prueba salía en rojo por eso. Hacen
    # falta DOS anclas, y la segunda propia de la pieza.
    dichas = {w.get("w", "").strip(".,;:¿?«»").lower()
              for w in tl.get("words") or []}
    if not {"auditar", "codex"} <= dichas:
        pytest.skip("build/ tiene otra pieza montada, no la de Codex")

    e = plan_codex.construir(tl)
    err, desv = e.auditar()
    assert not err, err
    # Las tres desviaciones conocidas y documentadas de esta pieza.
    assert len(desv) == 3, desv
    assert len(e.tarjetas) == 4 and len(e.microfx) == 3
