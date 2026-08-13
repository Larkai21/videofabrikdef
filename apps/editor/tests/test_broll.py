"""B-Roll: la ingesta de VÍDEO en `escenas[].files` y el plan huérfano.

Dos fallos medidos sobre la pieza real, y ninguno daba un error útil:

  · TODO fichero de escena entraba con `-loop 1 -t`, que es una opción del
    demuxer de IMÁGENES: con un .mp4 local ffmpeg muere con «Option loop not
    found» y exit 8, y un solo vídeo descargado a mano (el guion pidió
    «shield security» y el clip EXISTE en assets/broll) tumbaba la
    composición entera.
  · `generate_google_assets.py` sin clave salía «limpio» (exit 4) sin
    escribir nada: el broll_plan.json de la pieza ANTERIOR quedaba vivo en
    build/ y el compositor lo consumía — escenas de otra narración en los
    instantes de esta, sin que ninguna etapa protestara.

Las pruebas de grafo van por `--dry-run`, como en test_cortinilla.py: el
grafo es una cadena de texto y se puede afirmar sin componer. La composición
REAL de abajo existe porque el fallo original era de EJECUCIÓN, no de grafo:
el comando se construía bien y ffmpeg lo rechazaba. Esa clase de fallo solo
la ve una pasada de verdad.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

PY = sys.executable
# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
from comun import FFMPEG                        # noqa: E402
SHIELD = os.path.join(RAIZ, "assets", "broll",
                      "shield_security_pixabay_262696.mp4")


# --------------------------------------------------------------------------
#  el grafo: still y vídeo toman ramas distintas
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def montaje():
    """Timeline mínimo y un manifiesto sin capas: lo único bajo prueba es la
    rama de B-Roll. `--sin-normalizar` es obligatorio aquí: la medición de
    LUFS corre ffmpeg DE VERDAD incluso con --dry-run, y el A-Roll de esta
    fixture es un fichero de un byte."""
    d = tempfile.mkdtemp(prefix="broll_")
    vid = os.path.join(d, "clip.mp4")
    open(vid, "wb").write(b"\0")
    tl = {"reloj": "origen", "source": vid, "duration_final": 4.0,
          "keep": [{"src_start": 0.0, "src_end": 4.0,
                    "out_start": 0.0, "out_end": 4.0}],
          "words": [], "blocks": []}
    json.dump(tl, open(os.path.join(d, "timeline.json"), "w"))
    json.dump({"fps": 30, "ancho": 1080, "alto": 1920, "capas": []},
              open(os.path.join(d, "layers.json"), "w"))
    # los ficheros de escena solo tienen que EXISTIR para el dry-run
    for n in ("escena.mp4", "escena.png"):
        open(os.path.join(d, n), "wb").write(b"\0")
    yield d
    shutil.rmtree(d, ignore_errors=True)


def grafo(montaje, fichero):
    bp = os.path.join(montaje, "broll_%s.json" % fichero.replace(".", "_"))
    json.dump({"reloj": "salida",
               "escenas": [{"id": "escena_01", "t": 1.0, "dur": 2.0,
                            "tipo": "broll",
                            "files": [os.path.join(montaje, fichero)]}]},
              open(bp, "w"))
    r = subprocess.run(
        [PY, os.path.join(RAIZ, "scripts", "composite_ffmpeg.py"),
         "--timeline", os.path.join(montaje, "timeline.json"),
         "--layers", os.path.join(montaje, "layers.json"),
         "--broll", bp,
         "--output", os.path.join(montaje, "out.mp4"),
         "--lut", "none", "--sin-sfx", "--sin-normalizar", "--dry-run"],
        capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)["comando"]


@pytest.mark.ffmpeg
def test_un_video_entra_sin_loop_y_acotado(montaje):
    """`-loop 1` sobre un .mp4 no degrada: MATA. «Option loop not found»,
    exit 8, y la pieza entera sin componer por una escena."""
    cmd = grafo(montaje, "escena.mp4")
    assert "-loop 1 -t 2.000 -i %s" % os.path.join(montaje, "escena.mp4") \
        not in cmd
    assert "-an -t 2.000 -i %s" % os.path.join(montaje, "escena.mp4") in cmd


@pytest.mark.ffmpeg
def test_un_video_se_recorta_al_lienzo_sin_el_zoom_de_still(montaje):
    """El `increase`+crop recorta el 16:9 a 9:16 tirando los laterales —de un
    3840x2160 sobreviven 1215 de 3840 px—; el 1.06 de los stills no aplica
    porque un vídeo ya se mueve solo."""
    cmd = grafo(montaje, "escena.mp4")
    assert ("[1:v]scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,format=yuva420p") in cmd
    assert "scale=1144:2035" not in cmd


@pytest.mark.ffmpeg
def test_el_audio_del_video_no_entra_en_el_grafo(montaje):
    """La voz es la del A-Roll, siempre. La entrada lleva `-an` y ninguna
    rama del grafo consume `[1:a]`: si un día alguien mapea el audio de una
    escena, esto es lo que tiene que fallar."""
    cmd = grafo(montaje, "escena.mp4")
    assert "[1:a]" not in cmd


@pytest.mark.ffmpeg
def test_un_still_conserva_el_loop_y_su_zoom(montaje):
    """La rama vieja no cambia: un PNG necesita `-loop 1` para durar más de
    un fotograma, y su 6 % de sobre-escala existe porque un still clavado
    canta mucho en vídeo."""
    cmd = grafo(montaje, "escena.png")
    assert "-loop 1 -t 2.000 -i %s" % os.path.join(montaje, "escena.png") in cmd
    assert "scale=1144:2035" in cmd


# --------------------------------------------------------------------------
#  la composición REAL, con el clip real
# --------------------------------------------------------------------------
def pixel_medio(video, t):
    """Color medio del fotograma en t: `scale=1:1` promedia el cuadro entero
    y devuelve tres bytes RGB. Es la forma barata de MIRAR sin abrir nada."""
    r = subprocess.run(
        [FFMPEG, "-v", "error", "-ss", "%.2f" % t, "-i", video,
         "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo",
         "-pix_fmt", "rgb24", "-"], capture_output=True)
    assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
    return tuple(r.stdout[:3])


@pytest.mark.ffmpeg
@pytest.mark.lento
@pytest.mark.skipif(not os.path.exists(SHIELD),
                    reason="falta el clip real de assets/broll")
def test_una_escena_de_video_compone_de_verdad():
    """El fallo original no estaba en el grafo sino en ffmpeg ejecutándolo,
    así que esta prueba compone DE VERDAD: A-Roll sintético rojo con tono de
    audio, y el clip real 3840x2160@60 como escena en 1..3 s.

    Va en `lento` y no solo en `ffmpeg` por la semántica de niveles del
    Makefile: `lento` es «el único nivel que ejercita el filtergraph de
    ffmpeg», y este segundo largo de codificación no cabe en el presupuesto
    de `rapido`. Las pruebas de grafo de arriba sí corren en el nivel rápido
    y vigilan las banderas; esta vigila que ffmpeg las acepte.

    Se mira el resultado por su color medio: en 0,5 s tiene que ser el rojo
    del fondo y en 2 s NO — si el overlay no se pintó, los dos instantes son
    el mismo rojo y la prueba falla aunque ffmpeg saliera con 0. Y la salida
    tiene que seguir a 30 fps: los 60 del clip no mandan sobre la cadencia."""
    d = tempfile.mkdtemp(prefix="broll_real_")
    src = os.path.join(d, "aroll.mp4")
    r = subprocess.run(
        [FFMPEG, "-v", "error", "-y",
         "-f", "lavfi", "-i", "color=c=red:s=640x360:r=30:d=4",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
         "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
         "-shortest", src], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr

    json.dump({"reloj": "origen", "source": src, "duration_final": 4.0,
               "keep": [{"src_start": 0.0, "src_end": 4.0,
                         "out_start": 0.0, "out_end": 4.0}],
               "words": [], "blocks": []},
              open(os.path.join(d, "timeline.json"), "w"))
    json.dump({"fps": 30, "ancho": 1080, "alto": 1920, "capas": []},
              open(os.path.join(d, "layers.json"), "w"))
    json.dump({"reloj": "salida",
               "escenas": [{"id": "escena_01", "t": 1.0, "dur": 2.0,
                            "tipo": "broll", "files": [SHIELD]}]},
              open(os.path.join(d, "broll_plan.json"), "w"))

    out = os.path.join(d, "out.mp4")
    r = subprocess.run(
        [PY, os.path.join(RAIZ, "scripts", "composite_ffmpeg.py"),
         "--timeline", os.path.join(d, "timeline.json"),
         "--layers", os.path.join(d, "layers.json"),
         "--broll", os.path.join(d, "broll_plan.json"),
         "--output", out, "--lut", "none", "--sin-sfx", "--sin-normalizar",
         "--sin-seguir-rostro", "--cama", "0", "--lecho", "0", "--preview"],
        capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert os.path.exists(out)

    fondo = pixel_medio(out, 0.5)
    escena = pixel_medio(out, 2.0)
    assert fondo[0] > 150 and fondo[1] < 80 and fondo[2] < 80, \
        "en 0,5 s tendría que verse el fondo rojo: %s" % (fondo,)
    assert not (escena[0] > 150 and escena[1] < 80 and escena[2] < 80), \
        "en 2 s tendría que verse el clip, no el fondo: %s" % (escena,)

    fps = subprocess.run(
        [FFMPEG.replace("ffmpeg", "ffprobe"), "-v", "error",
         "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
         "-of", "csv=p=0", out], capture_output=True, text=True)
    assert fps.returncode == 0, fps.stderr
    assert fps.stdout.strip() == "30/1", \
        "los 60 fps del clip se colaron en la salida: %s" % fps.stdout


# --------------------------------------------------------------------------
#  el plan huérfano de la pieza anterior
# --------------------------------------------------------------------------
def _preparar(tmp_path, monkeypatch):
    """Un build/ aislado y el flujo sin clave. La clave se deja VACÍA y no
    solo ausente: `os.environ.get` devuelve "" y el script tiene que tratarlo
    como falta, que es como llega de un `GEMINI_API_KEY=` en el entorno."""
    import generate_google_assets as gga
    build = tmp_path / "build"
    build.mkdir()
    tl = tmp_path / "timeline.json"
    tl.write_text(json.dumps(
        {"blocks": [{"ini": 0.0, "fin": 2.0,
                     "palabras": [{"w": "hola"}, {"w": "mundo"}]}]}),
        encoding="utf-8")
    monkeypatch.setattr(gga, "BUILD", str(build))
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.delenv("GOOGLE_GENAI_API_KEY", raising=False)
    monkeypatch.setattr(sys, "argv", [
        "generate_google_assets.py", "--timeline", str(tl),
        "--outdir", str(tmp_path / "broll")])
    return gga, build / "broll_plan.json", tl


def test_sin_clave_sustituye_el_plan_de_otra_pieza(tmp_path, monkeypatch):
    """El fallo medido: exit 4 «limpio» y el plan de la pieza anterior vivo.
    Más viejo que el timeline = de otra pieza, y se sustituye por uno vacío
    sellado que todas las etapas leen como «no hay B-Roll»."""
    gga, plan, _ = _preparar(tmp_path, monkeypatch)
    plan.write_text(json.dumps(
        {"reloj": "salida",
         "escenas": [{"id": "ajena", "t": 3.0, "dur": 2.0,
                      "files": ["/no/existe.png"]}]}), encoding="utf-8")
    os.utime(plan, (1, 1))          # inequívocamente anterior al timeline

    with pytest.raises(SystemExit) as exc:
        gga.main()
    assert exc.value.code == 4      # el contrato de salida no cambia

    d = json.loads(plan.read_text(encoding="utf-8"))
    assert d["escenas"] == []
    assert d["reloj"] == "origen"


def test_sin_clave_respeta_un_plan_de_este_montaje(tmp_path, monkeypatch):
    """Un plan MÁS NUEVO que el timeline es de ESTE montaje —lo escribió
    leer_guion.py, un --dry-run o una pasada con clave— y pisarlo sería
    destruir trabajo bueno para protegerse de trabajo ajeno."""
    gga, plan, tl = _preparar(tmp_path, monkeypatch)
    os.utime(tl, (1, 1))            # el timeline pasa a ser el viejo
    contenido = json.dumps(
        {"reloj": "salida",
         "escenas": [{"id": "escena_01", "t": 1.0, "dur": 2.0, "files": []}]})
    plan.write_text(contenido, encoding="utf-8")

    with pytest.raises(SystemExit) as exc:
        gga.main()
    assert exc.value.code == 4
    assert plan.read_text(encoding="utf-8") == contenido


def test_sin_clave_y_sin_plan_previo_escribe_el_vacio(tmp_path, monkeypatch):
    """Sin plan previo también se escribe: que build/ quede COHERENTE no
    puede depender de qué dejó la pieza anterior."""
    gga, plan, _ = _preparar(tmp_path, monkeypatch)
    assert not plan.exists()

    with pytest.raises(SystemExit) as exc:
        gga.main()
    assert exc.value.code == 4
    d = json.loads(plan.read_text(encoding="utf-8"))
    assert d["escenas"] == [] and d["reloj"] == "origen"
