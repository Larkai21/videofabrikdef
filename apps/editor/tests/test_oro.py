"""Los goldens, y la medición del ítem J abierto del ROADMAP.

Se regeneran con `make oro`, nunca automáticamente: un golden creado sobre un
bug lo convierte en especificación.

Cada golden se compara por PARTES y con una afirmación propia. Comparar el
fichero entero de una vez diría «cambió algo» y habría que abrir un diff para
saber qué; comparado por partes, el fallo dice si se movió el recorte de
silencio, el grading, el sonido o la maquetación.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORO = os.path.join(RAIZ, "tests", "fixtures", "oro")
PY = sys.executable

import oro as generador                       # noqa: E402


def cargar(nombre):
    ruta = os.path.join(ORO, nombre)
    if not os.path.exists(ruta):
        pytest.skip("falta el golden %s (ejecuta `make oro`)" % nombre)
    with open(ruta, encoding="utf-8") as f:
        return json.load(f)


# ==========================================================================
#  timeline: clean_transcript es puro, así que el golden es exacto
# ==========================================================================
@pytest.fixture(scope="module")
def tl_oro():
    return cargar("timeline.json")


@pytest.fixture(scope="module")
def tl_ahora():
    return generador.timeline_desde_transcript()


def test_timeline_keep(tl_oro, tl_ahora):
    assert tl_ahora["keep"] == tl_oro["keep"]


def test_timeline_words(tl_oro, tl_ahora):
    assert tl_ahora["words"] == tl_oro["words"]


def test_timeline_blocks(tl_oro, tl_ahora):
    assert tl_ahora["blocks"] == tl_oro["blocks"]


def test_timeline_stats(tl_oro, tl_ahora):
    assert tl_ahora["stats"] == tl_oro["stats"]


def test_timeline_reloj(tl_oro, tl_ahora):
    assert tl_ahora["reloj"] == tl_oro["reloj"] == "origen"


# ==========================================================================
#  silencios: EL golden de más valor del repo
# ==========================================================================
@pytest.fixture(scope="module")
def sil_oro():
    return cargar("silencios.json")


@pytest.fixture(scope="module")
def sil_ahora():
    return generador.silencios_aplicados()


def test_silencios_informe(sil_oro, sil_ahora):
    """Fija la etapa cuyo fallo es invisible por definición, y sin necesitar
    audio ni ffmpeg: la lista de silencios va inyectada. Los dos números que más
    han cambiado en este repo están aquí: `huecos_sin_palabra` (que llegó a
    valer 0 cuando debía valer 12) y `segundos_de_silencio` (2,19 frente a
    17,68)."""
    assert sil_ahora["informe"] == sil_oro["informe"]


def test_silencios_keep(sil_oro, sil_ahora):
    assert sil_ahora["timeline"]["keep"] == sil_oro["timeline"]["keep"]


def test_silencios_no_mueve_las_palabras(sil_oro, sil_ahora):
    """`words` se queda en reloj de ORIGEN: es lo que compra la idempotencia."""
    assert sil_ahora["timeline"]["words"] == sil_oro["timeline"]["words"]


def test_silencios_plan_remapeado(sil_oro, sil_ahora):
    assert sil_ahora["plan"] == sil_oro["plan"]


def test_silencios_tiempo_relativo_en_capa_desplazada(sil_ahora):
    """El caso que el remapeo viejo hacía mal y que solo acertaba porque las
    capas con listas de tiempos viven en `t: 0`. Aquí la capa está en t>0."""
    cta = next(c for c in sil_ahora["plan"] if c["capa"] == "cierrecta")
    assert cta["t"] > 1.0, "esta prueba necesita una capa en t>0"
    assert cta["config"]["pulsacion"] == pytest.approx(0.9, abs=0.05)


# ==========================================================================
#  LUT: `transformar` es pura y el grading no tenía ninguna red
# ==========================================================================
def test_luts():
    """Un cambio de curva salía en el vídeo y en ningún log. El md5 lo fija."""
    assert generador.luts() == cargar("luts.json")


# ==========================================================================
#  SFX: duración, pico y RMS. No bytes.
# ==========================================================================
def test_sfx():
    """Los bytes cambiarían con cualquier versión de ffmpeg y no dicen nada del
    sonido; un pico que se mueve 3 dB sí. Fija además los +3,2 dB de los
    impactos que se calibraron en la tanda 1."""
    ahora, esperado = generador.sfx(), cargar("sfx.json")
    assert set(ahora) == set(esperado)
    for n in sorted(esperado):
        assert ahora[n] == esperado[n], n


# ==========================================================================
#  anclas: maquetación, no rasterización
# ==========================================================================
@pytest.mark.render
def test_anclas():
    """`getBoundingClientRect` a un instante fijo. Es lo ÚNICO geométrico que se
    puede congelar: los píxeles de un render multicapa a 25 fps no son
    reproducibles (ítem J), pero la maquetación sí."""
    if not shutil.which("node"):
        pytest.skip("hace falta node")
    ahora, esperado = generador.anclas(), cargar("anclas.json")
    assert set(ahora) == set(esperado), \
        "el catálogo ha cambiado: %s" % (set(ahora) ^ set(esperado))
    for f in sorted(esperado):
        assert ahora[f] == esperado[f], f


# ==========================================================================
#  el plan del director: RESUMEN, no el plan
# ==========================================================================
def test_resumen_del_plan():
    """El plan completo se pondría rojo cada tanda —`plantillas_disponibles()`
    lee el directorio—, así que se fija el resumen. Sigue cazando que el
    director deje de emitir micro-FX o que un acto se quede vacío."""
    ahora, esperado = generador.resumen_de_plan(), cargar("resumen_plan.json")
    for k in ("capas", "reparto", "tarjetas_de_acto", "microfx",
              "separacion_minima_tarjetas", "separacion_minima_microfx",
              "zooms", "cronologia", "cronologia_microfx"):
        assert ahora[k] == esperado[k], k


def test_el_director_cumple_la_densidad_de_13():
    """§13 pide cuatro gráficos, uno por acto, con 12 s de aire. Antes salían 3
    de 4 y el aire se medía mezclando carriles. Esto lo fija como comportamiento,
    no como aspiración."""
    import dirigir
    r = generador.resumen_de_plan()
    assert r["tarjetas_de_acto"] == len(dirigir.ACTOS), r["cronologia"]
    assert r["separacion_minima_tarjetas"] >= dirigir.SEPARACION_MIN - 0.05
    assert r["separacion_minima_microfx"] is None or \
        r["separacion_minima_microfx"] >= dirigir.SEP_MICRO - 0.05
    # §11: ninguna plantilla dos veces en la misma pieza.
    tpls = [t for _, t in r["cronologia"]]
    assert len(set(tpls)) == len(tpls), tpls


# ==========================================================================
#  el ítem J: convertirlo en un número en vez de dejarlo esperando
# ==========================================================================
@pytest.mark.render
def test_reproducibilidad_de_la_capa_cinetica(tmp_path):
    """El ROADMAP tiene abierto que dos renders del plan completo a 25 fps dan
    fotogramas distintos en la capa `kinetic`, y deja pendiente «cuantificar la
    diferencia». Esto lo cuantifica en cada ejecución del nivel de render, en vez
    de esperar una sesión dedicada.

    Es INFORMATIVA a propósito: no falla por la diferencia, la registra. Lo que
    sí afirma es el veredicto que el propio repo calibró en
    `comparar_fotogramas` —«ruido de rasterización» con `max <= 4` y
    `media < 0.05`—: si la desviación pasa de ahí, ya no son bordes
    antialiasados y hay que mirarlo.
    """
    if not shutil.which("node"):
        pytest.skip("hace falta node")
    import comparar_fotogramas as cf

    tl = generador.timeline_desde_transcript()
    ws = tl["words"][:24]
    plan = [{"capa": "kineticcaptions", "template": "kinetic-captions.html",
             "t": 0.0, "duracion": 4.0,
             "config": {"duration": 4.0, "zona": "abajo", "tam": 92,
                        "palabras": [{"w": w["w"], "ini": w["start"],
                                      "fin": w["end"]} for w in ws]}}]

    dirs = []
    for i in (1, 2):
        d = str(tmp_path / ("r%d" % i))
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "plan.json")
        json.dump(plan, open(p, "w", encoding="utf-8"), ensure_ascii=False)
        shutil.copy(os.path.join(RAIZ, "tests", "fixtures", "face_3s.json"),
                    os.path.join(d, "face.json"))
        r = subprocess.run(
            ["node", "scripts/render_playwright.js", "--plan", p,
             "--fps", "25", "--build", d],
            capture_output=True, text=True, cwd=RAIZ, timeout=900)
        assert r.returncode == 0, r.stderr[-1200:]
        dirs.append(os.path.join(d, "frames", "kineticcaptions"))

    a, b = dirs
    nombres = sorted(f for f in os.listdir(a) if f.endswith(".png"))
    distintos, peor_max, peor_media = [], 0.0, 0.0
    for n in nombres:
        pa, pb = os.path.join(a, n), os.path.join(b, n)
        if open(pa, "rb").read() == open(pb, "rb").read():
            continue
        distintos.append(n)
        s = cf.estadisticas(pa, pb) or {}
        peor_max = max(peor_max, s.get("max") or 0.0)
        peor_media = max(peor_media, s.get("media") or 0.0)

    print("\n  ítem J · capa kinetic AISLADA a 25 fps, dos renders:"
          "\n    %d de %d fotogramas difieren"
          "\n    desviación máxima %.1f sobre 255 · media peor %.4f"
          % (len(distintos), len(nombres), peor_max, peor_media))

    # El umbral es el que el repo ya calibró, no uno inventado aquí.
    assert peor_max <= 4 and peor_media < 0.05, (
        "la desviación pasa de «ruido de rasterización» (max %.1f, media %.4f): "
        "ya no son bordes antialiasados" % (peor_max, peor_media))


@pytest.mark.render
def test_reproducibilidad_del_plan_completo(tmp_path):
    """El caso que el ítem J describe DE VERDAD.

    Aislada, la capa cinética sale idéntica —lo mide la prueba de arriba: 0 de
    100 fotogramas—, así que medirla sola no responde a la pregunta abierta. Lo
    que el ROADMAP dice es «dos renders del PLAN COMPLETO a 25 fps dan
    fotogramas distintos en la capa kinetic»: varias plantillas en la misma
    sesión de navegador, compitiendo por el rasterizador. Eso es lo que se mide
    aquí, y por eso hay dos pruebas y no una.
    """
    if not shutil.which("node"):
        pytest.skip("hace falta node")
    import comparar_fotogramas as cf

    tl = generador.timeline_desde_transcript()
    ws = tl["words"][:20]
    plan = [
        {"capa": "pills", "template": "pills.html", "t": 0.0, "duracion": 2.0,
         "config": {"duration": 2.0, "y": 700,
                    "items": [{"txt": "/uno", "tipo": "cmd"},
                              {"txt": "/dos", "tipo": "cmd"}]}},
        {"capa": "targethud", "template": "target-hud.html", "t": 1.0,
         "duracion": 1.5,
         "config": {"duration": 1.5, "texto": "AQUÍ", "x": 400, "y": 800,
                    "r": 140}},
        {"capa": "kineticcaptions", "template": "kinetic-captions.html",
         "t": 0.0, "duracion": 3.0,
         "config": {"duration": 3.0, "zona": "abajo", "tam": 92,
                    "palabras": [{"w": w["w"], "ini": w["start"],
                                  "fin": w["end"]} for w in ws]}},
    ]

    dirs = []
    for i in (1, 2):
        d = str(tmp_path / ("plan%d" % i))
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, "plan.json")
        json.dump(plan, open(p, "w", encoding="utf-8"), ensure_ascii=False)
        shutil.copy(os.path.join(RAIZ, "tests", "fixtures", "face_3s.json"),
                    os.path.join(d, "face.json"))
        r = subprocess.run(
            ["node", "scripts/render_playwright.js", "--plan", p,
             "--fps", "25", "--build", d],
            capture_output=True, text=True, cwd=RAIZ, timeout=900)
        assert r.returncode == 0, r.stderr[-1200:]
        dirs.append(os.path.join(d, "frames"))

    print("\n  ítem J · PLAN COMPLETO a 25 fps, dos renders:")
    veredicto = True
    for capa in sorted(os.listdir(dirs[0])):
        a, b = os.path.join(dirs[0], capa), os.path.join(dirs[1], capa)
        if not (os.path.isdir(a) and os.path.isdir(b)):
            continue
        nombres = sorted(f for f in os.listdir(a) if f.endswith(".png"))
        distintos, peor_max, peor_media = 0, 0.0, 0.0
        for n in nombres:
            pa, pb = os.path.join(a, n), os.path.join(b, n)
            if open(pa, "rb").read() == open(pb, "rb").read():
                continue
            distintos += 1
            s = cf.estadisticas(pa, pb) or {}
            peor_max = max(peor_max, s.get("max") or 0.0)
            peor_media = max(peor_media, s.get("media") or 0.0)
        print("    %-18s %3d de %3d difieren · máx %4.1f · media %.4f"
              % (capa, distintos, len(nombres), peor_max, peor_media))
        if not (peor_max <= 4 and peor_media < 0.05):
            veredicto = False

    assert veredicto, (
        "alguna capa pasa del umbral de «ruido de rasterización» que el repo "
        "calibró (max<=4, media<0.05): eso ya no son bordes antialiasados")


# --------------------------------------------------------------------------
#  el golden que se lee al revés
# --------------------------------------------------------------------------
# Qué significa «mejor» para cada métrica. Es la única tabla de este fichero
# que expresa una DIRECCIÓN y no una igualdad, porque la monotonía no se
# congela: se reduce.
_MEJOR = {
    "ease_inexistente":        "menos",
    "dominancia_pct":          "menos",
    "solo_opacidad_transform": "menos",
    "hex_literal":             "menos",
    "px_tipografico":          "menos",
    "tracking_libre":          "menos",
    "curvas_por_plantilla":    "mas",
    "props_animadas":          "mas",
    "gestos_distintos":        "mas",
    "pesos_distintos":         "mas",
    "familias_por_plantilla":  "mas",
    "tokens_color":            "mas",
    "color_rico":              "mas",
    "con_textura":             "mas",
}


@pytest.mark.render
def test_las_importadas_solo_pueden_mejorar():
    """El otro lado del catálogo, con su propio listón.

    Las 126 del catálogo de HyperFrames no siguen nuestro sistema: escriben
    `font-size` a pelo y usan su paleta. Eso no es una regresión —es su
    naturaleza— así que medirlas con la vara de las nuestras solo produce un
    rojo permanente que se acaba desactivando.

    Pero tampoco pueden ir a peor mientras se visten: este golden empieza
    donde están HOY y es un trinquete en la misma dirección. Es la deuda,
    con un número que baja cuando alguien la paga.

    Y por eso son DOS ficheros y no uno con las 183: con todas en el mismo
    promedio, las ajenas hundían la media —643 píxeles sueltos contra los 2
    de siempre— y a partir de ahí una plantilla NUESTRA podía llenarse de
    números a pelo sin que saltara nada, porque cabía de sobra bajo el listón
    diluido. El trinquete dejaba de proteger justo lo que existía para
    proteger."""
    esperado = cargar("estilo-importadas.json")
    ahora = generador.estilo("importadas")
    peores = []
    for k, dir_ in _MEJOR.items():
        if k not in esperado or k not in ahora:
            continue
        a, b = float(esperado[k]), float(ahora[k])
        margen = abs(a) * 0.02
        if dir_ == "menos" and b > a + margen:
            peores.append("%s: %s -> %s (debería bajar)" % (k, a, b))
        if dir_ == "mas" and b < a - margen:
            peores.append("%s: %s -> %s (debería subir)" % (k, a, b))
    assert not peores, ("las importadas han ido a peor en:\n      "
                        + "\n      ".join(peores)
                        + "\n    Si el cambio es deliberado: make oro")


@pytest.mark.render
def test_estilo_no_empeora():
    """La monotonía deja de ser una opinión.

    Este golden no dice «esto tiene que seguir igual» —lo dicen todos los
    demás— sino «esto no puede ir a peor». Es la diferencia entre congelar un
    estado y poner un trinquete, y hace falta porque el catálogo HOY está en el
    número malo: `outCubic` en el 93 % de las plantillas, 45 de 56 animando
    solo `opacity` y `transform`, 2 de 56 con textura.

    Congelarlo con igualdad estricta obligaría a regenerar el golden en cada
    mejora, que es exactamente el gesto que hace que un golden se deje de
    mirar. Con dirección, mejorar no pide permiso y empeorar sí.

    Hay una tolerancia del 2 % en los promedios: son medias sobre 56
    plantillas, así que añadir una plantilla nueva mueve el tercer decimal sin
    que nadie haya empeorado nada.
    """
    esperado = cargar("estilo.json")
    ahora = generador.estilo()
    peores = []
    for k, dir_ in _MEJOR.items():
        if k not in esperado or k not in ahora:
            continue
        a, b = float(esperado[k]), float(ahora[k])
        margen = abs(a) * 0.02
        if dir_ == "menos" and b > a + margen:
            peores.append("%s: %s -> %s (debería bajar)" % (k, a, b))
        if dir_ == "mas" and b < a - margen:
            peores.append("%s: %s -> %s (debería subir)" % (k, a, b))
    assert not peores, (
        "el catálogo ha ido a peor en:\n    " + "\n    ".join(peores) +
        "\n  Si el cambio es deliberado, regenera con: make oro")
