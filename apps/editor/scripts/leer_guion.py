#!/usr/bin/env python3
"""Lee un guion de dirección en JSON y escribe `build/plan.json`.

    .venv/bin/python scripts/leer_guion.py guion.json
    .venv/bin/python scripts/leer_guion.py guion.json --escribir
    .venv/bin/python scripts/leer_guion.py guion.json --json   # para agentes

El guion describe la pieza que se QUERÍA grabar. `build/timeline.json` describe
la que se grabó. Casi nunca son la misma, y ahí está todo el trabajo de este
script: **alinear** una contra otra y decir en voz alta cada divergencia, en
vez de dejar caer en silencio lo que no encaja.

Tres reglas, y las tres vienen de errores que ya costaron un montaje:

1. **Los segundos del guion no mandan.** `start_sec`/`end_sec` son la intención
   del guionista; el reloj real lo pone la grabación. Todo se ancla a la
   PALABRA —igual que `escaleta.py`—, así que volver a transcribir mueve el
   plan con la transcripción en vez de descuadrarlo.
2. **Una palabra que no se dijo no se puede resaltar.** Si el guion pide azul
   sobre «arquitectura» y en el audio se oye «compilación», este script no
   inventa: alinea, propone el equivalente en la posición correspondiente y lo
   marca como SUSTITUCIÓN en el informe. Quien decide es quien lo lee.
3. **Un nombre que no existe se dice, no se descarta.** Los SFX del guion son
   nombres de fichero de banco (`stamp_heavy.wav`); los de este repo son
   sintetizados (`impacto`). Un cue mal escrito desaparecía sin una línea de
   log; aquí se traduce por tabla y lo que no esté en la tabla es un error.
   Y traducir no basta: en la pieza de Codex los 8 cues se validaban y SE
   TIRABAN —ninguna capa del plan llevaba `sfx`, y el sello, el HUD y el
   candado entraron en mudo—. Ahora cada capa colocada lleva su sonido
   deducido por las tablas de `dirigir.py` y los cues del guion se
   reconcilian contra lo colocado, acto a acto, con una línea por decisión.

Lo que este script NO puede hacer, y por eso lo dice en el informe en vez de
fingir que lo hizo: el desplazamiento lateral de CÁMARA (`FRAME_LEFT`) — el
recorte sigue al rostro y ese eje no se escribe. Y el de las CAPAS tampoco:

- **`POS_*` se INFORMA, no se emite.** La tabla `POSICIONES` existe y está
  vacía a propósito: llegó a traducir cada posición a un `dx` fijo, sacó
  tres gráficos del cuadro y con `escala` para que cupieran salió peor
  todavía. El porqué, medido, está sobre la tabla. Quien coloca es la
  plantilla —que maqueta para el lienzo entero— y `colocar.py`, que mide el
  alfa contra el rostro. El informe dice qué posición pidió el guion y que
  no se tradujo a nada.

Dos cosas que sí vivieron en esa lista y ya no:

- **`MODE_FULL_MOTION` existe.** El guion de Codex pidió «A-Roll oculto,
  Dark Canvas» y la tarjeta se compuso SOBRE la cara: 12,7 s con los ojos
  del presentador tapados (fotogramas 7,0 / 11,0 / 14,5 s). `fondo.html`
  —la única plantilla opaca, primera en el `ORDEN` del compositor— estaba
  ahí y nadie la emitía. Ahora cada acto full-motion la emite debajo de su
  gráfico, y gráfico y fondo llevan `colocar=False`: sobre fondo opaco no
  hay rostro del que apartarse.
- **`media_fetch` se resuelve EN LOCAL.** El guion pidió «shield security
  via pexels» y la respuesta fue «este repo no descarga nada» — mientras el
  fichero YA estaba en assets/broll/, bajado a mano. Descargar sigue sin
  hacerse: el slug se casa por TOKENS contra los ficheros en disco
  (`casa_slug`), los actos declaran `media_local` anclado a la PALABRA, y
  las escenas salen a `build/broll_plan.json` en reloj de ORIGEN — SIEMPRE,
  vacío incluido, para que el broll_plan de otra pieza no sobreviva en
  `build/`. De dónde se baja cada fichero y con qué licencia:
  `guiones/MEDIA.md`.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import escaleta  # noqa: E402
import reloj      # noqa: E402
# Las tablas de sonido del director son la MISMA verdad para los dos caminos:
# deducir aquí con una tabla propia es como se desincronizan. `escaleta` ya
# importa `dirigir`, así que esto no añade ninguna dependencia nueva.
import comun
import dirigir   # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLANTILLAS = os.path.join(RAIZ, "templates")


# --------------------------------------------------------------------------
# Traducción de nombres. El guion habla el idioma de un banco de recursos; el
# repo habla el suyo. La tabla es la frontera, y es explícita a propósito: un
# emparejado «inteligente» por parecido acertaría casi siempre y fallaría en
# silencio el resto de las veces, que es justo lo que se quiere evitar.

COMPONENTES = {
    "headline-clipper.html": "headline-clipper.html",
    "code-mockup.html": "code-mockup.html",
    "engagement-cta.html": "cierre-cta.html",
    "custom-component: security-pipeline-nodes": "security-pipeline-nodes.html",
    # Las tarjetas tech que el guionista no podía pedir. Medido antes de
    # añadirlas: 10 de 56 plantillas alcanzables desde un guion, y cada una
    # de estas ya existía en templates/ con su sonido de entrada en
    # `dirigir.SFX_POR_PLANTILLA`. Pedirlas reventaba con «no hay traducción».
    #
    # `data-diagram` pide cristal y aquí NO se declara: `escaleta.tarjeta`
    # lo activa sola para toda plantilla de `dirigir.CRISTAL` — y pasarle
    # `cristal=True` a mano sería PEOR que redundante, porque su guarda
    # («si ya viene, no toco nada») saltaría los valores de blur/sat/
    # desplazar calibrados por plantilla.
    "data-diagram.html": "data-diagram.html",
    "hero-stat.html": "hero-stat.html",
    "split-versus.html": "split-versus.html",
    "compare-ab.html": "compare-ab.html",
    "pasos-flow.html": "pasos-flow.html",
    "tweet-card.html": "tweet-card.html",
    "antes-despues.html": "antes-despues.html",
    # El odómetro: nuestro, parametrizable y hecho para contar. Entra ahora
    # porque la pieza de respiración lo pidió y no estaba: `hero-stat` ya
    # ocupaba el acto 1 y dos capas con el mismo nombre se pisan el
    # directorio de fotogramas (validar_plan.py lo caza).
    "odometro.html": "odometro.html",

    # --- EL CATÁLOGO IMPORTADO ---------------------------------------------
    # 126 plantillas entraron con `importar_bloque.js` y ninguna era pedible
    # desde un guion: el alcance se quedaba en 27 de 183. Estas son las que
    # aportan un REGISTRO que no teníamos —dibujo a mano, series de datos con
    # ejes, anillo de porcentaje, título con aberración— y por eso se abren
    # primero.
    #
    # Ojo con el copy: un bloque importado trae su contenido ESCRITO DENTRO.
    # No tiene ranura, así que `COPY` las marca como None y `card_copy` se
    # avisa y se tira. Hasta que alguien las parametrice sirven para lo que
    # son ahora mismo: estructura, anotación y movimiento — no para llevar
    # una frase que cambia por pieza.
    "hf-hw-pipeline.html": "hf-hw-pipeline.html",
    "hf-hw-title.html": "hf-hw-title.html",
    "hf-hw-text-cloud.html": "hf-hw-text-cloud.html",
    "hf-hw-frame.html": "hf-hw-frame.html",
    "hf-mk-line-graph.html": "hf-mk-line-graph.html",
    "hf-mk-usage-arc.html": "hf-mk-usage-arc.html",
    "hf-mk-progress-stat.html": "hf-mk-progress-stat.html",
    "hf-mk-specs-list.html": "hf-mk-specs-list.html",
    "hf-yt-prism-title.html": "hf-yt-prism-title.html",
    "hf-yt-lcd-background.html": "hf-yt-lcd-background.html",
    "hf-lt-bold-block.html": "hf-lt-bold-block.html",
    "hf-x-post.html": "hf-x-post.html",
}

# Dónde entra `card_copy` en cada plantilla. No hay una clave común y no la
# habrá: un titular de prensa (`titular`) y el rótulo de un diagrama (`titulo`)
# no son el mismo objeto. Lo que sí puede haber es una tabla, porque el fallo
# de no tenerla es mudo: `headline-clipper` recibió `titulo`, lo ignoró, y
# renderizó SU TEXTO DE MUESTRA —«El valor se desplaza hacia la capa de
# aplicación»— encima de la cara. Ni un aviso en ningún log.
#
# La forma del valor: `None` (sin ranura), un `str` (una ranura) o una
# LISTA de ranuras — `antes-despues` lleva dos rótulos y una sola clave no
# puede nombrarlos. Lista y no tupla a propósito: `contrato_guion.py` pinta
# cada ranura con `"%s" % ranura`, y una tupla ahí es interpolación
# múltiple — TypeError en la puerta de docs; una lista es UN argumento.
# Cada ranura nueva está VERIFICADA contra el `defaults` de su plantilla
# (`reloj.bloque_defaults`), porque una ranura equivocada es exactamente el
# fallo mudo de arriba.
# --- LA TABLA, ampliada de 9 ranuras a 35 -----------------------------------
# Nueve de 182 declaraban ranura de titular, y esas nueve son casi exactamente
# las que aparecían en todas las piezas: el repertorio real no lo fijaba el
# criterio de nadie, lo fijaba esta tabla. Lo que faltaba no era diseño —las
# plantillas ya tenían su clave— sino DECIR cuál de sus claves es el titular
# que `card_copy` rellena.
#
# El criterio para elegirla: la que un guionista escribiría entre comillas si
# le pidieras «el texto de esta tarjeta». Donde no hay una —porque el
# contenido es una LISTA y la tarjeta no existe sin ella— sigue en None y el
# informe manda su copy a `config`, que es lo correcto: media tarjeta con
# titular y sin lista es media tarjeta.
COPY = {
    "odometro.html": "rotulo",

    # --- tarjetas: su titular ---------------------------------------------
    "chapter-card.html": "titulo",
    "cita.html": "cita",                 # la cita ES la tarjeta; `autor` aparte
    "comment-bubble.html": "texto",
    "definition-card.html": "palabra",   # la ENTRADA del diccionario
    "kicker-hud.html": "titulo",
    "kinetic-quote.html": "texto",
    "lower-third.html": "nombre",
    "mapa-calor.html": "titulo",
    "marcos.html": "titular",
    "notification-pop.html": "titulo",
    "pip-frame.html": "label",
    "poll-rating.html": "titulo",
    "rejilla-logos.html": "titulo",
    "search-bar.html": "consulta",       # lo que se teclea es el copy
    "subtitles-showcase.html": "texto",
    "tarjeta-3d.html": "titulo",
    "highlighter-text.html": "texto",

    # --- micro-FX que llevan una palabra: esa palabra es su copy ----------
    # Son los mismos que la puerta de `_copy_sin_dar` obliga a rellenar
    # cuando se piden como micro-FX. Aquí se les da la vía de TARJETA, para
    # que un guion pueda ponerlos en pantalla sin conocer su config.
    "cursor-tap.html": "texto",
    "cut-strip.html": "texto",
    "gold-glint.html": "texto",
    "green-spike.html": "texto",
    "stamp-banned.html": "texto",
    "stroke-crossout.html": "texto",
    "svg-checkmark.html": "texto",
    "target-hud.html": "texto",
    "text-stack-offset.html": "texto",

    # --- sin titular, y dicho a propósito ---------------------------------
    # El contenido es una LISTA y sin ella no hay gráfico, así que un
    # `card_copy` suelto no tendría dónde ir: se avisa y va a `config`.
    "anotacion.html": None,        # marcas[]
    "capitulos.html": None,        # capitulos[]
    "chat-bubbles.html": None,     # mensajes[]
    "cinta.html": None,            # bandas[]
    "glass-dock.html": None,       # items[]
    "globo.html": None,            # visitas[]
    "kinetic-type.html": None,     # palabras[]
    "onda.html": None,             # niveles[]
    "pills.html": None,            # items[]
    "terminal.html": None,         # lineas[] — `titulo` es el chrome, 'zsh'
    "transicion.html": None,       # cortes[]
    # Y los que no llevan texto de ninguna clase.
    "fondo.html": None, "head-explode.html": None, "karaoke-subs.html": None,
    "kinetic-captions.html": None, "neural-node-pulse.html": None,
    "padlock-unlock.html": None, "red-crash.html": None,
    "timer-ring.html": None,
    # Los bloques importados no tienen ranura: su contenido va escrito dentro.
    **{n: None for n in (
        "hf-hw-pipeline.html", "hf-hw-title.html", "hf-hw-text-cloud.html",
        "hf-hw-frame.html", "hf-mk-line-graph.html", "hf-mk-usage-arc.html",
        "hf-mk-progress-stat.html", "hf-mk-specs-list.html",
        "hf-yt-prism-title.html", "hf-yt-lcd-background.html",
        "hf-lt-bold-block.html", "hf-x-post.html")},
    "headline-clipper.html": "titular",
    "security-pipeline-nodes.html": "titulo",
    "cierre-cta.html": "titular",
    "code-mockup.html": None,     # no tiene ranura de texto: lleva CÓDIGO
    "data-diagram.html": "titulo",   # defaults: titulo: 'Arquitectura'
    "hero-stat.html": "rotulo",      # rotulo es el titular; `etiqueta` es la
                                     # letra pequeña BAJO la cifra
    "compare-ab.html": "titulo",
    "tweet-card.html": "texto",      # el cuerpo del tuit ES el copy
    "split-versus.html": None,       # a/b son OBJETOS (rotulo/titulo/pie):
                                     # van por visual_trigger.config
    "pasos-flow.html": None,         # pasos[] con titulo+desc: por config
    # La única de DOS ranuras: `card_copy` trae las dos partes, como lista
    # o como cadena partida por « → » / «->» / «|».
    "antes-despues.html": ["antes", "despues"],
}


def _partes_copy(copy) -> list[str]:
    """Las partes de un `card_copy` para una plantilla de varias ranuras."""
    if isinstance(copy, (list, tuple)):
        return [str(x) for x in copy]
    return [p.strip() for p in re.split(r"\s*(?:→|->|\|)\s*", copy or "")
            if p.strip()]

MICRO_FX = {
    "stamp-banned": "stamp-banned.html",
    "padlock-unlock": "padlock-unlock.html",
    "svg-checkmark": "svg-checkmark.html",
    "target-hud": "target-hud.html",
    "cli-typewriter": "terminal.html",
    # Los nueve de `dirigir.SFX_MICRO` que faltaban. Cada uno tenía su
    # plantilla en templates/ y su sonido deducido en la tabla del director,
    # y aun así pedirlo por guion reventaba con «no hay traducción»: la
    # tabla era el único eslabón que no existía.
    "stroke-crossout": "stroke-crossout.html",
    "cut-strip": "cut-strip.html",
    "green-spike": "green-spike.html",
    "red-crash": "red-crash.html",
    "head-explode": "head-explode.html",
    "gold-glint": "gold-glint.html",
    "neural-node-pulse": "neural-node-pulse.html",
    "timer-ring": "timer-ring.html",
    "text-stack-offset": "text-stack-offset.html",
    # Dejó de ser None: templates/cursor-tap.html ya existe (tanda en
    # curso). Su sonido aún no está en dirigir.SFX_MICRO — lo pone
    # SFX_MICRO_NUEVOS, abajo, hasta que el director lo incorpore.
    "cursor-tap": "cursor-tap.html",

    # --- ANOTACIÓN Y TRANSICIÓN, del catálogo importado --------------------
    # Lo que de verdad faltaba: SEÑALAR en pantalla —flechas, círculos,
    # subrayados a mano, un foco que apaga lo demás— y CORTAR entre actos con
    # algo que no sea el barrido automático. Un vídeo técnico vive de
    # señalar, y este repo solo tenía `anotacion` y `highlighter-text`.
    #
    # Entran como micro-FX y no como componentes porque eso es lo que son:
    # duran un gesto, se anclan a una PALABRA y no llevan copy que cambie.
    "hw-arrow": "hf-hw-arrow.html",
    "hw-underline": "hf-hw-underline.html",
    "hw-callout-circle": "hf-hw-callout-circle.html",
    "hw-box-label": "hf-hw-box-label.html",
    "yt-circle-pointer": "hf-yt-circle-pointer.html",
    "yt-feather-highlight": "hf-yt-feather-highlight.html",
    "hw-scribble-transition": "hf-hw-scribble-transition.html",
    "whip-pan": "hf-whip-pan.html",
    "flash-through-white": "hf-flash-through-white.html",
    "light-leak": "hf-light-leak.html",
    "freeze-frame-dressing": "hf-freeze-frame-dressing.html",
    "morph-text": "hf-morph-text.html",
}

# Sonido deducido para micro-FX que `dirigir.SFX_MICRO` aún no conoce.
# NO es una tabla paralela —eso es como se desincronizan—: `dirigir` MANDA
# cuando el nombre está allí, y esta solo cubre el hueco entre que una
# plantilla nace y el director la aprende. Un cursor que pulsa suena a
# clic; el respaldo genérico (`aparicion`) diría «algo entró», no «se pulsó».
SFX_MICRO_NUEVOS = {"cursor-tap": ("clic", 0.6)}

# --- TODO EL CATÁLOGO, ALCANZABLE ------------------------------------------
# Las tablas de arriba son las CURADAS: nombre del guionista, ranura de copy y
# sonido pensados uno a uno. Por debajo se abre el resto del catálogo, porque
# el alcance real era 51 de 183 y eso significa que dos de cada tres plantillas
# existían para el que edita y no para el que escribe.
#
# Se DERIVA del disco y no se escribe a mano: una tabla de 183 filas copiada
# a mano nace vieja. Lo curado MANDA —un alias como `engagement-cta.html` sigue
# apuntando a `cierre-cta.html`— y lo derivado solo rellena lo que falte.
#
# Y lo que se abre no es lo mismo que lo que se garantiza: una plantilla
# alcanzable sin ranura en `COPY` no acepta `card_copy` (se avisa y se tira),
# y un micro-FX sin sonido en las tablas del director suena a lo genérico.
# Alcanzable quiere decir «se puede pedir sin que aborte», no «hace todo».
def _todas_las_plantillas() -> list:
    d = os.path.join(RAIZ, "templates")
    return sorted(f for f in os.listdir(d)
                  if f.endswith(".html") and not f.startswith("_")
                  and re.match(r"^[a-z0-9][a-z0-9-]*\.html$", f))


for _f in _todas_las_plantillas():
    COMPONENTES.setdefault(_f, _f)
    COPY.setdefault(_f, None)
    MICRO_FX.setdefault(_f[:-5], _f)
del _f



# Los del guion son nombres de banco. Los de este repo se SINTETIZAN
# (`scripts/hacer_sfx.py`), así que la traducción es por intención, no por
# fichero: lo que importa es que un golpe suene a golpe.
SFX = {
    "stamp_heavy.wav": "impacto",
    "whoosh_rise.wav": "riser",
    "tech_pulse.wav": "escaner",
    "hud_lock.wav": "tic",
    "unlock_click.wav": "clic",
    "keyboard_fast.wav": "tecleo",
    "ping_success.wav": "acierto",
    "mouse_click.wav": "clic",
    # Alias de banco para los sonidos que no tenían nombre de fichero.
    # Medido antes de añadirlos: el guionista alcanzaba 7 de los 21
    # sintetizados de `hacer_sfx.EFECTOS`. El criterio es la INTENCIÓN —un
    # whoosh ES un barrido, lo llame como lo llame el banco— y ningún alias
    # ambiguo: «swipe» podría ser barrido o deslizar, así que no está.
    "whoosh.wav": "barrido",
    "sub_drop.wav": "subgrave",
    "error_buzz.wav": "fallo",
    "notification.wav": "notificacion",
    "pop.wav": "pop",
    "sparkle.wav": "destello",
    "subscribe_reminder.wav": "suscribir",
    "appear.wav": "aparicion",
    "music_bed.wav": "cama",
}

# Cues de CLASE riser: no señalan una capa, anuncian una FRONTERA de acto. Y
# las fronteras ya suenan solas —el compositor emite su barrido/riser
# automático en cada cambio de acto—, así que colocar además el cue del guion
# sería sonorizar dos veces el mismo instante. `tech_pulse` está aquí como
# respaldo: primero intenta casar con una capa (afinidad o confirmación) y
# solo si no casa se da por cubierto por la frontera.
CUE_FRONTERA = {"whoosh_rise.wav", "tech_pulse.wav"}


# --- media: lo que hay en disco, no lo que habría que bajar -----------------
# Este repo no descarga nada, y eso no cambia. Lo que cambió es la respuesta
# a `media_fetch`: el guion de Codex pidió «shield security via pexels», el
# informe despachó «este repo no descarga nada»… y el fichero YA estaba en
# assets/broll/, bajado a mano. La resolución es contra el DISCO; qué fichero
# es cada media, de dónde se baja y con qué licencia vive en guiones/MEDIA.md
# (los media no se versionan: un clip de stock de ~10 MB doblaría el repo).
BROLL = os.path.join(RAIZ, "assets", "broll")
MEDIA_EXT = (".mp4", ".mov", ".webm", ".png", ".jpg", ".jpeg")
# Tokens del slug que no nombran CONTENIDO: el pegamento («via») y los
# proveedores. Fuera a propósito: el guion dijo «via pexels» y el clip vino
# de Pixabay — de qué banco salió un escudo no puede decidir si ES un escudo.
MEDIA_RUIDO = {"via", "de", "en", "stock", "pexels", "pixabay", "unsplash",
               "videvo", "giphy"}
MEDIA_FETCH_DUR = 2.0   # una escena pedida por un micro es un acento, no un acto


def casa_slug(slug: str) -> str | None:
    """El fichero de assets/broll/ que el slug de `media_fetch` nombra, o None.

    Por TOKENS y no por subcadena: «shield security via pexels» casa
    `shield_security_pixabay_262696.mp4` por «shield»+«security». Hacen
    falta al menos DOS tokens en común —o todos, si el slug solo trae uno—:
    con uno bastaría, «security dashboard» casaría el escudo y el fallo
    sería mudo, que es la clase de emparejado «listo» que la tabla
    COMPONENTES rechaza con nombre y apellidos. Empate lo decide el orden
    alfabético: determinista, como todo lo demás."""
    quiere = {t for t in (limpia(x) for x in re.split(r"[\s\-_./]+", slug or ""))
              if t and t not in MEDIA_RUIDO}
    if not quiere or not os.path.isdir(BROLL):
        return None
    mejor, puntos = None, 0
    for f in sorted(os.listdir(BROLL)):
        if not f.lower().endswith(MEDIA_EXT):
            continue
        suyo = {t for t in (limpia(x) for x in re.split(r"[\s\-_.]+", f)) if t}
        n = len(quiere & suyo)
        if n > puntos:
            mejor, puntos = f, n
    minimo = min(2, len(quiere))
    return mejor if puntos >= minimo else None


def _afines(*nombres: str) -> set[str]:
    """Piezas de nombre para la afinidad cue↔capa: `stamp_heavy` y
    `stamp-banned` comparten «stamp»; `hud_lock` y `target-hud`, «hud»;
    `unlock_click` y `padlock-unlock`, «unlock». Token EXACTO y no subcadena:
    «lock» está dentro de `padlock` y de `unlock`, y por subcadena `hud_lock`
    casaría también con el candado."""
    fuera: set[str] = set()
    for n in nombres:
        fuera |= {t for t in re.split(r"[-_.]", (n or "").lower())
                  if t and t not in ("wav", "html")}
    return fuera

# `FRAME_*` es encuadre de cámara. Solo el eje del zoom es expresable: el
# compositor recorta SIGUIENDO AL ROSTRO, así que «izquierda» no es un
# desplazamiento que se pueda escribir aquí. Se informa.
ENCUADRES = {"FRAME_CLOSE_UP": 1.16, "FRAME_LEFT": 1.0, "FRAME_WIDE": 1.0,
             "NONE": None, None: None}

# `POS_*` del guion → NADA. La tabla existe, está vacía, y la lista de
# claves es lo único que aporta: distingue una posición del vocabulario
# —que se acepta y se informa— de una inventada, que se avisa. Que el valor
# sea `{}` no es un hueco pendiente de rellenar: es la respuesta.
#
# Y esto es una vuelta atrás MEDIDA, no una opinión.
#
# La tabla llegó a traducir cada posición a un `dx` fijo, y después a un
# `dx` más `escala` para que el gráfico cupiera en su mitad. Las dos
# versiones salieron peor que no hacer nada, y se vio mirando la pieza:
#
#   · solo `dx`: un +250 igual para todos sobre plantillas que ocupan casi
#     el ancho entero —mockup 980 px de 1080, terminal 960, sello 860— sacó
#     tres gráficos del cuadro, 200, 190 y 140 px, con el código cortado a
#     media línea;
#   · con `escala` 0,62 sí cabían, pero el mockup pasó de ser grande y
#     legible sobre la barbilla a ser pequeño y estar CLAVADO EN LOS OJOS.
#     Encoger un gráfico para poder empujarlo cambia dos cosas a la vez y
#     estropea la que ya estaba bien.
#
# Quien coloca de verdad es la plantilla —que maqueta para el lienzo
# entero— y `colocar.py`, que mide el alfa contra el rostro EN ESA ventana
# de tiempo. El eje horizontal no es expresable para un gráfico que ocupa
# casi todo el ancho, y decirlo es más útil que fingirlo: para llevar algo
# a un lado hay que diseñar la plantilla estrecha, no empujar la ancha.
POSICIONES = {
    "POS_CENTER": {}, "POS_MID_RIGHT": {}, "POS_MID_LEFT": {},
    "POS_TOP_CENTER": {}, "POS_TOP_RIGHT": {}, "POS_TOP_LEFT": {},
}


def _despl_txt(d: dict) -> str:
    return ", ".join("%s=%s" % (k, ("%+d" % d[k]) if k != "escala"
                                else "%.2f" % d[k])
                     for k in sorted(d))


# --- la permanencia la dicta el CONTENIDO -----------------------------------
# Medido en la pieza de Codex: el `code-mockup` necesitaba 4,64 s SOLO de
# tecleo (194 caracteres a cps 42) y el guion le daba 3,0 — el nombre del
# producto y «fail-on: high» jamás llegaron a aparecer. Y el payoff del
# terminal («3 vulnerabilidades · 0 falsos positivos») entraba en t=1,0 de
# una capa de 1,3 s: vivió 0,3 s, ilegible. Ningún JSON válido delata nada de
# esto; hay que medir lo que la plantilla va a tardar, con SU compás.
# Las constantes del compás viven en reloj.py (TECLEO_*, LECTURA_*): una
# fuente para los tres consumidores.



TOPE_MICROFX = 3.0


# --- un micro-FX sin copy enseña el de su plantilla --------------------------
# Una tarjeta que no recibe copy se nota: sale el titular de otra pieza y en la
# revisión canta. Un micro-FX no, porque dura 1,3 s y nadie lo lee dos veces —
# y por eso se coló entero. Medido sobre las diez piezas de sesgos: `NO`
# tachado mientras la voz decía «es completamente falso», `ELIMINAR` en un
# fotograma de cine sobre la cara, `OBSOLETO` sellado sobre el flujo de los
# cuatro momentos, `PREMIUM` en la frente durante el cierre, y de los bloques
# importados «point at things», «the thing» y «underline the point / cross
# this out / bracket the aside», que es su demo tal cual.
#
# Se lee de la PLANTILLA y no de una tabla escrita a mano: la tabla envejece
# —lo demostró la lista de vocabulario de `test_defaults_sin_pieza`— y esto no,
# porque pregunta al fichero que va a rasterizar.
_CACHE_COPY: dict = {}


def _ranuras_de_texto(tpl: str) -> dict:
    """Qué claves de texto declara la plantilla, con lo que traen de fábrica.

    Dos formas, que son las dos que hay en el catálogo: un default `texto:`
    (las nuestras) y el mapa `RANURAS` que deja `importar_bloque.js` (los
    bloques de HyperFrames, cuyo copy vive dentro del marcado)."""
    if tpl in _CACHE_COPY:
        return _CACHE_COPY[tpl]
    try:
        src = open(os.path.join(RAIZ, "templates", tpl), encoding="utf-8").read()
    except OSError:
        return _CACHE_COPY.setdefault(tpl, {})
    fuera = {}
    m = re.search(r"defaults:\s*\{", src)
    if m:
        i = m.end() - 1
        hondo, j = 0, i
        for j in range(i, len(src)):
            if src[j] == "{":
                hondo += 1
            elif src[j] == "}":
                hondo -= 1
                if hondo == 0:
                    break
        bloque = re.sub(r"/\*.*?\*/", "", src[i:j + 1], flags=re.S)
        # Sin anclar a principio de línea: media docena de micro-FX declaran
        # sus defaults en UNA sola línea —`{ texto: 'NO', y: 900, … }`— y con
        # `^\s*texto` la puerta los daba por limpios. Eran justo los tres que
        # se colaron: `NO`, `OBSOLETO` y `PREMIUM`.
        t = re.search(r"(?:^|[{,])\s*texto\s*:\s*(['\"])(.*?)\1", bloque, re.M)
        if t and t.group(2):
            fuera["texto"] = t.group(2)
    r = re.search(r"var RANURAS = (\{.*?\});", src, re.S)
    if r:
        try:
            for clave in json.loads(r.group(1)):
                fuera.setdefault(clave, "el texto de muestra del bloque")
        except ValueError:
            pass
    return _CACHE_COPY.setdefault(tpl, fuera)


def _copy_sin_dar(tpl: str, cfg: dict) -> list:
    """Las ranuras de texto que la plantilla declara y el plan no llena."""
    return [(k, v) for k, v in sorted(_ranuras_de_texto(tpl).items())
            if not cfg.get(k)]


def _default_texto(tpl: str, clave: str) -> str:
    """El literal que `clave` trae de fábrica en `defaults`, o ''."""
    try:
        src = open(os.path.join(RAIZ, "templates", tpl), encoding="utf-8").read()
    except OSError:
        return ""
    m = re.search(r"defaults:\s*\{", src)
    if not m:
        return ""
    i, hondo, j = m.end() - 1, 0, m.end() - 1
    for j in range(i, len(src)):
        if src[j] == "{":
            hondo += 1
        elif src[j] == "}":
            hondo -= 1
            if hondo == 0:
                break
    bloque = re.sub(r"/\*.*?\*/", "", src[i:j + 1], flags=re.S)
    d = re.search(r"(?:^|[{,])\s*%s\s*:\s*([\'\"])(.*?)\1"
                  % re.escape(clave), bloque, re.M)
    return d.group(2) if d else ""


def _titular_sin_dar(tpl: str, cfg: dict) -> list:
    """Lo mismo para la ranura de TITULAR que declara la tabla `COPY`.

    No basta con mirar una clave llamada `texto`: el titular de
    `definition-card` es `palabra`, el de `search-bar` es `consulta` y el de
    `pip-frame` es `label`. Quien sabe cuál es en cada una es la tabla, que
    para eso existe."""
    ranura = COPY.get(tpl)
    if not ranura:
        return []
    claves = ranura if isinstance(ranura, (list, tuple)) else [ranura]
    fuera = []
    for k in claves:
        if cfg.get(k):
            continue
        v = _default_texto(tpl, k)
        if v:
            fuera.append((k, v))
    return fuera


# --- el agujero de la puerta de arriba ---------------------------------------
# `_ranuras_de_texto` pregunta qué ranuras DECLARA la plantilla, así que una
# que no declara ninguna pasa por limpia. Y hay 97 bloques importados que no
# declaran ninguna Y llevan texto dentro del marcado: `importar_bloque.js`
# solo consiguió exponer ranuras en 28 de los 125. Usar uno de esos compone
# «Unleash Full Potential», «START NOW», «Blue Sweater Intro Video» o
# «JAN 01 2000» dentro de la pieza, y no hay config que lo cambie.
#
# Se comprobó en las diez piezas de sesgos antes de quitarlos: `hf-hw-arrow`
# escribía «point at things» junto a la mano y `hf-yt-circle-pointer», «the
# thing» y «5 sec». La puerta anterior no los veía, precisamente por no
# declarar nada.
_CACHE_MUDO: dict = {}


def _texto_de_fabrica(tpl: str) -> list:
    """El texto que un bloque importado lleva EN EL MARCADO y nadie puede
    cambiar: sin ranuras, la config no llega a esos nodos.

    Solo se mira en `hf-*`: las nuestras construyen su DOM desde `config`, así
    que su texto de muestra vive en `defaults` y lo caza `_ranuras_de_texto`."""
    if not tpl.startswith("hf-"):
        return []
    if tpl in _CACHE_MUDO:
        return _CACHE_MUDO[tpl]
    try:
        src = open(os.path.join(RAIZ, "templates", tpl), encoding="utf-8").read()
    except OSError:
        return _CACHE_MUDO.setdefault(tpl, [])
    m = re.search(r"var RANURAS = (\{.*?\});", src, re.S)
    if not m or m.group(1).strip() != "{}":
        return _CACHE_MUDO.setdefault(tpl, [])
    cuerpo = re.sub(r"<script\b.*?</script>", " ", src, flags=re.S | re.I)
    cuerpo = re.sub(r"<style\b.*?</style>", " ", cuerpo, flags=re.S | re.I)
    cuerpo = re.sub(r"<!--.*?-->", " ", cuerpo, flags=re.S)
    cuerpo = re.sub(r"<[^>]+>", "\n", cuerpo)
    visto = [t.strip() for t in cuerpo.split("\n")
             if len(t.strip()) > 2 and not t.strip().startswith("&")]
    return _CACHE_MUDO.setdefault(tpl, visto)


def _exige_copy_propio(tpl: str, fid: str, acto: int) -> None:
    fijo = _texto_de_fabrica(tpl)
    if not fijo:
        return
    raise SystemExit(
        "el acto %d pide «%s» y ese bloque NO admite copy: su texto vive en el "
        "marcado y `importar_bloque.js` no consiguió exponer ninguna ranura.\n"
        "  Compondría, tal cual: %s\n"
        "  Son 97 de los 125 bloques importados. `guiones/CATALOGO.json` los "
        "marca con `admite_copy: false`; elige uno que sí lo admita."
        % (acto, fid, " · ".join("«%s»" % t for t in fijo[:4])))


def _gesto(tpl: str) -> float:
    """Cuánto dura el GESTO de una plantilla importada, medido al importarla.

    `importar_bloque.js` deja el número en el puente (`var DUR = 4.16;`) tras
    medirlo con el navegador. Leerlo aquí evita el número mágico: la duración
    de una capa deja de ser una constante del director y pasa a ser una
    propiedad de la pieza. Las nuestras no lo llevan y devuelven 0, así que
    conservan el 1,3 s de siempre."""
    try:
        src = open(os.path.join(RAIZ, "templates", tpl), encoding="utf-8").read()
    except OSError:
        return 0.0
    m = re.search(r"var DUR = ([\d.]+);", src)
    return float(m.group(1)) if m else 0.0


def _tecleo(cfg: dict):
    """Cuánto exige el contenido tecleable, o None si no lo hay.

    El compás vive en reloj.py — UNA fuente para quien dimensiona (aquí),
    quien vigila (validar_plan) y quien re-alarga tras el remapeo
    (silencios). Las copias locales divergieron una vez: para `terminal`
    esta tomaba la cola de la última línea por `at` y la puerta de la que
    termina más tarde, así que un plan dimensionado aquí reventaba allí.

    Devuelve `(fin_tecleo, cola, fines)` con `fines=[(fin, txt)]` para
    poder decir QUÉ se pierde si el acto no da.
    """
    filas = reloj.tecleo_filas(cfg)
    if not filas:
        return None
    txt_ult, fin_ult = max(filas, key=lambda p: p[1])
    cola = max(reloj.LECTURA_MIN, len(txt_ult.strip()) / reloj.LECTURA_CPS)
    return fin_ult, round(cola, 2), [(f, t) for t, f in filas]


def limpia(s: str) -> str:
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]", "", s)


def tokens(texto: str) -> list[str]:
    return [t for t in (limpia(x) for x in re.split(r"\s+", texto or "")) if t]


# --------------------------------------------------------------------------
class Alineacion:
    """Empareja las palabras del guion con las de la grabación.

    `difflib` sobre la secuencia ENTERA y no acto por acto: los actos del guion
    no coinciden con los de la grabación —el acto 2 del JSON acaba en
    «arquitectura» y la grabación dice «compilación»—, y alinear por trozos
    propaga el desajuste al trozo siguiente. Alineado entero, un acto que se
    desvía no arrastra a los demás.
    """

    def __init__(self, guion: list[str], reales: list[dict]):
        self.guion, self.reales = guion, reales
        self.rmap = [limpia(w["w"]) for w in reales]
        self.op = difflib.SequenceMatcher(
            a=guion, b=self.rmap, autojunk=False).get_opcodes()

    def resolver(self, i: int) -> tuple[int | None, str]:
        """Índice real para la palabra `i` del guion, y cómo se obtuvo."""
        for tag, i1, i2, j1, j2 in self.op:
            if not (i1 <= i < i2):
                continue
            if tag == "equal":
                return j1 + (i - i1), "exacta"
            if tag == "delete" or j1 == j2:
                return None, "no se dijo"
            # `replace`: la palabra se dijo de otra forma. Se elige la
            # candidata más parecida del tramo; si ninguna lo es, la última
            # con carga —los conectores nunca son el equivalente de un
            # sustantivo, y el tramo suele acabar en el sustantivo.
            palabra = self.guion[i]
            cand = list(range(j1, j2))
            mejor, r = max(
                ((j, difflib.SequenceMatcher(a=palabra, b=self.rmap[j]).ratio())
                 for j in cand), key=lambda x: x[1])
            if r >= 0.5:
                return mejor, "parecida (%.0f%%)" % (r * 100)
            carga = [j for j in cand if self.rmap[j] not in escaleta.ENLACES]
            if carga:
                return carga[-1], "equivalente por posición"
            return None, "no se dijo"
        return None, "fuera del guion"


# --------------------------------------------------------------------------
def bucle(tl: dict) -> tuple[float, float]:
    """El aire en la COSTURA del bucle infinito: cola y cabeza, en segundos.

    Cola: del final de la última palabra al final del montaje
    (`keep[-1].src_end`). Cabeza: del inicio del montaje (`keep[0].src_start`)
    a la primera palabra. Cuando la pieza se reproduce en bucle, esos dos
    trozos se pegan y su SUMA es lo que el espectador espera en silencio.

    Existe porque el guion de Codex declara `infinite_loop` y nadie medía si
    el montaje podía cumplirlo: la costura estaba en 0,00 s de cabeza y ni
    eso se decía. Aquí solo se MIDE y se DICE — tocar el montaje es de
    `silencios.py`, no de este script."""
    keep, words = tl["keep"], tl["words"]
    cola = float(keep[-1]["src_end"]) - float(words[-1]["end"])
    cabeza = float(words[0]["start"]) - float(keep[0]["src_start"])
    return round(cola, 2), round(cabeza, 2)


# La costura del bucle por encima de esto se lee como pausa, no como
# continuidad. Es el mismo umbral que usa `clean_transcript.py` para decir
# «esto ya es un silencio» (> 0,35 s), aplicado al único hueco que el
# espectador va a oír dos veces.
BUCLE_TOPE = 0.35


def construir(guion: dict, tl=None) -> tuple[escaleta.Escaleta, list[str]]:
    e = escaleta.Escaleta(tl)
    inf: list[str] = []          # el informe: todo lo que no fue literal
    palabras = e.tl["words"]
    # Las escenas de media (el broll_plan) viajan EN la escaleta y no en el
    # retorno: `construir` devuelve `(escaleta, informe)` y ese par lo
    # desempaquetan main, todas las pruebas y el agente guionista — cambiar
    # la forma del retorno los rompería a todos por un dato que pertenece al
    # plan construido. Atributo dinámico a propósito: `escaleta.py` no conoce
    # ni guiones ni broll_plan, y enseñárselos sería mudar una
    # responsabilidad de este script a un módulo que no la usa.
    e.media = []

    # El tema es UNO por pieza y lo pide el guion (§7). Antes estaba
    # cableado «carbon» en las tres configs que este script escribe
    # —tarjetas, micro-FX y fondo— y un guion en paper no tenía forma de
    # decirlo. El LUT no viaja con él: lo decide `--lut` del compositor.
    tema = (guion.get("metadata") or {}).get("tema") or "carbon"
    if tema not in ("carbon", "paper"):
        raise SystemExit(
            "metadata.tema «%s» no existe: los temas son «carbon» y «paper» "
            "(BRAND_RULES §7). Corrige el guion." % tema)

    # --- alineación global guion↔grabación --------------------------------
    tokens_guion, origen = [], []      # origen[k] = (acto, posición en acto)
    for a in guion["timeline"]:
        for k, t in enumerate(tokens(a["voice_speech"])):
            tokens_guion.append(t)
            origen.append((a["act"], k))
    al = Alineacion(tokens_guion, palabras)

    def indice_de(palabra: str, acto: int) -> tuple[int | None, str]:
        """Índice real de `palabra` buscándola dentro de su acto del guion."""
        obj = limpia(palabra)
        for k, t in enumerate(tokens_guion):
            if t == obj and origen[k][0] == acto:
                return al.resolver(k)
        return None, "no está en el texto del acto %d" % acto

    # --- actos -------------------------------------------------------------
    # Los límites salen de la PRIMERA y la ÚLTIMA palabra realmente alineadas
    # de cada acto. Así un acto cuyo final se reescribió al grabar sigue
    # cerrando donde la grabación lo cierra, no donde el guion creía.
    limites, previo, previo_j = {}, 0.0, None
    for a in guion["timeline"]:
        idxs = [j for k, (act, _) in enumerate(origen) if act == a["act"]
                for j, _ in [al.resolver(k)] if j is not None]
        # `difflib` empareja SIEMPRE: sobre dos textos que no tienen nada que
        # ver devuelve `replace` de uno entero contra el otro, y la regla del
        # «equivalente por posición» resuelve cada palabra a algo. O sea que
        # sin esta puerta, el guion de OTRA pieza produce un plan con buena
        # pinta y todos los anclajes en sitios arbitrarios. Lo que decide no
        # es que haya emparejamiento sino cuánto de él es LITERAL.
        n_tok = sum(1 for act, _ in origen if act == a["act"])
        exactas = sum(1 for k, (act, _) in enumerate(origen) if act == a["act"]
                      and al.resolver(k)[1] == "exacta")
        if not idxs or (n_tok and exactas / n_tok < 0.25):
            raise SystemExit(
                "el acto %d («%s») no casa con NINGUNA palabra de la "
                "grabación: solo %d de %d son literales (%.0f %%, hace falta "
                "25 %%).\n  Guion: %.60s…\n  Grabación: %.60s…\n"
                "  ¿Es el guion de esta toma?"
                % (a["act"], a["act_name"], exactas, n_tok,
                   100 * exactas / max(1, n_tok), a["voice_speech"],
                   " ".join(w["w"] for w in palabras[:12])))
        j0, j1 = min(idxs), max(idxs)
        ini, fin = float(palabras[j0]["start"]), float(palabras[j1]["end"])
        e.actos.append((a["act_name"].lower(), ini, fin))
        limites[a["act"]] = (ini, fin, j0, j1)
        d = a.get("start_sec")
        if d is not None and abs(d - ini) > 1.5:
            inf.append("acto %d: el guion lo sitúa en %ss y la grabación en "
                       "%.1fs (%+.1fs). Manda la grabación."
                       % (a["act"], d, ini, ini - d))
        # Lo que se dijo entre dos actos y ningún acto reclama: material
        # improvisado en la toma. No es un fallo —el plan lo cubre igual,
        # porque los subtítulos van sobre la pieza entera— pero sí es texto
        # sobre el que el guion no decidió nada, y hay que verlo.
        if ini - previo > 0.6 and previo_j is not None:
            suelto = " ".join(w["w"] for w in palabras[previo_j + 1:j0])
            if suelto.strip():
                inf.append("sin guion: «%s» (%.1f→%.1f s) se dijo y el guion no "
                           "lo contempla. Sin gráfico asignado."
                           % (suelto.strip(), previo, ini))
        previo, previo_j = fin, j1

    # Lo colocado, con su sonido, para reconciliar después los cues del guion.
    # `capa` guarda la REFERENCIA al dict que escribe la escaleta: sustituir
    # el sfx aquí es sustituirlo en el plan. `omitidos` recuerda qué micro-FX
    # de cada acto no llegaron a colocarse: su cue va a necesitar esa línea.
    colocadas: list[dict] = []
    omitidos: dict[int, list[str]] = {}

    # --- tarjetas ----------------------------------------------------------
    # El nombre de capa sale de la PLANTILLA, así que dos actos que piden la
    # misma se llaman igual — y el renderizador escribe los fotogramas de las
    # dos en `build/frames/<capa>/`: la segunda pisa a la primera y solo
    # sobrevive una. `validar_plan.py` lo caza, pero como ERROR, y eso deja al
    # guionista sin poder repetir una plantilla en una pieza.
    #
    # Repetirla es normal y no siempre es visible al escribir: en las diez
    # piezas de un guion con hooks, el cuerpo es común y el hook elige su
    # tarjeta sin saber qué usa el cuerpo. De diez, cinco chocaban.
    #
    # `vistos` es UNO para los dos carriles —tarjetas y micro-FX— porque el
    # directorio de fotogramas es uno: una tarjeta `strokecrossout` y un
    # micro-FX `stroke-crossout` colisionaban igual, y ese no lo cazaba nadie
    # hasta el render.
    vistos: set[str] = set()

    def _capa_unica(tpl: str) -> str:
        base = re.sub(r"[^a-z0-9]", "", tpl[:-5].lower())
        capa, n = base, 2
        while capa in vistos:
            capa, n = "%s%d" % (base, n), n + 1
        vistos.add(capa)
        return capa

    n_fondos = 0
    for a in guion["timeline"]:
        vt = a.get("visual_trigger") or {}
        nombre = vt.get("name")
        if not nombre:
            continue
        tpl = COMPONENTES.get(nombre)
        if tpl is None:
            raise SystemExit(
                "el acto %d pide «%s» y no hay traducción.\n"
                "  Añádela a COMPONENTES en scripts/leer_guion.py, o usa una "
                "de:\n  %s" % (a["act"], nombre, ", ".join(
                    sorted(x[:-5] for x in os.listdir(PLANTILLAS)
                           if x.endswith(".html") and not x.startswith("_")))))
        if nombre != tpl:
            inf.append("acto %d: «%s» → %s" % (a["act"], nombre, tpl))
        ini, fin, _, _ = limites[a["act"]]
        # Entra 0,55 s después de que arranque el acto —el espectador necesita
        # oír de qué va antes de que se le escriba encima— y dura lo que §13
        # pide para una tarjeta, recortado si el acto es más corto.
        dur = min(3.0, max(2.5, (fin - ini) * 0.28))
        t = round(ini + 0.55, 2)
        # `MODE_FULL_MOTION` no es una tarjeta sobre el metraje: es el gráfico
        # HACIENDO de pantalla. Su duración es la del acto, y el techo de 3 s
        # que §13 pone a las tarjetas no le aplica —no es algo que se lee
        # encima de una cara, es lo único que hay—.
        pleno = a.get("screen_mode") == "MODE_FULL_MOTION"
        if pleno:
            dur = round(fin - ini - 0.55, 2)
        # §12 pide el cierre en el último 15 % de la pieza. Un acto 4 que
        # empieza antes lo incumpliría entrando al principio del acto, así que
        # la tarjeta de cierre se ancla al FINAL y no al principio.
        if tpl == "cierre-cta.html":
            t = max(t, round(e.fin_pieza * 0.855 + 0.05, 2))
            dur = min(dur, max(1.6, e.fin_pieza - t - 0.15))
        _exige_copy_propio(tpl, tpl[:-5], a["act"])
        capa = _capa_unica(tpl)
        # «A-Roll oculto» de verdad: `fondo.html` es la única plantilla OPACA
        # y va primera en el ORDEN del compositor (guiones/capas.json),
        # así que emitirla cubriendo el acto es lo que tapa el metraje. Sin
        # ella, el gráfico de pantalla se compuso SOBRE la cara: 12,7 s con
        # los ojos del presentador tapados. La config replica la que escribe
        # `dirigir.py:1598` —blobs 0.85, grano 0.55, fps 5—, que es la medida
        # en la cabecera de fondo.html; va al carril de CROMO y no a
        # `tarjetas` porque `dirigir.CROMO` ya clasifica `fondo` ahí y porque
        # §13 mediría contra ella un aire que no le aplica.
        if pleno:
            n_fondos += 1
            nombre_fondo = "fondo" if n_fondos == 1 else "fondo%d" % n_fondos
            e.cromo.append(dict(
                capa=nombre_fondo, template="fondo.html",
                t=round(ini, 3), duracion=round(fin - ini, 3),
                colocar=False, fps=5,
                config={"duration": round(fin - ini, 3), "tema": tema,
                        "blobs": 0.85, "grano": 0.55}))
            inf.append("acto %d: MODE_FULL_MOTION: se emite `%s` (%.1f→%.1f s)"
                       " DEBAJO de %s — A-Roll oculto, el gráfico hace de "
                       "pantalla. colocar=False en fondo y gráfico: sobre "
                       "fondo opaco no hay rostro del que apartarse."
                       % (a["act"], nombre_fondo, ini, fin, capa))
        cfg = dict(duration=dur, tema=tema)
        ranura, copy = COPY.get(tpl, "titulo"), vt.get("card_copy", "")
        if isinstance(ranura, (list, tuple)) and copy:
            # Plantilla de VARIAS ranuras (antes-despues): el copy trae una
            # parte por ranura —lista, o cadena partida por « → »/«->»/«|»—.
            # Si falta alguna, la ranura vacía se queda con el texto de
            # muestra de la plantilla: es el fallo mudo del headline-clipper
            # otra vez, así que se rellena lo que hay y se DICE.
            partes = _partes_copy(copy)
            if len(partes) == len(ranura):
                cfg.update(zip(ranura, partes))
            else:
                cfg[ranura[0]] = partes[0]
                inf.append("acto %d: %s tiene %d ranuras de texto (%s) y "
                           "card_copy trae %d parte(s): la que falta se "
                           "queda con el texto de muestra de la plantilla. "
                           "Sepáralas con « → » o pasa una lista."
                           % (a["act"], tpl, len(ranura), "/".join(ranura),
                              len(partes)))
        elif ranura and copy:
            cfg[ranura] = copy
        elif copy:
            inf.append("acto %d: %s no tiene ranura de texto; «%s» no cabe en "
                       "ella. Su contenido va en `visual_trigger.config`."
                       % (a["act"], tpl, copy))
        # La misma puerta que los micro-FX, ahora que la tabla de arriba dice
        # cuál es el titular de 35 plantillas en vez de 9: una tarjeta que
        # declara ranura de texto y no la recibe rasteriza la de MUESTRA. Se
        # comprueba DESPUÉS de aplicar `card_copy` y la config del guion,
        # porque cualquiera de las dos vías la llena.
        _cfg_final = dict(cfg, **(vt.get("config") or {}))
        _falta = (_copy_sin_dar(tpl, _cfg_final)
                  + _titular_sin_dar(tpl, _cfg_final))
        if _falta:
            raise SystemExit(
                "el acto %d pone «%s» y no le da texto: %s.\n"
                "  Sin eso rasteriza el de muestra de la plantilla y nada lo "
                "avisa: el PNG sale bien y el vídeo se compone. Es lo que "
                "puso «SESGO» sobre la cara con el texto de otra pieza.\n"
                "  Escríbelo en `card_copy`%s."
                % (a["act"], tpl,
                   ", ".join("`%s` enseñaría «%s»" % (k, v) for k, v in _falta),
                   "" if COPY.get(tpl) else " no cabe aquí: va en "
                   "`visual_trigger.config`"))

        # Passthrough: lo que la plantilla necesita y el guion no modela —el
        # código de un mockup, el botón de un CTA— se pasa tal cual. Es la
        # válvula que evita que el guion tenga que conocer 56 plantillas.
        # Copia y no referencia: de aquí se saca `imagen`, y hacer `pop`
        # sobre el dict del guion mutaría lo que el llamador nos prestó.
        extra = dict(vt.get("config") or {})
        # La cortinilla de `antes-despues` es la segunda pasada de render:
        # la plantilla emite su silueta y ffmpeg revela otra cosa por
        # debajo. Y `imagen` va en la CAPA, no en config (§17): la
        # plantilla no lee `cfg.imagen` —la revela el compositor— y dejada
        # en config es exactamente la clave muerta que
        # `lint_config --estricto` tumba.
        portada = {}
        if tpl == "antes-despues.html":
            portada["cortinilla"] = True
            # `hasta` es OBLIGATORIO para validar_plan (sin él la cortinilla
            # no sabe dónde parar el canto) y el guionista no tiene por qué
            # saberlo: un guion conforme al CONTRATO que lo omitiera pasaba
            # leer_guion con exit 0 y moría en el paso 4. Se inyecta el
            # default de la plantilla (antes-despues.html: hasta 0.62) y el
            # guion puede sobrescribirlo por config.
            extra.setdefault("hasta", 0.62)
            img = extra.pop("imagen", None) or vt.get("imagen")
            if img:
                portada["imagen"] = img
                inf.append("acto %d: antes-despues entra con cortinilla y "
                           "revela «%s» — la imagen viaja en la CAPA, no en "
                           "config (§17)." % (a["act"], img))
            else:
                inf.append("acto %d: antes-despues sin `imagen`: la "
                           "cortinilla revela el metraje SIN LUT, y con el "
                           "grado de marca eso cambia la imagen un ~2 %% — "
                           "no se ve. Hace falta un LUT fuerte (--lut y "
                           "--aroll completo en composite_ffmpeg.py), o "
                           "mejor una imagen (§17)." % a["act"])
        cfg.update(extra)
        if extra:
            inf.append("acto %d: %s recibe del guion %s"
                       % (a["act"], capa, ", ".join(sorted(extra))))
        # La permanencia la dicta el CONTENIDO, no el guion: a este mockup el
        # guion le daba 3,0 s y su código pide 4,64 solo de tecleo. Se toma el
        # máximo entre lo pedido y lo derivado, recortado al fin del acto — y
        # si el acto no da, se dice QUÉ se recorta, porque la alternativa fue
        # «fail-on: high» sin aparecer y nadie avisó.
        minimo = _tecleo(cfg)
        if minimo:
            fin_tecleo, cola, fines = minimo
            pedida = round(fin_tecleo + cola, 2)
            tope = round(fin - t, 2)
            if pedida > dur + 0.05:
                if pedida <= tope:
                    inf.append("acto %d: %s duraba %.1f s en el guion y su "
                               "contenido pide %.2f s (tecleo hasta %.2f + "
                               "%.2f de lectura): se alarga."
                               % (a["act"], capa, dur, pedida, fin_tecleo,
                                  cola))
                    dur = pedida
                else:
                    dur = max(dur, tope)
                    if dur < fin_tecleo:
                        perd = [txt for f, txt in fines if f > dur]
                        inf.append("acto %d: %s pide %.2f s y el acto solo "
                                   "deja %.2f: %d línea(s) no llegan a "
                                   "teclearse — desde «%s»."
                                   % (a["act"], capa, pedida, dur, len(perd),
                                      perd[0]))
                    else:
                        inf.append("acto %d: %s pide %.2f s (tecleo %.2f + "
                                   "lectura %.2f) y el acto solo deja %.2f: "
                                   "la cola de lectura queda en %.2f s."
                                   % (a["act"], capa, pedida, fin_tecleo,
                                      cola, dur, dur - fin_tecleo))
        # El eje del guion, POR FIN emitido: `dx`/`dy` van en la capa y
        # colocar.py los afina midiendo el alfa contra el rostro. El informe
        # dice qué se emitió — «no se emite» murió con la tabla POSICIONES.
        # Los pasos ANCLADOS A LA PALABRA. `pasos-flow` acepta un `at` por
        # paso —el escalonado uniforme obliga a que la locución hable a
        # intervalos iguales, y eso no pasa nunca— pero escribir esos
        # segundos en el guion sería el error que este repo ya cometió: al
        # volver a transcribir se quedan donde estaban. Se declaran por
        # PALABRA y aquí se resuelven contra la grabación.
        #
        # Medido en la pieza de sesgos: las cuatro etapas se nombran en
        # 20,96 · 22,16 · 24,76 · 26,72 s, o sea con huecos de 1,2, 2,6 y
        # 2,0. Con el escalonado uniforme de 1,6 el segundo paso se
        # encendía 0,7 s tarde y el cuarto 1,6 s antes: el gráfico iba por
        # su cuenta mientras la voz nombraba otra cosa.
        for _paso in (cfg.get("pasos") or []):
            _anc = isinstance(_paso, dict) and _paso.pop("ancla", None)
            if not _anc:
                continue
            # Hasta el PRIMER palabra del acto siguiente, no hasta j1: la
            # última palabra del acto —«desplegarlo.», que es justo la que
            # nombra el cuarto paso— cae fuera del rango alineado cuando la
            # frontera la marca el guion y no la grabación. Mismo criterio
            # que `palabra_en_acto`, y por el mismo motivo.
            _j0 = limites[a["act"]][2]
            _sig = sorted(x for x in limites if x > a["act"])
            _j1 = limites[_sig[0]][2] if _sig else len(palabras)
            _obj = limpia(_anc)
            _j = next((k for k in range(_j0, _j1)
                       if limpia(palabras[k]["w"]) == _obj), None)
            if _j is None:
                inf.append("acto %d: el paso «%s» se ancla a «%s» y esa "
                           "palabra no está en el acto; se reparte con el "
                           "escalonado."
                           % (a["act"], _paso.get("titulo", "?"), _anc))
                continue
            _paso["at"] = round(float(palabras[_j]["start"]) - t, 2)
            inf.append("acto %d: paso «%s» anclado a «%s» → at %.2f s"
                       % (a["act"], _paso.get("titulo", "?"), _anc,
                          _paso["at"]))

        pos = vt.get("position")
        despl = dict(POSICIONES.get(pos) or {}) if pos else {}
        if pos and pos not in POSICIONES:
            inf.append("acto %d: %s pedía %s, que no está en POSICIONES; sin "
                       "desplazamiento — colocar.py ajustará dy contra el "
                       "rostro. Añádela a POSICIONES en scripts/leer_guion.py."
                       % (a["act"], capa, pos))
        elif pos:
            inf.append("acto %d: %s pedía %s. No se emite desplazamiento: la "
                       "plantilla maqueta para el lienzo entero y colocar.py "
                       "la afina midiendo el alfa contra el rostro. Empujarla "
                       "a un lado la sacaba del cuadro, y encogerla para que "
                       "cupiera la clavó en los ojos — las dos versiones se "
                       "probaron sobre la pieza y salieron peor."
                       % (a["act"], capa, pos))
        # El sonido de entrada, DEDUCIDO por la misma tabla que usa dirigir.py
        # para sus tarjetas (`capa.sfx` → cue al entrar la capa,
        # `render_playwright.js:432`). Faltaba: `build/plan.json` no llevaba
        # `sfx` en NINGUNA capa y las cuatro tarjetas de la pieza de Codex
        # dependían de que su plantilla publicara cues propios. Las que los
        # publican (code-mockup teclea sola) siguen sin golpe encima.
        propios = dirigir.sonidos_propios(tpl)
        golpe = {}
        if propios is None:
            son, gan = dirigir.SFX_POR_PLANTILLA.get(
                tpl[:-5], dirigir.SFX_POR_TIPO["entrada"])
            golpe = dict(sfx=son, sfxGain=gan)
        # En pleno movimiento la tarjeta lleva `colocar=False`: va sobre el
        # fondo opaco, no hay rostro que medir y moverla sería descolocar la
        # composición que el guion pidió.
        marca = {"colocar": False} if pleno else {}
        c = e.tarjeta(capa, tpl, dur=dur, t=t, config=cfg,
                      **golpe, **marca, **despl, **portada)
        colocadas.append(dict(acto=a["act"], nombre=tpl[:-5], capa=c,
                              propios=propios, tokens=_afines(tpl[:-5]),
                              usado=False))

    # --- micro-FX ----------------------------------------------------------
    # §15 pide 7 s entre micro-FX. Dos disparados en la MISMA palabra —el
    # guion pide `target-hud` y `padlock-unlock` los dos en «vulnerabilidades»—
    # no son dos efectos: son uno tapando al otro. Si el acto da tiempo, se
    # escalonan 1,5 s en el orden en que el guion los lista; si NO lo da, se
    # separan en el ESPACIO (dx −260/+260). Lo segundo existe por el fotograma
    # 17,4 s de la pieza de Codex: el escalonado se recortó contra el fin del
    # acto, quedaron 0,8 s de solape y el candado cayó SOBRE el nodo del
    # pipeline, ilegibles los dos. Y todo se dice, porque la alternativa
    # —descartar el segundo— borraría una decisión del guionista sin avisar.
    # `vistos` viene de las tarjetas y NO se reinicia: el directorio de
    # fotogramas es compartido, así que un micro-FX con el nombre de una
    # tarjeta la pisaría igual.
    ocupado = {}
    pide_media: list[dict] = []   # (acto, fid, slug, t): se resuelve después
    for a in guion["timeline"]:
        for fx in a.get("micro_fx") or []:
            fid = fx.get("fx_id")
            if fid not in MICRO_FX:
                raise SystemExit(
                    "el acto %d pide el micro-FX «%s» y no hay traducción.\n"
                    "  Añádela a MICRO_FX en scripts/leer_guion.py."
                    % (a["act"], fid))
            tpl = MICRO_FX[fid]
            j, como = indice_de(fx.get("trigger_word", ""), a["act"])
            if j is None:
                inf.append("acto %d: «%s» se dispara en «%s», que %s. Se omite."
                           % (a["act"], fid, fx.get("trigger_word"), como))
                omitidos.setdefault(a["act"], []).append(fid)
                continue
            real = palabras[j]["w"]
            if como != "exacta":
                inf.append("acto %d: «%s» disparaba en «%s» → «%s» (%s)"
                           % (a["act"], fid, fx.get("trigger_word"), real, como))
            capa = _capa_unica(tpl)
            # La config ANTES que el reloj: la duración ya no es fija —el
            # contenido tecleable la alarga (`_tecleo`)— y el escalonado
            # necesita conocerla para saber si cabe dentro del acto.
            cfg_fx = dict(duration=1.3, tema=tema)
            cfg_fx.update(fx.get("config") or {})
            if fx.get("config"):
                inf.append("acto %d: %s recibe del guion %s"
                           % (a["act"], capa, ", ".join(sorted(fx["config"]))))
            _exige_copy_propio(tpl, fid, a["act"])
            falta = _copy_sin_dar(tpl, cfg_fx)
            if falta:
                raise SystemExit(
                    "el acto %d pide «%s» y no le da copy: %s.\n"
                    "  Sin eso rasteriza el texto de MUESTRA de la plantilla, "
                    "y nada lo avisa después: el PNG sale bien, el alfa es "
                    "correcto y el vídeo se compone.\n"
                    "  Medido en las diez piezas de sesgos: se compuso «NO» "
                    "tachado mientras se oía «es completamente falso», "
                    "«ELIMINAR» sobre la cara, «OBSOLETO» sobre el flujo y "
                    "«point at things» —la demo del bloque importado— junto "
                    "a la mano.\n"
                    "  Escríbelo en `micro_fx[].config`:  %s"
                    % (a["act"], fid,
                       ", ".join("`%s` enseñaría «%s»" % (k, v)
                                 for k, v in falta),
                       json.dumps({k: "…" for k, _ in falta},
                                  ensure_ascii=False)))
            # 1,3 s es la medida de NUESTROS micro-FX, que están animados
            # para eso. Un bloque importado trae su gesto medido al importar
            # (`var DUR` en la plantilla) y va de 2 a 5 s: recortarlo a 1,3
            # lo corta por la mitad, que es exactamente lo que se vio en la
            # pieza de respiración — «no da tiempo ni a verlos».
            # …pero con TECHO. Un micro-FX es un acento, no una capa: §13 da
            # 2,5-3,5 s a una TARJETA, así que un acento que dure 4,98 s
            # —lo que mide el gesto de `hw-callout-circle`— compite con
            # ella y se come el acto. La horquilla es 1,3-3,0: por debajo
            # el gesto importado se corta por la mitad, por encima deja de
            # ser un acento.
            dur_fx = min(TOPE_MICROFX, max(1.3, _gesto(tpl)))
            minimo = _tecleo(cfg_fx)
            if minimo:
                dur_fx = max(dur_fx, round(minimo[0] + minimo[1], 2))
            ini_w = float(palabras[j]["start"])
            fin_acto = limites[a["act"]][1]
            desfase, dx_choque = 0.1, None
            if j in ocupado:
                previo_fx, previo_d, previo_capa = ocupado[j]
                if ini_w + previo_d + 1.5 + dur_fx > fin_acto:
                    # El tiempo no da: recortar el escalonado contra el fin
                    # del acto dejó 0,8 s de solape y el candado sobre el
                    # nodo. Comparten el instante y los separa el eje X.
                    desfase = previo_d
                    dx_choque = 260
                    previo_capa["dx"] = -260
                    inf.append("acto %d: «%s» y «%s» comparten palabra "
                               "(«%s») y el escalonado de 1,5 s no cabe "
                               "antes del fin del acto: se separan en el "
                               "espacio (dx −260/+260)."
                               % (a["act"], previo_fx, fid, real))
                else:
                    desfase = previo_d + 1.5
                    inf.append("acto %d: «%s» y «%s» disparan los dos en "
                               "«%s». Se escalona el segundo %.1f s; a la "
                               "vez se taparían."
                               % (a["act"], previo_fx, fid, real, desfase))
            t_fx = ini_w + desfase
            if minimo:
                fin_tecleo, cola, fines = minimo
                tope = round(fin_acto - t_fx, 2)
                if dur_fx > tope:
                    dur_fx = max(1.3, tope)
                    if dur_fx < fin_tecleo:
                        perd = [txt for f, txt in fines if f > dur_fx]
                        inf.append("acto %d: «%s» pide %.2f s y el acto solo "
                                   "deja %.2f: %d línea(s) no llegan a "
                                   "aparecer — desde «%s»."
                                   % (a["act"], fid, fin_tecleo + cola,
                                      dur_fx, len(perd), perd[0]))
                    else:
                        inf.append("acto %d: «%s» pide %.2f s (tecleo %.2f + "
                                   "lectura %.2f) y el acto solo deja %.2f: "
                                   "la cola de lectura queda en %.2f s."
                                   % (a["act"], fid, fin_tecleo + cola,
                                      fin_tecleo, cola, dur_fx,
                                      dur_fx - fin_tecleo))
                elif dur_fx > 1.3:
                    inf.append("acto %d: «%s» duraba 1,3 s y su contenido "
                               "pide %.2f s (tecleo hasta %.2f + %.2f de "
                               "lectura): se alarga."
                               % (a["act"], fid, dur_fx, fin_tecleo, cola))
            elif t_fx + dur_fx > fin_acto and dx_choque is None:
                desfase = max(0.1, fin_acto - dur_fx - ini_w)
                inf.append("acto %d: «%s» no cabe escalonado dentro del acto; "
                           "se pega al final (%+.1f s)." % (a["act"], fid, desfase))
            # En `MODE_FULL_MOTION` el micro-FX cae DENTRO del gráfico de
            # pantalla a propósito: es el guion diciendo «que suceda encima».
            # `colocar=False` es cómo se declara eso, y además impide que
            # colocar.py lo aparte de un rostro que el fondo opaco ya tapa.
            pleno = a.get("screen_mode") == "MODE_FULL_MOTION"
            if pleno:
                inf.append("acto %d: «%s» va DENTRO del gráfico de pantalla "
                           "(colocar=False): en pleno movimiento no hay rostro "
                           "del que apartarlo." % (a["act"], fid))
            # El eje del guion también para los micro-FX; si hay choque, el
            # eje X lo decide el choque y no la tabla, y queda dicho arriba.
            pos = fx.get("position")
            despl = dict(POSICIONES.get(pos) or {}) if pos else {}
            if pos and pos not in POSICIONES:
                inf.append("acto %d: «%s» pedía %s, que no está en POSICIONES;"
                           " sin desplazamiento — colocar.py ajustará dy "
                           "contra el rostro. Añádela a POSICIONES en "
                           "scripts/leer_guion.py." % (a["act"], fid, pos))
            else:
                if dx_choque is not None:
                    despl.pop("dx", None)
                if despl:
                    inf.append("acto %d: «%s» pedía %s → se emite %s en la "
                               "capa; colocar.py afinará dy midiendo el alfa "
                               "contra el rostro (dx viaja tal cual al "
                               "manifiesto)."
                               % (a["act"], fid, pos, _despl_txt(despl)))
            if dx_choque is not None:
                despl["dx"] = dx_choque
            # Mismo trato que las tarjetas: el sonido lo deduce la tabla del
            # director (`dirigir.SFX_MICRO`), salvo que la plantilla publique
            # los suyos — `terminal` (cli-typewriter) teclea sola y un golpe
            # de entrada encima sonaría dos veces.
            propios = dirigir.sonidos_propios(tpl)
            golpe = {}
            if propios is None:
                son, gan = dirigir.SFX_MICRO.get(
                    tpl[:-5], SFX_MICRO_NUEVOS.get(tpl[:-5],
                                                   ("aparicion", 0.7)))
                golpe = dict(sfx=son, sfxGain=gan)
            c = e.microfx_en(capa, tpl, dur=dur_fx, ancla=real,
                             desde=max(0.0, ini_w - 0.05),
                             desfase=desfase, colocar=not pleno, config=cfg_fx,
                             **golpe, **despl)
            ocupado[j] = (fid, desfase, c)
            colocadas.append(dict(acto=a["act"], nombre=fid, capa=c,
                                  propios=propios,
                                  tokens=_afines(fid, tpl[:-5]), usado=False))
            if fx.get("media_fetch"):
                # No se resuelve aquí: la media_local del acto puede estar
                # declarando YA el mismo fichero, y eso solo se sabe con
                # todas las declaraciones colocadas. Se anota quién lo pidió
                # y dónde (el t del micro: la escena va JUNTO a su efecto).
                pide_media.append(dict(acto=a["act"], fid=fid,
                                       slug=fx["media_fetch"],
                                       t=round(t_fx, 3)))

    # --- media: declarado por el acto y pedido por los micro, EN LOCAL ------
    # Dos vías y las dos acaban en build/broll_plan.json en reloj de ORIGEN
    # —`silencios.py --aplicar` lo pasa a salida (silencios.py:516-530) y el
    # compositor exige «salida»—. `media_local` declara {file, ancla,
    # desfase?, dur} y se ancla a la PALABRA, como todo lo demás: volver a
    # transcribir mueve la escena con la grabación, no la deja clavada en un
    # segundo escrito a mano.
    def palabra_en_acto(palabra: str, acto: int) -> int | None:
        """Índice REAL de `palabra`: se busca en la GRABACIÓN, dentro de la
        ventana del acto — de su primera palabra alineada a la primera del
        acto siguiente. Hasta el siguiente a propósito: el material
        improvisado entre dos actos («o muchísimo trabajo» en la pieza de
        Codex, 3,8→5,2 s que ningún acto reclama y quedaba a cara sola) es
        EXACTAMENTE el hueco que media_local viene a cubrir, y `indice_de`
        no puede verlo porque esa palabra no está en el texto de ningún
        acto del guion."""
        j0 = limites[acto][2]
        despues = sorted(x for x in limites if x > acto)
        j1 = limites[despues[0]][2] if despues else len(palabras)
        obj = limpia(palabra)
        for j in range(j0, j1):
            if limpia(palabras[j]["w"]) == obj:
                return j
        return None

    local_por_acto: dict[int, set] = {}
    for a in guion["timeline"]:
        for m in a.get("media_local") or []:
            ruta = m.get("file") or ""
            absoluta = os.path.join(RAIZ, ruta)
            if not os.path.exists(absoluta):
                raise SystemExit(
                    "el acto %d declara media_local «%s» y ese fichero NO "
                    "está en disco.\n"
                    "  Los media no se versionan (un clip de stock de ~10 MB "
                    "doblaría el repo):\n"
                    "  cada clon los baja según guiones/MEDIA.md — fuente, id "
                    "y licencia por\n"
                    "  fichero. Baja el clip, déjalo EXACTAMENTE en esa ruta "
                    "y relanza:\n"
                    "    .venv/bin/python scripts/leer_guion.py <guion> "
                    "--escribir" % (a["act"], ruta))
            j = palabra_en_acto(m.get("ancla") or "", a["act"])
            if j is None:
                inf.append("acto %d: media_local «%s» ancla en «%s», que no "
                           "se dijo entre este acto y el siguiente. Se omite."
                           % (a["act"], os.path.basename(ruta),
                              m.get("ancla")))
                continue
            t = round(float(palabras[j]["start"])
                      + float(m.get("desfase") or 0.0), 3)
            dur = round(float(m.get("dur") or MEDIA_FETCH_DUR), 3)
            # La ruta sale ABSOLUTA: composite_ffmpeg mira `os.path.exists`
            # sobre cada `files[]` y DESCARTA en silencio la que no
            # encuentre, así que una ruta relativa haría depender la escena
            # del cwd de quien compone. generate_google_assets ya escribe
            # absolutas por lo mismo.
            e.media.append({"id": "media_%02d" % (len(e.media) + 1),
                            "t": t, "dur": dur, "tipo": "media",
                            "files": [absoluta]})
            local_por_acto.setdefault(a["act"], set()).add(
                os.path.basename(ruta))
            inf.append("acto %d: media_local %s sobre «%s» (%.1f→%.1f s de "
                       "origen)." % (a["act"], os.path.basename(ruta),
                                     palabras[j]["w"], t, t + dur))

    for pet in pide_media:
        f = casa_slug(pet["slug"])
        if f is None:
            inf.append("acto %d: «%s» pedía material externo (%s) y ningún "
                       "fichero de assets/broll/ lo casa por tokens. Este "
                       "repo no descarga nada: el FX va sin él — baja el "
                       "fichero a assets/broll y decláralo en "
                       "guiones/MEDIA.md."
                       % (pet["acto"], pet["fid"], pet["slug"]))
        elif f in local_por_acto.get(pet["acto"], set()):
            # La misma cascada que los cues de sonido: lo que el acto ya
            # coloca a mano CONFIRMA la petición, no se apila encima — dos
            # escudos solapados serían además escenas solapadas, que el
            # contrato del broll_plan (contratos.broll) rechaza.
            inf.append("media_fetch resuelto en local: «%s» → %s, que la "
                       "media_local del acto %d ya coloca; no se duplica."
                       % (pet["slug"], f, pet["acto"]))
        else:
            e.media.append({"id": "media_%02d" % (len(e.media) + 1),
                            "t": pet["t"], "dur": MEDIA_FETCH_DUR,
                            "tipo": "media",
                            "files": [os.path.join(BROLL, f)]})
            inf.append("media_fetch resuelto en local: «%s» → assets/broll/"
                       "%s junto a «%s» (t=%.1f s, %.1f s). Nada se "
                       "descarga: el fichero ya estaba en disco "
                       "(guiones/MEDIA.md)."
                       % (pet["slug"], f, pet["fid"], pet["t"],
                          MEDIA_FETCH_DUR))

    # --- subtítulos: las palabras en azul ----------------------------------
    claves, perdidas = set(), []
    for a in guion["timeline"]:
        for p in a.get("blue_highlight_words") or []:
            j, como = indice_de(p, a["act"])
            if j is None:
                perdidas.append((a["act"], p, como))
                continue
            real = palabras[j]["w"]
            claves.add(real)
            if como != "exacta":
                inf.append("azul: «%s» no se dijo → «%s» (%s)"
                           % (p, real, como))
    for act, p, como in perdidas:
        inf.append("azul: «%s» (acto %d) %s y NO se resalta. Una palabra que "
                   "no está en el audio no se puede resaltar."
                   % (p, act, como))
    e.subtitulos(claves=claves)

    # --- cámara ------------------------------------------------------------
    # UN tramo por acto, SIEMPRE, aunque el encuadre no pida zoom. `plano` no
    # es «ponle zoom a este trozo»: los tramos de cámara son los que
    # `keep_con_camara` INTERSECA con el keep, así que un acto sin tramo se cae
    # del montaje entero. Emitiendo solo los actos con FRAME_CLOSE_UP, la pieza
    # salió de 45,2 s a 12,9 s —solo los actos 1 y 4— y ninguna etapa dio
    # error: el plan era válido, el alfa correcto y el vídeo se compuso.
    #
    # El hueco entre un acto y el siguiente lo rellena `plano` solo, y eso es
    # lo que hay que querer casi siempre: entre dos actos hay una respiración,
    # y cortarla deja la voz pegada y se come el ataque de la primera palabra.
    #
    # Casi siempre. Un guion con HOOKS graba cinco entradas seguidas y el
    # cuerpo detrás; cada pieza usa UNA, así que entre su acto 1 y su acto 2
    # hay treinta y tres segundos de los otros cuatro hooks. Rellenar ese
    # hueco los mete en el montaje: la primera pieza salió de 78,7 s en vez de
    # los 45 que dura, con los cinco ganchos seguidos y ninguna etapa dando
    # error — el plan válido, el alfa correcto y el vídeo compuesto.
    #
    # Cuál de las dos cosas es NO se adivina: se declara. Con
    # `metadata.descartar_no_reclamado` el hueco con palabras que no reclama
    # ningún acto se corta rompiendo la cadena; sin él, se rellena como
    # siempre. Lo pone `piezas.py`, que es quien sabe que la grabación lleva
    # cinco entradas y la pieza usa una.
    #
    # Por defecto NO, y eso importa: medirlo en vez de declararlo parecía más
    # limpio hasta que se probó sobre la pieza de Codex, donde el hueco entre
    # dos actos son tres palabras —«o muchísimo trabajo.»— que el guion no
    # modela y que se dijeron a propósito. Un umbral de segundos o de palabras
    # que separase eso de un hook es un número inventado; la intención del que
    # escribe el guion, no.
    #
    # Se informa SIEMPRE, se corte o no: lo que se cae de un montaje tiene que
    # poder leerse en el informe.
    descarta = bool((guion.get("metadata") or {}).get("descartar_no_reclamado"))
    previo = None
    for a in guion["timeline"]:
        z = ENCUADRES.get(a.get("framing")) or 1.0
        ini, fin, j0, j1 = limites[a["act"]]
        corta = a is guion["timeline"][0]
        if previo is not None:
            huerfanas = [w["w"] for w in palabras[previo + 1:j0]]
            if huerfanas:
                corta = corta or descarta
                inf.append(
                    "acto %d: %d palabra(s) sin acto entre el anterior y este "
                    "(%.1f→%.1f s). %s «%.60s…»"
                    % (a["act"], len(huerfanas),
                       float(palabras[previo + 1]["start"]), ini,
                       "La cámara NO las cubre: se caen del montaje."
                       if descarta else
                       "La cámara las cubre igual y se quedan en el montaje; "
                       "para tirarlas, metadata.descartar_no_reclamado.",
                       " ".join(huerfanas)))
        e.plano(hasta=fin, zoom=z, desde=ini if corta else None)
        previo = j1
        if a.get("framing") == "FRAME_LEFT":
            inf.append("acto %d: FRAME_LEFT: el recorte de cámara sigue al "
                       "rostro y ese eje sigue sin ser expresable por tramo. "
                       "El de las CAPAS tampoco: POS_* se informa y no emite "
                       "desplazamiento; quien coloca es la plantilla y "
                       "colocar.py, que afina dy contra el rostro."
                       % a["act"])

    # --- sonido: los cues del guion se RECONCILIAN, no se tiran -------------
    # El mecanismo de colocación existía entero —`capa.sfx` → cue al entrar la
    # capa (`render_playwright.js:432`) → `mezcla.recolectar`— y este script
    # validaba los 8 cues del guion contra la tabla… y los tiraba: el sello,
    # el HUD y el candado entraron EN MUDO en la pieza real (capas sin cue en
    # layers.json: stampbanned, targethud, padlockunlock, svgcheckmark). La
    # cascada va de lo más específico a lo menos, POR ACTO, y cada decisión
    # deja línea en el informe, igual que las palabras en azul.
    n_col = n_conf = n_front = n_sin = total = 0
    for a in guion["timeline"]:
        pendientes = []
        for s in a.get("sfx") or []:
            if s not in SFX:
                raise SystemExit(
                    "el acto %d pide el sonido «%s» y no hay traducción.\n"
                    "  Este repo SINTETIZA sus efectos; no hay banco. "
                    "Añádelo a SFX en scripts/leer_guion.py apuntando a uno "
                    "de: %s" % (a["act"], s, ", ".join(sorted(set(SFX.values())))))
            pendientes.append(s)
        total += len(pendientes)
        del_acto = [c for c in colocadas if c["acto"] == a["act"]]

        # a) Afinidad de nombre fichero↔capa: `stamp_heavy` comparte «stamp»
        #    con `stamp-banned`, así que ese cue habla DE esa capa y su
        #    traducción sustituye a la deducida. Pasada aparte y ANTES de la
        #    confirmación: `tech_pulse` (→ escaner) va delante de `hud_lock`
        #    en el acto 2, y confirmándose primero se quedaba con el
        #    `target-hud` que `hud_lock` reclama por nombre. La ganancia la
        #    sigue poniendo la tabla: el guion nombra el sonido, no mezcla.
        resto = []
        for s in pendientes:
            cand = next((c for c in del_acto if not c["usado"]
                         and _afines(s) & c["tokens"]), None)
            if cand is None:
                resto.append(s)
            elif cand["propios"] is not None:
                cand["usado"] = True
                n_conf += 1
                inf.append("sonido: %s casa con %s por nombre, y esa "
                           "plantilla ya publica sus propios cues (%s); no "
                           "se le pisa nada." % (s, cand["nombre"],
                                                 ", ".join(sorted(cand["propios"]))))
            else:
                cand["usado"] = True
                n_col += 1
                inf.append("sonido: %s sonaría «%s» por tabla; el guion pide "
                           "%s (%s) → %s"
                           % (cand["nombre"], cand["capa"].get("sfx"),
                              SFX[s], s, SFX[s]))
                cand["capa"]["sfx"] = SFX[s]

        # b) La traducción coincide con lo que una capa del acto ya suena —por
        #    tabla o por cues propios—: confirmado, se anota y no se toca.
        resto2 = []
        for s in resto:
            trad = SFX[s]
            cand = next((c for c in del_acto if not c["usado"]
                         and c["propios"] is None
                         and c["capa"].get("sfx") == trad), None) \
                or next((c for c in del_acto if not c["usado"]
                         and c["propios"] and trad in c["propios"]), None)
            if cand is None:
                resto2.append(s)
            elif cand["propios"] is not None:
                cand["usado"] = True
                n_conf += 1
                inf.append("sonido: %s → %s: %s ya lo publica en sus propios "
                           "cues; confirmado." % (s, trad, cand["nombre"]))
            else:
                cand["usado"] = True
                n_conf += 1
                inf.append("sonido: %s → %s: coincide con lo deducido para "
                           "%s; confirmado." % (s, trad, cand["nombre"]))

        # c) Clase riser: anuncia la frontera, no una capa.
        resto3 = []
        for s in resto2:
            if s in CUE_FRONTERA:
                n_front += 1
                inf.append("sonido: %s → %s: lo cubre la frontera de acto "
                           "(barrido/riser automático del compositor)."
                           % (s, SFX[s]))
            else:
                resto3.append(s)

        # d) Lo que queda no tiene capa. NADA desaparece sin línea.
        for s in resto3:
            n_sin += 1
            fuera = omitidos.get(a["act"])
            if fuera:
                inf.append("sonido: %s: su capa (%s) se omitió; el cue no "
                           "tiene dónde sonar." % (s, ", ".join(fuera)))
            else:
                inf.append("sonido: %s → %s: ninguna capa del acto %d lo "
                           "reclama; el cue no tiene dónde sonar."
                           % (s, SFX[s], a["act"]))

    inf.append("sonido: %d cue(s) del guion — %d colocado(s) en su capa, %d "
               "confirmado(s) por lo que ya suena, %d cubierto(s) por la "
               "frontera de acto, %d sin capa donde sonar."
               % (total, n_col, n_conf, n_front, n_sin))

    # --- la costura del bucle: se mide y se dice --------------------------
    # El guion declara `infinite_loop` y hasta aquí nadie comprobaba si el
    # montaje podía cumplirlo: la pieza de Codex cerraba con la costura en
    # 0,00 s de cabeza y ni eso se decía. Medir y decir, no tocar: recortar
    # la cola es trabajo de silencios.py sobre el AUDIO, no de este script.
    if guion.get("infinite_loop"):
        cola, cabeza = bucle(e.tl)
        inf.append("bucle: cola %.2f s · cabeza %.2f s — el guion declara "
                   "infinite_loop y esa suma es el silencio de la costura "
                   "(por encima de %.2f s el reinicio se lee como pausa)."
                   % (cola, cabeza, BUCLE_TOPE))

    col = (guion.get("metadata") or {}).get("brand_highlight_color")
    if col:
        inf.append("metadata: brand_highlight_color %s es un cian de "
                   "saturación 0,70 sobre valor 1,00 — neón, que §1 prohíbe. "
                   "El azul de marca (--accent) es el que se usa." % col)

    inf.append("metadata: tema «%s» en todas las capas (config.tema, §7); "
               "el grado de color NO viaja con él — el LUT lo decide --lut "
               "en composite_ffmpeg.py." % tema)

    return e, inf


def escribir_broll(escenas: list, destino: str = None) -> str:
    """Escribe el plan de B-Roll — SIEMPRE, con escenas o VACÍO.

    El sellado en vacío es el punto, no un adorno: `build/` se comparte
    entre piezas y `generate_google_assets.py` sin clave sale limpio
    (exit 4) SIN escribir broll_plan, así que el de la pieza ANTERIOR
    quedaba vivo y el compositor consumía sus escenas —con sus ficheros y
    sus tiempos— como si fueran de esta. Un guion sin media escribe
    `{"reloj": "origen", "escenas": []}` y el huérfano muere aquí.

    Reloj de ORIGEN, el mismo contrato que generate_google_assets:
    `silencios.py --aplicar` lo pasa a salida y lo vuelve a sellar
    (silencios.py:516-530), `composite_ffmpeg.py` exige «salida» y
    `contratos.broll` valida la forma (escenas[{id,t,dur,tipo,files}])."""
    destino = destino or os.path.join(comun.build_dir(), "broll_plan.json")
    plan = {"reloj": "origen",
            "escenas": sorted(escenas or [], key=lambda x: float(x["t"]))}
    json.dump(plan, open(destino, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    return destino


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("guion")
    ap.add_argument("--timeline", default=None)
    ap.add_argument("--escribir", action="store_true",
                    help="escribe build/plan.json (si no, solo audita)")
    ap.add_argument("--json", action="store_true",
                    help="por stdout sale SOLO el objeto {actos, informe, "
                         "desviaciones, errores, lint, escrito}; la prosa "
                         "entera se va a stderr")
    a = ap.parse_args()

    guion = json.load(open(a.guion, encoding="utf-8"))
    e, inf = construir(guion, a.timeline)
    errores, desviaciones = e.auditar()

    # La costura del bucle es una DESVIACIÓN cuando no da: igual que el aire
    # de §13, puede ser una decisión —una pieza que no va a rotar en bucle—
    # pero tiene que estar a la vista, no en la cabeza de quien montó.
    if guion.get("infinite_loop"):
        cola, cabeza = bucle(e.tl)
        if cola + cabeza > BUCLE_TOPE:
            desviaciones.append(
                "bucle: cola %.2f + cabeza %.2f = %.2f s de silencio en la "
                "costura (tope %.2f): el guion declara infinite_loop y el "
                "reinicio se va a leer como pausa, no como continuidad."
                % (cola, cabeza, cola + cabeza, BUCLE_TOPE))

    # Con --json el stdout es DEL OBJETO: el agente guionista hace
    # json.loads sobre él e itera su guion contra esas listas. Hasta ahora
    # iteraba a ciegas contra prosa — y una sola línea humana en medio del
    # objeto revienta el parseo, así que TODA la prosa cambia a stderr, el
    # canal donde ya iban los errores.
    hum = sys.stderr if a.json else sys.stdout

    print("\nGUION → PLAN   «%s»"
          % (guion.get("metadata", {}).get("title", a.guion)), file=hum)
    print("-" * 66, file=hum)
    for nombre, ini, fin in e.actos:
        print("  acto %-10s %6.2f → %6.2f s   (%.1f s)"
              % (nombre, ini, fin, fin - ini), file=hum)
    print("\nRECONCILIACIÓN GUION ↔ GRABACIÓN   (%d)" % len(inf), file=hum)
    for x in inf:
        print("  · " + x, file=hum)
    for x in desviaciones:
        print("  ~ " + x, file=hum)
    for x in errores:
        print("  ✗ " + x, file=sys.stderr)

    lint, escrito, rc = [], False, 0
    if errores:
        rc = 1
    elif a.escribir:
        e.escribir()
        escrito = True
        d = json.load(open(os.path.join(comun.build_dir(), "plan.json"),
                           encoding="utf-8"))
        print("\n  ✓ build/plan.json   %d capas"
              % len(d["capas"] if isinstance(d, dict) else d), file=hum)
        # El plan de B-Roll se escribe AQUÍ y siempre — vacío incluido: si
        # esta pieza no lleva media y el fichero no se pisa, el broll_plan
        # de la pieza anterior sobrevive en build/ y el compositor lo
        # consume (es el huérfano que dejaba generate_google_assets al
        # salir limpio sin escribir).
        escribir_broll(e.media)
        print("  ✓ build/broll_plan.json   %d escena(s) de media%s"
              % (len(e.media),
                 ", en reloj de origen" if e.media else
                 " — sellado VACÍO a propósito: el de otra pieza no "
                 "sobrevive"), file=hum)
        # `lint_config.py` cruza el plan con las 56 plantillas y caza la clave
        # que la plantilla NO lee. Se llama desde aquí y no se deja para el
        # `make rapido` porque este es el punto donde el fallo se produce: el
        # guion nombra `card_copy` y cada plantilla llama a su ranura de otra
        # forma. `headline-clipper` recibió `titulo`, lo ignoró y rasterizó su
        # texto de muestra sobre la cara; el lint lo decía y nadie lo corrió.
        # `--estricto` porque en un plan generado desde guion una clave que la
        # plantilla no lee ES un error, no un aviso. Y el returncode se
        # propaga: con un guionista automatizado produciendo los JSON, el exit
        # code es la única señal que ve, y devolver 0 incondicional era el
        # mismo silencio que puso el texto de muestra sobre la cara.
        r = subprocess.run(
            [sys.executable, os.path.join(RAIZ, "scripts", "lint_config.py"),
             "--plan", os.path.join(comun.build_dir(), "plan.json"),
             "--estricto"],
            capture_output=True, text=True)
        lint = [linea.strip() for linea in (r.stdout or "").splitlines()
                if "⚠" in linea or "✗" in linea]
        for linea in lint:
            print("  " + linea, file=hum)
        if r.returncode != 0:
            # returncode a mano y no exige_ok: las líneas ⚠/✗ de arriba ya
            # dicen el qué; aquí solo falta la cola de stderr —si el lint
            # revienta con traceback, hoy se perdía entera— y devolver 1.
            for linea in (r.stderr or "").splitlines()[-8:]:
                print("  " + linea.rstrip(), file=sys.stderr)
            print("  ✗ lint_config.py --estricto devolvió %d: el plan escrito "
                  "tiene claves que su plantilla no lee. Corrige el guion (o "
                  "las tablas COPY/COMPONENTES) y vuelve a pasar:\n"
                  "    .venv/bin/python scripts/leer_guion.py %s --escribir"
                  % (r.returncode, a.guion), file=sys.stderr)
            rc = 1
    else:
        print("\n  (nada escrito; añade --escribir)", file=hum)

    if a.json:
        json.dump({"actos": [{"nombre": n, "ini": round(i, 3),
                              "fin": round(f, 3)} for n, i, f in e.actos],
                   "informe": inf,
                   "desviaciones": desviaciones,
                   "errores": errores,
                   "lint": lint,
                   "escrito": escrito},
                  sys.stdout, ensure_ascii=False)
        print()
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
