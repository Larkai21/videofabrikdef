# editor-youtube

Pipeline **determinista** de edición vertical (1080×1920) para Apple Silicon.
De un `.mp4` en bruto sale un Reel montado: transcripción local con Whisper,
motion graphics rasterizados en Chromium, color por LUT 3D y sonido
sintetizado. Todo en la máquina salvo los B-Rolls, que son opcionales.

Determinista significa literalmente eso: **mismas entradas → mismos
fotogramas**. Las animaciones no leen el reloj del navegador —se posicionan con
`seek(t)` y se fotografían— y no hay un solo `Math.random()` en las 182
plantillas.

---

## Qué hace falta

| | |
|---|---|
| Sistema | macOS en Apple Silicon (MLX usa Metal) |
| Python | **3.12** — MLX no publica ruedas para 3.14 |
| Node | 20 o superior |
| ffmpeg | el de Homebrew, con `lut3d`, `libx264` y `aac` |
| Disco | ~2 GB entre dependencias, navegador y modelo |

Lo que **no** hace falta: una clave de API. Sin `GEMINI_API_KEY` se omiten los
B-Rolls generados y el vídeo sale igual.

> Este ffmpeg **no trae `libass` ni `libfreetype`**, así que no puede dibujar
> texto. No es un problema: todo el texto llega ya rasterizado desde Chromium.

---

## Instalación

Esto es lo único que no estaba escrito en ninguna parte: la secuencia vivía
repartida entre `package.json`, `requirements.txt`, el `Makefile` y
`CLAUDE.md`, y nadie la había juntado.

```bash
git clone <url> editor-youtube && cd editor-youtube

python3.12 -m venv .venv
make instalar-pipeline      # requirements.txt + npm + chromium + el .cube
make instalar               # el arnés de pruebas
make hooks                  # los ganchos de git. Una vez POR CLON: git no los
                            # activa solo, y uno sin activar no protege nada.

# Opcional: exponer scripts/ como el paquete `editor` para consumirlo desde
# otro repo (import editor.reloj, editor.mezcla, editor.escaleta…). No mueve
# ningún fichero y los scripts siguen funcionando igual que siempre.
.venv/bin/pip install -e .

# Las fuentes de marca. Sin ellas todo cae a las del sistema: funciona, pero
# no es la identidad.
brew install --cask font-plus-jakarta-sans font-geist font-geist-mono \
                    font-inter font-jetbrains-mono font-instrument-serif \
                    font-playfair-display font-montserrat font-yellowtail

make rapido                 # < 3 s. Si esto no está verde, falta algo.
```

---

## Uso

### Ver el catálogo sin montar nada

La vía más rápida para entender qué hay aquí. No necesita metraje ni claves.

```bash
node scripts/hoja_contactos.js   && open build/hoja/    # 61 fichas × 2 temas
node scripts/galeria.js && python3 scripts/galeria_video.py
```

La **hoja de contactos** congela un instante de cada plantilla: sirve para
juzgar composición y color. La **galería** las enseña en movimiento, que es lo
único que juzga de verdad una plantilla de motion — una entrada que llega tarde
o un texto que se lee a medias no se ven en una captura.

### Montar una pieza

Siete pasos. El porqué de cada uno está en
[`CLAUDE.md`](CLAUDE.md#comandos-rápidos), que es el manual de operación.

```bash
python3 scripts/transcribe_mlx.py --input input.mp4   # 1 · Whisper local
python3 scripts/clean_transcript.py                   # 2 · limpieza
python3 scripts/detect_face_bbox.py --input input.mp4 #     rostro y zonas
python3 scripts/plan_codex.py                         # 3 · ESCRIBIR EL PLAN
#   ...o, con guion de dirección en JSON — la vía normal cuando hay guion:
python3 scripts/leer_guion.py guiones/<pieza>.json --escribir
python3 scripts/silencios.py --aplicar                # 4 · quitar silencios
python3 scripts/validar_plan.py build/plan.json       # 5 · validar (barato)
node scripts/render_playwright.js --plan build/plan.json
python3 scripts/composite_ffmpeg.py --lut assets/luts/carbon_bronze.cube
```

> El paso 3 **escribe el plan** y sin él los demás no tienen qué leer. Faltaba
> de la lista de comandos durante meses, y por eso el orden roto parecía el
> canónico. Si hay guion de dirección, la vía normal es `leer_guion.py`: el
> formato del guion está en [`docs/guion-ejemplo.md`](docs/guion-ejemplo.md) y
> su paleta de disparadores en [`guiones/PALETA.md`](guiones/PALETA.md).

### El arnés

```bash
make ayuda
```

| nivel | qué corre | coste |
|---|---|---|
| `lint` | plan × plantillas, relojes y **monotonía del catálogo** | < 1 s |
| `pruebas` | unitarias y contratos, sin navegador — 30 **sí** usan ffmpeg | ~ 5 s |
| `comprobar` | los artefactos reales de `build/` | ~ 0,2 s |
| `rapido` | los tres anteriores | ~ 6 s |
| `render` | + las 182 plantillas en Chromium y los goldens | ~ 35 s |
| `lento` | + la cadena completa con ffmpeg | ~ 40 s |
| `sonido` | la tabla de señales medida contra la voz | ~ 1 s |
| `escuchar` | fichas de escucha: sin el efecto / con él / +6 dB | ~ 10 s |
| `oro` | **regenera** los goldens. Nunca automático | — |

`rapido` tiene que quedar en segundos o dejará de ejecutarse, y un arnés que no
se ejecuta no protege nada. Los seis de hoy son casi todos de `pruebas`, y
están medidos: la fila decía «< 0,2 s / sin ffmpeg» y las dos mitades eran
falsas. Vuelve a medirlo con `/usr/bin/time -p make rapido` antes de creerte
este número.

### Los ganchos y el CI

El arnés protege a quien lo ejecuta. Los ganchos y el CI son lo que hace que se
ejecute.

```bash
make hooks     # apunta core.hooksPath a scripts/hooks/. Una vez por clon.
```

| cuándo | qué corre | coste |
|---|---|---|
| **pre-commit** | techo de 2 MB por blob —y rutas sin espacios, que es lo que lo hace medible— y nada de `.mp4`/`.mov`/`.m4a` fuera de `tests/fixtures/` | 0,05 s |
| **pre-push** | `make rapido` entero | ~ 6 s |
| **CI** (GitHub Actions, en cada *push* a `main` y en cada PR) | `make PY=python ci` sobre un clon limpio de Ubuntu | ~ 1 min |

El reparto no es arbitrario: es el presupuesto. Un gancho que se hace esperar se
salta con `--no-verify`, y a la tercera vez se salta siempre — llevándose por
delante también a la comprobación barata que tenía al lado. Por eso el
pre-commit solo mira lo que, **una vez en la historia, ya no sale con un
commit**: `git rm` quita del árbol de trabajo, no del objeto. El techo de 2 MB
está calibrado sobre el mayor fichero versionado de hoy
(`assets/sfx/cama.wav`, 1,1 MB), no elegido a ojo, y se mide el blob del
ÍNDICE, que es lo que de verdad entra en el commit.

El CI hace lo único que un gancho local no puede: correr sobre un **clon
limpio**, donde no hay `.venv`, ni `build/`, ni las fuentes de esta máquina. Por
eso `ci` es un nivel más corto que `rapido` —`lint_config.py` lee un plan que en
un clon no existe, y los goldens tipográficos dependen de fuentes que el runner
no tiene—. Un CI que falla al azar se desactiva, y se lleva por delante a las
pruebas buenas.

Lo que sí necesita es **ffmpeg**, y ahí nacía rojo: el runner de Ubuntu no lo
trae y 30 pruebas del nivel rápido lo usan —la marca `ffmpeg` sirve para
seleccionarlas, no para excusarlas—. Compruébalo sin salir de esta máquina:

```bash
FFMPEG_BIN=/no/existe FFPROBE_BIN=/no/existe make pruebas   # las que lo usan, en rojo
```

El workflow lo instala por `apt` y publica su ruta en `FFMPEG_BIN` y
`FFPROBE_BIN`. Los sitios que localizan ffmpeg comparten hoy UNA resolución
—la de `comun.py` (y su espejo `comun.js`): variable de entorno, luego
`PATH`, luego el respaldo de Homebrew—, así que el runner funcionaría
incluso sin la variable. Se mantiene como palanca porque manda SIEMPRE,
también apuntando a la nada: es lo que hace posible la línea de arriba,
apagar ffmpeg a propósito para ver en rojo a las que lo usan.

**Si el CI no arranca**, mira la facturación de la cuenta de GitHub antes que el
YAML: con un pago rechazado, Actions deja de encolar runs y el aviso —«recent
account payments have failed»— sale en la pestaña *Actions*, no en el pull
request. No hay nada que arreglar en el repo; mientras tanto, el clon limpio es
lo único que deja de comprobarse, y los ganchos siguen corriendo.

---

## El mapa

```
input.mp4
   ├─ transcribe_mlx.py ──> build/transcript.json
   ├─ clean_transcript.py > build/timeline.json     keep[] words[] blocks[]
   ├─ detect_face_bbox.py > build/face.json         zones[] con y_ui
   ├─ plan_codex.py ──────> build/plan.json         las capas y sus tiempos
   ├─ render_playwright ──> build/frames/<capa>/    + build/layers.json
   └─ composite_ffmpeg ───> renders/final_output.mp4
```

`build/` y `renders/` son **desechables**: se regeneran desde `input.mp4`.

### Los scripts, por fase

| | |
|---|---|
| **transcripción** | `transcribe_mlx.py` · `clean_transcript.py` · `alinear_guion.py` · `narrar.py` |
| **análisis** | `detect_face_bbox.py` · `comprobar_fuentes.py` · `extraer_niveles.py` |
| **plan** | `dirigir.py` (automático) · `leer_guion.py` (guion de dirección) · `plan_codex.py` (a mano) · `silencios.py` · `colocar.py` |
| **render** | `render_playwright.js` · `hoja_contactos.js` · `galeria.js` · `mapa_desplazamiento.js` |
| **composición** | `composite_ffmpeg.py` · `galeria_video.py` · `make_lut.py` · `hacer_sfx.py` · `generate_google_assets.py` |
| **comprobación** | `validar_plan.py` · `lint_config.py` · `auditar_estilo.js` · `humo_plantillas.js` · `comprobar_{reloj,relojes,alfa,montaje,contratos,docs}.py` · `comprobar_movimiento.js` · `comprobar_eje.js` · `comparar_fotogramas.py` · `banco_sonido.py` · `oro.py` |
| **módulos** *(se importan, no se ejecutan)* | `reloj.py` · `mezcla.py` · `escaleta.py` · `contratos.py` · `comun.py` |

Los cinco últimos **no son pasos**: son bibliotecas. `reloj.py` es el contrato
origen→salida, `mezcla.py` el grafo de audio, `escaleta.py` el andamio para
escribir planes a mano.

Y tres de los de comprobación **necesitan navegador y comparan PÍXELES**, no
texto, porque hay fallos que no se ven de ninguna otra forma:
`humo_plantillas.js` (¿se ve algo?), `comprobar_movimiento.js` (¿se mueve
durante toda la capa, o el gesto se agota a mitad?) y `comprobar_eje.js` (¿el
peso variable que la plantilla anima mueve un píxel, o la ha emparejado CSS con
una cara estática que no tiene ejes?). Los tres van en `make render`.

---

## Cómo leer la documentación

Cuatro documentos y un contrato entre ellos. Sin él vuelven a solaparse.

| Documento | Qué es | Nunca contiene |
|---|---|---|
| **`README.md`** | la puerta: instalar, ejecutar, encontrar las cosas | trampas de operación, normas visuales |
| **[`CLAUDE.md`](CLAUDE.md)** | el manual de operación: pasos, contratos entre etapas, la regla del reloj, las trampas que muerden | instalación, aspecto |
| **[`BRAND_RULES.md`](BRAND_RULES.md)** | la norma visual, **vinculante** | comandos, arquitectura |
| **[`ROADMAP.md`](ROADMAP.md)** | la bitácora, *append-only* | el estado presente |

La última fila no es retórica. `ROADMAP.md` describe el pasado, así que sus
números viejos son **correctos**: un recuento de plantillas escrito en la
entrada de un sprint antiguo dice la verdad sobre aquel momento. Por eso queda fuera del
comprobador de documentación.

---

## Determinismo, y dónde acaba

Mismo `seek(t)` → mismo píxel. Lo sostienen tres reglas:

- las plantillas registran `{duration, setup, draw}` y **no usan el reloj del
  navegador**;
- **cero `Math.random()`**: el ruido determinista es `Engine.noise(i, semilla)`;
- los tiempos de `timeline.words` y `blocks` van **siempre** en el reloj del
  vídeo original, y `keep` es el único registro de la traducción a salida.

Lo que **no** es reproducible bit a bit: los píxeles de un render multicapa a
25 fps. Se midió y está cerrado en el ROADMAP; a 5 fps sí lo es, que es por lo
que el arnés lento renderiza a esa frecuencia.

---

## Estado

182 plantillas de motion · 21 efectos de sonido sintetizados ·
837 pruebas en el nivel rápido. La cola de trabajo vive en
[`ROADMAP.md`](ROADMAP.md).

## Licencia

Copyright (c) 2026. Todos los derechos reservados.

Los `.cube`, los `.wav` y el mapa de desplazamiento son **derivados generados
por los scripts de este repo**, no material de terceros. Las fuentes no se
distribuyen: se instalan por Homebrew.
