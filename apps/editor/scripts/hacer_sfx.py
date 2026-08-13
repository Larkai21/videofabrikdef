#!/usr/bin/env python3
"""Sintetiza la biblioteca de efectos de sonido. Sin muestras ajenas.

Todo se genera con `aevalsrc` de ffmpeg a partir de expresiones: nada se
descarga, así que no hay licencias que respetar ni archivos que falten al
clonar el repo.

Cómo se construye cada golpe:

  · La ALTURA baja con el tiempo. Un impacto real no tiene tono fijo: la
    membrana se tensa y se relaja. Para una frecuencia f(t)=f0-k·t la fase
    es la integral, 2π(f0·t - k·t²/2) — usar 2π·f(t)·t da un barrido del
    doble de pendiente y suena a efecto de dibujos animados.
  · La ENVOLVENTE es exponencial decreciente. Lineal suena sintético.
  · El TRANSITORIO (los primeros milisegundos de ruido) es lo que hace que
    un golpe se perciba fuerte sin subir el volumen.

Uso:
    python3 scripts/hacer_sfx.py
    python3 scripts/hacer_sfx.py --solo impacto --ganancia 0.8
"""

from __future__ import annotations

import argparse
import math
import os
import re
import subprocess
import sys

from comun import exige_ffmpeg, exige_ok

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SFX = os.path.join(RAIZ, "assets", "sfx")
# La resolución (entorno > PATH > Homebrew) vive en comun.py, una sola vez.
from comun import FFMPEG                        # noqa: E402
SR = 48000


def barrido_fase(f0: float, f1: float, dur: float) -> str:
    """Fase de un barrido lineal de f0 a f1. k = (f0-f1)/dur."""
    k = (f0 - f1) / dur
    return "2*PI*(%.4f*t-%.4f*t*t/2)" % (f0, k)


# Cada efecto: (expresión aevalsrc, duración, cadena de filtros, descripción)
EFECTOS = {
    # Golpe de transición: cuerpo grave que cae + chasquido de ataque.
    "impacto": (
        "0.86*exp(-13*t)*sin({f}) + 0.30*exp(-70*t)*random(0)".format(
            f=barrido_fase(190, 42, 0.5)),
        0.50,
        "highpass=f=28,lowpass=f=7000,acompressor=threshold=0.35:ratio=4:attack=1:release=90",
        "golpe seco para cortes y transiciones",
    ),

    # Barrido: ruido filtrado que sube y una cola de aire.
    "barrido": (
        "0.5*(exp(-2.2*t)*random(0)) + 0.22*exp(-3.5*t)*sin({f})".format(
            f=barrido_fase(300, 2400, 0.6)),
        0.60,
        "highpass=f=320,lowpass=f=9000,afade=t=in:d=0.06,afade=t=out:st=0.42:d=0.18",
        "whoosh para barridos y persianas",
    ),

    # Clic corto: para pastillas, tecleado y apariciones pequeñas.
    "clic": (
        "0.55*exp(-150*t)*random(0) + 0.35*exp(-90*t)*sin(2*PI*1750*t)",
        0.09,
        "highpass=f=800,lowpass=f=11000",
        "clic breve para pastillas y tecleado",
    ),

    # Aparición: tono ascendente muy suave, sin ataque.
    "aparicion": (
        "0.42*(1-exp(-26*t))*exp(-4.5*t)*(sin({f})+0.35*sin(2*{f}))".format(
            f=barrido_fase(420, 900, 0.45)),
        0.45,
        "highpass=f=200,lowpass=f=6500,afade=t=out:st=0.3:d=0.15",
        "entrada suave de un elemento",
    ),

    # Subgrave de cierre: presión, casi sin tono audible.
    "subgrave": (
        "0.9*exp(-4.2*t)*sin({f})".format(f=barrido_fase(72, 28, 1.2)),
        1.20,
        "lowpass=f=180,afade=t=out:st=0.85:d=0.35",
        "presión grave para el cierre",
    ),

    # Destello: chispa corta y brillante para los flashes a pantalla.
    "destello": (
        "0.5*exp(-40*t)*random(0) + 0.4*exp(-24*t)*sin(2*PI*2600*t)",
        0.22,
        "highpass=f=1200,lowpass=f=13000,afade=t=out:st=0.12:d=0.1",
        "chispa para destellos a pantalla completa",
    ),

    # Tic de trinquete: el chasquido de un tambor que encaja. Más corto y
    # más grave que `clic`, que es para pastillas y tecleado. Dos parciales
    # inarmónicos porque una madera golpeada no da un tono puro.
    "tic": (
        "0.45*exp(-190*t)*random(0)"
        " + 0.40*exp(-110*t)*sin(2*PI*1180*t)"
        " + 0.22*exp(-150*t)*sin(2*PI*1970*t)",
        0.055,
        "highpass=f=420,lowpass=f=9000",
        "trinquete del odómetro, uno por acarreo",
    ),

    # Riser: tensión que sube antes de un corte. La amplitud crece con
    # una potencia > 1 para que la última mitad concentre casi todo el
    # empuje; una rampa lineal se percibe plana y llega tarde.
    "riser": (
        "0.5*pow(t/1.8,2.3)*random(0)"
        " + 0.26*pow(t/1.8,2.0)*sin({f})".format(
            f=barrido_fase(180, 1500, 1.8)),
        1.80,
        "highpass=f=170,lowpass=f=11000,"
        "afade=t=in:d=0.25,afade=t=out:st=1.72:d=0.08",
        "subida de tensión antes de un corte",
    ),

    # Lecho: ruido rosa muy bajo. El silencio digital absoluto suena a
    # error de audio; un lecho a -42 dB lo evita sin que se perciba.
    #
    # Llevaba `afade=t=in:d=0.5` y `afade=t=out:st=3.5:d=0.5` DENTRO del
    # fichero, y se reproduce con `-stream_loop -1`. O sea que su sobre de
    # amplitud se repetía en cada vuelta: en una pieza de 38 s el fondo se caía
    # a nada **nueve veces y media**, una cada cuatro segundos, como un latido.
    # Un fondo que late no es un fondo.
    #
    # Los fundidos van UNA vez, en el mezclador, sobre la pieza entera. Y el
    # ruido no necesita costura: al no ser periódico, la unión del bucle es
    # tan discontinua como el propio material.
    "lecho": (
        "0.05*random(0)",
        4.00,
        "lowpass=f=2200,highpass=f=60,volume=0.5",
        "lecho ambiental en bucle, casi inaudible",
    ),
    # --- Confirmación de suscripción -------------------------------------
    # El clic solo dice «has tocado»; lo que hace satisfactoria una
    # suscripción es la CONFIRMACIÓN después. Van los dos en el mismo
    # archivo porque en pantalla son un solo gesto: pulsar y que responda.
    # Dos notas ascendentes, cuarta justa (880 -> 1174 Hz): un intervalo
    # consonante suena a «hecho»; uno disonante, a error.
    "suscribir": (
        "0.42*exp(-160*t)*random(0)"
        " + 0.34*exp(-140*t)*sin(2*PI*2100*t)"
        " + 0.30*gt(t,0.05)*exp(-11*(t-0.05))*("
        "sin(2*PI*880*(t-0.05)) + 0.30*sin(2*PI*1760*(t-0.05)))"
        " + 0.28*gt(t,0.15)*exp(-9*(t-0.15))*("
        "sin(2*PI*1174*(t-0.15)) + 0.28*sin(2*PI*2348*(t-0.15)))",
        0.55,
        "highpass=f=260,lowpass=f=12000,afade=t=out:st=0.42:d=0.13",
        "pulsar el botón de seguir y su confirmación",
    ),

    # --- Aviso ------------------------------------------------------------
    # Dos tonos MUY juntos en el tiempo y separados en altura: es la firma
    # de un aviso de móvil. Si se separan más, deja de leerse como uno.
    "notificacion": (
        "0.34*exp(-13*t)*sin(2*PI*1568*t)"
        " + 0.32*gt(t,0.085)*exp(-11*(t-0.085))*sin(2*PI*2093*(t-0.085))"
        " + 0.10*exp(-60*t)*random(0)",
        0.42,
        "highpass=f=600,lowpass=f=11000,afade=t=out:st=0.3:d=0.12",
        "aviso corto para notification-pop",
    ),

    # --- Burbuja ----------------------------------------------------------
    # Un «pop» es un tono que SUBE mientras se apaga: la burbuja se abre.
    # Con frecuencia fija suena a bloque de madera, no a burbuja.
    "pop": (
        "0.55*exp(-38*t)*sin({f}) + 0.14*exp(-120*t)*random(0)".format(
            f=barrido_fase(420, 1150, 0.13)),
        0.16,
        "highpass=f=240,lowpass=f=7000",
        "burbuja para pastillas, comentarios y globos",
    ),

    # --- Tecleado ---------------------------------------------------------
    # Más seco y más grave que `clic`: una tecla es masa golpeando tope,
    # no un contacto eléctrico. Cae en 8 ms.
    "tecleo": (
        "0.50*exp(-260*t)*random(0)"
        " + 0.28*exp(-200*t)*sin(2*PI*640*t)"
        " + 0.16*exp(-240*t)*sin(2*PI*1450*t)",
        0.045,
        "highpass=f=200,lowpass=f=6500",
        "una tecla, para terminal y code-mockup",
    ),

    # --- Resolución -------------------------------------------------------
    # Acorde mayor grave que se abre y se sostiene. Cierra la pieza: da la
    # sensación de final que un fundido a negro por sí solo no da.
    "resolucion": (
        "0.30*(1-exp(-14*t))*exp(-2.1*t)*("
        "sin(2*PI*130.8*t) + 0.7*sin(2*PI*196*t)"
        " + 0.5*sin(2*PI*261.6*t) + 0.3*sin(2*PI*392*t))",
        1.60,
        "highpass=f=70,lowpass=f=4200,afade=t=out:st=1.1:d=0.5",
        "acorde de cierre bajo la última tarjeta",
    ),

    # --- Deslizamiento ----------------------------------------------------
    # Aire corto y filtrado: acompaña una tarjeta que entra lateralmente
    # sin el golpe de `impacto` ni el barrido largo de `barrido`.
    "deslizar": (
        "0.34*exp(-9*t)*random(0)",
        0.32,
        "highpass=f=900,lowpass=f=6000,"
        "afade=t=in:d=0.05,afade=t=out:st=0.16:d=0.16",
        "entrada lateral suave de una tarjeta",
    ),

    # ======================================================================
    # LA MITAD QUE FALTABA
    # ----------------------------------------------------------------------
    # El catálogo tenía el lado positivo del vocabulario y no el negativo.
    # Medido en `dirigir.SFX_MICRO`: `red-crash` disparaba `subgrave` y
    # `stamp-banned` disparaba `impacto` —dos golpes NEUTROS haciendo de
    # negativos—, y `svg-checkmark` disparaba `notificacion`, o sea un aviso
    # de móvil haciendo de «correcto». Un aviso no dice «correcto», dice
    # «mira».
    #
    # §14 ya razona sobre consonancia contra disonancia para justificar la
    # cuarta justa de `suscribir`: el vocabulario estaba definido y solo
    # existía media lengua.
    # ======================================================================

    # --- Negativo ---------------------------------------------------------
    # Dos voces separadas por un TRITONO —311,1/220 = 1,4141 = raíz de dos—,
    # que es el único intervalo que el oído occidental no consigue resolver.
    # Lo que hacía de negativo hasta ahora era `subgrave`, que es UN SOLO
    # seno: sin dos alturas no hay intervalo, y sin intervalo no hay
    # disonancia. `subgrave` dice «peso», no dice «mal».
    #
    # Las dos caen (220->104 y 311->147) manteniendo la razón, porque una
    # caída de altura es colapso. Y la cuarta voz entra a 90 ms un semitono
    # por debajo del A2: a esa distancia el oído todavía la agrupa con el
    # ataque, así que se percibe como que el propio golpe se DESAFINA. Más
    # tarde sonaría a melodía, que es lo contrario de lo que se busca.
    "fallo": (
        "0.50*exp(-9*t)*sin({a})"
        " + 0.34*exp(-8*t)*sin({b})"
        " + 0.26*exp(-55*t)*random(0)"
        " + 0.18*gt(t,0.09)*exp(-7*(t-0.09))*sin(2*PI*103.83*(t-0.09))".format(
            a=barrido_fase(220, 104, 0.55), b=barrido_fase(311.1, 147, 0.55)),
        0.70,
        "highpass=f=55,lowpass=f=5200,"
        "acompressor=threshold=0.4:ratio=3:attack=2:release=120,"
        "afade=t=out:st=0.56:d=0.14",
        "negativo: algo se ha roto",
    ),

    # --- Positivo ---------------------------------------------------------
    # TRES notas y no dos. Dos notas juntas y separadas en altura es la firma
    # de un AVISO, y esa plaza ya la ocupa `notificacion`. Tres ascendentes
    # que aterrizan en la octava de la primera (C5 -> G5 -> C6) son un arpegio
    # que CIERRA: el oído sabe adónde va y llega.
    #
    # La tercera decae mucho más despacio (-6 frente a -13 y -12): dura 167 ms
    # contra 77 y 83. La llegada dura, y eso es lo que suena a conseguido. Con
    # las tres decayendo igual sería una escala, no una resolución.
    #
    # En Do, como `resolucion` y como la cama: la pieza tiene un centro tonal
    # aunque nadie lo llame así.
    "acierto": (
        "0.10*exp(-70*t)*random(0)"
        " + 0.30*exp(-13*t)*(sin(2*PI*523.25*t)+0.25*sin(2*PI*1046.5*t))"
        " + 0.30*gt(t,0.07)*exp(-12*(t-0.07))*("
        "sin(2*PI*784*(t-0.07))+0.22*sin(2*PI*1568*(t-0.07)))"
        " + 0.34*gt(t,0.15)*exp(-6*(t-0.15))*("
        "sin(2*PI*1046.5*(t-0.15))+0.30*sin(2*PI*1568*(t-0.15))"
        "+0.14*sin(2*PI*2093*(t-0.15)))",
        0.75,
        "highpass=f=350,lowpass=f=12000,afade=t=out:st=0.60:d=0.15",
        "positivo: lo que se pedía ha pasado",
    ),

    # --- Dato -------------------------------------------------------------
    # Una resonancia estrecha que barre un espectro quieto, con la amplitud
    # modulada a 17 Hz. Por debajo de ~20 Hz el oído NO fusiona la modulación
    # en un timbre: la oye como rugosidad, como grano, y eso es lo que se lee
    # como «una máquina leyendo». A 25 Hz se fundiría y quedaría un timbre
    # nasal cualquiera.
    #
    # No es un `barrido`: aquel es ruido de banda ancha y mueve TODO el
    # espectro. Son gestos físicos distintos y por eso suenan a cosas
    # distintas. Un conteo de cifra usaba `tic`, que es madera golpeada.
    "escaner": (
        "0.42*exp(-2.0*t)*sin({f})*(0.55+0.45*sin(2*PI*17*t))"
        " + 0.10*exp(-3*t)*random(0)".format(
            f=barrido_fase(900, 3400, 0.90)),
        0.90,
        "highpass=f=600,lowpass=f=9000,"
        "afade=t=in:d=0.08,afade=t=out:st=0.70:d=0.20",
        "lectura de datos: mapa de calor, diagrama, nodos",
    ),

    # --- Anticipación -----------------------------------------------------
    # El complemento del `riser`, para cuando no caben 1,8 s de carrera.
    # Exponente 3,0 y no el 2,3 del riser: aquel tiene 1,8 s para construir y
    # este 0,7, así que debe ser casi inaudible hasta los últimos 200 ms o
    # deja de ser anticipación y se convierte en un segundo suceso. Con p=3, a
    # mitad de recorrido la amplitud vale 0,36 del pico (-8,9 dB).
    #
    # Y el barrido BAJA (1400 -> 260 Hz), al revés que el riser: el riser sube
    # porque la tensión sube; esto es la inhalación, y es el derrumbe de altura
    # lo que hace pesado lo que viene después. Acaba en 260 Hz, justo encima de
    # donde arranca `impacto` (190): encadenados suenan como UN gesto.
    "preimpacto": (
        "0.55*pow(t/0.70,3.0)*random(0)"
        " + 0.20*pow(t/0.70,2.4)*sin({f})".format(
            f=barrido_fase(1400, 260, 0.70)),
        0.70,
        "highpass=f=200,lowpass=f=10000,"
        "afade=t=in:d=0.05,afade=t=out:st=0.68:d=0.02",
        "anticipación corta: la inspiración antes del golpe",
    ),

    # --- Respiración ------------------------------------------------------
    # Sin NINGÚN tono, a propósito: todo el resto del catálogo tiene altura, y
    # un tramo de transición no puede tenerla porque chocaría con la
    # fundamental de la voz. Ruido de banda ancha filtrado a 180-2600 Hz ocupa
    # el mismo hueco espectral que la voz pero sin tono, así que se lee como
    # SALA y no como nota.
    #
    # El ataque dura 600 ms. El más lento del catálogo hasta ahora era
    # `aparicion`, 38 ms: dieciséis veces más rápido. Un ataque tan lento es lo
    # que hace que el oído lo clasifique como cambio de ENTORNO en vez de como
    # suceso; por debajo de ~250 ms cualquier subida se lee como algo que pasa.
    "aire": (
        "0.30*(1-exp(-2.6*t))*exp(-1.0*t)*random(0)",
        2.40,
        "highpass=f=180,lowpass=f=2600,"
        "afade=t=in:d=0.60:curve=qsin,afade=t=out:st=1.60:d=0.80:curve=qsin",
        "aire entre secciones: espacio, no evento",
    ),

    # ======================================================================
    # LA CAMA
    # ----------------------------------------------------------------------
    # El ROADMAP abre diciendo que el sistema «suena a nada», y lo dice de una
    # pieza que solo tiene voz, ocho golpes y cuatro segundos de ruido rosa en
    # bucle. Durante el 90 % de la duración no hay NADA debajo.
    #
    # Un bucle sin costura exige que **cada parcial complete un número ENTERO
    # de ciclos** en la longitud del bucle. Con L = 12 s la rejilla es 1/12 =
    # 0,08333 Hz, así que las frecuencias se eligen sobre esa rejilla:
    # 65,416667 × 12 = 785,0 exacto. La desviación respecto al Do2 temperado
    # (65,406 Hz) es de medio cent — el oído distingue a partir de 5-10, así
    # que es literalmente inaudible y compra una costura perfecta.
    #
    # Se sintetizan TRECE segundos y se tira el primero. Esto no es margen de
    # seguridad, es la diferencia entre que funcione y que no: `highpass` y
    # `lowpass` son IIR con estado, arrancan de cero, y su transitorio de
    # arranque no coincide con el régimen permanente del final. Medido, sobre
    # el salto muestra a muestra en la unión del bucle:
    #
    #     sin descartar     costura 5702  ·  248 veces la mediana (23)
    #     descartando 1 s   costura   30  ·  1,3 veces
    #
    # 1,0 s es múltiplo exacto de 1/12, así que lo que queda sigue en rejilla.
    #
    # Do sin tercera, como `resolucion` (130,8/196/261,6/392 = Do-Sol-Do-Sol).
    # Ni mayor ni menor: ninguna emoción declarada, que es lo que corresponde a
    # una pieza técnica. Y la cama vive una octava POR DEBAJO del mismo acorde,
    # así que cuando entra `resolucion` en el cierre no es un acorde nuevo: es
    # el mismo, que sube.
    #
    # SIN `afade` dentro del fichero, y eso es una corrección a `lecho`: sus
    # fundidos de 0,5 s están DENTRO del sample y se repiten en cada vuelta del
    # bucle, así que el fondo se cae a silencio nueve veces en una pieza de 38
    # s. Los fundidos van una sola vez, en el mezclador, sobre la pieza entera.
    "cama": (
        "0.100*sin(2*PI*65.416667*t)"          # Do2   785/12
        " + 0.070*sin(2*PI*65.750000*t)"       #       789/12 -> batido de 1/3 Hz
        " + 0.060*sin(2*PI*98.000000*t)"       # Sol2 1176/12
        " + 0.045*sin(2*PI*130.833333*t)"      # Do3  1570/12
        " + 0.030*sin(2*PI*196.000000*t)*(0.6+0.4*sin(2*PI*0.083333333*t))"
        " + 0.020*sin(2*PI*261.666667*t)*(0.5+0.5*sin(2*PI*0.166666667*t))",
        13.00,
        "highpass=f=45,lowpass=f=1200,"
        "atrim=start=1.0:end=13.0,asetpts=PTS-STARTPTS",
        "cama armónica en bucle de 12 s: la pieza deja de no tener música",
    ),
}


# --------------------------------------------------------------------------
# CALIBRACIÓN POR FAMILIAS
#
# El catálogo tenía 18,5 dB de dispersión entre efectos que hacen el mismo
# trabajo, y eso no es una cuestión de gusto: `--sfx-vol` y las ganancias de
# `SFX_POR_PLANTILLA` se estaban usando para compensar a ojo un catálogo
# descalibrado, así que ningún número significaba lo que decía.
#
# El daño concreto, medido: `deslizar` tenía el pico en −21,8 dBFS. Con su
# `gain 0,9` y `--sfx-vol 0,55` llega a la mezcla a **−27,9 dBFS**, y el umbral
# del `sidechaincompress` es `0.05` = **−26,02**. O sea que **no dispara el
# ducking**: no aparta la voz y suena entero por debajo de ella. Y es la
# entrada de cuatro plantillas de texto, dos de los ocho cues de la pieza real.
# Aislado en la galería suena perfecto; contra la voz no existe.
#
# Por qué TRES familias y no una sola cifra. Normalizar todo al mismo nivel
# medido igual es lo obvio y es lo malo: `tecleo` dura 45 ms y `subgrave` 1,2 s.
# Una medida de energía sobre 45 ms lo infravalora muchísimo, así que
# igualarlos por energía subiría `tecleo` casi veinte decibelios y lo estrellaría
# contra el limitador — matando justo el transitorio que, según la cabecera de
# este fichero, «es lo que hace que un golpe se perciba fuerte sin subir el
# volumen». Cada familia se mide por lo que el oído usa para juzgarla:
#
#   impulso   < 250 ms   por PICO   dura menos que la integración del oído
#   gesto     0,25-1 s   por RMS    energía sobre una ventana comparable
#   sostenido > 1 s      por RMS    ídem, ya asentado
#
# El techo de pico es común a todas: por encima de −6 dBFS un efecto empieza a
# comerse el margen del máster, que ahora es un recurso medido y no infinito.
FAMILIAS = {
    "impulso":   {"medida": "pico_dB", "objetivo": -6.0},
    "gesto":     {"medida": "rms_dB",  "objetivo": -21.0},
    "sostenido": {"medida": "rms_dB",  "objetivo": -22.5},
}
TECHO_PICO = -6.0

# El lecho queda FUERA de la calibración a propósito: está diseñado para no
# oírse, así que igualarlo al resto sería romperlo. Es el mismo razonamiento
# que ya excluye a `lecho` del aviso de «casi mudo».
SIN_CALIBRAR = {"lecho"}

# --------------------------------------------------------------------------
# VARIANTES POR ROTACIÓN
#
# Diez teclas seguidas eran el mismo fichero diez veces. Medido en la pieza
# real: 7 tecleos IDÉNTICOS en 6,5 s, misma ganancia. Ningún objeto físico
# suena dos veces igual, así que la repetición exacta es la firma acústica de
# lo sintético, y en una ráfaga es lo primero que el oído caza.
#
# Como la síntesis es paramétrica, la cura es trivial y determinista: tres
# variantes por efecto de ráfaga con desviaciones FIJAS escritas aquí — nada
# de random, mismas entradas → misma mezcla byte a byte. Frecuencia ±6-9 % y
# caída ±10-15 %: ±9 % de altura son ~1,5 semitonos, que en un clic
# amortiguado de 45-90 ms se lee como otra PULSACIÓN de la misma tecla; una
# desviación mayor empezaría a leerse como otra tecla, que es mentir.
#
# El contrato con el mezclador: la aparición i-ésima rota
# [base, v2, v3, v4][i % n] sondeando NOMBRES FIJOS (base, _v2, _v3, _v4:
# mezcla.variantes_de comprueba existencia, no globea — un glob por prefijo
# contaminaría la rotación con cualquier efecto futuro que compartiera
# prefijo). El base va primero: la primera pulsación suena como sonaba.
#
# Cada variante pasa por la MISMA calibración de dos pasadas que su base y
# aterriza en el mismo objetivo (impulso: pico −6 dBFS): la rotación varía el
# timbre, no el volumen.
_DESVIOS = (
    # (sufijo, desviación de frecuencia, desviación de caída)
    # caída positiva = decae más rápido = pulsación más seca
    ("v2", +0.07, +0.12),
    ("v3", -0.06, -0.10),
    ("v4", +0.09, -0.15),
)
VARIANTES = {
    "clic":   _DESVIOS,
    "tecleo": _DESVIOS,
    "tic":    _DESVIOS,
}


def catalogo() -> set:
    """Los nombres de sonido válidos. Es la ÚNICA fuente de verdad.

    `EFECTOS` manda y `assets/sfx/*.wav` es un artefacto de compilación: los
    `.wav` se pueden borrar y regenerar, la tabla no. Todo el que valide un
    nombre —el validador de planes, el lint, los contratos— pregunta aquí.

    Existe porque no lo hacía nadie: `grep sfx` sobre `lint_config.py`,
    `validar_plan.py` y `contratos.py` daba **cero** en los tres, así que un
    nombre mal escrito no lo cazaba nada y el compositor lo descartaba en
    silencio. Tres capas de red y ningún agujero tapado.
    """
    return set(EFECTOS)


def desajuste_con_disco(dir_sfx: str = SFX) -> list:
    """Qué hay en disco y no en la tabla, y al revés. Vacío = están al día."""
    if not os.path.isdir(dir_sfx):
        return ["no existe el directorio %s" % dir_sfx]
    en_disco = {f[:-4] for f in os.listdir(dir_sfx) if f.endswith(".wav")}
    # Las variantes declaradas son artefactos legítimos de su efecto base y se
    # esperan en disco igual que él. Solo las DECLARADAS: un `impacto_v2.wav`
    # dejado a mano sigue siendo basura y se avisa como siempre.
    variantes = {"%s_%s" % (base, suf)
                 for base, desvios in VARIANTES.items()
                 for suf, _df, _dk in desvios}
    fuera = []
    for n in sorted(catalogo() - en_disco):
        fuera.append("«%s» está en EFECTOS y no en disco: "
                     "regenéralo con python3 scripts/hacer_sfx.py --solo %s" % (n, n))
    for n in sorted(variantes - en_disco):
        base = n.rsplit("_", 1)[0]
        fuera.append("«%s.wav» es una variante declarada en VARIANTES y no "
                     "está en disco: regenérala con "
                     "python3 scripts/hacer_sfx.py --solo %s" % (n, base))
    for n in sorted(en_disco - catalogo() - variantes):
        fuera.append("«%s.wav» está en disco y no en EFECTOS: o es basura o "
                     "alguien borró su definición" % n)
    return fuera


def familia(nombre: str) -> str:
    if nombre in SIN_CALIBRAR:
        return "cama"
    d = EFECTOS[nombre][1]
    return "impulso" if d < 0.25 else "gesto" if d <= 1.0 else "sostenido"


_RECORTE = re.compile(r",?atrim=[^,]+,asetpts=PTS-STARTPTS")

# Lo que define una pulsación en los efectos de tono fijo: sus parciales
# `sin(2*PI*F*t)` y sus caídas `exp(-K*t)`. Los tres efectos de VARIANTES
# están escritos solo con estas dos formas; un barrido (`barrido_fase`) no
# pasaría por aquí y no tiene que pasar.
_FREC = re.compile(r"sin\(2\*PI\*(\d+(?:\.\d+)?)\*t\)")
_CAIDA = re.compile(r"exp\(-(\d+(?:\.\d+)?)\*t\)")


def _varia(expr: str, df: float, dk: float) -> str:
    """Deriva la expresión de una variante: cada frecuencia fija escalada por
    (1+df) y cada caída por (1+dk). Determinista: los factores vienen de la
    tabla `_DESVIOS`, no de ningún random.

    Si la expresión sale igual que entró, parar es lo honesto: una «variante»
    clónica es exactamente el bug que este mecanismo cura — la ráfaga volvería
    a ser el mismo fichero n veces y ningún log lo diría."""
    salida = _FREC.sub(
        lambda m: "sin(2*PI*%.1f*t)" % (float(m.group(1)) * (1 + df)), expr)
    salida = _CAIDA.sub(
        lambda m: "exp(-%.1f*t)" % (float(m.group(1)) * (1 + dk)), salida)
    if salida == expr:
        raise RuntimeError(
            "la variante ha salido idéntica al base: la expresión no tiene "
            "ni sin(2*PI*F*t) ni exp(-K*t) que escalar")
    return salida


def _sintetiza(nombre, ganancia, ruta, expr=None):
    # `expr` permite sintetizar una VARIANTE del efecto reutilizando su
    # duración y su cadena de filtros: una variante es la misma tecla con
    # otros números, no otro efecto.
    expr_base, dur, filtros, _ = EFECTOS[nombre]
    if expr is None:
        expr = expr_base

    # Si el efecto declara un recorte, va al FINAL de la cadena, detrás de la
    # ganancia y del limitador. No es cosmética: TODO filtro con estado tiene
    # un transitorio de arranque, y si el recorte va antes, ese transitorio
    # cae dentro de lo que se conserva.
    #
    # Lo pagué en la cama: el recorte estaba escrito antes del `alimiter` y la
    # costura del bucle se disparó de 30 a 2325 —116 veces la mediana— o sea
    # un clic cada doce segundos. El propósito del recorte era justamente
    # tirar el transitorio del `highpass`/`lowpass`; con el limitador detrás,
    # se tiraba uno y se metía otro.
    recorte = ""
    m = _RECORTE.search(filtros)
    if m:
        recorte = m.group(0).lstrip(",")
        filtros = _RECORTE.sub("", filtros).strip(",")

    cadena = filtros + ",volume=%.3f" % ganancia
    # alimit evita que un pico se pase de 0 dBFS y sature al mezclar
    cadena += ",alimiter=limit=0.94:level=false"
    if recorte:
        cadena += "," + recorte
    cmd = [
        FFMPEG, "-nostdin", "-y", "-loglevel", "error",
        "-f", "lavfi", "-i",
        "aevalsrc='%s':s=%d:d=%.3f" % (expr, SR, dur),
        "-af", cadena,
        "-c:a", "pcm_s16le", "-ar", str(SR), "-ac", "1",
        ruta,
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg falló en %s:\n%s" % (nombre, r.stderr.strip()))


def generar(nombre: str, ganancia: float, calibrar: bool = True) -> dict:
    """Sintetiza el efecto y, si toca, lo lleva al objetivo de su familia.

    Son dos pasadas: se sintetiza, se mide, y se vuelve a sintetizar con la
    ganancia corregida. Medir sobre el resultado y no calcular la ganancia a
    priori es lo que hace que el número sea cierto: entre la expresión y el
    fichero hay filtros, un compresor y un limitador, y ninguno de los tres
    tiene una función de transferencia que apetezca despejar.

    Se REMIDE al final y el residuo se devuelve. Si el techo de pico mordió
    antes de llegar al objetivo de energía, el residuo lo dice — nunca se calla.
    """
    expr, dur, filtros, desc = EFECTOS[nombre]
    ruta = os.path.join(SFX, nombre + ".wav")
    _sintetiza(nombre, ganancia, ruta)

    fam = familia(nombre)
    ajuste, residuo = 0.0, None
    if calibrar:
        ajuste, residuo = _calibra(nombre, ruta, ganancia)

    # Las variantes se generan AQUÍ, dentro de la síntesis de su base, y no
    # como entradas de EFECTOS: no son sonidos nuevos del vocabulario
    # —`catalogo()` sigue diciendo 21 y `comprobar_docs.py` lo deriva de
    # ahí—, son la misma tecla pulsada otra vez. Con `--solo tecleo` se
    # regeneran también sus variantes, que es lo que promete el mensaje de
    # `desajuste_con_disco`.
    variantes = []
    for sufijo, df, dk in VARIANTES.get(nombre, ()):
        vruta = os.path.join(SFX, "%s_%s.wav" % (nombre, sufijo))
        vexpr = _varia(expr, df, dk)
        _sintetiza(nombre, ganancia, vruta, expr=vexpr)
        if calibrar:
            _calibra(nombre, vruta, ganancia, expr=vexpr)
        mv = medir(vruta)
        variantes.append({"sufijo": sufijo, "archivo": vruta,
                          "pico_dB": mv.get("pico_dB")})

    return {"nombre": nombre, "archivo": ruta, "dur": dur, "desc": desc,
            "familia": fam, "ajuste_dB": round(ajuste, 2),
            "residuo_dB": None if residuo is None else round(residuo, 2),
            "variantes": variantes}


def _calibra(nombre, ruta, ganancia, expr=None):
    """La segunda pasada de `generar`: medir y volver a sintetizar con la
    ganancia corregida. Vive aparte para que las variantes pasen por LA MISMA
    calibración que su base — dos caminos de calibración divergen tarde o
    temprano, y una variante 2 dB más fuerte que su base convertiría la
    rotación en un trémolo."""
    fam = familia(nombre)
    ajuste, residuo = 0.0, None
    if fam in FAMILIAS:
        cfg = FAMILIAS[fam]
        m = medir(ruta)
        actual = m.get(cfg["medida"])
        if actual is not None:
            ajuste = cfg["objetivo"] - actual
            # el techo de pico manda sobre el objetivo de energía
            if m.get("pico_dB") is not None:
                ajuste = min(ajuste, TECHO_PICO - m["pico_dB"])
            _sintetiza(nombre, ganancia * (10 ** (ajuste / 20.0)), ruta, expr)
            m2 = medir(ruta)
            if m2.get(cfg["medida"]) is not None:
                residuo = m2[cfg["medida"]] - cfg["objetivo"]
    return ajuste, residuo


def medir(ruta: str) -> dict:
    """Medidas objetivas. No puedo oír el archivo, así que la verificación
    es numérica: nivel de pico (¿satura?), RMS (¿se oye algo?) y centroide
    espectral (¿está la energía donde debería?)."""
    r = subprocess.run(
        # OJO: astats escribe a nivel INFO. Con -v error el filtro corre
        # pero su salida se descarta y las medidas vuelven vacías.
        [FFMPEG, "-nostdin", "-v", "info", "-i", ruta,
         "-af", "astats=metadata=1:reset=0", "-f", "null", "-"],
        capture_output=True, text=True)
    # Si ffmpeg no puede ni leer el archivo, no hay verificación: `sacar`
    # devolvía None en todo, `generar` saltaba la calibración en silencio y
    # el golden de `oro.py` congelaba medidas vacías. Medir es el único
    # trabajo de esta función; si no puede, que pare y lo diga.
    exige_ok(r, "ffmpeg astats sobre %s" % ruta)
    salida = r.stderr
    def sacar(clave):
        for linea in salida.splitlines():
            if clave in linea:
                try:
                    return float(linea.split(":")[-1].strip())
                except ValueError:
                    return None
        return None
    return {
        "pico_dB": sacar("Peak level dB"),
        "rms_dB": sacar("RMS level dB"),
    }


def main() -> int:
    # Antes de nada: si falta el binario, decirlo con el comando que
    # lo arregla en vez de reventar con un FileNotFoundError crudo en
    # medio del trabajo.
    exige_ffmpeg("ffmpeg")
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo", default=None, choices=sorted(EFECTOS))
    ap.add_argument("--ganancia", type=float, default=0.85)
    ap.add_argument("--outdir", default=SFX)
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    nombres = [args.solo] if args.solo else sorted(EFECTOS)

    hechos = []
    for n in nombres:
        info = generar(n, args.ganancia)
        info.update(medir(info["archivo"]))
        info["kb"] = round(os.path.getsize(info["archivo"]) / 1024, 1)
        hechos.append(info)
        aviso = ""
        if info.get("pico_dB") is not None and info["pico_dB"] > -0.3:
            aviso = "  ⚠ al límite"
        # El lecho está DISEÑADO para no oírse: avisar de que es
        # inaudible sería avisar de que funciona.
        if (n != "lecho" and info.get("rms_dB") is not None
                and info["rms_dB"] < -45):
            aviso = "  ⚠ casi mudo"
        print("  %-10s %5.2fs  pico %6s dB  rms %6s dB  %5s KB%s  — %s"
              % (n, info["dur"], info.get("pico_dB"), info.get("rms_dB"),
                 info["kb"], aviso, info["desc"]))
        # Las variantes de rotación, con su pico a la vista: el contrato es
        # que queden a ±1 dB del base, y aquí es donde se comprueba mirando.
        for v in info.get("variantes", []):
            print("    └ %-10s        pico %6s dB"
                  % ("%s_%s" % (n, v["sufijo"]), v.get("pico_dB")))

    print("\n%d efectos en %s" % (len(hechos), args.outdir))
    return 0


if __name__ == "__main__":
    sys.exit(main())
