# Contrato del guion de dirección

> **GENERADO** por `scripts/contrato_guion.py` desde las tablas de
> `scripts/leer_guion.py`, el catálogo de `scripts/hacer_sfx.py` y los
> `defaults` de las plantillas. **No lo edites a mano**: regenéralo con
> `python3 scripts/contrato_guion.py --escribir`. La puerta
> (`scripts/comprobar_docs.py`) falla si diverge de las tablas.

El guion JSON lo consume `scripts/leer_guion.py`, que lo cruza con la
grabación real y dice en voz alta cada divergencia. El guion describe la
pieza que se QUERÍA grabar; manda la grabación. Ejemplo completo:
`guiones/codex-security.json`. Colores y palabras en azul:
`guiones/PALETA.md`. Un guion de pieza redactado en prosa:
`docs/guion-ejemplo.md`.

Hoy el guion alcanza 182 de las 182 plantillas del catálogo y 16 de los
21 sonidos sintetizados. Ampliar ese alcance es ampliar las tablas
`COMPONENTES`, `MICRO_FX` y `SFX` de `scripts/leer_guion.py` — este
contrato se regenera de ahí.

## Esquema

```json
{
  "metadata": { "title": "…", "duration_seconds": 55,
                "aspect_ratio": "9:16" },
  "timeline": [
    {
      "act": 1,
      "act_name": "HOOK",
      "start_sec": 0,
      "screen_mode": "MODE_A_ROLL",
      "framing": "FRAME_CLOSE_UP",
      "voice_speech": "texto que se quería decir en este acto",
      "blue_highlight_words": ["palabra", "otra"],
      "visual_trigger": {
        "name": "headline-clipper.html",
        "position": "POS_TOP_CENTER",
        "card_copy": "TITULAR DE LA TARJETA",
        "config": { "lo": "que la plantilla necesite, tal cual" }
      },
      "micro_fx": [
        { "trigger_word": "palabra", "fx_id": "stamp-banned",
          "position": "POS_MID_RIGHT", "config": {} }
      ],
      "media_local": [
        { "file": "assets/broll/clip.mp4", "ancla": "palabra",
          "dur": 2.2 }
      ],
      "sfx": ["stamp_heavy.wav"]
    }
  ],
  "infinite_loop": { "end_phrase": "…", "start_phrase": "…" }
}
```

Qué hace el pipeline con cada campo:

- **`voice_speech`** — el texto del acto. Se alinea con `difflib`
  contra la transcripción real, PALABRA a palabra: todos los anclajes
  (actos, disparadores, azules) se resuelven sobre esa alineación.
- **`start_sec` / `end_sec`** — intención, no mandan. Los límites del
  acto salen de la primera y la última palabra realmente alineadas;
  una desviación > 1,5 s se informa. En la pieza de Codex el acto 3 se
  grabó 4,3 s antes de su marca.
- **`blue_highlight_words`** — palabras que salen en `--accent` en los
  subtítulos. Una palabra que no se dijo NO se puede resaltar: se
  propone el equivalente por posición o se omite, y se dice.
- **`visual_trigger.card_copy`** — entra por la ranura de copy de la
  tabla de componentes (cada plantilla la llama de otra forma).
- **`visual_trigger.config` / `micro_fx[].config`** — passthrough: se
  pasa TAL CUAL a la plantilla. Es la válvula para lo que el guion no
  modela (el código de un mockup, el botón de un CTA). Tras escribir
  el plan, `lint_config.py --estricto` comprueba que cada clave la lea
  de verdad la plantilla; una clave que no lee es ERROR, porque el
  fallo es mudo: `headline-clipper` recibió `titulo`, lo ignoró y
  rasterizó su texto de muestra sobre la cara.
- **`micro_fx[].trigger_word`** — palabra del `voice_speech` de SU acto
  sobre la que dispara el efecto. Se ancla a la palabra real alineada.
- **`sfx`** — cues de sonido del acto, con nombres de banco de la tabla
  de abajo. Se RECONCILIAN con las capas colocadas, no se colocan a
  ciegas: casan por afinidad de nombre, se confirman contra lo que ya
  suena, o los cubre la frontera de acto; lo que queda sin capa se
  informa. Nada desaparece sin una línea.
- **`timeline[].media_local`** — B-Roll LOCAL declarado por el acto:
  lista de `{file, ancla, desfase?, dur}`, anclada a la PALABRA como
  todo lo demás — volver a transcribir mueve la escena con la
  grabación. El fichero tiene que existir en disco (los media no se
  versionan; fuente, id y licencia por fichero en `guiones/MEDIA.md`):
  si falta, ABORTA nombrándolo. Las escenas salen a
  `build/broll_plan.json` en reloj de ORIGEN — y con `--escribir` ese
  plan se escribe SIEMPRE, vacío incluido, para que el broll_plan de
  otra pieza no sobreviva en `build/`.
- **`micro_fx[].media_fetch`** — se resuelve EN LOCAL, sin descargar
  nada: el slug se casa por tokens contra los ficheros de
  `assets/broll/` («shield security via pexels» casa
  shield_security_pixabay_262696.mp4 por «shield»+«security»; el
  proveedor no puntúa). Si la media_local del acto ya coloca ese
  fichero, la petición se confirma sin duplicar; si nada casa, el
  informe dice el paso: bajar el fichero a `assets/broll/` y
  declararlo en `guiones/MEDIA.md`.
- **`infinite_loop`** — SÍ se lee: se mide la costura del bucle
  (cola tras la última palabra + cabeza antes de la primera) y se
  informa; desviación si la suma pasa de 0,35 s. No toca el montaje.
- **`spatial_position`, `time_range`, `component_type`,
  `custom_specification`** — se aceptan y hoy no se leen: no lleves
  señal ahí. La posición va en `visual_trigger.position` y
  `micro_fx[].position`.
- **`metadata.brand_highlight_color`** — sobra: el color lo pone la
  paleta (`guiones/PALETA.md`). Un color fuera de marca se ignora y se
  avisa.

Claves de `config` que valen en CUALQUIER plantilla (las aplica el
motor): `tema` (`carbon` | `paper`; por defecto `carbon`), `zoom`
(escala de maquetación), y `zona`/`ancho` solo en plantillas con nodo
`.tarjeta`. `duration` la pone `leer_guion.py` con la duración que
dicta el CONTENIDO (el compás de tecleo puede alargarla). `modo` está
RESERVADA por el renderizador: la sobrescribe y no llega nunca a la
plantilla. Los tiempos dentro de `config` (`at`, `ini`, `fin`…) son
RELATIVOS al inicio de su capa, no absolutos de la pieza.

## Componentes (`visual_trigger.name`)

| nombre en el guion | plantilla | ranura de `card_copy` | sonido | claves de `config` |
|---|---|---|---|---|
| `anotacion.html` | `templates/anotacion.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues (deslizar) | `marcas` (lista), `permanece`, `pluma`, `salida`, `semilla`, `sinSonido` |
| `antes-despues.html` | `templates/antes-despues.html` | `antes` y `despues` (lista, o cadena partida por « → », «->» o «|») | `barrido` al entrar | `antes` (texto), `desde` (número), `despues` (texto), `entrada` (número), `espera` (número), `hasta` (número), `mango` (número), `pie` (texto), `rotulos` (número), `salida` (número), `viaje` (número), `vuelta` (número) |
| `capitulos.html` | `templates/capitulos.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `capitulos` (lista), `entrada`, `opacidad`, `restante`, `salida`, `y` |
| `chapter-card.html` | `templates/chapter-card.html` | `titulo` | `impacto` al entrar | `entrada` (número), `n` (texto), `salida` (número), `titulo` (texto) |
| `chat-bubbles.html` | `templates/chat-bubbles.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues (clic, tecleo) | `cps` (número), `mensajes`, `pensar` (número), `rotulos` (objeto), `salida` (número), `sinSonido`, `y` (número) |
| `cierre-cta.html` | `templates/cierre-cta.html` | `titular` | publica sus propios cues (suscribir) | `boton` (texto), `botonHecho` (texto), `entrada` (número), `ico` (booleano), `icoHecho` (booleano), `marca` (texto), `matiz` (texto), `nChispas` (número), `permanencia` (número), `pulsacion` (número), `rotulo` (texto), `salida` (número), `sub` (texto), `titular` (texto), `viaje` (número) |
| `cinta.html` | `templates/cinta.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `alternar`, `arranque`, `bandas` (lista), `entrada`, `frenada`, `salida` |
| `cita.html` | `templates/cita.html` | `cita` | publica sus propios cues (tic) | `autor` (texto), `cargo` (texto), `cita` (texto), `entrada` (número), `escalonado` (número), `resaltar` (lista), `salida` (número), `sinSonido` (booleano), `tam` |
| `code-mockup.html` | `templates/code-mockup.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues (tecleo) | `anclaje` (texto), `archivo` (texto), `codigo` (lista), `cps` (número), `entrada`, `escala` (número), `estado` (texto), `margen` (número), `primera` (número), `rama` (texto), `salida`, `sinSonido`, `tam` |
| `comment-bubble.html` | `templates/comment-bubble.html` | `texto` | `pop` al entrar | `cps` (número), `entrada` (número), `iniciales` (texto), `likes` (número), `nombre` (texto), `respuestas` (número), `salida` (número), `texto` (texto), `usuario` (texto), `y` (número) |
| `compare-ab.html` | `templates/compare-ab.html` | `titulo` | publica sus propios cues (deslizar, impacto, resolucion) | `a` (objeto), `b`, `diferencia` (texto), `entrada` (número), `ganador` (texto), `ini` (número), `salida` (número), `sinSonido`, `subida` (número), `titulo` (texto) |
| `cursor-tap.html` | `templates/cursor-tap.html` | `texto` | `aparicion` al entrar | `entrada` (número), `escala` (número), `giro` (número), `pulsacion` (número), `salida` (número), `texto` (texto), `viaje` (número), `x` (número), `y` (número) |
| `custom-component: security-pipeline-nodes` | `templates/security-pipeline-nodes.html` | `titulo` | publica sus propios cues (clic, fallo) | `celda`, `ciclo`, `entrada`, `fundido`, `lienzo`, `nodos` (lista), `rejilla`, `reparto`, `salida`, `sinSonido`, `titulo` (texto), `viaje`, `y` (número) |
| `cut-strip.html` | `templates/cut-strip.html` | `texto` | publica sus propios cues (clic) | `angulo` (número), `at` (número), `corte` (número), `entrada` (número), `salida` (número), `sinSonido`, `tam`, `texto` (texto), `y` (número) |
| `data-diagram.html` | `templates/data-diagram.html` | `titulo` | publica sus propios cues (clic) | `aristas`, `columnas`, `escala`, `filas`, `nodos` (lista), `paquete`, `salida` (número), `sinSonido`, `subtitulo` (texto), `titulo` (texto), `velFlujo`, `vidrio`, `vista` (texto), `y` |
| `definition-card.html` | `templates/definition-card.html` | `palabra` | `deslizar` al entrar | `categoria` (texto), `definicion` (texto), `entrada` (número), `fonetica` (texto), `lectura` (booleano), `letra` (booleano), `palabra` (texto), `salida` (número), `x` (número), `y` (número) |
| `engagement-cta.html` | `templates/cierre-cta.html` | `titular` | publica sus propios cues (suscribir) | `boton` (texto), `botonHecho` (texto), `entrada` (número), `ico` (booleano), `icoHecho` (booleano), `marca` (texto), `matiz` (texto), `nChispas` (número), `permanencia` (número), `pulsacion` (número), `rotulo` (texto), `salida` (número), `sub` (texto), `titular` (texto), `viaje` (número) |
| `fondo.html` | `templates/fondo.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `blobs` (número), `celda` (número), `entrada` (número), `grano` (número) |
| `glass-dock.html` | `templates/glass-dock.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `entrada`, `items` (lista), `salida`, `salto_dur`, `saltos`, `y` (número) |
| `globo.html` | `templates/globo.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues (clic) | `arco` (número), `arcos`, `cx` (número), `cy` (número), `entrada`, `noche`, `paso` (número), `permanencia` (número), `puntos`, `r` (número), `relleno`, `rotY` (número), `salida`, `sinSonido`, `sol` (objeto), `velocidad` (número), `viaje` (número), `visita` (booleano) |
| `gold-glint.html` | `templates/gold-glint.html` | `texto` | `aparicion` al entrar | `anchoMax` (número), `barrido` (número), `espera` (número), `salida` (número), `tam`, `texto` (texto), `y` (número) |
| `green-spike.html` | `templates/green-spike.html` | `texto` | `aparicion` al entrar | `alto` (número), `tam` (número), `texto` (texto), `y` (número) |
| `head-explode.html` | `templates/head-explode.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `alcance` (número), `grosor` (número), `n` (número), `sacudida` (número), `salida` (número), `x` (número), `y` (número) |
| `headline-clipper.html` | `templates/headline-clipper.html` | `titular` | publica sus propios cues (impacto) | `entrada` (número), `entradilla` (texto), `fecha` (texto), `firma` (texto), `giro` (número), `medio` (texto), `pop` (número), `resaltar` (texto), `salida` (número), `seccion` (texto), `semilla` (número), `sinSonido`, `titular` (texto), `trazo` (número) |
| `hero-stat.html` | `templates/hero-stat.html` | `rotulo` | `tic` al entrar | `align` (texto), `decimales` (número), `desde` (número), `etiqueta` (texto), `flecha` (texto), `nota` (texto), `rotulo` (texto), `salida` (número), `separador` (texto), `subida` (número), `unidad` (texto), `valor` (número), `y` (número) |
| `hf-app-showcase.html` | `templates/hf-app-showcase.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-apple-money-count.html` | `templates/hf-apple-money-count.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `ease` (texto), `encaje`, `escala`, `salida`, `sinSonido` |
| `hf-beat-freeze-cut.html` | `templates/hf-beat-freeze-cut.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-blue-sweater-intro-video.html` | `templates/hf-blue-sweater-intro-video.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `ease` (texto), `encaje`, `escala`, `salida`, `sinSonido` |
| `hf-camcorder-hud.html` | `templates/hf-camcorder-hud.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-caption-clip-wipe.html` | `templates/hf-caption-clip-wipe.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-caption-editorial-emphasis.html` | `templates/hf-caption-editorial-emphasis.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-caption-emoji-pop.html` | `templates/hf-caption-emoji-pop.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-caption-gradient-fill.html` | `templates/hf-caption-gradient-fill.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-caption-highlight.html` | `templates/hf-caption-highlight.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-caption-kinetic-slam.html` | `templates/hf-caption-kinetic-slam.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-caption-parallax-layers.html` | `templates/hf-caption-parallax-layers.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-caption-pill-karaoke.html` | `templates/hf-caption-pill-karaoke.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-caption-weight-shift.html` | `templates/hf-caption-weight-shift.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-chromatic-radial-split.html` | `templates/hf-chromatic-radial-split.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-cinematic-zoom.html` | `templates/hf-cinematic-zoom.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-code-3d-extrude.html` | `templates/hf-code-3d-extrude.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-code-diff.html` | `templates/hf-code-diff.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-code-highlight.html` | `templates/hf-code-highlight.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-code-morph.html` | `templates/hf-code-morph.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-code-particle-assemble.html` | `templates/hf-code-particle-assemble.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-code-scroll.html` | `templates/hf-code-scroll.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-code-shader-dissolve.html` | `templates/hf-code-shader-dissolve.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-code-typing.html` | `templates/hf-code-typing.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-cross-warp-morph.html` | `templates/hf-cross-warp-morph.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-data-chart.html` | `templates/hf-data-chart.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-domain-warp-dissolve.html` | `templates/hf-domain-warp-dissolve.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-flash-through-white.html` | `templates/hf-flash-through-white.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-flowchart-vertical.html` | `templates/hf-flowchart-vertical.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-flowchart.html` | `templates/hf-flowchart.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-freeze-frame-dressing.html` | `templates/hf-freeze-frame-dressing.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-glitch.html` | `templates/hf-glitch.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-gravitational-lens.html` | `templates/hf-gravitational-lens.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-hw-arrow.html` | `templates/hf-hw-arrow.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `lineas`, `salida` (booleano), `sinSonido` |
| `hf-hw-boil.html` | `templates/hf-hw-boil.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-hw-box-label.html` | `templates/hf-hw-box-label.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-hw-callout-circle.html` | `templates/hf-hw-callout-circle.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-hw-frame.html` | `templates/hf-hw-frame.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-hw-path-text.html` | `templates/hf-hw-path-text.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-hw-pipeline.html` | `templates/hf-hw-pipeline.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `nodos`, `salida` (booleano), `sinSonido` |
| `hf-hw-scribble-transition.html` | `templates/hf-hw-scribble-transition.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-hw-text-cloud.html` | `templates/hf-hw-text-cloud.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-hw-title.html` | `templates/hf-hw-title.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `lineas`, `salida` (booleano), `sinSonido` |
| `hf-hw-underline.html` | `templates/hf-hw-underline.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `lineas`, `salida` (booleano), `sinSonido` |
| `hf-instagram-follow.html` | `templates/hf-instagram-follow.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-ios26-liquid-glass.html` | `templates/hf-ios26-liquid-glass.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-light-leak.html` | `templates/hf-light-leak.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-liquid-glass-context-menu.html` | `templates/hf-liquid-glass-context-menu.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-liquid-glass-media-controls.html` | `templates/hf-liquid-glass-media-controls.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-liquid-glass-notification.html` | `templates/hf-liquid-glass-notification.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-liquid-glass-widgets.html` | `templates/hf-liquid-glass-widgets.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-logo-outro.html` | `templates/hf-logo-outro.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-lower-third-bild.html` | `templates/hf-lower-third-bild.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-lt-accent-underline.html` | `templates/hf-lt-accent-underline.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-lt-bold-block.html` | `templates/hf-lt-bold-block.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `lineas`, `salida` (booleano), `sinSonido` |
| `hf-lt-clean-bar.html` | `templates/hf-lt-clean-bar.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-lt-color-block.html` | `templates/hf-lt-color-block.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-lt-dark-card.html` | `templates/hf-lt-dark-card.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-lt-kicker-name.html` | `templates/hf-lt-kicker-name.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-lt-mask-reveal.html` | `templates/hf-lt-mask-reveal.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-lt-side-rule.html` | `templates/hf-lt-side-rule.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-lt-soft-pill.html` | `templates/hf-lt-soft-pill.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-lt-stack-bars.html` | `templates/hf-lt-stack-bars.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-macos-notification.html` | `templates/hf-macos-notification.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-macos-tahoe-liquid-glass.html` | `templates/hf-macos-tahoe-liquid-glass.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-mk-background.html` | `templates/hf-mk-background.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-mk-callout-highlight.html` | `templates/hf-mk-callout-highlight.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `lineas`, `salida` (booleano), `sinSonido` |
| `hf-mk-clone-wall-transition.html` | `templates/hf-mk-clone-wall-transition.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-mk-line-graph.html` | `templates/hf-mk-line-graph.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `ejex`, `encaje` (booleano), `escala`, `salida` (booleano), `series`, `sinSonido` |
| `hf-mk-placeholder-grid.html` | `templates/hf-mk-placeholder-grid.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-mk-progress-stat.html` | `templates/hf-mk-progress-stat.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cifra`, `cue`, `cueGain`, `encaje` (booleano), `escala`, `pie`, `rotulo`, `salida` (booleano), `sinSonido` |
| `hf-mk-specs-list.html` | `templates/hf-mk-specs-list.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `filas`, `salida` (booleano), `sinSonido` |
| `hf-mk-usage-arc.html` | `templates/hf-mk-usage-arc.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cifra`, `cue`, `cueGain`, `encaje` (booleano), `escala`, `rotulo`, `salida` (booleano), `sinSonido` |
| `hf-morph-text.html` | `templates/hf-morph-text.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-news-ticker.html` | `templates/hf-news-ticker.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-north-korea-locked-down.html` | `templates/hf-north-korea-locked-down.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje`, `escala`, `overwrite` (texto), `salida`, `sinSonido` |
| `hf-nyc-paris-flight.html` | `templates/hf-nyc-paris-flight.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje`, `escala`, `overwrite` (texto), `salida`, `sinSonido` |
| `hf-organic-light-leak-overlay.html` | `templates/hf-organic-light-leak-overlay.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-reddit-post.html` | `templates/hf-reddit-post.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-ridged-burn.html` | `templates/hf-ridged-burn.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-ripple-waves.html` | `templates/hf-ripple-waves.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-sdf-iris.html` | `templates/hf-sdf-iris.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-spain-map.html` | `templates/hf-spain-map.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-spotify-card.html` | `templates/hf-spotify-card.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-swirl-vortex.html` | `templates/hf-swirl-vortex.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-thermal-distortion.html` | `templates/hf-thermal-distortion.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-tiktok-follow.html` | `templates/hf-tiktok-follow.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-transitions-3d.html` | `templates/hf-transitions-3d.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-transitions-blur.html` | `templates/hf-transitions-blur.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-transitions-cover.html` | `templates/hf-transitions-cover.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-transitions-destruction.html` | `templates/hf-transitions-destruction.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-transitions-dissolve.html` | `templates/hf-transitions-dissolve.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-transitions-distortion.html` | `templates/hf-transitions-distortion.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `ease` (texto), `encaje`, `escala`, `salida`, `sinSonido` |
| `hf-transitions-grid.html` | `templates/hf-transitions-grid.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `ease` (texto), `encaje`, `escala`, `salida`, `sinSonido` |
| `hf-transitions-light.html` | `templates/hf-transitions-light.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-transitions-mechanical.html` | `templates/hf-transitions-mechanical.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-transitions-other.html` | `templates/hf-transitions-other.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-transitions-push.html` | `templates/hf-transitions-push.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-transitions-radial.html` | `templates/hf-transitions-radial.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-transitions-scale.html` | `templates/hf-transitions-scale.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-ui-3d-reveal.html` | `templates/hf-ui-3d-reveal.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-us-map-bubble.html` | `templates/hf-us-map-bubble.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-us-map-flow.html` | `templates/hf-us-map-flow.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-us-map-hex.html` | `templates/hf-us-map-hex.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-us-map.html` | `templates/hf-us-map.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-vfx-iphone-device.html` | `templates/hf-vfx-iphone-device.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-vfx-liquid-background.html` | `templates/hf-vfx-liquid-background.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-vfx-liquid-glass.html` | `templates/hf-vfx-liquid-glass.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-vfx-magnetic.html` | `templates/hf-vfx-magnetic.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-vfx-portal.html` | `templates/hf-vfx-portal.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-vfx-text-cursor.html` | `templates/hf-vfx-text-cursor.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-vpn-youtube-spot.html` | `templates/hf-vpn-youtube-spot.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `ease` (texto), `encaje`, `escala`, `salida`, `sinSonido` |
| `hf-whip-pan.html` | `templates/hf-whip-pan.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-world-map.html` | `templates/hf-world-map.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-x-post.html` | `templates/hf-x-post.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-yt-camera-move.html` | `templates/hf-yt-camera-move.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-yt-circle-pointer.html` | `templates/hf-yt-circle-pointer.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-yt-comment-card.html` | `templates/hf-yt-comment-card.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-yt-feather-highlight.html` | `templates/hf-yt-feather-highlight.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-yt-lcd-background.html` | `templates/hf-yt-lcd-background.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-yt-logo-intro.html` | `templates/hf-yt-logo-intro.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-yt-lower-third.html` | `templates/hf-yt-lower-third.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-yt-prism-title.html` | `templates/hf-yt-prism-title.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-yt-screen-warp.html` | `templates/hf-yt-screen-warp.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `hf-yt-vertical-fill.html` | `templates/hf-yt-vertical-fill.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` |
| `highlighter-text.html` | `templates/highlighter-text.html` | `texto` | `aparicion` al entrar | `at`, `barrido`, `color`, `colores`, `entrada`, `marcar` (lista), `salida`, `tam`, `texto` (texto) |
| `karaoke-subs.html` | `templates/karaoke-subs.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `alto` (número), `bloques` (lista), `caja`, `pop` (número), `tam` (número), `tercio`, `y` (número) |
| `kicker-hud.html` | `templates/kicker-hud.html` | `titulo` | publica sus propios cues (barrido, clic, tic) | `cps`, `division`, `entrada`, `escala`, `escalonado`, `funcion` (texto), `kicker` (texto), `metrica`, `salida`, `sinSonido`, `titulo` (texto), `y` |
| `kinetic-captions.html` | `templates/kinetic-captions.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `acento` (texto), `anchoMax` (número), `clave` (lista), `cuerpoClave` (número), `escalonado` (número), `fijoAbajo` (número), `gestos` (booleano), `giroClave` (número), `huecoMax` (número), `max` (número), `palabras` (lista), `pop` (número), `popClave` (número), `popPalabra` (número), `preset` (número), `subida` (número), `tam`, `trazo` (número), `vaiven` (número), `ventanas` (lista) |
| `kinetic-quote.html` | `templates/kinetic-quote.html` | `texto` | `impacto` al entrar | `anchoMax`, `entrada` (número), `resaltar` (texto), `salida` (número), `tam` (número), `texto` (texto) |
| `kinetic-type.html` | `templates/kinetic-type.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `anchoMax` (número), `at`, `barridoEn`, `dur`, `flashEn` (lista), `palabras` (lista), `salida` (número) |
| `lower-third.html` | `templates/lower-third.html` | `nombre` | publica sus propios cues (clic, tic) | `bug` (texto), `conBug` (booleano), `entrada` (número), `escalonado` (número), `lado` (texto), `nombre` (texto), `rol` (texto), `salida` (número), `sinSonido`, `y` (número) |
| `mapa-calor.html` | `templates/mapa-calor.html` | `titulo` | `escaner` al entrar | `celda`, `columnas` (lista), `entrada`, `escalonado`, `etiquetas`, `filas`, `foco`, `salida`, `sub` (texto), `titulo` (texto), `valores` |
| `marcos.html` | `templates/marcos.html` | `titular` | publica sus propios cues (aparicion, clic, tic) | `alto` (número), `cps` (número), `desplazamiento` (número), `entrada` (número), `localhost`, `origen` (texto), `salida` (número), `sinSonido`, `tipo` (texto), `titular` (texto), `url` (texto) |
| `neural-node-pulse.html` | `templates/neural-node-pulse.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `entrada` (número), `halos` (número), `n` (número), `r` (número), `salida` (número), `viaje` (número), `x` (número), `y` (número) |
| `notification-pop.html` | `templates/notification-pop.html` | `titulo` | publica sus propios cues (clic) | `app` (texto), `entrada` (número), `hora` (texto), `icono` (texto), `permanencia` (número), `sub` (texto), `titulo` (texto), `venta`, `y` (número) |
| `odometro.html` | `templates/odometro.html` | `rotulo` | publica sus propios cues (tic) | `desde` (número), `entrada` (número), `pie` (texto), `rigidez` (número), `rotulo` (texto), `salida` (número), `separador` (texto), `sinSonido`, `subida` (número), `sufijo` (texto), `tam` (número), `valor` (número) |
| `onda.html` | `templates/onda.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `alto` (número), `barras` (número), `desde` (número), `entrada` (número), `etiqueta` (texto), `minimo` (número), `niveles` (lista), `salida` (número), `suelo` (número), `tasa` (número), `y` (número) |
| `padlock-unlock.html` | `templates/padlock-unlock.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `alza` (número), `escala` (número), `giro` (número), `salto` (número), `x` (número), `y` (número) |
| `pasos-flow.html` | `templates/pasos-flow.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues | `entrada` (número), `escalonado` (número), `hueco` (número), `pasos` (lista), `salida` (número), `sinSonido`, `y` (número) |
| `pills.html` | `templates/pills.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `pop` al entrar | `align` (texto), `barrido` (número), `entrada` (número), `escalonado` (número), `items` (lista), `salida` (número), `sinSonido`, `y` (número) |
| `pip-frame.html` | `templates/pip-frame.html` | `label` | publica sus propios cues (clic, tic) | `apertura`, `contador`, `entrada`, `grosor`, `h`, `intensidadEq`, `label` (texto), `medidor`, `salida`, `sinSonido`, `w`, `x`, `y` |
| `poll-rating.html` | `templates/poll-rating.html` | `titulo` | publica sus propios cues (tic) | `entrada`, `escalonado`, `opciones` (lista), `paso`, `salida`, `sinSonido`, `subida`, `titulo` (texto) |
| `red-crash.html` | `templates/red-crash.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `alto` (número), `destellos` (número), `y` (número) |
| `rejilla-logos.html` | `templates/rejilla-logos.html` | `titulo` | `aparicion` al entrar | `columnas`, `elegido`, `entrada`, `escalonado`, `hueco`, `items` (lista), `lado`, `lockup`, `nota`, `salida`, `sub` (texto), `titulo` (texto), `vista` (texto) |
| `search-bar.html` | `templates/search-bar.html` | `consulta` | `tecleo` al entrar | `consulta` (texto), `cps`, `entrada`, `pulsacion`, `salida`, `sugEn`, `sugerencias` (lista), `y` |
| `security-pipeline-nodes.html` | `templates/security-pipeline-nodes.html` | `titulo` | publica sus propios cues (clic, fallo) | `celda`, `ciclo`, `entrada`, `fundido`, `lienzo`, `nodos` (lista), `rejilla`, `reparto`, `salida`, `sinSonido`, `titulo` (texto), `viaje`, `y` (número) |
| `split-versus.html` | `templates/split-versus.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues (clic, deslizar, destello, impacto) | `a` (objeto), `b`, `barrido`, `entrada`, `espera`, `salida`, `sinSonido`, `vs`, `vsEn` |
| `stamp-banned.html` | `templates/stamp-banned.html` | `texto` | `aparicion` al entrar | `giro` (número), `nPolvo` (número), `tam` (número), `texto` (texto), `y` (número) |
| `stroke-crossout.html` | `templates/stroke-crossout.html` | `texto` | `aparicion` al entrar | `diagonal` (booleano), `grosor` (número), `tam` (número), `texto` (texto), `trazo` (número), `y` (número) |
| `subtitles-showcase.html` | `templates/subtitles-showcase.html` | `texto` | `aparicion` al entrar | `brillo` (número), `clave` (lista), `cuerpo` (número), `entrada` (número), `escalaTexto` (número), `escalonado` (número), `permanencia` (número), `pop` (número), `preset` (número), `texto` (texto), `viaje` (número), `vista` (texto) |
| `svg-checkmark.html` | `templates/svg-checkmark.html` | `texto` | `aparicion` al entrar | `r` (número), `tam` (número), `texto` (texto), `x` (número), `y` (número) |
| `target-hud.html` | `templates/target-hud.html` | `texto` | `aparicion` al entrar | `division` (número), `entrada` (número), `giro` (número), `lectura` (texto), `r` (número), `salida` (número), `texto` (texto), `viaje` (número), `x` (número), `y` (número) |
| `tarjeta-3d.html` | `templates/tarjeta-3d.html` | `titulo` | publica sus propios cues (deslizar, impacto, tic) | `cifra` (texto), `entrada` (número), `inclinacion` (número), `periodo` (número), `pie` (texto), `rotulo` (texto), `salida` (número), `sinSonido`, `titulo` (texto), `unidad` (texto) |
| `terminal.html` | `templates/terminal.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | publica sus propios cues (acierto, fallo, tecleo) | `alto` (número), `cps` (número), `eje`, `entrada`, `lineas` (lista), `prompt` (booleano), `ruta` (texto), `salida`, `sinSonido`, `tam`, `titulo` (texto) |
| `text-stack-offset.html` | `templates/text-stack-offset.html` | `texto` | `aparicion` al entrar | `copias` (número), `dx` (número), `dy` (número), `tam` (número), `texto` (texto), `y` (número) |
| `timer-ring.html` | `templates/timer-ring.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `desde` (número), `r` (número), `tam` (número), `vaciado` (número), `x` (número), `y` (número) |
| `transicion.html` | `templates/transicion.html` | — (sin ranura de texto: su contenido va por config; un `card_copy` se avisa y se tira) | `aparicion` al entrar | `cortes` (lista), `franjas` |
| `tweet-card.html` | `templates/tweet-card.html` | `texto` | `pop` al entrar | `entrada`, `escalonado`, `metricas` (lista), `nombre` (texto), `red` (texto), `resaltar` (texto), `salida`, `sello` (texto), `subida`, `texto` (texto), `usuario` (texto), `verificado` (booleano) |

Un `name` fuera de esta tabla ABORTA con la lista de plantillas
disponibles. La tarjeta entra 0,55 s después de arrancar el acto y
dura 2,5-3 s (recortada al acto); `cierre-cta` se ancla al FINAL de la
pieza (último 15 %, BRAND_RULES §12). El contenido tecleable alarga la
capa: la permanencia la dicta el contenido, no el guion.

## Micro-FX (`micro_fx[].fx_id`)

| `fx_id` | plantilla | sonido | claves de `config` | copy OBLIGATORIO |
|---|---|---|---|---|
| `anotacion` | `templates/anotacion.html` | publica sus propios cues (deslizar) | `marcas` (lista), `permanece`, `pluma`, `salida`, `semilla`, `sinSonido` | — |
| `antes-despues` | `templates/antes-despues.html` | `aparicion` | `antes` (texto), `desde` (número), `despues` (texto), `entrada` (número), `espera` (número), `hasta` (número), `mango` (número), `pie` (texto), `rotulos` (número), `salida` (número), `viaje` (número), `vuelta` (número) | — |
| `capitulos` | `templates/capitulos.html` | `aparicion` | `capitulos` (lista), `entrada`, `opacidad`, `restante`, `salida`, `y` | — |
| `chapter-card` | `templates/chapter-card.html` | `aparicion` | `entrada` (número), `n` (texto), `salida` (número), `titulo` (texto) | — |
| `chat-bubbles` | `templates/chat-bubbles.html` | publica sus propios cues (clic, tecleo) | `cps` (número), `mensajes`, `pensar` (número), `rotulos` (objeto), `salida` (número), `sinSonido`, `y` (número) | — |
| `cierre-cta` | `templates/cierre-cta.html` | publica sus propios cues (suscribir) | `boton` (texto), `botonHecho` (texto), `entrada` (número), `ico` (booleano), `icoHecho` (booleano), `marca` (texto), `matiz` (texto), `nChispas` (número), `permanencia` (número), `pulsacion` (número), `rotulo` (texto), `salida` (número), `sub` (texto), `titular` (texto), `viaje` (número) | — |
| `cinta` | `templates/cinta.html` | `aparicion` | `alternar`, `arranque`, `bandas` (lista), `entrada`, `frenada`, `salida` | — |
| `cita` | `templates/cita.html` | publica sus propios cues (tic) | `autor` (texto), `cargo` (texto), `cita` (texto), `entrada` (número), `escalonado` (número), `resaltar` (lista), `salida` (número), `sinSonido` (booleano), `tam` | — |
| `cli-typewriter` | `templates/terminal.html` | publica sus propios cues (acierto, fallo, tecleo) | `alto` (número), `cps` (número), `eje`, `entrada`, `lineas` (lista), `prompt` (booleano), `ruta` (texto), `salida`, `sinSonido`, `tam`, `titulo` (texto) | — |
| `code-mockup` | `templates/code-mockup.html` | publica sus propios cues (tecleo) | `anclaje` (texto), `archivo` (texto), `codigo` (lista), `cps` (número), `entrada`, `escala` (número), `estado` (texto), `margen` (número), `primera` (número), `rama` (texto), `salida`, `sinSonido`, `tam` | — |
| `comment-bubble` | `templates/comment-bubble.html` | `aparicion` | `cps` (número), `entrada` (número), `iniciales` (texto), `likes` (número), `nombre` (texto), `respuestas` (número), `salida` (número), `texto` (texto), `usuario` (texto), `y` (número) | `texto` |
| `compare-ab` | `templates/compare-ab.html` | publica sus propios cues (deslizar, impacto, resolucion) | `a` (objeto), `b`, `diferencia` (texto), `entrada` (número), `ganador` (texto), `ini` (número), `salida` (número), `sinSonido`, `subida` (número), `titulo` (texto) | — |
| `cursor-tap` | `templates/cursor-tap.html` | `clic` | `entrada` (número), `escala` (número), `giro` (número), `pulsacion` (número), `salida` (número), `texto` (texto), `viaje` (número), `x` (número), `y` (número) | — |
| `cut-strip` | `templates/cut-strip.html` | publica sus propios cues (clic) | `angulo` (número), `at` (número), `corte` (número), `entrada` (número), `salida` (número), `sinSonido`, `tam`, `texto` (texto), `y` (número) | `texto` |
| `data-diagram` | `templates/data-diagram.html` | publica sus propios cues (clic) | `aristas`, `columnas`, `escala`, `filas`, `nodos` (lista), `paquete`, `salida` (número), `sinSonido`, `subtitulo` (texto), `titulo` (texto), `velFlujo`, `vidrio`, `vista` (texto), `y` | — |
| `definition-card` | `templates/definition-card.html` | `aparicion` | `categoria` (texto), `definicion` (texto), `entrada` (número), `fonetica` (texto), `lectura` (booleano), `letra` (booleano), `palabra` (texto), `salida` (número), `x` (número), `y` (número) | — |
| `flash-through-white` | `templates/hf-flash-through-white.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `fondo` | `templates/fondo.html` | `aparicion` | `blobs` (número), `celda` (número), `entrada` (número), `grano` (número) | — |
| `freeze-frame-dressing` | `templates/hf-freeze-frame-dressing.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `glass-dock` | `templates/glass-dock.html` | `aparicion` | `entrada`, `items` (lista), `salida`, `salto_dur`, `saltos`, `y` (número) | — |
| `globo` | `templates/globo.html` | publica sus propios cues (clic) | `arco` (número), `arcos`, `cx` (número), `cy` (número), `entrada`, `noche`, `paso` (número), `permanencia` (número), `puntos`, `r` (número), `relleno`, `rotY` (número), `salida`, `sinSonido`, `sol` (objeto), `velocidad` (número), `viaje` (número), `visita` (booleano) | — |
| `gold-glint` | `templates/gold-glint.html` | `destello` | `anchoMax` (número), `barrido` (número), `espera` (número), `salida` (número), `tam`, `texto` (texto), `y` (número) | `texto` |
| `green-spike` | `templates/green-spike.html` | `aparicion` | `alto` (número), `tam` (número), `texto` (texto), `y` (número) | — |
| `head-explode` | `templates/head-explode.html` | `impacto` | `alcance` (número), `grosor` (número), `n` (número), `sacudida` (número), `salida` (número), `x` (número), `y` (número) | — |
| `headline-clipper` | `templates/headline-clipper.html` | publica sus propios cues (impacto) | `entrada` (número), `entradilla` (texto), `fecha` (texto), `firma` (texto), `giro` (número), `medio` (texto), `pop` (número), `resaltar` (texto), `salida` (número), `seccion` (texto), `semilla` (número), `sinSonido`, `titular` (texto), `trazo` (número) | — |
| `hero-stat` | `templates/hero-stat.html` | `aparicion` | `align` (texto), `decimales` (número), `desde` (número), `etiqueta` (texto), `flecha` (texto), `nota` (texto), `rotulo` (texto), `salida` (número), `separador` (texto), `subida` (número), `unidad` (texto), `valor` (número), `y` (número) | — |
| `hf-app-showcase` | `templates/hf-app-showcase.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-apple-money-count` | `templates/hf-apple-money-count.html` | publica sus propios cues | `cue`, `cueGain`, `ease` (texto), `encaje`, `escala`, `salida`, `sinSonido` | — |
| `hf-beat-freeze-cut` | `templates/hf-beat-freeze-cut.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-blue-sweater-intro-video` | `templates/hf-blue-sweater-intro-video.html` | publica sus propios cues | `cue`, `cueGain`, `ease` (texto), `encaje`, `escala`, `salida`, `sinSonido` | — |
| `hf-camcorder-hud` | `templates/hf-camcorder-hud.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-caption-clip-wipe` | `templates/hf-caption-clip-wipe.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-caption-editorial-emphasis` | `templates/hf-caption-editorial-emphasis.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-caption-emoji-pop` | `templates/hf-caption-emoji-pop.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-caption-gradient-fill` | `templates/hf-caption-gradient-fill.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-caption-highlight` | `templates/hf-caption-highlight.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-caption-kinetic-slam` | `templates/hf-caption-kinetic-slam.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-caption-parallax-layers` | `templates/hf-caption-parallax-layers.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-caption-pill-karaoke` | `templates/hf-caption-pill-karaoke.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-caption-weight-shift` | `templates/hf-caption-weight-shift.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-chromatic-radial-split` | `templates/hf-chromatic-radial-split.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-cinematic-zoom` | `templates/hf-cinematic-zoom.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-code-3d-extrude` | `templates/hf-code-3d-extrude.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-code-diff` | `templates/hf-code-diff.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-code-highlight` | `templates/hf-code-highlight.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-code-morph` | `templates/hf-code-morph.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-code-particle-assemble` | `templates/hf-code-particle-assemble.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-code-scroll` | `templates/hf-code-scroll.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-code-shader-dissolve` | `templates/hf-code-shader-dissolve.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-code-typing` | `templates/hf-code-typing.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-cross-warp-morph` | `templates/hf-cross-warp-morph.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-data-chart` | `templates/hf-data-chart.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-domain-warp-dissolve` | `templates/hf-domain-warp-dissolve.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-flash-through-white` | `templates/hf-flash-through-white.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-flowchart` | `templates/hf-flowchart.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-flowchart-vertical` | `templates/hf-flowchart-vertical.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-freeze-frame-dressing` | `templates/hf-freeze-frame-dressing.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-glitch` | `templates/hf-glitch.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-gravitational-lens` | `templates/hf-gravitational-lens.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-hw-arrow` | `templates/hf-hw-arrow.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `lineas`, `salida` (booleano), `sinSonido` | `lineas` |
| `hf-hw-boil` | `templates/hf-hw-boil.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-hw-box-label` | `templates/hf-hw-box-label.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-hw-callout-circle` | `templates/hf-hw-callout-circle.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-hw-frame` | `templates/hf-hw-frame.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-hw-path-text` | `templates/hf-hw-path-text.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-hw-pipeline` | `templates/hf-hw-pipeline.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `nodos`, `salida` (booleano), `sinSonido` | `nodos` |
| `hf-hw-scribble-transition` | `templates/hf-hw-scribble-transition.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-hw-text-cloud` | `templates/hf-hw-text-cloud.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-hw-title` | `templates/hf-hw-title.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `lineas`, `salida` (booleano), `sinSonido` | `lineas` |
| `hf-hw-underline` | `templates/hf-hw-underline.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `lineas`, `salida` (booleano), `sinSonido` | `lineas` |
| `hf-instagram-follow` | `templates/hf-instagram-follow.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-ios26-liquid-glass` | `templates/hf-ios26-liquid-glass.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-light-leak` | `templates/hf-light-leak.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-liquid-glass-context-menu` | `templates/hf-liquid-glass-context-menu.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-liquid-glass-media-controls` | `templates/hf-liquid-glass-media-controls.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-liquid-glass-notification` | `templates/hf-liquid-glass-notification.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-liquid-glass-widgets` | `templates/hf-liquid-glass-widgets.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-logo-outro` | `templates/hf-logo-outro.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-lower-third-bild` | `templates/hf-lower-third-bild.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-lt-accent-underline` | `templates/hf-lt-accent-underline.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-lt-bold-block` | `templates/hf-lt-bold-block.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `lineas`, `salida` (booleano), `sinSonido` | `lineas` |
| `hf-lt-clean-bar` | `templates/hf-lt-clean-bar.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-lt-color-block` | `templates/hf-lt-color-block.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-lt-dark-card` | `templates/hf-lt-dark-card.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-lt-kicker-name` | `templates/hf-lt-kicker-name.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-lt-mask-reveal` | `templates/hf-lt-mask-reveal.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-lt-side-rule` | `templates/hf-lt-side-rule.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-lt-soft-pill` | `templates/hf-lt-soft-pill.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-lt-stack-bars` | `templates/hf-lt-stack-bars.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-macos-notification` | `templates/hf-macos-notification.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-macos-tahoe-liquid-glass` | `templates/hf-macos-tahoe-liquid-glass.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-mk-background` | `templates/hf-mk-background.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-mk-callout-highlight` | `templates/hf-mk-callout-highlight.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `lineas`, `salida` (booleano), `sinSonido` | `lineas` |
| `hf-mk-clone-wall-transition` | `templates/hf-mk-clone-wall-transition.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-mk-line-graph` | `templates/hf-mk-line-graph.html` | publica sus propios cues | `cue`, `cueGain`, `ejex`, `encaje` (booleano), `escala`, `salida` (booleano), `series`, `sinSonido` | `ejex`, `series` |
| `hf-mk-placeholder-grid` | `templates/hf-mk-placeholder-grid.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-mk-progress-stat` | `templates/hf-mk-progress-stat.html` | publica sus propios cues | `cifra`, `cue`, `cueGain`, `encaje` (booleano), `escala`, `pie`, `rotulo`, `salida` (booleano), `sinSonido` | `cifra`, `pie`, `rotulo` |
| `hf-mk-specs-list` | `templates/hf-mk-specs-list.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `filas`, `salida` (booleano), `sinSonido` | `filas` |
| `hf-mk-usage-arc` | `templates/hf-mk-usage-arc.html` | publica sus propios cues | `cifra`, `cue`, `cueGain`, `encaje` (booleano), `escala`, `rotulo`, `salida` (booleano), `sinSonido` | `cifra`, `rotulo` |
| `hf-morph-text` | `templates/hf-morph-text.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-news-ticker` | `templates/hf-news-ticker.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-north-korea-locked-down` | `templates/hf-north-korea-locked-down.html` | publica sus propios cues | `cue`, `cueGain`, `encaje`, `escala`, `overwrite` (texto), `salida`, `sinSonido` | — |
| `hf-nyc-paris-flight` | `templates/hf-nyc-paris-flight.html` | publica sus propios cues | `cue`, `cueGain`, `encaje`, `escala`, `overwrite` (texto), `salida`, `sinSonido` | — |
| `hf-organic-light-leak-overlay` | `templates/hf-organic-light-leak-overlay.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-reddit-post` | `templates/hf-reddit-post.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-ridged-burn` | `templates/hf-ridged-burn.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-ripple-waves` | `templates/hf-ripple-waves.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-sdf-iris` | `templates/hf-sdf-iris.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-spain-map` | `templates/hf-spain-map.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-spotify-card` | `templates/hf-spotify-card.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-swirl-vortex` | `templates/hf-swirl-vortex.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-thermal-distortion` | `templates/hf-thermal-distortion.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-tiktok-follow` | `templates/hf-tiktok-follow.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-transitions-3d` | `templates/hf-transitions-3d.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-transitions-blur` | `templates/hf-transitions-blur.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-transitions-cover` | `templates/hf-transitions-cover.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-transitions-destruction` | `templates/hf-transitions-destruction.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-transitions-dissolve` | `templates/hf-transitions-dissolve.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-transitions-distortion` | `templates/hf-transitions-distortion.html` | publica sus propios cues | `cue`, `cueGain`, `ease` (texto), `encaje`, `escala`, `salida`, `sinSonido` | — |
| `hf-transitions-grid` | `templates/hf-transitions-grid.html` | publica sus propios cues | `cue`, `cueGain`, `ease` (texto), `encaje`, `escala`, `salida`, `sinSonido` | — |
| `hf-transitions-light` | `templates/hf-transitions-light.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-transitions-mechanical` | `templates/hf-transitions-mechanical.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-transitions-other` | `templates/hf-transitions-other.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-transitions-push` | `templates/hf-transitions-push.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-transitions-radial` | `templates/hf-transitions-radial.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-transitions-scale` | `templates/hf-transitions-scale.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-ui-3d-reveal` | `templates/hf-ui-3d-reveal.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-us-map` | `templates/hf-us-map.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-us-map-bubble` | `templates/hf-us-map-bubble.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-us-map-flow` | `templates/hf-us-map-flow.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-us-map-hex` | `templates/hf-us-map-hex.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-vfx-iphone-device` | `templates/hf-vfx-iphone-device.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-vfx-liquid-background` | `templates/hf-vfx-liquid-background.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-vfx-liquid-glass` | `templates/hf-vfx-liquid-glass.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-vfx-magnetic` | `templates/hf-vfx-magnetic.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-vfx-portal` | `templates/hf-vfx-portal.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-vfx-text-cursor` | `templates/hf-vfx-text-cursor.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-vpn-youtube-spot` | `templates/hf-vpn-youtube-spot.html` | publica sus propios cues | `cue`, `cueGain`, `ease` (texto), `encaje`, `escala`, `salida`, `sinSonido` | — |
| `hf-whip-pan` | `templates/hf-whip-pan.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-world-map` | `templates/hf-world-map.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-x-post` | `templates/hf-x-post.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-yt-camera-move` | `templates/hf-yt-camera-move.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-yt-circle-pointer` | `templates/hf-yt-circle-pointer.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-yt-comment-card` | `templates/hf-yt-comment-card.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-yt-feather-highlight` | `templates/hf-yt-feather-highlight.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-yt-lcd-background` | `templates/hf-yt-lcd-background.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-yt-logo-intro` | `templates/hf-yt-logo-intro.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-yt-lower-third` | `templates/hf-yt-lower-third.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-yt-prism-title` | `templates/hf-yt-prism-title.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-yt-screen-warp` | `templates/hf-yt-screen-warp.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hf-yt-vertical-fill` | `templates/hf-yt-vertical-fill.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `highlighter-text` | `templates/highlighter-text.html` | `aparicion` | `at`, `barrido`, `color`, `colores`, `entrada`, `marcar` (lista), `salida`, `tam`, `texto` (texto) | `texto` |
| `hw-arrow` | `templates/hf-hw-arrow.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `lineas`, `salida` (booleano), `sinSonido` | `lineas` |
| `hw-box-label` | `templates/hf-hw-box-label.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hw-callout-circle` | `templates/hf-hw-callout-circle.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hw-scribble-transition` | `templates/hf-hw-scribble-transition.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `hw-underline` | `templates/hf-hw-underline.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `lineas`, `salida` (booleano), `sinSonido` | `lineas` |
| `karaoke-subs` | `templates/karaoke-subs.html` | `aparicion` | `alto` (número), `bloques` (lista), `caja`, `pop` (número), `tam` (número), `tercio`, `y` (número) | — |
| `kicker-hud` | `templates/kicker-hud.html` | publica sus propios cues (barrido, clic, tic) | `cps`, `division`, `entrada`, `escala`, `escalonado`, `funcion` (texto), `kicker` (texto), `metrica`, `salida`, `sinSonido`, `titulo` (texto), `y` | — |
| `kinetic-captions` | `templates/kinetic-captions.html` | `aparicion` | `acento` (texto), `anchoMax` (número), `clave` (lista), `cuerpoClave` (número), `escalonado` (número), `fijoAbajo` (número), `gestos` (booleano), `giroClave` (número), `huecoMax` (número), `max` (número), `palabras` (lista), `pop` (número), `popClave` (número), `popPalabra` (número), `preset` (número), `subida` (número), `tam`, `trazo` (número), `vaiven` (número), `ventanas` (lista) | — |
| `kinetic-quote` | `templates/kinetic-quote.html` | `aparicion` | `anchoMax`, `entrada` (número), `resaltar` (texto), `salida` (número), `tam` (número), `texto` (texto) | `texto` |
| `kinetic-type` | `templates/kinetic-type.html` | `aparicion` | `anchoMax` (número), `at`, `barridoEn`, `dur`, `flashEn` (lista), `palabras` (lista), `salida` (número) | — |
| `light-leak` | `templates/hf-light-leak.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `lower-third` | `templates/lower-third.html` | publica sus propios cues (clic, tic) | `bug` (texto), `conBug` (booleano), `entrada` (número), `escalonado` (número), `lado` (texto), `nombre` (texto), `rol` (texto), `salida` (número), `sinSonido`, `y` (número) | — |
| `mapa-calor` | `templates/mapa-calor.html` | `aparicion` | `celda`, `columnas` (lista), `entrada`, `escalonado`, `etiquetas`, `filas`, `foco`, `salida`, `sub` (texto), `titulo` (texto), `valores` | — |
| `marcos` | `templates/marcos.html` | publica sus propios cues (aparicion, clic, tic) | `alto` (número), `cps` (número), `desplazamiento` (número), `entrada` (número), `localhost`, `origen` (texto), `salida` (número), `sinSonido`, `tipo` (texto), `titular` (texto), `url` (texto) | — |
| `morph-text` | `templates/hf-morph-text.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `neural-node-pulse` | `templates/neural-node-pulse.html` | `escaner` | `entrada` (número), `halos` (número), `n` (número), `r` (número), `salida` (número), `viaje` (número), `x` (número), `y` (número) | — |
| `notification-pop` | `templates/notification-pop.html` | publica sus propios cues (clic) | `app` (texto), `entrada` (número), `hora` (texto), `icono` (texto), `permanencia` (número), `sub` (texto), `titulo` (texto), `venta`, `y` (número) | — |
| `odometro` | `templates/odometro.html` | publica sus propios cues (tic) | `desde` (número), `entrada` (número), `pie` (texto), `rigidez` (número), `rotulo` (texto), `salida` (número), `separador` (texto), `sinSonido`, `subida` (número), `sufijo` (texto), `tam` (número), `valor` (número) | — |
| `onda` | `templates/onda.html` | `aparicion` | `alto` (número), `barras` (número), `desde` (número), `entrada` (número), `etiqueta` (texto), `minimo` (número), `niveles` (lista), `salida` (número), `suelo` (número), `tasa` (número), `y` (número) | — |
| `padlock-unlock` | `templates/padlock-unlock.html` | `acierto` | `alza` (número), `escala` (número), `giro` (número), `salto` (número), `x` (número), `y` (número) | — |
| `pasos-flow` | `templates/pasos-flow.html` | publica sus propios cues | `entrada` (número), `escalonado` (número), `hueco` (número), `pasos` (lista), `salida` (número), `sinSonido`, `y` (número) | — |
| `pills` | `templates/pills.html` | `aparicion` | `align` (texto), `barrido` (número), `entrada` (número), `escalonado` (número), `items` (lista), `salida` (número), `sinSonido`, `y` (número) | — |
| `pip-frame` | `templates/pip-frame.html` | publica sus propios cues (clic, tic) | `apertura`, `contador`, `entrada`, `grosor`, `h`, `intensidadEq`, `label` (texto), `medidor`, `salida`, `sinSonido`, `w`, `x`, `y` | — |
| `poll-rating` | `templates/poll-rating.html` | publica sus propios cues (tic) | `entrada`, `escalonado`, `opciones` (lista), `paso`, `salida`, `sinSonido`, `subida`, `titulo` (texto) | — |
| `red-crash` | `templates/red-crash.html` | `fallo` | `alto` (número), `destellos` (número), `y` (número) | — |
| `rejilla-logos` | `templates/rejilla-logos.html` | `aparicion` | `columnas`, `elegido`, `entrada`, `escalonado`, `hueco`, `items` (lista), `lado`, `lockup`, `nota`, `salida`, `sub` (texto), `titulo` (texto), `vista` (texto) | — |
| `search-bar` | `templates/search-bar.html` | `aparicion` | `consulta` (texto), `cps`, `entrada`, `pulsacion`, `salida`, `sugEn`, `sugerencias` (lista), `y` | — |
| `security-pipeline-nodes` | `templates/security-pipeline-nodes.html` | publica sus propios cues (clic, fallo) | `celda`, `ciclo`, `entrada`, `fundido`, `lienzo`, `nodos` (lista), `rejilla`, `reparto`, `salida`, `sinSonido`, `titulo` (texto), `viaje`, `y` (número) | — |
| `split-versus` | `templates/split-versus.html` | publica sus propios cues (clic, deslizar, destello, impacto) | `a` (objeto), `b`, `barrido`, `entrada`, `espera`, `salida`, `sinSonido`, `vs`, `vsEn` | — |
| `stamp-banned` | `templates/stamp-banned.html` | `fallo` | `giro` (número), `nPolvo` (número), `tam` (número), `texto` (texto), `y` (número) | `texto` |
| `stroke-crossout` | `templates/stroke-crossout.html` | `clic` | `diagonal` (booleano), `grosor` (número), `tam` (número), `texto` (texto), `trazo` (número), `y` (número) | `texto` |
| `subtitles-showcase` | `templates/subtitles-showcase.html` | `aparicion` | `brillo` (número), `clave` (lista), `cuerpo` (número), `entrada` (número), `escalaTexto` (número), `escalonado` (número), `permanencia` (número), `pop` (número), `preset` (número), `texto` (texto), `viaje` (número), `vista` (texto) | `texto` |
| `svg-checkmark` | `templates/svg-checkmark.html` | `acierto` | `r` (número), `tam` (número), `texto` (texto), `x` (número), `y` (número) | — |
| `target-hud` | `templates/target-hud.html` | `escaner` | `division` (número), `entrada` (número), `giro` (número), `lectura` (texto), `r` (número), `salida` (número), `texto` (texto), `viaje` (número), `x` (número), `y` (número) | `texto` |
| `tarjeta-3d` | `templates/tarjeta-3d.html` | publica sus propios cues (deslizar, impacto, tic) | `cifra` (texto), `entrada` (número), `inclinacion` (número), `periodo` (número), `pie` (texto), `rotulo` (texto), `salida` (número), `sinSonido`, `titulo` (texto), `unidad` (texto) | — |
| `terminal` | `templates/terminal.html` | publica sus propios cues (acierto, fallo, tecleo) | `alto` (número), `cps` (número), `eje`, `entrada`, `lineas` (lista), `prompt` (booleano), `ruta` (texto), `salida`, `sinSonido`, `tam`, `titulo` (texto) | — |
| `text-stack-offset` | `templates/text-stack-offset.html` | `pop` | `copias` (número), `dx` (número), `dy` (número), `tam` (número), `texto` (texto), `y` (número) | `texto` |
| `timer-ring` | `templates/timer-ring.html` | `tic` | `desde` (número), `r` (número), `tam` (número), `vaciado` (número), `x` (número), `y` (número) | — |
| `transicion` | `templates/transicion.html` | `aparicion` | `cortes` (lista), `franjas` | — |
| `tweet-card` | `templates/tweet-card.html` | `aparicion` | `entrada`, `escalonado`, `metricas` (lista), `nombre` (texto), `red` (texto), `resaltar` (texto), `salida`, `sello` (texto), `subida`, `texto` (texto), `usuario` (texto), `verificado` (booleano) | `texto` |
| `whip-pan` | `templates/hf-whip-pan.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `yt-circle-pointer` | `templates/hf-yt-circle-pointer.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |
| `yt-feather-highlight` | `templates/hf-yt-feather-highlight.html` | publica sus propios cues | `cue`, `cueGain`, `encaje` (booleano), `escala`, `salida` (booleano), `sinSonido` | — |

La última columna ABORTA si viene vacía. Un micro-FX con ranura de
texto que no recibe copy rasteriza el de MUESTRA de su plantilla, y
nada lo avisa después: el PNG sale bien, el alfa es correcto y el
vídeo se compone. Medido sobre diez piezas ya montadas — se compuso
«NO» tachado mientras la voz decía «es completamente falso»,
«ELIMINAR» sobre la cara, «OBSOLETO» sellado sobre el flujo,
«PREMIUM» en la frente durante el cierre y «point at things», que es
la demo del bloque importado. Dura 1,3 s y nadie lo lee dos veces:
por eso se coló entero y por eso la puerta es un aborto y no un aviso.

Un `fx_id` fuera de esta tabla ABORTA. Dos micro-FX sobre la misma
`trigger_word` no se descartan: se escalonan 1,5 s o, si el acto no
da, se separan en el eje X (dx −260/+260) — y se dice. Repetir un
micro-FX en la pieza es una desviación que la auditoría señala (§15).

## Sonidos de banco (`sfx`)

El guion habla en nombres de fichero de banco; este repo SINTETIZA sus
efectos (`scripts/hacer_sfx.py`). La traducción es por intención — que
un golpe suene a golpe — y un nombre fuera de tabla ABORTA.

| nombre de banco | aquí suena | a qué suena |
|---|---|---|
| `appear.wav` | `aparicion` | entrada suave de un elemento |
| `error_buzz.wav` | `fallo` | negativo: algo se ha roto |
| `hud_lock.wav` | `tic` | trinquete del odómetro, uno por acarreo |
| `keyboard_fast.wav` | `tecleo` | una tecla, para terminal y code-mockup |
| `mouse_click.wav` | `clic` | clic breve para pastillas y tecleado |
| `music_bed.wav` | `cama` | cama armónica en bucle de 12 s: la pieza deja de no tener música |
| `notification.wav` | `notificacion` | aviso corto para notification-pop |
| `ping_success.wav` | `acierto` | positivo: lo que se pedía ha pasado |
| `pop.wav` | `pop` | burbuja para pastillas, comentarios y globos |
| `sparkle.wav` | `destello` | chispa para destellos a pantalla completa |
| `stamp_heavy.wav` | `impacto` | golpe seco para cortes y transiciones |
| `sub_drop.wav` | `subgrave` | presión grave para el cierre |
| `subscribe_reminder.wav` | `suscribir` | pulsar el botón de seguir y su confirmación |
| `tech_pulse.wav` | `escaner` | lectura de datos: mapa de calor, diagrama, nodos — cue de FRONTERA: si no casa con una capa, lo cubre el barrido automático del cambio de acto |
| `unlock_click.wav` | `clic` | clic breve para pastillas y tecleado |
| `whoosh.wav` | `barrido` | whoosh para barridos y persianas |
| `whoosh_rise.wav` | `riser` | subida de tensión antes de un corte — cue de FRONTERA: si no casa con una capa, lo cubre el barrido automático del cambio de acto |

## Posiciones (`position`)

`POS_*` **se informa y no se emite**: ninguna posición se traduce a
desplazamiento. Declara la intención y sale en el informe, y ahí se
acaba. Quien coloca es la plantilla —que maqueta para el lienzo
entero— y `colocar.py`, que mide el alfa real del gráfico contra el
rostro de esa ventana y afina `dy`. Es una vuelta atrás MEDIDA: un
`dx` fijo por posición sacó tres gráficos del cuadro (mockup 200 px,
terminal 190, sello 140) y encogerlos para que cupieran los clavó en
los ojos. Para llevar algo a un lado hay que diseñar la plantilla
estrecha, no empujar la ancha. Una posición fuera de tabla tampoco
aborta: se avisa, y el efecto es el mismo que el de una que sí está.

| `position` | desplazamiento emitido |
|---|---|
| `POS_CENTER` | ninguno (la plantilla ya centra) |
| `POS_MID_RIGHT` | ninguno (la plantilla ya centra) |
| `POS_MID_LEFT` | ninguno (la plantilla ya centra) |
| `POS_TOP_CENTER` | ninguno (la plantilla ya centra) |
| `POS_TOP_RIGHT` | ninguno (la plantilla ya centra) |
| `POS_TOP_LEFT` | ninguno (la plantilla ya centra) |

## Encuadres (`framing`) y modos de pantalla (`screen_mode`)

| `framing` | qué hace el pipeline |
|---|---|
| `FRAME_CLOSE_UP` | tramo de cámara con zoom 1.16 |
| `FRAME_LEFT` | sin zoom. El eje horizontal de cámara NO es expresable: el recorte sigue al rostro. Se informa y el acto sale a 1.0 |
| `FRAME_WIDE` | tramo de cámara a 1.0 (el plano tal cual) |
| `NONE` | tramo de cámara a 1.0 (el plano tal cual) |

Cada acto emite SIEMPRE su tramo de cámara, con o sin zoom: los tramos
se intersecan con el `keep` y un acto sin tramo se caería del montaje.

`screen_mode`:

- **`MODE_A_ROLL`** — el gráfico va SOBRE el metraje y se aparta del
  rostro (`colocar.py`).
- **`MODE_FULL_MOTION`** — el gráfico HACE de pantalla: se emite
  `templates/fondo.html` (la única plantilla opaca) debajo, cubriendo
  el acto entero; el gráfico dura el acto y lleva `colocar=False` —
  sobre fondo opaco no hay rostro del que apartarse.

## Reglas que ABORTAN (exit ≠ 0)

El exit code es la única señal que ve un guionista automatizado, así
que ninguna de estas falla en silencio:

1. **Acto con menos del 25 % de palabras literales** contra la
   grabación. `difflib` empareja SIEMPRE —dos textos sin nada en común
   devuelven un `replace` de uno contra el otro—, así que la puerta no
   es que haya emparejamiento sino cuánto es LITERAL. Sin ella, el
   guion de OTRA toma produce un plan con buena pinta y los anclajes
   en sitios arbitrarios.
2. **`visual_trigger.name` fuera de la tabla de componentes.**
3. **`micro_fx[].fx_id` fuera de la tabla de micro-FX.**
4. **`sfx` fuera de la tabla de sonidos.** Un cue mal escrito
   desaparecía sin una línea de log; ahora revienta con la lista de lo
   que sí hay.
5. **Con `--escribir`: `lint_config.py --estricto` sobre el plan.**
   Una clave de `config` que la plantilla no lee es error, no aviso —
   ver el incidente del texto de muestra sobre la cara.

Lo demás se INFORMA en el listado de reconciliación (stdout), una
línea por decisión: sustituciones de palabra, cues sin capa, material
improvisado sin guion, duraciones alargadas por contenido.

## Lo que el pipeline NO sabe hacer

Se declara en vez de fingirse: el eje horizontal de CÁMARA
(`FRAME_LEFT` — el recorte sigue al rostro) se informa y la pieza
sale sin él. DESCARGAR de la red tampoco se hace, pero `media_fetch`
ya no muere en el informe: se resuelve contra lo que hay en
`assets/broll/`, y lo que falte se baja A MANO según
`guiones/MEDIA.md` — el manifiesto de qué fichero es cada media, de
dónde se baja y con qué licencia.

