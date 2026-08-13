"""La cadena entera, con material real y en un temporal. Opt-in.

    .venv/bin/python -m pytest tests/test_cadena.py -m lento

Es el único nivel que ejercita el filtergraph de ffmpeg y, sobre todo, el único
que puede probar la invariante de reloj DE PUNTA A PUNTA: que la palabra que se
oye en el segundo X del vídeo final sea la misma que el subtítulo dibuja en el
segundo X. Eso no se puede comprobar con una unitaria y no hace falta mirar un
solo píxel para saberlo.

Cómo se mantiene en 1-2 min:

  · **No se transcribe.** Se parte de `transcript_3s.json`, congelado. Whisper
    queda fuera del arnés entero.
  · **`--fps 5`** en el render: cinco veces menos fotogramas, y según el ítem J
    del ROADMAP a 5 fps el render SÍ es reproducible.
  · **`--preview`** en la composición: 540×960, cuatro veces menos píxeles.
  · **Un clip de 3 s a 540×960**, 199 KB. Nunca los 4K de `assets/aroll`.
  · **Tres capas** que cubren los tres caminos distintos del compositor: una
    tarjeta normal, un micro-FX con `x`/`y` propios, y los subtítulos con
    `palabras`, `ventanas` y `cues`.
  · **Todo a `tempfile.mkdtemp()`.** Jamás a `build/`: es el montaje del
    usuario, y encima está sincronizado con iCloud.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIX = os.path.join(RAIZ, "tests", "fixtures")
PY = sys.executable

pytestmark = pytest.mark.lento


def corre(*cmd, cwd=RAIZ):
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd, timeout=900)
    return r


def exige(r, que):
    assert r.returncode == 0, "%s falló (%d):\n%s\n%s" % (
        que, r.returncode, r.stdout[-1500:], r.stderr[-1500:])
    return r


@pytest.fixture(scope="module")
def cadena(tmp_path_factory):
    """Ejecuta el pipeline entero una vez y devuelve el directorio con todo."""
    if not shutil.which("node"):
        pytest.skip("hace falta node")
    from comun import FFMPEG, _existe
    if not _existe(FFMPEG):
        pytest.skip("hace falta ffmpeg")

    d = str(tmp_path_factory.mktemp("cadena"))
    clip = os.path.join(FIX, "clip3s.mp4")
    if not os.path.exists(clip):
        pytest.skip("falta tests/fixtures/clip3s.mp4")

    # --- transcript congelado, con la ruta del clip absoluta ---
    tr = json.load(open(os.path.join(FIX, "transcript_3s.json"), encoding="utf-8"))
    tr["source"] = clip
    p_tr = os.path.join(d, "transcript.json")
    json.dump(tr, open(p_tr, "w", encoding="utf-8"), ensure_ascii=False)

    shutil.copy(os.path.join(FIX, "face_3s.json"), os.path.join(d, "face.json"))

    # --- limpieza ---
    p_tl = os.path.join(d, "timeline.json")
    exige(corre(PY, "scripts/clean_transcript.py", "--input", p_tr,
                "--output", p_tl), "clean_transcript")

    # --- plan de tres capas, en reloj de ORIGEN ---
    tl = json.load(open(p_tl, encoding="utf-8"))
    ws = tl["words"]
    fin = tl["keep"][-1]["src_end"]
    plan = [
        {"capa": "pills", "template": "pills.html",
         "t": round(ws[0]["start"], 3), "duracion": 1.2,
         "config": {"duration": 1.2, "y": 700,
                    "items": [{"txt": "/prueba", "tipo": "cmd"}]}},
        {"capa": "targethud", "template": "target-hud.html",
         "t": round(ws[len(ws) // 2]["start"], 3), "duracion": 1.0,
         "config": {"duration": 1.0, "texto": "AQUÍ", "x": 300, "y": 700,
                    "r": 120}},
        {"capa": "kineticcaptions", "template": "kinetic-captions.html",
         "t": 0.0, "duracion": round(fin, 3),
         "config": {"duration": round(fin, 3), "zona": "abajo", "tam": 72,
                    "palabras": [{"w": w["w"], "ini": w["start"],
                                  "fin": w["end"]} for w in ws],
                    "ventanas": [{"ini": round(ws[0]["start"], 3),
                                  "fin": round(ws[0]["start"] + 1.2, 3)}]}},
    ]
    p_plan = os.path.join(d, "plan.json")
    json.dump(plan, open(p_plan, "w", encoding="utf-8"), ensure_ascii=False)

    # --- silencios: lista inyectada, sin tocar el audio ---
    exige(corre(PY, "scripts/silencios.py", "--timeline", p_tl,
                "--plan", p_plan, "--silencios",
                os.path.join(FIX, "silencios_3s.json"), "--aplicar"),
          "silencios")

    # --- las puertas ---
    exige(corre(PY, "scripts/lint_config.py", "--plan", p_plan), "lint_config")
    exige(corre(PY, "scripts/validar_plan.py", p_plan,
                "--manifiesto", os.path.join(d, "layers.json")), "validar_plan")

    # --- render a 5 fps ---
    exige(corre("node", "scripts/render_playwright.js", "--plan", p_plan,
                "--fps", "5", "--build", d), "render_playwright")

    # --- comprobaciones sobre lo renderizado ---
    exige(corre(PY, "scripts/comprobar_alfa.py",
                "--frames", os.path.join(d, "frames")), "comprobar_alfa")
    exige(corre(PY, "scripts/comprobar_montaje.py", "--build", d),
          "comprobar_montaje")
    exige(corre(PY, "scripts/comprobar_contratos.py", "--build", d),
          "comprobar_contratos")

    # --- colocación y composición ---
    exige(corre(PY, "scripts/colocar.py", "--plan", p_plan,
                "--layers", os.path.join(d, "layers.json"),
                "--face", os.path.join(d, "face.json"), "--aplicar"),
          "colocar")
    salida = os.path.join(d, "final.mp4")
    exige(corre(PY, "scripts/composite_ffmpeg.py", "--preview",
                "--timeline", p_tl, "--layers", os.path.join(d, "layers.json"),
                "--broll", os.path.join(d, "no-hay-broll.json"),
                "--face", os.path.join(d, "face.json"),
                "--output", salida), "composite_ffmpeg")

    return {"dir": d, "video": salida, "plan": p_plan, "timeline": p_tl,
            "layers": os.path.join(d, "layers.json")}


# --------------------------------------------------------------------------
def test_el_video_existe_y_pesa(cadena):
    assert os.path.exists(cadena["video"])
    assert os.path.getsize(cadena["video"]) > 20_000


def test_la_duracion_cuadra_con_el_timeline(cadena):
    """Es el «vídeo de 59 s con la narración de 74 s por encima» que la cabecera
    de silencios.py documenta. Se comprueba contra `keep`, que es lo que ffmpeg
    usa de verdad para cortar, no contra `duration_final`.

    La tolerancia va en FOTOGRAMAS de la salida, no en segundos fijos, y eso
    está medido: a 25 fps —lo que se usa de verdad— la duración sale EXACTA
    (3,000 s y 75 fotogramas); a 5 fps sobran dos fotogramas, que son 0,4 s. El
    exceso es del ajuste que esta prueba usa para ir rápido, no del pipeline,
    así que la tolerancia tiene que escalar con él. Y sigue cazando lo que
    importa: un desfase de reloj de verdad se mide en segundos, no en dos
    fotogramas.
    """
    import reloj
    tl = json.load(open(cadena["timeline"], encoding="utf-8"))
    man = json.load(open(cadena["layers"], encoding="utf-8"))
    fps = float(man["fps"])
    esperada = reloj.Mapa(tl["keep"]).duracion()
    from comun import FFPROBE
    r = corre(FFPROBE, "-v", "error", "-show_entries",
              "format=duration", "-of", "csv=p=0", cadena["video"])
    real = float(r.stdout.strip())
    tolerancia = max(0.05, 2.5 / fps)
    assert abs(real - esperada) < tolerancia, \
        "el vídeo dura %.3f y el timeline dice %.3f (tolerancia %.3f a %g fps)" \
        % (real, esperada, tolerancia, fps)


def test_invariante_de_reloj_de_punta_a_punta(cadena):
    """LA prueba de este nivel, y la única automática posible del remapeo doble.

    Para cada palabra: el instante en que SE OYE —derivado de `keep`, que es el
    recorte que ffmpeg aplica— tiene que coincidir con el instante en que el
    subtítulo la DIBUJA, que vive en `config.palabras` de la capa de subtítulos
    ya remapeada. Si los dos relojes se separan, aquí se ve; en el JSON, no.
    """
    import reloj
    tl = json.load(open(cadena["timeline"], encoding="utf-8"))
    plan = json.load(open(cadena["plan"], encoding="utf-8"))
    subs = next(c for c in plan if c["capa"] == "kineticcaptions")

    mapa = reloj.Mapa(tl["keep"])
    ps = subs["config"]["palabras"]
    # Se comparan POR ÍNDICE y no por texto. Un diccionario `{palabra: t}`
    # parecía más legible y estaba mal: «de» aparece dos veces en tres segundos
    # de habla, así que la segunda sobrescribía a la primera y la prueba
    # informaba de un desfase de 2 s que no existía.
    assert len(ps) == len(tl["words"]), \
        "los subtítulos llevan %d palabras y el timeline %d" % (
            len(ps), len(tl["words"]))

    peor, cual = 0.0, ""
    for w, p in zip(tl["words"], ps):
        assert p["w"] == w["w"], "desalineadas: «%s» vs «%s»" % (p["w"], w["w"])
        se_oye = mapa(w["start"])
        dibuja = subs["t"] + p["ini"]
        d = abs(dibuja - se_oye)
        if d > peor:
            peor, cual = d, w["w"]
    # Un fotograma a 25 fps. Los subtítulos se renderizan a 5 fps en esta
    # prueba, pero el dato que se compara son los TIEMPOS, no los fotogramas.
    assert peor <= 0.04, \
        "«%s» se oye y se dibuja con %.3f s de diferencia" % (cual, peor)


def test_cada_capa_se_compone_de_verdad(cadena):
    """Caza «se descartó en silencio», que es el fallo de `fondo`: una capa que
    se renderiza y el compositor tira sin decir nada.

    Se comprueba sobre el GRAFO DE FILTROS y no sobre píxeles: cada capa tiene
    que aportar su propio `overlay` con su ventana temporal. Comparar
    fotogramas contra el A-Roll pelado obligaría a componer dos veces, y contra
    un golden de píxeles no se puede —el ítem J del ROADMAP dice que el render
    multicapa a 25 fps no es bit a bit reproducible—. El grafo es la
    declaración de intenciones de ffmpeg y aquí basta con leerla."""
    import comun
    plan = json.load(open(cadena["plan"], encoding="utf-8"))
    # El manifiesto trae `dir` relativo a su raíz; el grafo lleva rutas
    # absolutas, así que se resuelve igual que hace el compositor.
    man = comun.resolver_manifiesto(
        json.load(open(cadena["layers"], encoding="utf-8")), cadena["dir"])
    por_capa = {c["capa"]: c for c in man["capas"]}

    r = exige(corre(PY, "scripts/composite_ffmpeg.py", "--dry-run",
                    "--timeline", cadena["timeline"],
                    "--layers", cadena["layers"],
                    "--broll", os.path.join(cadena["dir"], "nada.json")),
              "dry-run")
    grafo = r.stdout

    for c in plan:
        m = por_capa[c["capa"]]
        # El directorio de la capa tiene que estar entre las entradas...
        assert m["dir"] in grafo, \
            "«%s» no entra en el grafo: el vídeo saldría sin ella" % c["capa"]
        # ...y su ventana temporal, en un `enable=between(...)`.
        ventana = "between(t,%.3f,%.3f)" % (m["t"], m["t"] + m["dur"])
        assert ventana in grafo, \
            "«%s» no aparece con su ventana %s" % (c["capa"], ventana)


def test_ffmpeg_ausente_da_un_mensaje_util(cadena):
    """Con FFMPEG_BIN apuntando a la nada, un mensaje que diga qué instalar, no
    un FileNotFoundError. Solo `detect_face_bbox` usaba `shutil.which` antes."""
    env = dict(os.environ, FFMPEG_BIN="/no/existe/ffmpeg")
    r = subprocess.run([PY, "scripts/colocar.py", "--plan", cadena["plan"],
                        "--layers", cadena["layers"]],
                       capture_output=True, text=True, cwd=RAIZ, env=env)
    assert r.returncode == 2
    assert "falta ffmpeg" in r.stderr
    assert "brew install ffmpeg" in r.stderr


def test_el_dry_run_construye_el_grafo(cadena):
    """Barato y vale como humo del filtergraph: si el grafo no se puede
    construir, no hay vídeo que valga."""
    r = exige(corre(PY, "scripts/composite_ffmpeg.py", "--dry-run",
                    "--timeline", cadena["timeline"],
                    "--layers", cadena["layers"],
                    "--broll", os.path.join(cadena["dir"], "nada.json")),
              "dry-run")
    assert "filter_complex" in r.stdout
