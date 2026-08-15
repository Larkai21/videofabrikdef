# Local Tech Video Editor Pipeline (M4 Pro & Google GenAI)

## Contexto

Sistema de edición de vídeo vertical (1080×1920) **automatizado y
determinista**. El procesamiento pesado corre en local sobre Apple Silicon;
solo la generación de B-Rolls sale a la red.

Determinista significa literalmente eso: mismas entradas → mismos frames.
Las animaciones no usan el reloj del navegador y no hay `Math.random()` en
ninguna plantilla.

Las normas visuales viven en **`BRAND_RULES.md`** y son vinculantes.

---

## Comandos rápidos

```bash
# 1. Transcribir y filtrar A-Roll (local, GPU)
python3 scripts/transcribe_mlx.py --input input.mp4
python3 scripts/clean_transcript.py

# 2. Detectar rostro y calcular zonas seguras de UI
python3 scripts/detect_face_bbox.py --input input.mp4

# 3. Generar assets visuales con Google GenAI
python3 scripts/generate_google_assets.py --timeline build/timeline.json

# 3b. Comprobar los clips de origen: rotación, formato, coherencia
python3 scripts/comprobar_fuentes.py assets/aroll

# 3c. ESCRIBIR EL PLAN. Sin este paso no existe build/plan.json y los tres
#     siguientes no tienen nada que leer. Faltaba en esta lista, y por eso
#     el orden roto parecía el canónico.
python3 scripts/dirigir.py --transcript build/transcript.json   # automático
#   o la escaleta de la pieza, que es lo que se usa cuando hay guion:
python3 scripts/plan_codex.py                                   # a mano
#   o el guion de dirección en JSON, que es la vía normal cuando hay guion:
python3 scripts/leer_guion.py guiones/codex-security.json --escribir

# 3d. Quitar silencios y REMAPEAR todo el reloj (va antes de renderizar)
python3 scripts/silencios.py --timeline build/timeline.json --plan build/plan.json --aplicar

# 4. Validar el plan ANTES de renderizar (barato; renderizar y descubrirlo, no)
python3 scripts/validar_plan.py build/plan.json --duracion 22.98

# 4b. Todo el nivel rápido de una vez: lint, unitarias y contratos. 0,5 s.
make rapido

#     Y por separado, si hace falta:
python3 scripts/lint_config.py         # claves muertas y colisiones
python3 scripts/comprobar_relojes.py   # ¿alguna clave de tiempo sin clasificar?
python3 scripts/comprobar_reloj.py     # las cinco medidas del reloj
python3 scripts/comprobar_contratos.py # los JSON de build/ cumplen su contrato

# 5. Renderizar secuencias de motion con Playwright
node scripts/render_playwright.js

# 6. Comprobar el canal alfa antes de componer (0,7 s; el fallo cuesta minutos)
python3 scripts/comprobar_alfa.py

# 6b. ¿Son plan, manifiesto y fotogramas del MISMO montaje? build/ es
#     compartido entre piezas y nada lo comprobaba.
python3 scripts/comprobar_montaje.py

# 6c. Colocación: choques con el rostro y solapes entre gráficos
python3 scripts/colocar.py --plan build/plan.json --aplicar

# 6d. La mezcla, medida: sonoridad, techo, dinámica, valles y capas sin cue.
#     La última pieza llevó cuatro golpes en mudo y ningún log lo dijo.
python3 scripts/comprobar_sonido.py

# 6e. El RITMO: cada cuánto entra algo nuevo. Reels y Shorts piden un
#     estímulo cada 2-3 s; en la última pieza el 75,8 % transcurre en
#     ventanas de más de 3,5 s sin ninguna entrada, la mayor de 10,87 s.
#     Cruza además las pausas de voz de la mezcla con esas ventanas: voz
#     parada + pantalla quieta es el momento exacto de abandono.
python3 scripts/comprobar_ritmo.py

# 6f. Zona segura de plataforma: qué gráficos quedan DEBAJO del caption, el
#     avatar y el CTA que pinta la app. Avisa, no mueve (BRAND_RULES §18).
python3 scripts/colocar.py --plan build/plan.json --plataforma reels

#     Y de dónde salen esas fracciones: se MIDEN con dos capturas de
#     teléfono de reels DISTINTOS (la interfaz es lo único que coincide).
python3 scripts/medir_zona_segura.py capturas/reels_*.png --plataforma reels

# 7. Ensamblar con LUT y audio. El `--lut` va EXPLÍCITO: sin él no hay grado.
#    Por defecto el compositor no aplica ninguno — el grado es el de ESTA
#    marca, y sobre material ajeno es una alteración que nadie ha pedido.
#    Llegaba por la puerta de atrás: `solo_subs.py` no lo pasaba, su
#    comentario decía «sin LUT» y cuatro clips de un cliente salieron
#    graduados. Medido contra el original en la zona sin subtítulo: 30,6 dB
#    de PSNR con el LUT puesto, 44,2 dB sin él.
python3 scripts/composite_ffmpeg.py --lut assets/luts/carbon_bronze.cube

# 8. La PORTADA. Sin este paso la enseña la plataforma, y es el fotograma 0.
python3 scripts/portada.py --input renders/codex-s4.mp4
python3 scripts/portada.py --input renders/codex-s4.mp4 --detalle   # la tabla

# 9. Y la OTRA entrada: un guion con `hooks` no es una pieza, son DIEZ.
#    Se graban los cinco ganchos seguidos y el cuerpo detrás, en UNA toma;
#    cada pieza reclama su gancho y el cuerpo, y los otros cuatro se caen.
python3 scripts/piezas.py guiones/idea.json                  # qué saldría
python3 scripts/piezas.py guiones/idea.json --montar -j 3    # las diez
python3 scripts/piezas.py guiones/idea.json --montar --solo H3B
```

El paso 9 cambia lo que significa `build/`: deja de ser un montaje y pasa a
ser la FUENTE que las diez comparten —el timeline limpio y el rostro—, porque
cada pieza trabaja en `build/piezas/<id>/` a través de `EDITOR_BUILD`. Se copia
y no se enlaza porque `silencios.py --aplicar` REESCRIBE el timeline al
remapear el reloj: con enlaces, la primera pieza en terminar le cambiaría el
reloj a las otras nueve y ninguna daría error.

Consecuencia directa: **el arnés hay que apuntarlo a una pieza**, porque en
`build/` ya no hay plan que mirar. La misma variable que aísla un montaje lo
selecciona:

```bash
EDITOR_BUILD=build/piezas/H3B make rapido
EDITOR_BUILD=build/piezas/H3B python3 scripts/comprobar_ritmo.py
```

Tres a la vez y no diez: cada pieza abre su Chromium y rasteriza miles de
fotogramas, así que el techo es la memoria y no los núcleos.

Y una cosa que **no** hace sola, aunque lo pareciera: tirar los otros cuatro
ganchos. `escaleta.plano()` ENCADENA —el hueco entre un tramo de cámara y el
siguiente se rellena, porque entre dos actos hay una respiración y cortarla
deja la voz pegada—, así que la primera pieza salió de 78,7 s con los cinco
ganchos seguidos y ninguna etapa dio error. Lo que los tira es
`metadata.descartar_no_reclamado`, que `piezas.py` pone en el guion que
sintetiza: con él, un hueco que contenga PALABRAS que ningún acto reclama
rompe la cadena. Se declara y no se mide porque el umbral que separaría un
gancho de una respiración es un número inventado — en la pieza de Codex ese
hueco son tres palabras que sí deben quedarse.

El paso 3b existe por un error caro: unos clips venían codificados
3840x2160 con **rotación de 90°** —o sea verticales— y montarlos como 16:9
aplastó la imagen. `width`/`height` son las dimensiones CODIFICADAS; las de
pantalla salen de aplicarles la rotación, y ffmpeg sí la aplica al
decodificar. Quien no la mira es quien lee el metadato a mano.

`leer_guion.py` toma el guion de dirección —actos, disparadores, copy de
tarjeta, palabras en azul, SFX— y lo cruza con lo que de verdad se grabó. Su
trabajo no es traducir: es **no callarse**. El guion describe la pieza que se
quería grabar y `timeline.json` la que salió, y nunca son la misma, así que
alinea las dos con `difflib` y saca por pantalla cada divergencia. En la pieza
de Codex fueron dieciocho, y dos cambian lo que se ve: el guion pedía azul
sobre «arquitectura» y sobre «asegurar», y en el audio se oye «compilación» y
«proteger». Las sustituye por posición y lo dice; resaltar una palabra que no
se pronunció es imposible y dejarla caer en silencio pierde el énfasis.

Tres cosas más que no acepta:

- **Los segundos del guion no mandan.** `start_sec` es intención; los anclajes
  van a la PALABRA, así que volver a transcribir mueve el plan con ella. En
  esta pieza el acto 3 se grabó 4,3 s antes de su marca.
- **Un guion de otra toma revienta.** `difflib` empareja siempre —sobre dos
  textos sin nada en común devuelve un `replace` de uno entero contra el otro—,
  así que la puerta no es que haya emparejamiento sino que al menos el 25 % de
  cada acto sea literal. Sin eso, el guion equivocado produce un plan con buena
  pinta y todos los anclajes en sitios arbitrarios.
- **Un nombre fuera de tabla para el montaje.** Los SFX del guion son ficheros
  de banco (`stamp_heavy.wav`) y aquí se sintetizan (`impacto`); un cue mal
  escrito desaparecía sin una línea de log.

Lo que el pipeline no sabe hacer se declara en vez de fingirse: el eje
horizontal, tanto el de CÁMARA (`FRAME_LEFT` — el recorte sigue al rostro)
como el de las CAPAS. `POS_*` **se informa y no emite desplazamiento**: la
tabla `POSICIONES` está vacía a propósito, y es una vuelta atrás medida —un
`dx` fijo sacó tres gráficos del cuadro (200, 190 y 140 px) y encogerlos
para que cupieran clavó el mockup en los ojos—. Quien coloca es la
plantilla, que maqueta para el lienzo entero, y `colocar.py`, que mide el
alfa contra el rostro; para llevar algo a un lado hay que diseñar la
plantilla estrecha, no empujar la ancha.

`MODE_FULL_MOTION` y `media_fetch` sí salieron de esa lista: cada acto
full-motion emite `fondo.html` de lienzo opaco bajo su gráfico, y los
media se resuelven EN
LOCAL — descargar sigue sin hacerse, pero el acto declara `media_local`
anclado a la PALABRA, el slug de `media_fetch` se casa por tokens contra los
ficheros de `assets/broll/`, y las escenas salen a broll_plan en reloj de
ORIGEN, sellado SIEMPRE (vacío incluido) para que el de otra pieza no
sobreviva en build/. Qué fichero es cada media, de dónde se baja y con qué
licencia: `guiones/MEDIA.md` — los media no se versionan.

El contrato completo del guionista —esquema del JSON, componentes, sonidos,
posiciones y reglas que abortan— es `guiones/CONTRATO.md`, GENERADO desde
las tablas por `scripts/contrato_guion.py` (nunca a mano: la puerta de
`comprobar_docs.py` falla si diverge).

Un **micro-FX con ranura de texto que no recibe copy ABORTA**, y la puerta se
puso tarde: una tarjeta sin copy canta en la revisión —sale el titular de otra
pieza— pero un gesto dura 1,3 s y nadie lo lee dos veces, así que se coló
entero. Medido sobre diez piezas ya montadas: «NO» tachado mientras la voz
decía «es completamente falso», «ELIMINAR» sobre la cara, «OBSOLETO» sellado
sobre el flujo de los cuatro momentos, «PREMIUM» en la frente durante el
cierre, y «point at things» / «the thing» / «underline the point», que es la
demo de los bloques importados tal cual. Ninguna etapa se quejó. Qué ranura
exige cada uno está en la última columna de la tabla de micro-FX de
`guiones/CONTRATO.md`, LEÍDA de la plantilla y no de una lista a mano — una
lista envejece y esto no.

Y una consecuencia de composición que no es del guion sino del plano:
`colocar.py` aparta los gráficos del rostro empujándolos a la banda libre más
ancha, que en un plano cerrado es la de ARRIBA — que es donde va la tarjeta.
Así que un micro-FX anclado a una palabra que se dice MIENTRAS la tarjeta está
en pantalla acaba encima de ella por construcción; en la pieza de sesgos
pasaba en tres actos de siete. Se ancla a una palabra posterior a la salida de
la tarjeta, no se empuja más.

El copy de tarjeta entra por una tabla, `COPY`, porque cada plantilla llama a
su ranura de otra forma —`titular` en una prensa, `titulo` en un diagrama— y
`code-mockup` no tiene ninguna: lleva código. Sin esa tabla el fallo es mudo:
`headline-clipper` recibió `titulo`, lo ignoró y rasterizó **su texto de
muestra** sobre la cara sin un aviso en ningún log. Lo que la plantilla
necesita y el guion no modela va en `visual_trigger.config` (o `micro_fx[].
config`), que se pasa tal cual — así el guion no tiene que conocer 57
plantillas.

El paso 3c va **entre el director y el renderizador**, nunca después.
Remapear el plan una vez renderizado no basta y falla sin dar ningún error:
una tarjeta aguanta el cambio de reloj porque su contenido no varía
mientras dura, pero los subtítulos cinéticos llevan grabado en cada
fotograma qué palabra toca en cada instante del reloj VIEJO. Con el reloj
comprimido un 6 % se leía «ESPACIO LATENTE» mientras se oía «desde la
primera capa».

El silencio se mide en el AUDIO con `silencedetect`, no en los huecos entre
palabras de Whisper: Whisper alarga la última palabra de cada frase hasta
el siguiente ataque, así que por sus tiempos casi no hay huecos. La
transcripción se usa solo para NO cortar dentro de una palabra, y
estimando la duración real por longitud —el final que da Whisper no vale
para eso—.

El paso 6b mide el área real de cada gráfico —por su canal ALFA, no por lo
que declare su plantilla— y la contrasta con la zona del rostro en ESA
ventana de tiempo. Propone el desplazamiento mínimo hacia la banda libre
más amplia, sin salirse del lienzo. Con `--aplicar` lo escribe en el plan y
en el manifiesto: `dy` es de composición, así que no hace falta
re-renderizar.

El paso 6 mira la cabecera IHDR de cada PNG: si una secuencia mezcla
formatos, ffmpeg reconfigura el grafo a mitad y **el archivo sale truncado
sin un solo error en el log**.

El paso 8 elige la portada MIDIENDO. Es el último sitio donde este repo
dejaba una decisión al azar: la plataforma enseña el fotograma 0 mientras
nadie le dé otro, y el fotograma 0 de la pieza de Codex es el más borroso de
todo el arranque —varianza del laplaciano 184 contra 2132 de la mejor
candidata— con el primer gráfico entrando en 0,55 s, o sea una cara a medio
gesto. Se puntúan las candidatas de los primeros segundos por nitidez,
contraste, tamaño de la franja de ojos y boca, y un castigo si hay un gráfico
a medio fundir, que se lee como un error de render. El resultado sale a
`renders/<pieza>-portada.jpg`, a 1080x1920 y por debajo de medio mega; con
`--detalle` se ve la tabla entera y con `--titular`, solo los instantes en
que una tarjeta con copy está asentada.

**No dibuja texto, y no le hace falta.** Este ffmpeg no trae `libfreetype`,
así que un `drawtext` no daría un rótulo feo: no daría nada. Y el titular ya
está en el fotograma, rasterizado por Playwright desde una plantilla del
catálogo en el mismo render que produjo la pieza; lo único que hace
`--titular` es preferir ese instante.

Dos cosas que aprendió a la primera pasada, las dos por mirar el JPEG y no
el JSON: `face.json` describe el A-ROLL, así que donde hay B-Roll no hay
rostro que medir —la primera portada fue un plano de archivo de un centro de
datos con «rostro 1,00» encima— y los tiempos del plan y de `broll_plan.json`
solo valen si son de ESTE montaje, que se comprueba contra la duración del
vídeo antes de castigar a nadie con los tiempos de otra pieza.

> **`build/` es un symlink a `build.nosync/`.** El repo vive en
> `~/Documents`, que iCloud sincroniza, y iCloud **no sincroniza `*.nosync`**.
> Todo pasa por la ruta `build/`, así que el pipeline funciona exactamente
> igual; en un clon nuevo se recrea con `mkdir build.nosync && ln -s
> build.nosync build` (y si no se hace, `comprobar_montaje.py` avisará). El
> porqué, medido antes del symlink: iCloud creaba copias de conflicto
> (`00140 3.png`) —llegaron a contarse **185 PNG y 3 JSON de conflicto en un
> solo build**— y desalojaba el contenido de los fotogramas, así que cada
> lectura bloqueaba segundos descargando. El compositor no se veía afectado
> porque lee con patrón `%05d.png` e ignora esos nombres, pero cualquier
> herramienta que recorriera `*.png` se arrastraba.

El paso 4 atrapa los fallos que **no dan error al renderizar**: capas fuera
de `ORDEN` (se descartan en silencio), tiempos relativos escritos en
absoluto, capas que empiezan después del final, solapes en un mismo carril y
huecos sin gráficos. Devuelve 1 si hay errores.

Sistema de temas y liquid glass: **`BRAND_RULES.md` §7-§10**. El tema se
pide por capa con `config.tema` (`carbon` | `paper`).

Una capa puede pedir **dos pasadas de render** con `cristal: true` o con
`cortinilla: true`. Es el mismo mecanismo —la plantilla emite una silueta y
ffmpeg trata con ella una región del metraje— y dos tratamientos distintos:
el cristal difumina una copia de lo que ya hay; la cortinilla de
`antes-despues.html` revela otra cosa por debajo. Declarar las dos en la
misma capa no tiene sentido y el compositor no lo hace.

Lo normal es que la cortinilla revele una **imagen**:

```json
{ "capa": "antesdespues", "template": "antes-despues.html",
  "t": 12.0, "duracion": 5.0, "cortinilla": true,
  "imagen": "assets/broll/auditoria_antes.png",
  "config": { "duration": 5.0, "hasta": 0.64,
              "antes": "LO QUE ENCONTRÓ", "despues": "LO QUE HICE" } }
```

Sin `imagen` revela el propio metraje **sin LUT**. Suena mejor de lo que es:
con el grado de marca ese revelado **no se ve** —cambia la imagen un 2 %,
porque la cámara ya entrega S-Cinetone—, así que solo sirve con un look
fuerte. Y entonces sí necesita `--lut` y `--aroll completo`; con `imagen`
ninguno de los dos hace falta. En todos los casos avisa y omite el revelado
en vez de componer algo que parece funcionar. Detalles en **§17**.

Y el camino CORTO, para cuando lo que se pide son subtítulos y nada más
—material de otro, un clip de cliente—:

```bash
python3 scripts/solo_subs.py --input clip.mp4 --acento '#E5789F' \
                             --claves novia,éxito
```

**El caso de uso entero está en `docs/captions.md`**: qué motor manda
(`templates/kinetic-captions.html`, y no hay otro), el estilo tal como está
escrito, la historia del acento —amarillo → bronce → azul `#6FA0D6` en `38bcf0f`
→ rosa por plan— y por qué `tam` no agranda nada cuando el ajuste al `anchoMax`
ya ha entrado. Se escribió porque este caso se ha reimplementado desde cero más
de una vez, deduciendo a ojo un estilo que ya estaba en el repo.

Respeta los **fps del origen** y no los 30 del pipeline. Imponerlos remuestrea:
cuatro clips a 24 salieron a 30, o sea 240 fotogramas convertidos en 300
duplicando uno de cada cuatro. En una imagen quieta no se ve; en movimiento es
un tirón por segundo, y al recomprimir el codificador reparte bits distintos
entre fotogramas idénticos — la suciedad que se veía en pantalla. Y codifica a
CRF 14 con preset `slower`, no a los 17 de siempre: aquí la única capa es
texto sobre metraje que NO se toca, así que todo lo que el codificador tire es
pérdida pura contra el original.

Medido sobre el mismo fotograma contra el original, en la zona sin subtítulo:
**30,6 dB** de PSNR con LUT y 30 fps · **44,2** sin LUT a 30 fps · **46,3** sin
LUT, a 24 fps y CRF 14.

No pasa por `clean_transcript.py` a propósito: ese paso quita silencios y
tomas falsas, o sea REEDITA, y sobre el material de otro eso no es una mejora
sino una decisión que nadie ha pedido. `keep` es el clip entero y el vídeo que
sale dura exactamente lo que entró. Tampoco aplica el LUT de marca ni detecta
rostro. `--acento` existe porque la palabra con carga va en `--accent`, que es
el azul de ESTA marca: en una pieza ajena ese azul es el error, y cambiar de
tinta no debería costar cambiar de estilo entero (que es lo que hace un
`preset`). El filete de bronce se va con él — el bronce es la marca de esta
marca, y bajo una palabra rosa son dos colores peleándose.

```bash
node scripts/hoja_contactos.js            # las 61 fichas x 2 temas
node scripts/galeria.js                   # el catálogo EN MOVIMIENTO
python3 scripts/galeria_video.py          # ...montado, con los 21 sonidos
node scripts/mapa_desplazamiento.js       # mapa de refracción del cristal
python3 scripts/make_lut.py --preset paper
python3 scripts/narrar.py --texto guion.txt      # locución con edge-tts
python3 scripts/alinear_guion.py --guion guion.txt
```

La hoja de contactos congela un instante y sirve para juzgar composición y
color. No sirve para juzgar lo único que una plantilla de motion hace de
verdad: **moverse**. Una entrada que llega tarde o un texto que se lee a
medias solo se ven a 20 fotogramas por segundo, y para eso está `galeria.js`,
que además reúne los 21 SFX con su onda dibujada.

Escribe en `/tmp` y no en `build/` a propósito: son miles de PNG que no
pertenecen a ningún montaje —`build/` es de la pieza en curso y
`comprobar_montaje.py` vigila su coherencia—, y la decisión viene de cuando
`build/` aún se sincronizaba con iCloud (hoy es un symlink a `build.nosync/`).

`alinear_guion.py` es importante cuando la voz viene de TTS: se conoce el
texto exacto, así que se sustituye el de Whisper conservando sus tiempos.
Ha corregido «Zupac» → «ffmpeg» y «Cloud» → «Claude».

Atajos: `--dry-run` (pasos 3 y 5), `--preview` para un 540×960 rápido,
`--hw` para codificar con `h264_videotoolbox`, y `--only <capa>` en el
renderizador para rehacer una sola capa.

Regenerar el LUT tras tocar el grading: `python3 scripts/make_lut.py`

---

## Stack

- **STT & limpieza:** `mlx-whisper` (`medium` / `large-v3`, Metal) +
  `clean_transcript.py` (silencios > 0.35 s, tomas falsas por Levenshtein
  sobre n-gramas).
- **Visión local:** rostro vía **Vision de macOS** (rápido, sin descargas) con
  respaldo en **Ollama** (`qwen2-vl` / `llava`). Ver «Estado real» abajo.
- **Generación visual:** Google GenAI SDK (`google-genai`).
- **Motion graphics:** plantillas HTML5/CSS3 capturadas frame a frame con
  Playwright a PNG con alfa.
- **Composición y color:** `ffmpeg` multicapa con LUT 3D (`lut3d`).

---

## Instalación

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt              # solo el arnés de pruebas
npm install && npx playwright install chromium
python3 scripts/make_lut.py                      # genera el .cube
brew install --cask font-plus-jakarta-sans font-geist font-geist-mono \
                    font-inter font-jetbrains-mono font-instrument-serif \
                    font-playfair-display font-montserrat font-yellowtail
```

| Variable | Obligatoria | Para qué |
|---|---|---|
| `GEMINI_API_KEY` *o* `GOOGLE_GENAI_API_KEY` | Solo paso 3 | B-Rolls |
| `FFMPEG_BIN` / `FFPROBE_BIN` | No | Manda SIEMPRE (aunque apunte a la nada: así se apaga ffmpeg en las pruebas). Sin ella: `PATH`, y de respaldo `/opt/homebrew/bin/…` — la cadena vive en `comun.py` |

---

## Estado real de esta máquina

Comprobado, no supuesto. Impórtate de esto antes de prometer nada:

- **Ollama está instalado pero parado y sin modelos.** `qwen2-vl` son ~6 GB.
  Por eso el detector prefiere **Vision de macOS**: es un detector de caras
  de verdad, tarda milisegundos y no descarga nada
  (`pip install pyobjc-framework-Vision`). Sin ninguno de los dos, la UI se
  posiciona en el tercio inferior y `face.json` lo marca como
  `verificado: false`.
- **Las fuentes de marca SÍ están instaladas.** Este apartado decía lo
  contrario —«ninguna está instalada, todo cae a SF Pro y Menlo»— y era falso.
  Medido **en el mismo Chromium que rasteriza los PNG**, que es el único sitio
  donde la respuesta cuenta: `--display` resuelve a **Plus Jakarta Sans**,
  `--subs` a **Geist** y `--mono` a **Geist Mono**. Además hay Inter, Inter
  Display, JetBrains Mono, **Playfair Display**, **Instrument Serif**,
  Montserrat, Caveat y Yellowtail, con quince ficheros **variables** (`[wght]`).

  **Y ojo con cómo se mide, que me costó una vuelta:** `document.fonts.check`
  **no sirve** — devuelve `true` para una familia que no existe, porque solo
  informa de cargas `@font-face` pendientes y el emparejado de familias de CSS
  nunca falla, cae al respaldo. Lo comprobé: `check('40px "Fuente Que No
  Existe"')` → `true`. La medida que vale es el **ancho**: se compone la misma
  cadena con la familia sobre dos respaldos muy distintos y se mira si coinciden.
  Lo hace `humo_plantillas.js` en las 182 plantillas, y ese es el número al que
  hay que creer, no a esta prosa.

  Importa más de lo que parece: mientras esta línea dijo que faltaban fuentes,
  el aspecto genérico del catálogo se atribuyó a eso y no se buscó la causa
  real —que está en la jerarquía, los pesos, el tracking y la escala—. Una
  afirmación falsa en la documentación no es un error de redacción: es un
  diagnóstico bloqueado.
- **ffmpeg no trae `libass` ni `libfreetype`**: no puede dibujar texto. No
  hace falta — todo el texto llega rasterizado desde Playwright. Sí tiene
  `lut3d`, `libx264`, `h264_videotoolbox`, `prores_ks` y `aac`.
- Python del proyecto: **3.12**. MLX no publica ruedas para 3.14.
- **El árbol de `.venv/` lleva el flag `UF_HIDDEN` de macOS**, y Python
  ≥ 3.12 ignora los `.pth` ocultos (cambio de seguridad de CPython). La
  consecuencia es silenciosa: `pip install -e .` termina bien y
  `import editor` no existe. Medido aquí, y el arreglo es una línea:
  `chflags nohidden .venv/lib/python3.12/site-packages/*.pth`. Vale para
  cualquier instalación editable, no solo la de este repo.

---

## Arquitectura

```
input.mp4
   ├─ transcribe_mlx.py ──────> build/transcript.json
   ├─ clean_transcript.py ────> build/timeline.json      keep[] words[] blocks[]
   ├─ detect_face_bbox.py ────> build/face.json          zones[] con y_ui
   ├─ generate_google_assets ─> assets/broll/*.png       + build/broll_plan.json
   ├─ render_playwright.js ───> build/frames/<capa>/     + build/layers.json
   └─ composite_ffmpeg.py ────> renders/final_output.mp4
```

`build/` y `renders/` son desechables: se regeneran desde `input.mp4`.

### Contratos entre etapas

- **`transcript.json`** → `words[{w,start,end,p}]`, `segments[]`, `duration`
- **`timeline.json`** → `reloj: "origen"`,
  `keep[{src_start,src_end,out_start,out_end,zoom?}]`,
  `words[]`, `blocks[]`, `stats`
- **`face.json`** → `zones[{t0,t1,safe,y_ui}]`, `engine`, `verificado`
- **`layers.json`** → `capas[{capa,dir,frames,dur,t}]`, `fps`, `raiz`
  (`dir`/`mask` van RELATIVOS a `raiz`; los absolutos de un manifiesto
  anterior se aceptan — resuelve `comun.resolver_manifiesto`)
- **`broll_plan.json`** → `reloj`, `escenas[{id,t,dur,tipo,prompt?,plantilla?,files?}]`

### El reloj

Es donde este repo se ha equivocado más veces, así que hay UNA regla:

> **`timeline.words` y `timeline.blocks` van SIEMPRE en el reloj del vídeo
> ORIGINAL. `keep` es el único registro de la traducción origen→salida. El
> reloj de salida NO se almacena: se deriva con `reloj.Mapa(keep)`.**

Antes `clean_transcript.py` devolvía `words` ya remapeados a salida mientras
`silencios.py` construía su mapa de `keep.src_*`, que es origen. El resultado,
medido sobre una pieza real por la vía de arriba: la señal de huecos entre
palabras se apagaba —0 tramos en vez de 12—, se cortaban 0,33 s del ATAQUE de
una palabra, y los gráficos derivaban hasta 8,2 s, cada vez más según avanzaba
la pieza. Nada de eso daba error.

Tres cosas se derivan de esa regla y conviene no romperlas:

- Los tiempos DENTRO de `config` —`at`, `ini`, `fin`, `pulsacion`…— son
  **relativos al inicio de su capa**. `reloj.remapea` aplica
  `o' = mapa(t_capa + o) - mapa(t_capa)`. Tratarlos como absolutos acierta
  solo si la capa está en `t: 0`.
- La semántica de cada clave vive en `reloj.SEMANTICA`, indexada por clave
  **hoja** y no por contenedor. `scripts/comprobar_relojes.py` falla si una
  plantilla nueva trae una clave de tiempo sin clasificar.
- `silencios.py --aplicar` es **idempotente**: guarda `build/plan.origen.json`
  y re-deriva siempre de ahí.

---

## Escribir un plan a mano: `scripts/escaleta.py`

Cuando el guion trae actos, disparadores y copy exactos —el caso normal—,
`dirigir.py` no sirve: repartir por intención contradice una escaleta ya
escrita. `escaleta.py` es el andamio para escribirla, y `plan_codex.py` es el
ejemplo completo.

```python
import escaleta
e = escaleta.Escaleta()                      # exige reloj de ORIGEN
e.acto("gancho", desde="Auditar", hasta="trabajo")
e.tarjeta("headlineclipper", "headline-clipper.html",
          ancla="Auditar", desfase=0.55, dur=2.5, config={...})
e.microfx_en("stampbanned", "stamp-banned.html",
             ancla="dólares", desfase=0.11, dur=1.2, config={...})
e.subtitulos(claves={"codex", "github"})      # `ventanas` se derivan
e.plano(hasta="OpenAI", zoom=1.15, desde=0.0)
errores, desviaciones = e.auditar()
e.escribir()
```

Tres cosas que hace y por las que existe:

- **Ancla por PALABRA, no por segundo.** Si se vuelve a transcribir, el plan se
  mueve con la transcripción. Escribir los segundos a mano fue lo que dejó un
  candado a 4,4 s de su palabra disparadora al rehacer un montaje.
- **Audita §12, §13 y §15 en cada pasada**, y distingue **error** de
  **desviación**. Un aire de 7,9 s entre tarjetas en vez de 12 puede ser una
  decisión —la pieza de Codex es full-motion en el acto 2 y en 44 s no caben
  las dos cosas—; repetir un micro-FX no lo es nunca. Las desviaciones salen
  por `stderr` y **se ven**.
- **Interseca los tramos de cámara con los `keep` que ya haya**, en vez de
  reemplazarlos: reemplazar descartaba el recorte de tomas falsas, que el audio
  no delata y `silencios.py` no puede recuperar.

`colocar: false` en una capa significa «esto está donde quiero que esté»: la
respetan `colocar.py` —que no la mueve ni le borra el `dy`— y la auditoría, que
deja de avisar de que un micro-FX cae dentro de una tarjeta.

---

## Cómo funcionan las plantillas

No usan el reloj del navegador. Cada una registra
`Engine.register({duration, setup, draw})` y expone:

```js
window.TPL.setup(config)   // contenido y layout
window.TPL.seek(t)         // posiciona la animación en el segundo t
```

Playwright llama a `seek(t)` y captura. Mismo `t` → mismo pixel. Capturar
animaciones CSS en tiempo real produce frames repetidos y saltados.

Para añadir una plantilla: copia una existente, enlaza `_tokens.css` y
`_engine.js`, y añádela al plan en `render_playwright.js:planPorDefecto()`.

**Nunca uses `Math.random()`** dentro de una plantilla: rompería la
reproducibilidad. Usa `Engine.noise(i, semilla)`.

---

## Criterio de trabajo

- **Verifica mirando, no leyendo.** Un JSON correcto no prueba que el frame se
  vea. Renderiza y abre el PNG. Una fuente que falta o un `omitBackground` mal
  puesto producen imágenes vacías que ningún log delata.
- `--only` **fusiona** el manifiesto, no lo reemplaza. Si algún día lo tocas,
  mantén esa propiedad: sobrescribir dejaría el vídeo sin las demás capas y en
  silencio.
- Un paso que falle debe decir **qué** falta y **qué comando** lo arregla.
- Nunca toques `input.mp4`. Todo va a `build/` y `renders/`.
- No inventes IDs de modelo de Google: cambian a menudo. Si la API responde
  404, dilo y remite a ai.google.dev.
