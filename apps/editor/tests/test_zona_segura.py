"""`medir_zona_segura.py`: que la medida recupere una interfaz SEMBRADA.

La única forma de probar un medidor es darle algo cuya respuesta ya se sabe.
Aquí se fabrican dos «capturas» de vídeos DISTINTOS con la misma interfaz
pintada encima, en una posición que elige la prueba, y se exige que el
medidor devuelva esa posición.

Fue esta prueba la que tumbó la primera versión: cortaba la banda con un
umbral FIJO del 22 % y se comió 324 px de vídeo, porque dos capturas
cualesquiera tienen un suelo de coincidencia —en el montaje sintético, del
33 %—. El criterio bueno es el DESPEÑE respecto al borde, y sin una
respuesta conocida contra la que medir, el error habría viajado a la tabla
de `colocar.py` disfrazado de medición.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import medir_zona_segura as m                     # noqa: E402

# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
from comun import FFMPEG                        # noqa: E402


def captura(ruta, w, h, fondo, sup, inf):
    """Una «captura»: un vídeo cualquiera con la interfaz pintada encima.

    Las bandas de alto CERO se omiten en vez de pasarse a `drawbox`. En
    ffmpeg, `h=0` no es «una caja sin alto» sino el valor por defecto —el
    alto ENTERO—, así que el caso «sin interfaz» pintaba las dos capturas
    de negro de arriba abajo y el medidor, con razón, devolvía que todo era
    interfaz. El fallo estaba en la prueba, no en lo probado."""
    cajas = []
    if sup > 0:
        cajas.append("drawbox=0:0:%d:%d:0x101014@1:t=fill" % (w, sup))
    if inf > 0:
        cajas.append("drawbox=0:%d:%d:%d:0x101014@1:t=fill" % (h - inf, w, inf))
    cmd = [FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", fondo,
           "-frames:v", "1"]
    if cajas:
        cmd += ["-vf", ",".join(cajas)]
    subprocess.run(cmd + [ruta], check=True, capture_output=True)


@pytest.fixture
def par():
    d = tempfile.mkdtemp(prefix="zona_")
    yield d
    shutil.rmtree(d, ignore_errors=True)


def mide(d, w, h, sup, inf):
    a, b = os.path.join(d, "a.png"), os.path.join(d, "b.png")
    captura(a, w, h, "gradients=s=%dx%d:c0=0x203040:c1=0x806040:n=2" % (w, h),
            sup, inf)
    captura(b, w, h, "testsrc2=s=%dx%d" % (w, h), sup, inf)
    W, H = m.dimensiones(a)
    alto = max(1, round(m.ANCHO * H / W))
    grises = [m.gris(x, m.ANCHO, alto) for x in (a, b)]
    n = m.ANCHO * alto
    mask = m.mascara([g[:n] for g in grises], n)
    arriba, abajo, _ = m.bandas(mask, m.ANCHO, alto)
    return (arriba + 1) / float(alto), (alto - abajo) / float(alto)


@pytest.mark.ffmpeg
def test_recupera_la_interfaz_sembrada(par):
    """200 px arriba y 320 abajo sobre 1920: 0,104 y 0,167."""
    f_sup, f_inf = mide(par, 1080, 1920, 200, 320)
    assert f_sup == pytest.approx(200 / 1920, abs=0.01)
    assert f_inf == pytest.approx(320 / 1920, abs=0.01)


@pytest.mark.ffmpeg
def test_el_suelo_de_coincidencia_no_se_traga_el_video(par):
    """La regresión que existió: con el umbral fijo, la banda superior salía
    de 200 a 524 px porque los dos fondos coinciden en un 33 % bastante
    abajo. El corte por despeñe tiene que parar en el borde real."""
    f_sup, _ = mide(par, 1080, 1920, 200, 320)
    assert f_sup < 0.15, "la banda se comió vídeo: %.3f" % f_sup


@pytest.mark.ffmpeg
def test_una_pantalla_mas_alta_que_9_16(par):
    """El caso real: los móviles de hoy son ~0,46 y el lienzo 0,5625. La
    medida sobre la PANTALLA no debe cambiar por eso."""
    f_sup, f_inf = mide(par, 1180, 2556, 300, 456)
    assert f_sup == pytest.approx(300 / 2556, abs=0.01)
    assert f_inf == pytest.approx(456 / 2556, abs=0.01)


@pytest.mark.ffmpeg
def test_sin_interfaz_no_inventa_banda(par):
    """Dos vídeos distintos y NADA encima: el medidor no puede devolver una
    banda. Es el lado del error que importa — inventar zona tapada empujaría
    los gráficos al centro por nada."""
    f_sup, f_inf = mide(par, 1080, 1920, 0, 0)
    assert f_sup < 0.05 and f_inf < 0.05, "%.3f / %.3f" % (f_sup, f_inf)


@pytest.mark.ffmpeg
def test_una_interfaz_de_texto_suelto_se_rechaza(par):
    """El caso real de Instagram, y la razón de que exista `fiable()`: si la
    app dibuja TEXTO sobre el vídeo en vez de barras opacas, entre letra y
    letra se ve lo de debajo y no hay frontera que delimitar. Medido sobre
    dos capturas reales de Reels, la mejor fila daba 0,68 y el suelo de
    casualidad 0,09; la primera versión devolvió «0 px arriba» sobre unas
    capturas con la barra de estado a la vista, y eso es peor que no medir.

    Se simula con rayas finas —texto visto de lejos— en vez de una banda."""
    d = par
    a, b = os.path.join(d, "a.png"), os.path.join(d, "b.png")
    rayas = ",".join("drawbox=%d:%d:40:14:0xF0F0F0@1:t=fill" % (x, y)
                     for y in (60, 130, 1780, 1850)
                     for x in range(120, 900, 90))
    for ruta, fondo in ((a, "gradients=s=1080x1920:c0=0x203040:c1=0x806040:n=2"),
                        (b, "testsrc2=s=1080x1920")):
        subprocess.run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", fondo,
                        "-frames:v", "1", "-vf", rayas, ruta],
                       check=True, capture_output=True)
    W, H = m.dimensiones(a)
    alto = max(1, round(m.ANCHO * H / W))
    grises = [m.gris(x, m.ANCHO, alto) for x in (a, b)]
    n = m.ANCHO * alto
    mask = m.mascara([g[:n] for g in grises], n)
    _, _, perfil = m.bandas(mask, m.ANCHO, alto)
    ok, suelo, p_sup, p_inf = m.fiable(perfil, alto)
    assert not ok, ("una interfaz de texto suelto no puede medirse por "
                    "coincidencia: picos %.2f/%.2f" % (p_sup, p_inf))


@pytest.mark.ffmpeg
def test_una_banda_opaca_si_es_fiable(par):
    """El contrapunto: la puerta no puede rechazarlo TODO o no sirve."""
    d = par
    a, b = os.path.join(d, "a.png"), os.path.join(d, "b.png")
    captura(a, 1080, 1920, "gradients=s=1080x1920:c0=0x203040:c1=0x806040:n=2",
            200, 320)
    captura(b, 1080, 1920, "testsrc2=s=1080x1920", 200, 320)
    W, H = m.dimensiones(a)
    alto = max(1, round(m.ANCHO * H / W))
    grises = [m.gris(x, m.ANCHO, alto) for x in (a, b)]
    n = m.ANCHO * alto
    mask = m.mascara([g[:n] for g in grises], n)
    _, _, perfil = m.bandas(mask, m.ANCHO, alto)
    assert m.fiable(perfil, alto)[0]


def test_exige_dos_capturas():
    """Una sola captura no puede aislar la interfaz, y el script tiene que
    decirlo en vez de medir cualquier cosa."""
    r = subprocess.run(
        [sys.executable, os.path.join(RAIZ, "scripts", "medir_zona_segura.py"),
         "una.png"], capture_output=True, text=True)
    assert r.returncode == 2
    assert "DOS capturas" in r.stderr
