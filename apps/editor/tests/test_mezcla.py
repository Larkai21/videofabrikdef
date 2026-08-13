"""El mezclador, probado sin ffmpeg y sin vídeo.

Hasta ahora **no había ni una sola prueba del mezclador**, y no por descuido:
eran sesenta líneas dentro del `main()` de `composite_ffmpeg.py`, así que no se
podían llamar. Toda la calibración documentada —los +3,2 dB de los impactos,
los −60,5 dB del lecho— vive en la bitácora del ROADMAP y nada la sostenía.

Con `mezcla.py` el grafo es una cadena de texto que sale de datos, así que se
puede afirmar sobre ella en milisegundos y en el nivel RÁPIDO. Lo que estas
pruebas fijan no son valores estéticos —eso se juzga oyendo— sino las
propiedades que, al romperse, no dan error:

  · un cue con el nombre mal escrito debe AVISAR, no desaparecer;
  · el truncado debe sacrificar un tecleo, nunca el acorde del cierre;
  · el declick no puede cambiar la duración, o rompe la invariante de reloj;
  · la ganancia del máster tiene que ser exactamente la que falta.
"""

from __future__ import annotations

import os
import sys

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "scripts"))

import mezcla                    # noqa: E402

SFX = os.path.join(RAIZ, "assets", "sfx")


def capa(nombre, *cues):
    return {"capa": nombre,
            "cues": [{"sfx": s, "t": t, "gain": g} for s, t, g in cues]}


# --------------------------------------------------------------------------
#  recolección: el descarte silencioso que había aquí
# --------------------------------------------------------------------------
def test_un_sonido_que_no_existe_avisa_en_vez_de_desaparecer():
    """LA prueba de este fichero.

    El código que sustituye era `if os.path.exists(ruta): cues.append(...)`
    **sin `else`**: un nombre mal escrito se caía del grafo sin una línea de
    log, y el vídeo salía sin ese sonido sin que nada se quejara. Es el mismo
    patrón que el repo ya castigó con las capas fuera de `ORDEN` y con
    `parallax`/`dx` sin copiar al manifiesto — o sea la tercera vez."""
    cues, avisos = mezcla.recolectar(
        [capa("uno", ("impacto", 1.0, 1.0), ("no_existe_12345", 2.0, 1.0))], SFX)
    assert len(cues) == 1
    assert len(avisos) == 1
    assert "no_existe_12345" in avisos[0] and "uno" in avisos[0]


def test_el_catalogo_caza_el_nombre_antes_que_el_disco():
    """Con catálogo, el aviso dice «no está en el catálogo» en vez de «no
    existe el fichero». Distinguirlos importa: uno es una errata y el otro es
    que falta regenerar los `.wav`."""
    cues, avisos = mezcla.recolectar(
        [capa("uno", ("impacto", 1.0, 1.0))], SFX, catalogo={"tic"})
    assert cues == []
    assert "catálogo" in avisos[0]


def test_los_cues_salen_ordenados_por_tiempo():
    cues, _ = mezcla.recolectar(
        [capa("a", ("tic", 3.0, 1.0)), capa("b", ("clic", 1.0, 1.0))], SFX)
    assert [c["t"] for c in cues] == [1.0, 3.0]


# --------------------------------------------------------------------------
#  truncado por prioridad
# --------------------------------------------------------------------------
def test_al_truncar_sobrevive_el_cierre_y_no_el_tecleo():
    """El truncado de antes era POR ORDEN TEMPORAL, así que en una pieza con
    muchas señales desaparecía el sonido del FINAL — incluidos `resolucion` y
    `suscribir`, que son los dos momentos que la pieza entera prepara. Un
    cierre sin su acorde acaba en seco; un tecleo de menos no lo nota nadie."""
    cues = [{"sfx": "tecleo", "t": float(i), "gain": 1.0, "ruta": "x"}
            for i in range(20)]
    cues += [{"sfx": "resolucion", "t": 30.0, "gain": 1.0, "ruta": "x"},
             {"sfx": "suscribir", "t": 31.0, "gain": 1.0, "ruta": "x"}]
    quedan, aviso = mezcla.truncar(cues, 10)
    nombres = {c["sfx"] for c in quedan}
    assert "resolucion" in nombres and "suscribir" in nombres
    assert aviso and "tecleo" in aviso
    # y lo que queda sigue en orden temporal
    assert [c["t"] for c in quedan] == sorted(c["t"] for c in quedan)


def test_sin_exceso_no_se_toca_nada():
    cues = [{"sfx": "tic", "t": 1.0, "gain": 1.0, "ruta": "x"}]
    quedan, aviso = mezcla.truncar(cues, 24)
    assert quedan == cues and aviso is None


# --------------------------------------------------------------------------
#  una entrada por SONIDO, no por cue
# --------------------------------------------------------------------------
def test_diez_tecleos_son_una_sola_entrada_de_ffmpeg():
    """Antes cada cue era un `-i` del mismo fichero. Con `asplit` el `.wav`
    entra una vez y alimenta N ramas, que es lo que permite subir el tope de
    señales sin que el número de entradas se dispare."""
    cues, _ = mezcla.recolectar(
        [capa("t", *[("tecleo", i * 0.2, 1.0) for i in range(10)])], SFX)
    filtros, rutas, _ = mezcla.rama_cues(mezcla.agrupar(cues), 0, 0.55, 20.0)
    assert len(rutas) == 1, "diez cues del mismo sonido = una entrada"
    assert "asplit=10" in filtros[0]
    assert sum(1 for f in filtros if "adelay" in f) == 10


def test_un_solo_cue_no_pide_asplit():
    """`asplit=1` es legal pero es ruido en el grafo, y un grafo que se lee es
    un grafo que se puede depurar."""
    cues, _ = mezcla.recolectar([capa("t", ("tic", 1.0, 1.0))], SFX)
    filtros, _, _ = mezcla.rama_cues(mezcla.agrupar(cues), 0, 0.55, 20.0)
    assert not any("asplit" in f for f in filtros)


def test_el_relleno_esta_acotado():
    """`apad` sin argumento genera silencio INFINITO por rama, y solo lo corta
    el `duration=first` del amix final. Con ocho ramas da igual; con ciento
    veinte es trabajo que ffmpeg hace para tirarlo."""
    cues, _ = mezcla.recolectar([capa("t", ("tic", 1.0, 1.0))], SFX)
    filtros, _, _ = mezcla.rama_cues(mezcla.agrupar(cues), 0, 0.55, 38.485)
    assert "apad=whole_dur=38.485" in filtros[0]


def test_la_ganancia_del_cue_se_multiplica_por_el_volumen_general():
    cues, _ = mezcla.recolectar([capa("t", ("impacto", 1.0, 1.7))], SFX)
    filtros, _, _ = mezcla.rama_cues(mezcla.agrupar(cues), 0, 0.55, 20.0)
    assert "volume=0.935" in filtros[0]      # 1.7 x 0.55


# --------------------------------------------------------------------------
#  el máster
# --------------------------------------------------------------------------
def test_la_ganancia_es_exactamente_la_que_falta():
    assert mezcla.ganancia_para(-17.60) == pytest.approx(3.60, abs=0.001)
    assert mezcla.ganancia_para(-14.00) == pytest.approx(0.0, abs=0.001)
    assert mezcla.ganancia_para(-10.00) == pytest.approx(-4.0, abs=0.001)


def test_el_limitador_no_es_opcional():
    """No es una preferencia, es aritmética: medido, la pieza sale a −17,6 LUFS
    con el pico en −2,8. Llevarla a −14 son +3,6 dB y solo hay 2,8 de margen,
    así que sin limitador el máster se va POR ENCIMA de 0 dBFS y lo recorta el
    codificador, que no pregunta."""
    assert mezcla.ganancia_para(-17.6) > 2.8
    r = mezcla.rama_master("mix", mezcla.ganancia_para(-17.6))
    assert "alimiter" in r[0]


def test_el_techo_deja_margen_para_el_codec():
    """−1,4 dBFS y no −1,0. Medido aislando el códec sobre el máster real:
        techo −1,0 -> el fichero sale a −0,2
        techo −1,2 -> −0,7
        techo −1,4 -> −1,0
    Parte del sobrepaso lo pone `alimiter` con `attack=5`, que deja pasar
    transitorios cortos, y parte el AAC. Da igual de quién sea: lo que se
    entrega es el mp4."""
    assert mezcla.TECHO_DEFECTO == -1.4
    r = mezcla.rama_master("mix", 3.6)
    assert "limit=0.8511" in r[0]


# --------------------------------------------------------------------------
#  declick
# --------------------------------------------------------------------------
def test_el_declick_no_cambia_la_duracion():
    """`afade` y no `acrossfade`. `acrossfade=d` acorta la salida en `d` por
    junta: con 14 juntas a 20 ms son 0,28 s que el audio pierde y el vídeo no,
    y eso rompe la invariante de reloj de punta a punta que `test_cadena`
    existe para proteger. Se comprueba en la CADENA: `afade` no lleva ningún
    parámetro que recorte."""
    f = mezcla.declick(2.0)
    assert "acrossfade" not in f
    assert f.count("afade") == 2
    assert "st=1.9940" in f      # la salida empieza 6 ms antes del final


def test_el_declick_se_acota_en_un_tramo_muy_corto():
    """Un `keep` de 15 ms es legal. Con 6 ms fijos los dos fundidos se
    solaparían y el tramo se quedaría sin nivel plano."""
    f = mezcla.declick(0.012)
    assert "d=0.0040" in f       # un tercio del tramo
    assert "d=0.0060" not in f


def test_la_curva_del_declick_es_potencia_constante():
    """`qsin` y no la rampa lineal: cuarto de seno mantiene la potencia, y una
    rampa lineal deja un hoyo de energía en la junta."""
    assert mezcla.declick(1.0).count("curve=qsin") == 2


# --------------------------------------------------------------------------
#  calibración del catálogo por familias
# --------------------------------------------------------------------------
import json                                              # noqa: E402

import hacer_sfx                                         # noqa: E402

ORO_SFX = os.path.join(RAIZ, "tests", "fixtures", "oro", "sfx.json")


def _oro():
    with open(ORO_SFX, encoding="utf-8") as f:
        return json.load(f)


def test_cada_familia_esta_calibrada_a_su_objetivo():
    """Lo que se fija es la PROPIEDAD, no el nivel: que los efectos que hacen
    el mismo trabajo suenen igual de fuerte. Antes había **18,5 dB** de
    dispersión entre gestos, y eso obligaba a compensar a ojo con `--sfx-vol`
    y con las ganancias por plantilla — o sea que ningún número significaba lo
    que decía.

    El umbral es 3 dB, holgado a propósito: el techo de pico puede morder antes
    que el objetivo de energía, y cuando lo hace es correcto que lo haga."""
    oro = _oro()
    for fam, cfg in hacer_sfx.FAMILIAS.items():
        clave = cfg["medida"].replace("_dB", "_dB")
        vs = [oro[n][clave] for n in oro if hacer_sfx.familia(n) == fam]
        assert vs, "la familia %s se ha quedado vacía" % fam
        assert max(vs) - min(vs) <= 3.0, (
            "%s tiene %.1f dB de dispersión: %s"
            % (fam, max(vs) - min(vs), sorted(vs)))


def test_ningun_efecto_pasa_del_techo_de_pico():
    """Por encima de −6 dBFS un efecto empieza a comerse el margen del máster,
    que desde que se normaliza es un recurso medido y no infinito."""
    oro = _oro()
    for n, m in oro.items():
        if n in hacer_sfx.SIN_CALIBRAR:
            continue
        assert m["pico_dB"] <= hacer_sfx.TECHO_PICO + 0.1, \
            "%s tiene el pico en %.1f dBFS" % (n, m["pico_dB"])


def test_todos_los_efectos_disparan_el_ducking():
    """LA prueba que justifica el bloque entero.

    `deslizar` tenía el pico en −21,8 dBFS. Con su `gain 0,9` y `--sfx-vol
    0,55` llegaba a la mezcla a −27,9, y el umbral del `sidechaincompress` es
    `0.05` = −26,02: **no apartaba la voz**, así que sonaba entero por debajo
    de ella. Era la entrada de cuatro plantillas y dos de los ocho cues de la
    pieza real.

    Aislado en la galería sonaba perfecto. Ese hecho solo existe contra la voz,
    y por eso esta prueba mide la CADENA y no el fichero."""
    import math
    umbral_dB = 20 * math.log10(0.05)
    oro = _oro()
    # el caso más desfavorable del reparto real: la ganancia más baja
    gain_min, sfx_vol = 0.6, 0.55
    for n, m in oro.items():
        if n in hacer_sfx.SIN_CALIBRAR:
            continue
        en_mezcla = m["pico_dB"] + 20 * math.log10(gain_min * sfx_vol)
        assert en_mezcla > umbral_dB, (
            "%s llega a la mezcla a %.1f dBFS y el umbral del ducking es "
            "%.1f: no apartaría la voz" % (n, en_mezcla, umbral_dB))


def test_el_lecho_se_queda_fuera_de_la_calibracion():
    """Está diseñado para no oírse: igualarlo al resto sería romperlo. Es el
    mismo razonamiento que ya lo excluye del aviso de «casi mudo»."""
    assert "lecho" in hacer_sfx.SIN_CALIBRAR
    assert hacer_sfx.familia("lecho") == "cama"
    assert _oro()["lecho"]["rms_dB"] < -45


# --------------------------------------------------------------------------
#  la cama y los actos
# --------------------------------------------------------------------------
def test_sin_actos_no_hay_expresion():
    """Sin estructura no hay nada que seguir, y una expresión con `eval=frame`
    cuesta una evaluación por muestra: no se paga por nada."""
    assert mezcla.volumen_por_actos([], 0.25) is None


def test_la_cama_interpola_entre_actos_en_vez_de_conmutar():
    """Un escalón de gain en la frontera de acto es audible —es exactamente un
    corte de nivel, que es lo que el declick acaba de quitar de las juntas— y
    caería justo donde suele haber una pausa. Se comprueba evaluando la
    expresión: entre dos actos el valor tiene que MOVERSE, no saltar."""
    actos = [{"nombre": "gancho", "ini": 0.0, "fin": 4.0},
             {"nombre": "concepto", "ini": 4.0, "fin": 12.0}]
    e = mezcla.volumen_por_actos(actos, 0.25)
    assert e and "if(lt(t," in e

    def val(t):
        # se evalúa la expresión de ffmpeg como Python: `if(c,a,b)` y `lt`
        import re
        py = re.sub(r"\bif\(", "_if(", e).replace("lt(", "_lt(")
        return eval(py, {"_if": lambda c, a, b: a if c else b,
                         "_lt": lambda a, b: a < b, "t": t})
    a, b, c = val(1.0), val(6.0), val(11.0)
    assert a > c, "el gancho pesa más que el concepto"
    assert a > b > c, "entre los dos puntos medios tiene que interpolar: %s" % [a, b, c]


def test_los_pesos_de_acto_cubren_los_nombres_de_las_dos_rutas():
    """`dirigir.py` llama a sus actos hook/nucleo1/nucleo2/outro y las escaletas
    a mano usan gancho/concepto/prueba/cierre. Los dos vocabularios tienen que
    estar, o la mitad de las piezas caería al peso por defecto sin avisar."""
    for n in ("hook", "nucleo1", "nucleo2", "outro",
              "gancho", "concepto", "prueba", "cierre"):
        assert n in mezcla.PESO_ACTO, "falta el peso del acto «%s»" % n
