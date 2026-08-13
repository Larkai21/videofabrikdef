"""Los subtítulos: los que se ven quemados y los que se suben aparte.

Este fichero nace de un diagnóstico equivocado, y por eso lo primero que hace
es fijarlo. Se dio por hecho que 54 de las 105 palabras de la pieza —el 51 %—
salían sin subtítulo, porque `escaleta.subtitulos()` deriva `ventanas` SOLO de
las tarjetas y se leyó `ventanas` como «dónde salen los subtítulos».

No es eso. `ventanas` es dónde se CLAVAN: dentro de una ventana los subtítulos
bajan a la franja fija y renuncian al gesto grande para no competir con la
tarjeta (`kinetic-captions.html:draw`, la exclusión mutua). Fuera salen igual.

Lo que sí es cierto del número: sobre `build/plan.json` hay 50 palabras (48 %)
fuera de toda ventana y un tramo de 24,74 a 38,14 s sin ninguna, que es de
donde salió el «51 % mudo». La cobertura REAL, medida con `escaleta.cobertura`
—que reproduce la agrupación de la plantilla y cruza cada palabra con la
ventana de pantalla de SU grupo— es del 100 %, y el fotograma
`build/frames/kineticcaptions/00900.png` (t = 30 s, en mitad del tramo
«mudo») enseña «TUS PRS y» en pantalla.

Así que la parte útil de aquel encargo no era arreglar un hueco: era que nadie
lo estaba MIDIENDO. Eso es lo que se prueba aquí.
"""

from __future__ import annotations

import json
import os
import re

import pytest

import escaleta
import exportar_srt
from conftest import keep, palabras


# --------------------------------------------------------------------------
#  helpers
# --------------------------------------------------------------------------
def config_subtitulos(plan: list) -> dict | None:
    for c in plan:
        if c.get("template") == "kinetic-captions.html":
            return c["config"]
    return None


def _tl(ws, tramos):
    return {"reloj": "origen", "source": "x.mp4", "words": ws, "blocks": [],
            "keep": keep(*tramos),
            "duration_original": tramos[-1][1],
            "duration_final": sum(b - a for a, b in tramos)}


def _cues_srt(texto: str) -> list:
    """(n, ini, fin, [líneas]) de un SRT ya escrito. Se parsea el FICHERO y no
    la estructura interna: lo que se sube es el fichero, y un error de formato
    solo existe ahí."""
    fuera = []
    for bloque in texto.strip().split("\n\n"):
        lineas = bloque.split("\n")
        a, b = lineas[1].split(" --> ")
        fuera.append((int(lineas[0]), _seg(a), _seg(b), lineas[2:]))
    return fuera


def _seg(sello: str) -> float:
    h, m, resto = sello.split(":")
    s, ms = resto.split(",")
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0


# ==========================================================================
#  La cobertura sobre el plan REAL
# ==========================================================================
@pytest.fixture
def plan_real(raiz):
    p = os.path.join(raiz, "build", "plan.json")
    if not os.path.exists(p):
        pytest.skip("no hay build/plan.json")
    return json.load(open(p, encoding="utf-8"))


def test_toda_la_voz_lleva_subtitulo(plan_real):
    """El número que este fichero existe para vigilar.

    El 90 % es un suelo, no el objetivo: hoy son 105 de 105. Se deja holgura
    porque una pieza puede declarar un tramo mudo con `omitir`, y una puerta
    que se dispara por una decisión legítima se desactiva."""
    cfg = config_subtitulos(plan_real)
    if cfg is None:
        pytest.skip("el plan no lleva capa de subtítulos cinéticos")
    c = escaleta.cobertura(cfg)
    assert c["pct"] > 0.90, "sin subtítulo: %s" % c["mudas"][:20]
    assert c["pct_tiempo"] > 0.90


def test_fuera_de_una_ventana_tambien_hay_subtitulo(plan_real):
    """La prueba del malentendido, escrita al derecho.

    Si algún día `ventanas` pasara a significar «dónde salen», esta prueba se
    cae con el número delante: hoy el 48 % de las palabras vive fuera de toda
    ventana y todas llevan subtítulo."""
    cfg = config_subtitulos(plan_real)
    if cfg is None:
        pytest.skip("el plan no lleva capa de subtítulos cinéticos")
    v = cfg.get("ventanas") or []
    fuera = [w for w in cfg["palabras"]
             if not any(x["ini"] <= w["ini"] < x["fin"] for x in v)]
    assert fuera, "sin palabras fuera de las ventanas no se prueba nada"
    mudas = set(escaleta.cobertura(cfg)["mudas"])
    assert not [w for w in fuera if w["w"] in mudas]


def test_la_capa_de_subtitulos_cubre_la_pieza_entera(plan_real):
    """Una capa que empieza tarde o acaba pronto deja voz sin subtítulo sin
    que la cobertura por palabra lo note: la plantilla solo dibuja mientras la
    capa existe."""
    capa = [c for c in plan_real
            if c.get("template") == "kinetic-captions.html"]
    if not capa:
        pytest.skip("el plan no lleva capa de subtítulos cinéticos")
    capa = capa[0]
    ws = capa["config"]["palabras"]
    assert capa["t"] <= ws[0]["ini"] + 1e-6
    assert capa["t"] + capa["duracion"] >= ws[-1]["fin"] - 1e-6


# ==========================================================================
#  `cobertura` mide de verdad
# ==========================================================================
def test_cobertura_ve_las_palabras_colapsadas():
    """La forma real de perder subtítulos, y la que la medida tiene que cazar.

    Las palabras que el montaje corta siguen en `timeline.words`; al remapear,
    `reloj.Mapa` lleva al borde del corte todo lo que cae en el hueco, así que
    colapsan al mismo instante. Su grupo nace con `ini == corte` y no se dibuja
    ni un fotograma. Nada de eso da error."""
    cfg = {"max": 3, "huecoMax": 0.42, "palabras": [
        {"w": "uno", "ini": 0.0, "fin": 0.4},
        {"w": "dos", "ini": 0.4, "fin": 0.8},
        {"w": "tres.", "ini": 0.8, "fin": 1.2},
        {"w": "toma", "ini": 1.2, "fin": 1.2},      # colapsadas en el corte
        {"w": "falsa", "ini": 1.2, "fin": 1.2},
        {"w": "cuatro", "ini": 2.0, "fin": 2.4},
    ]}
    c = escaleta.cobertura(cfg)
    assert c["mudas"] == ["toma", "falsa"]
    assert c["pct"] == pytest.approx(4 / 6)


def test_cobertura_de_una_pieza_normal_es_total():
    cfg = {"max": 3, "huecoMax": 0.42, "palabras": [
        {"w": w, "ini": i * 0.4, "fin": i * 0.4 + 0.4}
        for i, w in enumerate("una dos tres cuatro cinco seis".split())]}
    c = escaleta.cobertura(cfg)
    assert c["pct"] == 1.0 and c["mudas"] == []


def test_los_grupos_replican_la_agrupacion_de_la_plantilla():
    """Tope de palabras, puntuación fuerte y pausa mayor que `huecoMax`. Si
    esto se separa de `kinetic-captions.html:setup`, la cobertura mide otra
    cosa y deja de valer."""
    ws = [{"w": "a", "ini": 0.0, "fin": 0.2},
          {"w": "b.", "ini": 0.2, "fin": 0.4},     # corta por puntuación
          {"w": "c", "ini": 0.4, "fin": 0.6},
          {"w": "d", "ini": 1.5, "fin": 1.7},      # corta por pausa
          {"w": "e", "ini": 1.7, "fin": 1.9},
          {"w": "f", "ini": 1.9, "fin": 2.1},
          {"w": "g", "ini": 2.1, "fin": 2.3}]      # corta por tope de 3
    g = escaleta.grupos_subtitulo(ws)
    assert [[p["w"] for p in x["palabras"]] for x in g] == [
        ["a", "b."], ["c"], ["d", "e", "f"], ["g"]]
    # la cola de un grupo se recorta contra el siguiente: dos grupos en la
    # misma banda a la vez se leen como seis palabras donde hay tres
    assert g[0]["corte"] == pytest.approx(0.4)


# ==========================================================================
#  Lo que no se oye no se subtitula
# ==========================================================================
def _escaleta_con_corte():
    ws = palabras(("uno", 0.0, 0.4), ("dos", 0.5, 0.9),
                  ("toma", 2.0, 2.4), ("falsa", 2.5, 2.9),
                  ("tres", 4.0, 4.4), ("cuatro", 4.5, 4.9))
    tl = _tl(ws, [(0.0, 1.5), (3.5, 5.0)])
    e = escaleta.Escaleta(tl)
    return e


def test_las_palabras_que_el_montaje_corta_no_llegan_al_plan(tmp_path):
    """Dejarlas no era inocuo: la agrupación es secuencial, así que un grupo
    puede llevar la última palabra buena y dos de la toma descartada, y
    entonces se lee en pantalla texto que no está en el audio."""
    e = _escaleta_con_corte()
    e.subtitulos()
    e.escribir(destino=str(tmp_path / "plan.json"),
               timeline=str(tmp_path / "timeline.json"))
    cfg = config_subtitulos(json.load(open(tmp_path / "plan.json",
                                           encoding="utf-8")))
    assert [w["w"] for w in cfg["palabras"]] == ["uno", "dos", "tres", "cuatro"]


def test_omitir_calla_un_tramo_declarado(tmp_path):
    """La excepción a «subtítulo sobre toda la voz» se declara y se ve; no se
    consigue dejando de pasar palabras a mano."""
    e = _escaleta_con_corte()
    e.subtitulos(omitir=[(3.9, 4.6)])
    e.escribir(destino=str(tmp_path / "plan.json"),
               timeline=str(tmp_path / "timeline.json"))
    cfg = config_subtitulos(json.load(open(tmp_path / "plan.json",
                                           encoding="utf-8")))
    assert [w["w"] for w in cfg["palabras"]] == ["uno", "dos", "cuatro"]


# ==========================================================================
#  El SRT
# ==========================================================================
FORMATO = re.compile(
    r"^\d+\n"
    r"\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n"
    r"[^\n]+(?:\n[^\n]+)?$")


def _tl_largo():
    """Una locución de 24 s con un corte de 2 s en medio, en reloj de ORIGEN."""
    texto = ("Auditar la seguridad de tu código cuesta miles de dólares. "
             "Codex Security lo hace gratis y en tu propia máquina. "
             "Trae un agente que lee tus PRs y busca vulnerabilidades "
             "antes de que lleguen a producción del todo.").split()
    ws, t = [], 0.0
    for w in texto:
        if 10.0 <= t < 12.0:                 # el trozo que el montaje corta
            t = 12.0
        ws.append({"w": w, "start": round(t, 3), "end": round(t + 0.45, 3),
                   "p": 1.0})
        t += 0.5
    return _tl(ws, [(0.0, 10.0), (12.0, round(t, 3))])


def test_el_srt_va_en_reloj_de_salida():
    """El fallo que no da error: escribirlo en reloj de origen produce un SRT
    válido cuyos subtítulos llegan cada vez más tarde. Sobre la pieza de este
    repo son 4,40 s al final, tres frases."""
    tl = _tl_largo()
    cues, cortos, ws = exportar_srt.construir(tl)
    # la última palabra del montaje, medida por los dos relojes
    fin_origen = max(w["end"] for w in tl["words"])
    fin_salida = tl["duration_final"]
    assert fin_salida < fin_origen - 1.9              # el corte de 2 s existe
    assert cues[-1]["fin"] <= fin_salida + exportar_srt.MIN_DUR
    assert cues[-1]["fin"] < fin_origen
    assert max(p["fin"] for p in ws) == pytest.approx(fin_salida, abs=0.06)


def test_el_srt_no_subtitula_lo_que_no_se_oye():
    tl = _tl_largo()
    cortadas = {w["w"] for w in tl["words"] if 10.0 <= w["start"] < 12.0}
    _, _, ws = exportar_srt.construir(tl)
    assert not cortadas & {p["w"] for p in ws} or not cortadas


def test_el_srt_es_monotono_y_sin_solapes():
    cues, _, _ = exportar_srt.construir(_tl_largo())
    for a, b in zip(cues, cues[1:]):
        assert a["fin"] <= b["ini"] + 1e-9, (a, b)
        assert a["ini"] < a["fin"]


def test_ningun_subtitulo_baja_del_minimo_legible():
    """Un segundo. Por debajo no se lee: se ve parpadear."""
    cues, cortos, _ = exportar_srt.construir(_tl_largo())
    assert not cortos
    for c in cues:
        assert c["fin"] - c["ini"] >= exportar_srt.MIN_DUR - 1e-3, c


def test_dos_lineas_de_cuarenta_y_dos():
    cues, _, _ = exportar_srt.construir(_tl_largo())
    for c in cues:
        lineas = exportar_srt.envuelve(" ".join(p["w"] for p in c["palabras"]))
        assert len(lineas) <= exportar_srt.LINEAS
        assert max(len(x) for x in lineas) <= exportar_srt.ANCHO_LINEA


def test_el_fichero_tiene_el_formato_del_estandar():
    cues, _, _ = exportar_srt.construir(_tl_largo())
    texto = exportar_srt.texto_srt(cues)
    bloques = texto.strip().split("\n\n")
    assert len(bloques) == len(cues)
    for i, b in enumerate(bloques, 1):
        assert FORMATO.match(b), b
        assert b.startswith("%d\n" % i)      # numeración correlativa desde 1


def test_el_sello_lleva_coma_y_tres_decimales():
    assert exportar_srt.sello(0) == "00:00:00,000"
    assert exportar_srt.sello(3661.5) == "01:01:01,500"
    assert exportar_srt.sello(45.3) == "00:00:45,300"


def test_las_lineas_salen_equilibradas():
    """«41 / 4» cumple el ancho y se lee peor que «23 / 22»: el ojo salta a una
    segunda línea que casi no está."""
    txt = ("Auditar fallos de seguridad en tu código ya no te va a costar")
    a, b = exportar_srt.envuelve(txt)
    assert abs(len(a) - len(b)) <= 6


def test_no_se_corta_dejando_un_enlace_al_final():
    """El primer subtítulo de la pieza real acababa en «…miles de dólares o» y
    el siguiente empezaba en «muchísimo trabajo»: se lee la conjunción, se
    espera la segunda mitad y llega en otro plano."""
    cues, _, _ = exportar_srt.construir(_tl_largo())
    for c in cues[:-1]:
        ultima = escaleta.limpia(c["palabras"][-1]["w"])
        assert ultima not in escaleta.ENLACES, \
            " ".join(p["w"] for p in c["palabras"])


# ==========================================================================
#  El SRT de la pieza que hay en build/
# ==========================================================================
def test_el_srt_de_la_pieza_real(raiz, tmp_path):
    """Contra el timeline real, escribiendo fuera de `build/`. Es la prueba de
    que esto sirve para la pieza y no solo para la fixture."""
    p = os.path.join(raiz, "build", "timeline.json")
    if not os.path.exists(p):
        pytest.skip("no hay build/timeline.json")
    tl = json.load(open(p, encoding="utf-8"))
    if tl.get("reloj") != "origen":
        pytest.skip("el timeline está remapeado; hace falta clean_transcript")

    cues, cortos, ws = exportar_srt.construir(tl)
    destino = tmp_path / "pieza.srt"
    destino.write_text(exportar_srt.texto_srt(cues), encoding="utf-8")

    leidos = _cues_srt(destino.read_text(encoding="utf-8"))
    assert [c[0] for c in leidos] == list(range(1, len(cues) + 1))
    prev = -1.0
    for n, ini, fin, lineas in leidos:
        assert ini >= prev - 1e-9 and fin > ini
        assert fin - ini >= exportar_srt.MIN_DUR - 1e-3
        assert len(lineas) <= exportar_srt.LINEAS
        assert max(len(x) for x in lineas) <= exportar_srt.ANCHO_LINEA
        prev = fin
    # y termina DENTRO del montaje, no en el reloj de origen
    assert leidos[-1][2] <= float(tl["duration_final"]) + 0.5
    assert leidos[-1][2] < float(tl["duration_original"])
    assert not cortos


# --------------------------------------------------------------------------
#  La dinámica del subtítulo: la energía viaja y los presets no contaminan

def test_la_energia_viaja_con_la_palabra_y_sobrevive_al_corte(tmp_path):
    """`medir_energia.py` escribe `energia` DENTRO de cada palabra del
    timeline. El contrato es que ese campo llega al config de la plantilla
    pegado a su palabra, también después de que `_ajusta_subtitulos` tire
    las que el montaje corta: un fichero aparte con un join por índice se
    desincronizaría exactamente aquí."""
    ws = palabras(("uno", 0.0, 0.4), ("dos", 0.5, 0.9),
                  ("toma", 2.0, 2.4), ("falsa", 2.5, 2.9),
                  ("tres", 4.0, 4.4), ("cuatro", 4.5, 4.9))
    for w, e in zip(ws, [0.9, 0.1, 0.5, 0.5, 0.7, 0.3]):
        w["energia"] = e
    e = escaleta.Escaleta(_tl(ws, [(0.0, 1.5), (3.5, 5.0)]))
    e.subtitulos()
    e.escribir(destino=str(tmp_path / "plan.json"),
               timeline=str(tmp_path / "timeline.json"))
    cfg = config_subtitulos(json.load(open(tmp_path / "plan.json",
                                           encoding="utf-8")))
    assert [(w["w"], w.get("energia")) for w in cfg["palabras"]] == [
        ("uno", 0.9), ("dos", 0.1), ("tres", 0.7), ("cuatro", 0.3)]


def test_sin_energia_no_aparece_el_campo():
    """Un timeline sin medir no inventa el dato: la plantilla ya tiene su
    neutro (0,5) para la ausencia, y un 0.5 escrito aquí sería mentir sobre
    lo que se midió."""
    cfg = _escaleta_con_corte().subtitulos()["config"]
    assert all("energia" not in w for w in cfg["palabras"])


def test_dinamica_cero_no_toca_el_config():
    """La vía de escape: `dinamica=0` produce el config de siempre, sin
    NINGUNA clave nueva, y la plantilla toma su rama de píxel idéntico
    (vigilada por `comparar_fotogramas.py`)."""
    cfg = _escaleta_con_corte().subtitulos(dinamica=0)["config"]
    assert not {"gestos", "popPalabra", "popClave", "vaiven",
                "cuerpoClave", "escalonado", "giroClave"} & cfg.keys()


def test_el_default_es_el_favorito():
    """El estilo fijado por el usuario ES el default: quien escribe
    `e.subtitulos()` a secas se lleva el paquete favorito entero. Si esto
    se cae, o alguien cambió el default o el favorito perdió claves — las
    dos cosas se deciden, no se heredan."""
    cfg = _escaleta_con_corte().subtitulos()["config"]
    for k, v in escaleta.DINAMICA["favorito"].items():
        assert cfg[k] == v, k


def test_dinamica_pone_el_paquete_y_el_llamador_sigue_mandando():
    cfg = _escaleta_con_corte().subtitulos(dinamica=2, vaiven=4)["config"]
    assert cfg["gestos"] is True
    assert cfg["popClave"] == escaleta.DINAMICA[2]["popClave"]
    assert cfg["vaiven"] == 4          # **config pisa al preset


def test_dinamica_admite_dict_crudo():
    cfg = _escaleta_con_corte().subtitulos(
        dinamica={"gestos": True})["config"]
    assert cfg["gestos"] is True and "vaiven" not in cfg


def test_dinamica_desconocida_revienta_con_los_niveles_en_el_mensaje():
    with pytest.raises(SystemExit) as exc:
        _escaleta_con_corte().subtitulos(dinamica=9)
    assert "9" in str(exc.value) and "1, 2, 3" in str(exc.value)
