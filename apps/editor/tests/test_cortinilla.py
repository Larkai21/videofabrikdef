"""La cortinilla antes/después, que es el único componente que toca al METRAJE.

Las demás plantillas se pintan encima del vídeo. Esta revela otra versión del
mismo vídeo por debajo de su silueta, así que su corrección no vive en la
plantilla sino en el filtergraph: qué cadenas se construyen, con qué etiquetas
y en qué orden. Eso se puede probar sin ffmpeg y sin un solo píxel, porque el
grafo es una cadena de texto.

Lo que NO prueba este fichero, y hay que decirlo: que el lado «antes» se vea
distinto. Eso se comprueba MIRANDO, y la diferencia entre las dos cosas costó
una vuelta: se midió que cada lado venía de la cadena correcta —el crudo casa
con el montaje sin LUT 2,7 veces mejor que con el graduado— y se dio por bueno,
pero al verlo no se distinguía nada, porque el LUT de marca cambia la imagen un
2 % sobre material que ya sale perfilado de cámara. «Verificado midiendo» no
significa nada si no se dice QUÉ se midió.

Lo que sí se fija es que el grafo no pueda dejar de intentarlo en silencio. Y
en el revelado por imagen, algo peor que un silencio: `-loop 1` sin `-t` no
falla, CUELGA la composición para siempre.
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

import composite_ffmpeg          # noqa: E402
import reloj                     # noqa: E402

PY = sys.executable

KEEP = [
    {"src_start": 0.0, "src_end": 2.0, "out_start": 0.0, "out_end": 2.0},
    {"src_start": 5.0, "src_end": 7.5, "out_start": 2.0, "out_end": 4.5,
     "zoom": 1.15},
    {"src_start": 9.0, "src_end": 11.0, "out_start": 4.5, "out_end": 6.5},
]


# --------------------------------------------------------------------------
#  filtro_aroll pedido dos veces
# --------------------------------------------------------------------------
def test_la_cadena_por_defecto_no_ha_cambiado():
    """La primera obligación al parametrizar una función que ya funcionaba: sin
    argumentos nuevos tiene que dar exactamente lo de antes. Las etiquetas de
    salida son las que consume el resto del compositor."""
    g = composite_ffmpeg.filtro_aroll(KEEP, 1080, 1920)
    assert g.endswith("concat=n=3:v=1:a=1[aroll][aud]")
    assert "[v0][a0][v1][a1][v2][a2]concat" in g


def test_las_dos_cadenas_no_comparten_ni_una_etiqueta():
    """Es LA razón de ser del sufijo. Con las etiquetas repetidas ffmpeg no
    avisa de una colisión: consume la primera definición y el resultado es un
    grafo que se construye y compone otra cosa."""
    import re
    a = composite_ffmpeg.filtro_aroll(KEEP, 1080, 1920, lut=None)
    b = composite_ffmpeg.filtro_aroll(KEEP, 1080, 1920, lut=None,
                                      sufijo="cr", con_audio=False)
    salidas = lambda g: set(re.findall(r"\[([a-z]+\w*)\](?=;|$)", g))
    etq = lambda g: set(re.findall(r"\[([a-z][\w]*)\]", g))
    assert not (etq(a) & etq(b)), \
        "etiquetas compartidas: %s" % (etq(a) & etq(b))


def test_la_cadena_cruda_no_declara_audio():
    """Un label de salida sin consumir es un error de filtergraph, no un
    descarte silencioso: `[acr0]` sin destino tumbaría la composición entera
    con un mensaje que no menciona la cortinilla."""
    g = composite_ffmpeg.filtro_aroll(KEEP, 1080, 1920, sufijo="cr",
                                      con_audio=False)
    assert "atrim" not in g
    assert "[acr" not in g
    assert g.endswith("concat=n=3:v=1:a=0[arollcr]")


def test_las_dos_cadenas_comparten_LA_GEOMETRIA():
    """Lo único que puede diferir es el LUT. Si difiriera el recorte por rostro
    o el zoom por tramo, los dos lados del canto mostrarían encuadres distintos
    del mismo instante y la comparación dejaría de ser una comparación.

    Se comprueba quitándole el `lut3d` a la cadena graduada: los tramos de
    vídeo que quedan tienen que ser los de la cruda salvo en las etiquetas.

    Se comparan los TRAMOS y no el grafo entero: la lista de entradas del
    concat difiere a propósito —la graduada las intercala con el audio— y
    compararla mezclaba esa diferencia legítima con la que se busca."""
    import re
    lut = "/tmp/x.cube"
    a = composite_ffmpeg.filtro_aroll(KEEP, 1080, 1920, lut=lut, camara=0.4)
    b = composite_ffmpeg.filtro_aroll(KEEP, 1080, 1920, lut=None, camara=0.4,
                                      sufijo="cr", con_audio=False)

    def tramos(g):
        g = g.replace(",lut3d=file='%s'" % lut, "")
        return [re.sub(r"\[v\w*\d+\]$", "[v]", p)
                for p in g.split(";") if p.startswith("[0:v]trim")]

    assert tramos(a) == tramos(b)
    assert len(tramos(a)) == len(KEEP)


# --------------------------------------------------------------------------
#  el grafo completo, por --dry-run
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def montaje():
    """Un timeline y un manifiesto mínimos, en un temporal. El compositor no
    abre el vídeo con `--dry-run`, pero sí comprueba que exista."""
    d = tempfile.mkdtemp(prefix="cortinilla_")
    vid = os.path.join(d, "clip.mp4")
    fixt = os.path.join(RAIZ, "tests", "fixtures", "clip3s.mp4")
    if os.path.exists(fixt):
        shutil.copy(fixt, vid)
    else:                       # el dry-run solo exige que el fichero esté
        open(vid, "wb").write(b"\0")
    tl = {"reloj": "origen", "source": vid, "keep": KEEP,
          "duration_final": 6.5, "words": [], "blocks": []}
    with open(os.path.join(d, "timeline.json"), "w") as f:
        json.dump(tl, f)

    frames = os.path.join(d, "frames", "antesdespues")
    mask = os.path.join(d, "frames", "antesdespues__mask")
    for p in (frames, mask):
        os.makedirs(p)
        open(os.path.join(p, "00001.png"), "wb").write(b"\0")

    lut = os.path.join(d, "grade.cube")
    open(lut, "w").write("LUT_3D_SIZE 2\n" + "0 0 0\n" * 8)

    img = os.path.join(d, "captura.png")
    # un PNG mínimo de verdad: el compositor solo comprueba que exista, pero
    # una ruta que apunta a un fichero vacío no probaría el camino de existencia
    open(img, "wb").write(b"\x89PNG\r\n\x1a\n" + b"\0" * 32)

    def manifiesto(n=1, imagen=None, ajuste=None):
        capas = []
        for i in range(n):
            # `template` NO es opcional: `rango()` resuelve el sitio en ORDEN
            # por nombre de capa, por plantilla o por su alias sin guiones, y
            # una capa que no resuelve por ninguno de los tres se descarta como
            # huérfana. Sin esta clave la segunda cortinilla desaparecía y la
            # prueba culpaba al split.
            capas.append({"capa": "antesdespues" if not i else "antesdespues%d" % (i + 1),
                          "template": "antes-despues.html",
                          "dir": frames, "frames": 1, "dur": 2.0,
                          "t": 1.0 + i * 3, "fps": 5,
                          "mask": mask, "cortinilla": True})
            if imagen:
                capas[-1]["imagen"] = imagen
            if ajuste:
                capas[-1]["ajuste"] = ajuste
        ruta = os.path.join(d, "layers%d%s.json" % (n, ajuste or ""))
        with open(ruta, "w") as f:
            json.dump({"fps": 5, "ancho": 1080, "alto": 1920, "capas": capas}, f)
        return ruta

    # Un broll_plan VACÍO propio. Sin él, `composite_ffmpeg.py` cae a su
    # valor por defecto —`build/broll_plan.json`— y el grafo de la prueba
    # hereda las escenas de la PIEZA REAL que haya en `build/`: cada escena
    # añade una entrada, todos los índices se desplazan y las etiquetas que
    # estas pruebas afirman (`an1`, `img1`) pasan a llamarse otra cosa. Vivió
    # latente mientras el plan estuvo siempre vacío, y saltó el día que la
    # vía del guion empezó a colocar b-roll de verdad: seis pruebas en rojo
    # sin que nada del revelado hubiera cambiado.
    broll = os.path.join(d, "broll_plan.json")
    with open(broll, "w", encoding="utf-8") as f:
        json.dump({"reloj": "salida", "escenas": []}, f)

    yield {"dir": d, "tl": os.path.join(d, "timeline.json"), "img": img,
           "lut": lut, "manifiesto": manifiesto, "broll": broll}
    shutil.rmtree(d, ignore_errors=True)


def grafo(montaje, n=1, extra=(), imagen=None, ajuste=None):
    cmd = [PY, os.path.join(RAIZ, "scripts", "composite_ffmpeg.py"),
           "--timeline", montaje["tl"],
           "--layers", montaje["manifiesto"](n, imagen, ajuste),
           "--output", os.path.join(montaje["dir"], "out.mp4"),
           "--lut", montaje["lut"], "--broll", montaje["broll"],
           "--dry-run", "--sin-sfx"]
    r = subprocess.run(cmd + list(extra), capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout), r.stderr


@pytest.mark.ffmpeg
def test_el_grafo_lleva_la_cadena_cruda_y_el_alphamerge(montaje):
    """Las tres piezas del revelado, en orden: una segunda cadena de A-Roll sin
    LUT, recortada con la silueta, puesta encima de la graduada."""
    d, _ = grafo(montaje)
    g = d["filtergraph"] if "filtergraph" in d else json.dumps(d)
    assert "concat=n=3:v=1:a=0[arollcr]" in g
    assert "[arollcr][mk1]alphamerge[an1]" in g
    assert "[aroll][an1]overlay=0:0:enable=" in g


@pytest.mark.ffmpeg
def test_la_cortinilla_no_pasa_por_el_tratamiento_de_cristal(montaje):
    """Comparten la pasada de máscara y NO el tratamiento. Si cayera en la rama
    del cristal, el lado «antes» saldría difuminado y saturado en vez de crudo:
    seguiría pareciendo un antes/después y sería el efecto equivocado."""
    d, _ = grafo(montaje)
    g = d["filtergraph"] if "filtergraph" in d else json.dumps(d)
    assert "gblur" not in g
    assert "[bs1]" not in g and "[bl1]" not in g


@pytest.mark.ffmpeg
def test_sin_LUT_se_avisa_y_se_omite_el_revelado(montaje):
    """Sin grading los dos lados son el MISMO píxel. Componer igual sería lo
    peor de los tres casos: la cortinilla se ve moverse y parece funcionar."""
    d, err = grafo(montaje, extra=["--lut", "none"])
    g = json.dumps(d)
    assert "arollcr" not in g
    assert "cortinilla" in err and "SIN LUT" in err
    assert "--lut" in err, "el aviso tiene que traer el comando que lo arregla"


@pytest.mark.ffmpeg
def test_con_metraje_en_columna_se_avisa_y_se_omite(montaje):
    """El lado crudo tendría que repetir el escalado, el relleno difuminado y
    el overlay de la columna, y cualquier diferencia se vería como un salto en
    el canto."""
    d, err = grafo(montaje, extra=["--aroll", "derecha"])
    assert "arollcr" not in json.dumps(d)
    assert "aroll completo" in err


@pytest.mark.ffmpeg
def test_dos_cortinillas_se_reparten_la_cadena_con_split(montaje):
    """Un label de ffmpeg se consume UNA vez. Con dos cortinillas y sin split,
    la segunda se queda sin fuente y el grafo no se construye."""
    d, _ = grafo(montaje, n=2)
    g = d["filtergraph"] if "filtergraph" in d else json.dumps(d)
    assert "[arollcr]split=2[crudo0][crudo1]" in g
    assert g.count("alphamerge[an") == 2
    # y la segunda se apila sobre el resultado de la primera, no sobre [aroll]
    assert "[aroll][an1]overlay" in g
    assert "[aroll][an3]overlay" not in g


@pytest.mark.ffmpeg
def test_una_segunda_cortinilla_no_necesita_su_propia_entrada_en_ORDEN(montaje):
    """`antesdespues2` NO está en ORDEN y aun así se compone, porque `rango()`
    resuelve por plantilla o por su alias sin guiones antes de rendirse. Vale la
    pena fijarlo: la convención de `pasos2..5` y `kicker2` sugiere que cada
    instancia necesita su entrada, y para las que traen `template` no es así."""
    assert "antesdespues2" not in composite_ffmpeg.ORDEN
    d, err = grafo(montaje, n=2)
    assert "NO en ORDEN" not in err
    assert json.dumps(d).count("alphamerge[an") == 2


# --------------------------------------------------------------------------
#  la plantilla y su contrato de tiempo
# --------------------------------------------------------------------------
def test_la_plantilla_declara_su_silueta_sin_vidrio():
    """`.silueta` y no `.cristal`: con la clase del cristal el panel se vería
    como una pastilla difuminada en la pasada de DETALLE, además de servir de
    máscara."""
    src = open(os.path.join(RAIZ, "templates", "antes-despues.html"),
               encoding="utf-8").read()
    assert "silueta" in src
    assert "cristal" not in src
    tok = open(os.path.join(RAIZ, "templates", "_tokens.css"),
               encoding="utf-8").read()
    assert 'body[data-modo="mascara"] .silueta' in tok


def test_las_claves_de_tiempo_de_la_cortinilla_estan_clasificadas():
    """`vuelta` la tuvo que clasificar una persona: el barrido de
    `comprobar_relojes.py` solo propone nombres que ya conoce o que llevan un
    sufijo `En/At/Dur/Ini/Fin`, así que un nombre nuevo es invisible para él.
    Sin clasificar, `silencios.py --aplicar` la dejaría sin escalar y el
    retroceso duraría lo de antes sobre un reloj comprimido."""
    assert reloj.SEMANTICA.get("viaje") == "dur"
    assert reloj.SEMANTICA.get("vuelta") == "dur"
    # `espera` es POSICIÓN a propósito: es el instante en que la mano agarra
    assert reloj.SEMANTICA.get("espera") == "pos"


def test_no_queda_ninguna_clave_de_tiempo_sin_clasificar():
    """La red del barrido, sobre el catálogo entero. Vacío = la tabla está al
    día; si una plantilla nueva trae una clave que él SÍ sabe proponer, esto
    falla antes de que llegue a un montaje."""
    assert reloj.sin_clasificar() == {}


def test_las_dos_plantillas_nuevas_estan_en_el_orden_de_apilado():
    """Una capa fuera de `ORDEN` se descarta EN SILENCIO al componer.

    Y sus sitios no son intercambiables: la cortinilla va abajo porque revela
    metraje y forma parte del plano —cualquier tarjeta tiene que poder taparla—
    y la rejilla va con las tarjetas porque es una."""
    O = composite_ffmpeg.ORDEN
    assert "antesdespues" in O and "rejillalogos" in O
    assert O.index("antesdespues") < O.index("pip")
    assert O.index("rejillalogos") > O.index("pip")
    assert O.index("rejillalogos") < O.index("kineticcaptions")


# --------------------------------------------------------------------------
#  revelado por IMAGEN
# --------------------------------------------------------------------------
@pytest.mark.ffmpeg
def test_la_imagen_se_acota_en_el_tiempo(montaje):
    """LA prueba de este bloque, porque su fallo no es un error sino un CUELGUE.

    `-loop 1` a secas es una entrada infinita y `alphamerge` espera a que
    terminen todas las suyas, así que la codificación no acaba nunca: no falla,
    no avisa, se queda ahí. Medido: diez minutos sin escribir un fotograma más.
    Un `-t` que desaparezca no rompería ninguna otra prueba — solo colgaría el
    montaje del usuario."""
    import re
    # `comando` es la línea entera, no una lista de argumentos
    cmd = d = grafo(montaje, imagen=montaje["img"])[0]["comando"]
    assert re.search(r"-loop 1 -t [\d.]+ -i \S*captura\.png", cmd), \
        "la imagen entra sin -t que la acote: la composición no terminaría.\n" + cmd


@pytest.mark.ffmpeg
def test_con_imagen_no_se_construye_la_segunda_cadena_de_aroll(montaje):
    """Revelar una imagen y decodificar el A-Roll otra vez son alternativas, no
    pasos. Construir las dos duplicaría el trabajo más caro del compositor para
    tirar el resultado."""
    d, _ = grafo(montaje, imagen=montaje["img"])
    g = json.dumps(d)
    assert "arollcr" not in g
    assert "alphamerge[an1]" in g
    assert "[img1]" in g


@pytest.mark.ffmpeg
def test_la_imagen_se_escala_al_LIENZO(montaje):
    """`alphamerge` exige que los dos flujos midan lo mismo, y en `--preview` el
    lienzo es la mitad. Escalar al tamaño nativo de la imagen daría un error de
    ffmpeg que no menciona ni la cortinilla ni la imagen."""
    d, _ = grafo(montaje, imagen=montaje["img"])
    assert "scale=1080:1920" in json.dumps(d)
    d, _ = grafo(montaje, imagen=montaje["img"], extra=["--preview"])
    assert "scale=540:960" in json.dumps(d)


@pytest.mark.ffmpeg
def test_cubrir_recorta_y_contener_acolcha(montaje):
    """Los dos encajes, y son decisiones distintas: `cubrir` llena el cuadro
    porque una captura con bandas al lado del metraje se lee como un error de
    montaje; `contener` la deja entera para cuando lo que importa es leerla."""
    d, _ = grafo(montaje, imagen=montaje["img"])
    g = json.dumps(d)
    assert "force_original_aspect_ratio=increase" in g and "crop=1080:1920" in g

    d, _ = grafo(montaje, imagen=montaje["img"], ajuste="contener")
    g = json.dumps(d)
    assert "force_original_aspect_ratio=decrease" in g and "pad=1080:1920" in g


@pytest.mark.ffmpeg
def test_la_imagen_no_pasa_por_el_LUT(montaje):
    """Es un asset, no metraje. Graduar una captura de pantalla la tiñe de
    bronce y deja de ser la captura."""
    d, _ = grafo(montaje, imagen=montaje["img"])
    cad = [p for p in json.dumps(d).split(";") if "[img1]" in p]
    assert cad and "lut3d" not in cad[0]


@pytest.mark.ffmpeg
def test_con_imagen_el_LUT_deja_de_ser_obligatorio(montaje):
    """El aviso de «sin LUT los dos lados son el mismo píxel» es del revelado
    por METRAJE. Con una imagen los dos lados difieren pase lo que pase, y
    heredar aquel aviso habría desactivado un revelado que funciona."""
    d, err = grafo(montaje, imagen=montaje["img"], extra=["--lut", "none"])
    assert "SIN LUT" not in err
    assert "[img1]" in json.dumps(d)


@pytest.mark.ffmpeg
def test_con_imagen_el_metraje_en_columna_deja_de_estorbar(montaje):
    """Mismo razonamiento: la imagen no tiene que casar con el encuadre del
    A-Roll, así que `--aroll derecha` no la afecta."""
    d, err = grafo(montaje, imagen=montaje["img"], extra=["--aroll", "derecha"])
    assert "aroll completo" not in err
    assert "[img1]" in json.dumps(d)


@pytest.mark.ffmpeg
def test_una_imagen_que_no_existe_avisa_y_no_revela(montaje):
    """Una ruta mal escrita es el error más probable de este componente. Sin
    esta comprobación, ffmpeg muere con «No such file or directory» sin decir
    qué capa lo pidió, en medio de una composición de minutos."""
    d, err = grafo(montaje, imagen="assets/broll/no_existe_12345.png")
    assert "no existe" in err and "antesdespues" in err
    g = json.dumps(d)
    assert "[img1]" not in g and "arollcr" not in g
