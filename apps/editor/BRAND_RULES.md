# Brand Rules & Motion Graphics Guidelines

## 1. Filosofía visual: "Papel y Tinta"

Estética de **documento impreso**: papel, tinta, y un sello. La tecnología se
representa con **precisión geométrica** y con los materiales de la imprenta —
trama, filete, registro—, no con metal ni con luz.

Lo que esto descarta, explícitamente: efectos estruendosos, neón saturado,
resplandores grandes, gráficos infantiles, rebotes elásticos, degradados
arcoíris. Si un elemento necesita destacar, lo hace con **contraste y peso
tipográfico**, nunca con luz.

> Regla práctica: si un `box-shadow` supera los ~48 px de difuminado o una
> animación se pasa de rosca más de un 6 %, se ha salido de marca.

### Por qué dejó de ser "Carbon & Bronze"

La marca fue carbón (`#121212`) y bronce (`#CD7F32`) hasta la tanda 16. Lo que
la cambió fue una sola frase del usuario mirando el catálogo entero:

> «el color dorado y negro son colores IA total»

Y es cierto: negro casi puro con un ámbar saturado encima es la firma visual de
lo generado, precisamente porque es el par que más aparece. Un sistema visual
que se parece a todo lo demás no distingue nada, por bien construido que esté.

---

## 2. Paleta oficial

Dos temas, **la misma tinta**. `paper` es su casa; `carbon` es la misma paleta
invertida, para cuando el metraje va claro.

| Rol | `paper` | `carbon` | Aplicación |
|---|---|---|---|
| Fondo | `#EDE8DF` papel crudo | `#16161A` tinta | fondos de tarjeta, hojas |
| Superficie | `#F7F3EC` | `#1F1F24` | tarjetas, terminales |
| Tinta | `#16161A` | `#EDE8DF` | titulares y texto |
| Tinta suave | `#4A4650` | `#9E9A92` | subtítulos secundarios, logs |
| Regla | `#CFC6B7` | `#2E2C30` | separadores, filetes |
| **Acento** | `#1F4E79` azul de sello | `#6FA0D6` | bordes activos, nodos, karaoke |
| **Acento 2** | `#8A3A32` rojo de rúbrica | `#C97068` | lo comparado, lo terminado |
| Señal correcto | `#256B43` | `#3DD68C` | vistos, aciertos |
| Señal error | `#C0261F` | `#E5484D` | choques, sellos de prohibido |

Definidos **una sola vez** en `templates/_tokens.css`. No repitas HEX a mano en
las plantillas: usa las variables. La única excepción son las paletas AJENAS
—los presets de subtítulo de terceros—, delimitadas con marcadores
`PALETA-AJENA` y comprobadas por `auditar_estilo.js`.

### Por qué el acento es azul y no rojo

La primera versión de esta paleta ponía el rojo de tinta al frente, que es lo
que se espera de «papel y tinta». No se puede: `--senal-no` —el rojo de error,
que es universal y no se negocia— queda a **ΔE 4,5** de ese acento. El propio
repo ya declaró que ΔE 9,2 es «el mismo color otra vez» cuando movió el
cardenillo. Un sello de PROHIBIDO en el rojo del cromo de marca deja de
significar nada.

Y en el tema oscuro no hay salida por ahí: **cualquier rojo legible sobre
`#16161A` cae cerca del rojo de alarma, y todo lo que se separa lo suficiente
se va al naranja** — de vuelta al oro que motivó el cambio. Medido sobre ocho
candidatos.

Con el azul de sello al frente: ΔE **94** en papel y **90** en carbón contra la
señal de error. El rojo se queda donde tiene sentido, que es la rúbrica y el
error.

### Los colores de SEÑAL no son de marca

`--senal-ok` y `--senal-no` viven aparte del acento y **no cambian con la
paleta**: un visto verde y un choque rojo significan lo que significan en
cualquier marca, y volverlos azules sería quitarles el sentido para ganar
coherencia.

### El material

El bronce nunca fue un plano naranja y la tinta tampoco es un plano azul. Los
cinco stops de `--metal-1..5` son el MATERIAL del acento —su rampa— y
`test_color.py` comprueba que ninguno se despegue más de ΔE 45 de él. El nombre
`metal` es herencia de la paleta anterior; lo que describe ahora es la rampa de
la tinta.

### El acento de PLAN: cuando la pieza no es de esta marca

Todo lo anterior describe ESTA marca. Sobre una pieza ajena —un clip de
cliente, una colaboración— el azul no es el acierto sino el error, y por eso
una capa puede pedir `config.acento` con un color CSS. Lo aplica el motor en
`Engine.register().setup`, en el mismo sitio donde se aplica el tema, así que
lo hereda **el catálogo entero** sin tocar ninguna plantilla.

Mueve `--accent`, `--accent-soft`, `--accent-line` y la rampa `--metal-1..5`,
que se RECONSTRUYE conservando tono y saturación del color pedido y aplicándole
los saltos de luminancia que la rampa de marca tiene hoy sobre su acento. Sin
eso el titular sale del color pedido y su filete metálico sigue azul: dos
colores peleándose en la misma pieza.

Dos tokens no se mueven, y por el mismo motivo cada uno. `--senal-ok` y
`--senal-no` porque no son de marca —lo dice el apartado de arriba—: un visto
verde y un tachón rojo significan lo mismo en cualquier paleta. Y `--accent-2`
porque su trabajo es DIFERENCIAR del primero, y la relación que sostiene
—acento cálido, acento-2 frío— aguanta con cualquier acento cálido de plan.

`acento` significa COLOR en toda la config. `kinetic-quote` lo usaba para
nombrar un trozo de texto y era el único del catálogo: ahora lo llama
`resaltar`, como `cita` y `headline-clipper` ya llamaban a ese mismo trabajo.

---

## 3. Tipografía y jerarquía

Esta tabla decía otra cosa y **no describía lo que ejecuta el navegador**.
Manda `templates/_tokens.css`, que es lo que el motor lee; lo de abajo está
verificado con `document.fonts.check` en el mismo Chromium que rasteriza.

| Uso | Token | Familia que resuelve | Respaldos declarados |
|---|---|---|---|
| Display y titulares | `--display` | **Plus Jakarta Sans** | Geist, Inter, SF Pro Display |
| Cuerpo y subtítulos | `--subs` | **Geist** | Inter, SF Pro Text |
| Código y datos | `--mono` | **Geist Mono** | JetBrains Mono, SF Mono, Menlo |
| Display del tema `paper` | `--display` | **Instrument Serif** | Newsreader, Georgia |
| Cursiva de conector | — | **Yellowtail** | Caveat |

Los subtítulos van en **cajas compactas**: `padding: 8px`, filete de `1px` en
`#CD7F32` sobre la palabra activa.

> **Corrección.** Aquí ponía que ninguna de las tres estaba instalada y que
> todo caía a SF Pro y Menlo. Es **falso**: están las once familias y quince
> ficheros son **variables** (`[wght]`), incluida **Playfair Display**, que no
> se usa en ninguna plantilla y es la única didone de alto contraste del
> sistema — o sea justo la herramienta que §1 pide cuando dice «contraste y
> peso tipográfico, nunca luz».
>
> Mientras esa frase estuvo escrita, el aspecto genérico del catálogo se
> atribuyó a fuentes ausentes y nadie miró la causa real. La comprobación que
> lo habría evitado ya está puesta, en `humo_plantillas.js`, y **mide anchos**:
> la primera versión usaba `document.fonts.check` y no detectaba nada, porque
> ese método dice que sí a cualquier nombre. Un control que siempre pasa es
> peor que ninguno: da la sensación de estar vigilado.

---

## 4. Biblioteca de componentes

> **Esta sección describía un catálogo que ya no existe.** Hasta la tanda 13
> decía que `code-mockup` era «un marco que simula la pantalla de un MacBook
> Pro con bisel de aluminio, muesca y tres botones» y que los nodos de
> `data-diagram` eran «hexágonos con un pulso de luz que viaja». Las dos cosas
> se retiraron —el cromo de otra empresa y la forma «tech» por defecto— y la
> norma siguió afirmándolas. Una afirmación falsa en la documentación no es un
> error de redacción: ya bloqueó un diagnóstico entero cuando decía que las
> fuentes de marca no estaban instaladas. `comprobar_docs.py` caza plantillas
> SIN mención, no menciones equivocadas; desde la tanda 13 comprueba además
> que toda clave `config.X` que se cite aquí exista de verdad en su plantilla.

### A. Listado grabado — `templates/code-mockup.html`
El canal de números es una **regla fresada** con graduación —división mayor
cada cinco líneas— y un índice de bronce que baja línea a línea mientras se
teclea: el progreso lo dice la regla, no una barra de porcentaje. El margen
lleva **marca de cambio** como un diff (`+` bronce, `~` cardenillo, `-`
apagado) y el pie las cuenta. El resaltado va por PESO además de por color,
así que la jerarquía sobrevive en escala de grises. Cursor de filete, no de
bloque: sobre texto de lectura un bloque tapa la letra siguiente.

### B. Diagramas y tablas — `templates/data-diagram.html`
Dos vistas en la misma plantilla, vía **`config.vista`** — `modo` está
RESERVADA por el renderizador, que la usa para `detalle`/`mascara`:

- `nodos`: **placas con las esquinas achaflanadas**, con el canto en bisel
  —la luz cae por una arista y el resto muere en `--rule`— y grano en la cara.
  Conectores con **enrutado ortogonal** y esquinas redondeadas, que es como se
  enruta un esquema real; cada arista deja su pista gris visible desde que se
  traza. Por encima viaja **UN paquete**, no un patrón de guiones: un dato
  sale de un sitio y llega a otro.
- `tabla`: filas separadas por un filete en `--rule`, encabezados en bronce
  sobre `--accent-soft`, y barras de comparativa con degradado metálico.

### C. Picture-in-Picture — `templates/pip-frame.html`
Una **compuerta**: las cuatro hojas de un matte box que se cierran sobre el
encuadre. La ventana no se dibuja, es el hueco que dejan. Etiqueta flotante
`[ M4 PRO LOCAL ]` en la mono de marca.

### D. Placa graduada — `templates/kicker-hud.html`
El filete decorativo de la izquierda es una **escala** de verdad, con tres
especies de división —menor, media y registro— y una corredera de bronce que
se desliza hasta el renglón que toca leer. El titular consigue su jerarquía
DENTRO de la línea: 300 de base contra 800 en el resaltado, que son los 500
puntos de salto que pide §1. Las palabras se marcan con `*asteriscos*` y
admiten varias seguidas.

### E. Etiqueta troquelada — `templates/pills.html`
Chapa cortada por un troquel, con la cabeza del remache FORMADA por el golpe y
el rótulo grabado por un cabezal a avance constante. Tres tipos, tres voces:
`--mono` MIDE, `--display` AFIRMA, `--subs` NARRA, con el tipo codificado dos
veces —color y densidad de trama— para que se lea en escala de grises.

Era «badges glassmorphic sobrios», y dejó de ser cierto en la tanda 15. El
`backdrop-filter` que llevaba **no hacía nada**: estas capas se capturan sobre
transparencia, y sin píxeles detrás no hay nada que desenfocar. Costaba una
capa de composición por fotograma y sugería que el efecto estaba puesto.

### F. Los que faltaban en esta lista

Cinco plantillas llevaban tiempo existiendo sin una línea en la norma, y eso no
es un descuido de redacción: una plantilla que la norma no menciona es una
plantilla que nadie sabe cuándo usar, y así es como se acumulan las que no usa
nadie. Lo cazó `comprobar_docs.py`, que ahora falla si vuelve a pasar.

| Plantilla | Qué es | Cuándo |
|---|---|---|
| `templates/transicion.html` | Hoja que cruza el cuadro con una marca de acto. Es **cromo**, no contenido: no dice nada, separa. | En la frontera de dos actos. Es la única que emite `config.cortes`, o sea la única que puede pedir un `riser`. |
| `templates/tarjeta-3d.html` | Tarjeta con paralaje real: el contenido se mueve a distinta velocidad que el marco. | Un solo objeto que merezca mirarse. No para listas. |
| `templates/marcos.html` | Marco de navegador o de móvil alrededor de una captura. | Cuando lo que se enseña es una interfaz y hace falta que se lea COMO interfaz. |
| `templates/kinetic-type.html` | Tipografía a pantalla completa que se recompone. | Una frase corta que carga sola. Acepta `flashEn`. |
| `templates/security-pipeline-nodes.html` | Cadena de nodos que se encienden en secuencia. | Un proceso con etapas nombradas. Lleva `escaner` de entrada desde el sprint de sonido. |

---

## 5. Reglas de correspondencia (guión → recurso)

Implementadas en `generate_google_assets.py:TEMAS_PLANTILLA`. Lo que tiene
plantilla **no se manda a la API**: sale más limpio en vectorial y no gasta
llamadas.

| Tema del guión | Recurso |
|---|---|
| Código, funciones, scripts, comandos, terminal | Listado grabado (`code-mockup`) |
| Arquitectura, redes, agentes, flujo, sistema | Diagrama de nodos |
| Métricas, comparativas, rendimiento, benchmark | Tabla o barras horizontales |
| Concepto general, introducción | B-Roll fotorrealista (Google GenAI) |

---

## 6. Evitación de rostro

La UI dinámica **nunca** debe solaparse con la cara del creador.

`detect_face_bbox.py` muestrea 1 frame por segundo, localiza el rostro y
publica en `build/face.json` las zonas con su `y_ui` recomendada.
`render_playwright.js` la aplica al posicionar subtítulos y pastillas.

- Cara en el tercio superior o centrada → UI al **tercio inferior** (`y ≈ 0.72`)
- Cara en el tercio inferior → UI al **tercio superior** (`y ≈ 0.16`)

Las zonas contiguas con la misma decisión se fusionan y las de menos de 2,5 s
se absorben: **la UI saltando arriba y abajo cada segundo marea más que
taparle media cara**.

---

## 7. Sistema de temas

`_tokens.css` ya no define una estética, define **el sistema**. Tres capas:

1. **Semánticos** — cambian con el tema. Nombran el rol (`--ink`), no el
   color (`--ivory`): un token llamado como su color pierde el sentido en
   cuanto hay dos temas.
2. **Invariantes** — escala tipográfica (`--t-xs` … `--t-mega`), espaciado
   (`--s-1` … `--s-8`), radios y ritmo de movimiento.
3. **Temas** — `:root[data-tema="…"]` redefine solo la capa 1.

El tema lo aplica `_engine.js` en `<html data-tema>`, así que **ninguna
plantilla necesita saber que existen los temas**: basta con que use tokens.
Se pide desde el plan con `config.tema`. Debe ser un string: la fusión de
config es `Object.assign` de un nivel y un objeto anidado se reemplazaría.

> **Prohibido escribir un HEX dentro de una plantilla.** Si un color no
> tiene token, se añade a `_tokens.css`. Es lo que impedía tener temas.

| Rol | Carbon & Bronze | Paper & Ink |
|---|---|---|
| `--bg` | `#121212` | `#F6F4F0` |
| `--surface` | `#1E1E24` | `#FFFFFF` |
| `--ink` | `#F5F5F5` | `#16181D` |
| `--accent` | `#CD7F32` | `#C2410C` |
| `--accent-2` | `#4E9A8F` | `#0F766E` |
| Display | Plus Jakarta Sans | **Instrument Serif** |
| UI / subs | Geist | Geist |
| Mono | Geist Mono | Geist Mono |

**El segundo acento es CARDENILLO, el bronce oxidado.** Hasta la tanda 24 era
`#B87333`, un cobre a **ΔE 9,2** del acento: el mismo color otra vez. Doce
plantillas lo usan para DIFERENCIAR algo —números de tabla, líneas `ok` del
terminal, foco del mapa de calor, anotaciones `frio`, pastillas `stat`, flecha
del hero-stat, barra del code-mockup, filete del kicker— y en tema oscuro
ninguna diferenciaba nada.

Medido frente al bronce `#CD7F32`:

| | antes `#B87333` | ahora `#4E9A8F` |
|---|---|---|
| ΔE(CIELab) | 9,2 | **73,7** |
| saturación (el bronce marca 0,61) | 0,57 | **0,33** |
| contraste sobre `#121212` | 4,9:1 | **5,7:1** |
| luminancia frente al acento | — | **más apagado** |

Los dos últimos números son los que descartaron las alternativas: el verde de
`paper` puesto tal cual en carbon se queda en **3,4:1** y no llega al 4,5 que
necesita el texto, y los tonos más claros salen **más brillantes que el propio
bronce**, que es justo lo que un acento secundario no debe hacer.

No es un color importado: es lo que le pasa al bronce con el tiempo, así que
sigue dentro del material de §1. Y su matiz (171°) coincide con el del
`--accent-2` de paper (175°), de modo que los dos temas significan lo mismo:
**acento cálido, acento-2 frío.** Un componente que use el segundo acento para
«lo secundario» dice lo mismo en los dos temas.

Ojo con `--metal-2`, que sigue siendo `#B87333`: es un stop del degradado
metálico, no un acento. Cambiarlo al tocar el acento habría desteñido el
acabado de todas las tarjetas.

`tests/test_color.py` fija estas propiedades —ΔE mínimo, AA para texto, techo
de saturación, temperatura por tema— y valida su aritmética contra los 9,2 y
97,2 que se midieron con los valores antiguos. El sistema de color no tenía
ninguna red: un cambio de token salía en el vídeo y en ningún log.

**Regla del tema claro:** texto claro sobre metraje claro no se lee. En
`paper` los overlays de texto van con **relleno sólido y tinta oscura**, no
con borde. Un chip opaco se lee sobre cualquier fondo; un contorno, no.

---

## 8. Liquid Glass

Inspirado en el navbar `glassy style nav` y en el filtro de iOS 26.

**No se puede hacer solo con CSS en este pipeline.** `backdrop-filter` no
tiene píxeles que muestrear cuando se captura con `omitBackground`, y el
cristal sale como una pastilla gris. Comprobado y descartado.

La plantilla emite **dos pasadas** (`data-modo` lo pone el motor):

- `detalle` — brillos, borde, reflejo y contenido
- `mascara` — la silueta en blanco, nada más

Y ffmpeg hace la refracción: difumina el metraje, lo **desplaza** con un
mapa de turbulencia, lo recorta con la silueta y le pone el detalle encima.
El fondo que refracta es el vídeo real, que es mejor que unos blobs.

```json
{ "capa": "dock", "cristal": true, "blur": 24, "sat": 1.4, "desplazar": 0.26 }
```

`desplazar` es lo que separa el cristal del plástico esmerilado: un blur
difumina, pero solo el desplazamiento **dobla** la luz en el canto. El mapa
se genera con `scripts/mapa_desplazamiento.js` y se atenúa hacia el centro,
porque en un cristal real la refracción se concentra en el borde.

---

## 9. Componentes nuevos

| Plantilla | Qué es |
|---|---|
| `chat-bubbles.html` | Conversación con la IA: burbuja de usuario, «pensando» y respuesta en streaming |
| `hero-stat.html` | Cifra protagonista con contador `outExpo` y `tabular-nums` |
| `lower-third.html` | Rótulo inferior con apertura por `clip-path` + bug de marca |
| `compare-ab.html` | Dos tarjetas enfrentadas con barras y ganador |
| `glass-dock.html` | Dock de liquid glass con pastilla deslizante (muelle de Apple) y marcas dibujadas en SVG |
| `globo.html` | Globo ortográfico con retícula, puntos y etiquetas |
| `pasos-flow.html` | Lista de pasos con hilos que se dibujan (`strokeDashoffset`) |
| `fondo.html` | Fondo opaco: rejilla en deriva, blobs, **grano de papel**, viñeta |

**Registrar toda capa nueva en `ORDEN`** (`capas.json`, en guiones/; lo leen
el compositor y el validador). Si no, se renderiza y el compositor la
descarta — ahora con aviso, pero el vídeo saldría sin ella.

---

## 10. Movimiento

Del pen de tarjetas 3D y del dock:

- **Muelle de Apple** `cubic-bezier(0.34, 1.2, 0.64, 1)` solo para lo que
  se desplaza (la pastilla del dock). Da masa.
- **Flotación de reposo**: cada elemento deriva con su propio periodo. Sin
  ella una fila parece una captura fija.
- **Sombra multicapa con brillo interior** (`inset 0 1px 0` arriba,
  `inset 0 -2px` abajo): lo que hace que algo parezca un objeto.
- Entradas con `outCubic` y como mucho 6 % de escala. Nada de rebotes.


---

## §11 · Dirección: ritmo, variedad e intención

Estas reglas las aplica `scripts/dirigir.py` y son **medibles sobre el plan
que produce**, no recomendaciones. El motivo de que existan está medido: en
la pieza de la inversión en IA, el **93,6 %** del metraje tenía exactamente
UNA capa de contenido en pantalla. Eso es una secuencia de diapositivas, no
una composición, y ningún componente nuevo lo arregla.

### Ritmo
- Un cambio visual cada **2,5-4 s**. Por debajo se lee como nervio; por
  encima, como una diapositiva olvidada.
- Ninguna gráfica más de **4 s** fija. Los tramos más largos se parten.
- El script informa de `cambio_visual_cada_s`: si sale por encima de 4, el
  montaje está flojo aunque los componentes sean bonitos.

### Variedad
- Ninguna plantilla dos veces **seguidas**.
- Tope de usos por pieza, **calculado** como `huecos / plantillas útiles`.
  Un tope fijo de 2 con 100 huecos y treinta plantillas útiles es imposible, y un
  respaldo que lo salte anula la regla entera: lo que pasó en la primera
  versión, con `pills` 40 veces y `cita` 35.
- Cuando la intención agota sus candidatas se coge **la menos usada del
  catálogo**, nunca se repite la anterior.

### Cámara
Saltos de corte por tramo, no rampas: `1.15x` en el gancho, alternando
`1.00x` y `1.12x` en el desarrollo, `1.20x` en el cierre. Se emiten como
`keep` con `zoom` y el compositor les da a cada uno su escala antes del
concat, así que son cortes reales.

### Intención → componente

La elección **no** depende del orden sino de lo que se está diciendo.

| Si el guion… | Intención | Componentes |
|---|---|---|
| «muchos me preguntáis…» | `pregunta_audiencia` | `comment-bubble`, `chat-bubbles` |
| da un porcentaje o una proporción | `dato_porcentaje` | `poll-rating`, `hero-stat`, `mapa-calor` |
| «el primer paso», «error 2» | `paso_numerado` | `chapter-card`, `pasos-flow` |
| «antes… ahora», «frente a» | `comparacion` | `split-versus`, `compare-ab` |
| «la regla es», «quédate con» | `cita_frase` | `highlighter-text`, `cita`, `kinetic-quote` |
| abre con una pregunta | `busqueda_pregunta` | `search-bar`, `kinetic-quote` |
| «es decir», «consiste en» | `definicion` | `definition-card`, `pills` |
| nombra una herramienta | `herramienta_tecnica` | `terminal`, `code-mockup`, `data-diagram` |
| «cinco capas», «tres riesgos» | `estructura_lista` | `data-diagram`, `pasos-flow`, `cinta` |
| resultados, ventas, seguidores | `resultado_logro` | `notification-pop`, `hero-stat` |
| «un estudio», «según el informe» | `autoridad_noticia` | `headline-clipper`, `tweet-card` |
| «guárdalo», «comparte» | `cierre_cta` | `engagement-cta`, `cierre-cta` |

### Trampa recurrente: tinta como fondo

Ya ha mordido **tres veces** —hojas de transición, bisel del móvil y
`split-versus`—. `--ink` es el color del TEXTO y se invierte con el tema:
en carbon es casi blanco. Un panel que cubre usa `--velo-oscuro` o
`--velo-claro`, que son fijos en los dos temas a propósito.

### Sobre duplicar componentes

Cuatro de los recursos pedidos ya existían con otro nombre:
`engagement-cta` es `cierre-cta` (ya hace el clic con puntero),
`step-tracker` es `capitulos`, `audio-waveform` es `onda`, y `split-versus`
partía de `compare-ab`. Duplicarlos habría empeorado el catálogo: más
plantillas que mantener y el mismo repertorio real.

---

## §12 · Tarjetas, subtítulos y copia

### Centrado

Toda tarjeta lleva la clase `.tarjeta`, definida en `_tokens.css`:

```css
.tarjeta { position: absolute; left: 50%; transform: translateX(-50%);
           width: 90%; max-width: 900px; margin: 0 auto; }
.tarjeta[data-zona="arriba"] { top: 120px; }
.tarjeta[data-zona="abajo"]  { bottom: 280px; }
.tarjeta[data-zona="centro"] { top: 50%; transform: translate(-50%,-50%); }
```

El eje X es **siempre exactamente 50 %**. Lo único que decide la evitación
de rostro es la banda vertical, en `data-zona`, que `_engine.js` publica
desde `config.zona`.

**`.tarjeta` posiciona y NUNCA anima.** El elemento que anima es su hijo
directo, `.tarjeta-cont`. Tienen que ser dos: las plantillas escriben
`style.transform` en su tarjeta para entrar, y eso borra el
`translateX(-50%)` que la centra — la tarjeta se queda clavada por el borde
izquierdo, medio fuera de cuadro, desde el primer fotograma. La separación
la hace `_engine.js` al preparar la plantilla, envolviendo el nodo una sola
vez, así que una plantilla nueva solo tiene que poner `class="tarjeta"`.

Una tarjeta no debe traer posicionamiento propio, ni su `.stage` un
`place-items: center`: compiten con el sistema y gana el que se cargue
después. El ancho propio se pide con `config.ancho`, que el motor aplica
sobre el envoltorio, que es quien tiene el `max-width`.

### Vidrio

`.vidrio-apple` es el acabado único de tarjeta. Fondo al 65 % de opacidad,
filete interior superior claro y sombra larga y suave. Sobre metraje claro
un bloque de texto sin relleno no se lee — si un componente muestra texto
sobre vídeo, lleva vidrio o lleva sombra dura; flotar no es opción.

### Subtítulos

`kinetic-captions` sustituye a `karaoke-subs` en todo plan nuevo.

| Regla | Valor |
|---|---|
| Palabras por golpe | 1-3 |
| Corte | máximo, puntuación **o pausa > 0.42 s** |
| Cuerpo | Plus Jakarta Sans 800, versales |
| Color | `--sobre-relleno`; la clave en `--accent`, 1.16em, filete de bronce |
| Conectores | Yellowtail cursiva, minúscula, `--ink-soft`, `-4°` |
| Entrada | escala 0.94 → 1.0 en 0.1 s, `outBack6` (≤6 %, §10) |

Esta tabla dijo «`#FFE500` en la clave» y «escala 0.85 con rebote» mucho
después de que la plantilla dejara de hacer ninguna de las dos cosas — el
neón lo prohíbe §1 y el 15 % de zoom es el gesto de CapCut. Lo que hay
arriba está copiado del código, que es al que hay que creer.

La pausa manda tanto como el punto: dos palabras separadas por medio
segundo no se leen juntas por mucho que la gramática las una.

#### La dinámica (opcional, apagada por defecto)

`kinetic-captions` admite cuatro efectos, todos con techo y todos a cero
si el plan no los pide — con los defaults el píxel es idéntico al de antes
de que existieran:

| Clave | Qué hace | Techo |
|---|---|---|
| `gestos` | la entrada rota por grupo: alza · lateral · aterrizaje · crecer | curvas `outCubic`/`outBack6`, ≤6 % |
| `popPalabra` | la palabra viva crece con `transform` mientras suena | ×1.06 |
| `popClave` | ídem para la clave (0 = hereda `popPalabra`) | ×1.12 |
| `vaiven` | descoloque determinista del grupo (dx; dy = 0,6·dx) | 24 px |
| `cuerpoClave` | el grupo con clave o energía ≥ 0.75 se compone mayor | ×1.12 |

La intensidad del pop la modula la **energía de la voz** por palabra
(`medir_energia.py` → `words[].energia`, 0..1 por percentiles p20-p95);
sin medir, todo vale 0,5 — neutro. Con tarjeta en pantalla se cede el
gesto (§13): entrada de siempre, sin vaivén, y el grupo que solapa una
ventana no crece. Los enlaces no hacen pop nunca. Los paquetes curados
son `escaleta.DINAMICA[1..3]` (`subtitulos(dinamica=2)`); en material
ajeno, `solo_subs.py --dinamica N` — apagado por defecto, como el LUT.

### Copia en pantalla

Un titular no es un trozo de transcripción. `dirigir.py` refina cada
fragmento a 2-4 palabras **escogidas de las que ya están en la frase** —no
añade términos que el guion no dice— y aplica estas prohibiciones:

- No empezar ni terminar en conjunción, artículo, preposición o cópula.
- No terminar en conjunción + una sola palabra: abre una oración que no
  cierra («…a un LLM, pero Kimi»).
- No quitar un marcador del discurso dejando su subordinante («Así que
  sígueme» → «que sígueme»).
- **No perder una negación.** Si la frase negaba y el resumen no, el
  titular dice lo contrario que la voz en off: antes que eso, ningún
  titular.

Cuando no sale copia limpia, el componente **no se coloca**. Un hueco es
mejor que media frase.

### Componentes que el director no reparte solo

`pasos-flow`, `split-versus` y `compare-ab` necesitan dos o tres contenidos
contrastados que no se pueden extraer de un único fragmento: salían con
descripciones vacías o con el mismo texto a ambos lados. Quedan para planes
escritos a mano.

`cierre-cta` solo aparece en el último 15 % del vídeo y una sola vez.

---

## §13 · Orquestación narrativa

### Densidad

**Cuatro gráficos por pieza, uno por acto.** No cuatro por minuto: cuatro
en total. Entre uno y el siguiente hay **doce segundos de aire como
mínimo**, y cada uno vive entre **2,5 y 3,5 s** en pantalla.

El resto —entre el 60 % y el 85 % del metraje— es cara y subtítulos
cinéticos y nada más. La versión anterior del director repartía un gráfico
cada tres segundos: eso no es ritmo. El espectador deja de mirar a quien
habla y se pasa el vídeo leyendo tarjetas, que es exactamente lo contrario
de lo que sostiene una pieza de creador.

### Los cuatro actos

Las fracciones dan **exactamente** los tramos de realización en un vídeo de
60 s, y escalan solas en uno de 40 o de 81:

| Acto | Fracción | En 60 s | Qué entra |
|---|---|---|---|
| Gancho | 0-10 % | 0-6 s | `headline-clipper` · `kinetic-quote` |
| Núcleo 1 | 10-42 % | 6-25 s | `definition-card` · `data-diagram` · `notification-pop` |
| Núcleo 2 | 42-75 % | 25-45 s | `hero-stat` · `odometro` · `terminal` · `code-mockup` · `poll-rating` |
| Cierre | 75-100 % | 45-60 s | `cierre-cta` |

Dentro de cada acto se elige el tramo con más carga —cifras y nombres
propios pesan—, no el primero: en un acto de veinte segundos, el momento
que merece un gráfico rara vez es la frase de entrada.

### Guardias semánticas

Hay plantillas que **afirman algo** sobre el guion. `chapter-card` dice
«esto es el paso 2». `search-bar` dice «alguien preguntó esto». `terminal`
dice «esto es un comando». Ponerlas porque tocaba rellenar un hueco
convierte el vídeo en una mentira pequeña y constante.

| Plantilla | Solo si el guion contiene |
|---|---|
| `chapter-card` | paso · número · primero · segundo · clave · error · punto |
| `search-bar` · `faq-card` | una pregunta literal (`?` o `¿`) |
| `split-versus` · `compare-ab` | frente a · versus · antes y ahora · en vez de · a diferencia de |
| `terminal` | comando · consola · script · código · ffmpeg · python · git |
| `code-mockup` | código · función · clase · variable · api · json |
| `hero-stat` · `odometro` · `poll-rating` | una cifra de verdad |

Para conceptos técnicos abstractos sin ninguna de esas señales, el orden es
`definition-card` → `data-diagram` → `notification-pop`.

### El gráfico no repite el subtítulo

Compartir **términos** está bien: refuerza. Reproducir una **tirada de
palabras seguidas** de lo que se está leyendo abajo, no — son los mismos
ojos leyendo dos veces la misma frase, y la segunda capa no aporta nada.

El umbral son **dos palabras con carga seguidas**, no tres: los enlaces se
filtran antes, así que un titular como «Encoder a un LLM» aporta solo dos
—«encoder llm»— y con el umbral en tres no saltaría nunca.

Como el texto de la tarjeta sale del mismo fragmento que el subtítulo, por
construcción coinciden. La solución no es cambiar el texto sino **retrasar
el gráfico** hasta 3 s en pasos de 0,4 s: la tarjeta condensa lo que ACABA
de decirse mientras el subtítulo sigue adelante, que además es como se
monta a mano. Si ningún retraso lo limpia, se prueba otra plantilla.

### Exclusión mutua con los subtítulos

Mientras una tarjeta ocupa la pantalla, los subtítulos cinéticos se clavan
en `bottom: 150px` y **dejan de rebotar**: sin tarjeta viven en `300px` con
su pop elástico. El rebote existe para llamar la atención, y dos capas
compitiendo por la mirada estropean las dos a la vez. Se controla con la
lista `ventanas` que el director pasa a `kinetic-captions`.

---

## §14 · Sonido y color de cámara

### Catálogo de efectos

Todos **sintetizados** con `scripts/hacer_sfx.py` — expresiones de ffmpeg,
sin material de terceros. Regenerables y auditables: cada uno lleva escrito
por qué suena así.

| Efecto | Dura | Para qué |
|---|---|---|
| `suscribir` | 550 ms | pulsar Seguir **y su confirmación** |
| `notificacion` | 420 ms | `notification-pop` |
| `pop` | 160 ms | pastillas, comentarios, globos |
| `tecleo` | 45 ms | `terminal`, `code-mockup`, `search-bar` |
| `resolucion` | 1,6 s | acorde grave bajo la última tarjeta |
| `deslizar` | 320 ms | entrada lateral de una tarjeta |

`suscribir` lleva el clic **y** la confirmación en el mismo archivo porque
en pantalla son un solo gesto. Las dos notas van a una cuarta justa
(880 → 1174 Hz): un intervalo consonante suena a «hecho», uno disonante a
error. `tecleo` cae a −40 dB en 17 ms frente a los 47 de `clic`: una tecla
es masa golpeando un tope, no un contacto eléctrico.

**El sonido de entrada depende de QUÉ entra** (`SFX_POR_PLANTILLA`). Con
`aparicion` para todo, cuatro gráficos distintos sonaban igual y el oído
dejaba de distinguirlos: el efecto pasaba de subrayar a ser un tic.

Un efecto ligado a un instante DENTRO de una plantilla —el clic del botón—
lo declara la propia plantilla devolviendo `cues: [{at, sfx, gain}]` desde
`setup`. `at` es **relativo** al inicio de la capa. Declararlo en el plan
garantizaría que se desincronice al mover la animación.

### El botón de seguir cambia de estado

Pulsar y que nada cambie no convence. A los 120 ms de la pulsación —lo que
tarda una interfaz real en confirmar— el botón pierde el relleno, se vuelve
un contorno y pasa de «+ Seguir» a «✓ Siguiendo», con un estallido **único**
de chispas. Único, no en bucle: un estallido que se repite deja de leerse
como reacción.

### LUT para material S-Cinetone

```bash
python3 scripts/make_lut.py --preset scinetone   # -> assets/luts/scinetone_s11.cube
```

**S-Cinetone no es log.** Sale de cámara ya perfilado: pie levantado,
hombro suave en altas luces y piel desaturada a propósito. No hay que
«revelarlo».

Aplicarle `carbon_bronze` —pensado para material plano— vuelve a levantar
un negro que ya venía levantado. Medido sobre el metraje real:

| | negro (YMIN) | blanco (YMAX) | saturación |
|---|---|---|---|
| sin LUT | 21 | 241 | 5,6 |
| `carbon_bronze` | **33** | 224 | **4,7** |
| `scinetone_s11` | **17** | 229 | 5,6 |

`carbon` sube el negro doce niveles —ese es el velo lechoso— y desatura
material que ya venía desaturado. El preset `scinetone` hace lo contrario:
pie **negativo** para densificar el negro, contraste contenido (0,17 frente
a 0,28) y un hombro que comprime al acercarse al blanco **sin dejar de
llegar a él**.

---

## §15 · Micro-FX por palabra

Otra clase de gráfico. Duran menos de segundo y medio, se anclan a **una
palabra** y no ocupan la pantalla como una tarjeta. Viven en su propio
carril y con su propio presupuesto: si entraran en el reparto de actos,
volveríamos al problema que ese reparto vino a resolver.

**Seis del catálogo pedido YA existían con otro nombre** y no se han
duplicado: `number-roll`→`odometro`, `marker-sweep`→`highlighter-text`,
`cli-typewriter`→`terminal`/`code-mockup`, `vs-slash`→`split-versus`,
`glass-toast`→`notification-pop`, `search-glass`→`search-bar`.

`cursor-tap` estuvo en esa lista —«→ el puntero de `cierre-cta`»— y el alias
no aguantó el primer guion real: la pieza de Codex pidió un tap sobre
«perfil» y aquel puntero está soldado a SU tecla, no puede tocar un x/y
arbitrario del plano. `leer_guion.py` lo informaba y lo omitía. Ahora es una plantilla propia,
`cursor-tap.html`: el mismo puntero de la marca —grafito con canto
de bronce, dibujado en SVG, nunca un dingbat— que llega, TOCA (presión con
retorno de muelle y UNA onda que se abre y muere, no el ripple de Material) y
se retira. `config.x`/`config.y` es el punto, `config.escala` el tamaño,
`config.texto` la etiqueta opcional bajo el punto y `config.pulsacion` el
instante del contacto — la clave ya clasificada del clic de puntero, no un
nombre nuevo. No publica `cues`: el clic lo pone la tabla del director o el
cue del guion (`mouse_click.wav`→`clic`), como `target-hud`.

### Los catorce nuevos

| Plantilla | Dispara con | Qué hace |
|---|---|---|
| `stroke-crossout` | no · jamás · nunca · error · fallo · mito | trazo rojo que tacha en 0,2 s |
| `stamp-banned` | prohibido · ilegal · obsoleto · basura · roto | sello que cae con rebote y suelta polvo |
| `cut-strip` | cortar · eliminar · reducir · simplificar · quitar | línea de puntos que separa el texto en dos mitades |
| `green-spike` | crecer · multiplicar · escalar · disparar · exponencial | gráfica que se dispara + etiqueta que vibra |
| `red-crash` | caer · perder · desplomarse · bajar · cero | caída acelerada + aviso por los bordes |
| `head-explode` | explotar · locura · brutal · flipas · bestial | onda radial de partículas con sacudida de lienzo |
| `gold-glint` | oro · valor · top · premium · gratis · calidad | banda de luz que cruza el relleno del texto |
| `target-hud` | mira · fíjate · detalle · detectar · concreto | visor que **cierra** sobre el punto |
| `neural-node-pulse` | ia · cerebro · pensar · modelo · agente · red | nodos que se encienden en cadena con halos |
| `svg-checkmark` | correcto · funciona · solución · listo · hecho | aro y tic dibujados, con rebote |
| `padlock-unlock` | truco · estrategia · desbloquear · acceso · secreto | el arco salta y gira, con fogonazo |
| `timer-ring` | rápido · urgente · segundos · minutos · deprisa | anillo que se vacía en sentido horario |
| `text-stack-offset` | muchos · miles · millones · repetir · múltiples | el texto se multiplica hacia atrás |
| `cursor-tap` | pulsa · toca · aquí · perfil · suscríbete | puntero que llega, TOCA y suelta una onda |

### Presupuesto

| Regla | Valor |
|---|---|
| Máximo por pieza | 6 |
| Separación entre micro-FX | 7 s |
| Aire alrededor de una tarjeta de acto | 0,6 s |
| Cada efecto | **una sola vez** |

Sin presupuesto, «no» y «modelo» aparecen tantas veces en un guion técnico
que el vídeo se llena de destellos: el efecto pasa de subrayar a ser ruido.
Y el mismo destello tres veces deja de significar algo — se lee como un tic
del montaje, no como una decisión.

Los disparadores se comparan **sin tildes y con límites de palabra**: «no»
no puede casar dentro de «nota», y «jamás» tiene que casar escrito de las
dos maneras que devuelve Whisper.

### Orden de capas

Los micro-FX van **por encima** de las tarjetas y **por debajo** de los
subtítulos: son acentos sobre lo que ya hay, no contenido que deba competir
con la lectura.

---

## §16 · Catálogo de subtítulos (`subtitles-showcase.html`)

Diez presets para inspeccionar y elegir. Dos vistas:

```json
{"vista": "rejilla"}                  // los 10 en 2x5, etiquetados
{"vista": "solo", "preset": 2}        // uno a tamaño real
```

**La clave es `vista`, no `modo`.** `render_playwright.js` hace
`Object.assign({}, capa.config, { modo })` y sobrescribe esa clave con la
suya: una plantilla que use `modo` se queda sin ella **en silencio**. El
renderizador ahora avisa cuando detecta el choque.

| # | Preset | Familia | Acento |
|---|---|---|---|
| 1 | Carbon & Bronze | Plus Jakarta Sans 800 | `#CD7F32` sobre `#F5F5F5` |
| 2 | Cinematic Coral | Montserrat 800 + Yellowtail | `#FF3B4E` con bloom |
| 3 | Hormozi | Montserrat 900 | `#FFE500`, trazo negro 4 px, −2° |
| 4 | Cyber Neon | JetBrains Mono 700 | `#00F0FF` doble resplandor |
| 5 | Editorial | Geist + Playfair itálica | `#F4E0A5` |
| 6 | 3D Offset | Montserrat 900 | extrusión `4px/8px` a `#FF3B4E` |
| 7 | Glass Gradient | Plus Jakarta Sans 800 | degradado bronce → coral |
| 8 | Electric Lime | Inter 800 | `#CCFF00` |
| 9 | Label Tape | Geist Mono 700 | caja por palabra |
| 10 | Gold Shimmer | Plus Jakarta Sans 800 | barrido dorado animado |

### Las fuentes van del sistema, no de Google Fonts

Un `@import` a Google Fonts **no da error si falla**: cae a la fuente de
respaldo y el preset se maqueta con otra letra sin que nada lo diga. Las
diez familias se instalan en local:

```bash
brew install --cask font-plus-jakarta-sans font-montserrat font-yellowtail \
                    font-caveat font-jetbrains-mono font-geist font-geist-mono \
                    font-playfair-display font-inter font-instrument-serif
```

### El bloom del preset 2

Es un `filter: drop-shadow(...)` sobre el texto, **no** un `text-shadow`.
El filtro difumina el glifo ya compuesto y da un halo; `text-shadow` solo
pinta copias desplazadas y produce un contorno. Medido sobre el render:
el halo se extiende **45 px a cada lado**, es rojo —`rgb(120,27,34)` a 4 px
del glifo— y decae de alfa 104 a 24 en 36 px.

### El catálogo va sobre MEDIO TONO, no sobre negro

Sobre negro, el trazo negro de 4 px del preset 3 y las sombras duras del 6
son invisibles. Están ahí —18.000 píxeles cambian al quitarlos, medido—
pero no se pueden juzgar. Un catálogo sobre fondo negro miente sobre la
mitad de sus fichas. Las celdas alternan un tono medio frío y otro cálido,
que es el rango donde caen la piel y una pared normal.

---

## §17 · Los dos componentes que quedaban

Cierran la cola de «Componentes nuevos» de la ronda 1. No se parecen entre
sí: uno es una tarjeta más y el otro es el primero del catálogo que toca al
METRAJE.

### `rejilla-logos.html` · rejilla de marcas y lockup

Dos vistas en una plantilla, porque son la misma relación a dos escalas: la
rejilla enseña un conjunto de marcas y el lockup enseña UNA con su
logotipo.

La clave es **`vista`, nunca `modo`**. `modo` la pisa el renderizador con
la pasada de render (`detalle` / `mascara`), así que una plantilla que la
use para otra cosa tiene un valor inalcanzable por el pipeline. Ya pasó dos
veces: `data-diagram` sigue con su modo `tabla` muerto y
`subtitles-showcase` se arregló renombrando a `vista`.

**Las marcas son monogramas tipográficos por defecto, y eso es una
decisión, no una carencia.** Dibujar de memoria el logo de otro sale mal, y
además no es nuestro para redibujarlo. Cuando haga falta el logo de verdad
se pega su trazado en `marca` —o el `<svg>` completo en `svg`— y la
plantilla lo usa en lugar del monograma.

**No se acepta un `<img>`, y el motivo no es estético:** una imagen se
decodifica de forma asíncrona y Playwright puede capturar antes de que esté
pintada, así que el mismo `seek(t)` daría dos píxeles distintos según lo
que tardara el disco. Todo el proyecto se apoya en lo contrario. El SVG en
línea se pinta con el layout y no tiene esa carrera.

Dos detalles que salieron de mirar el fotograma y no el JSON:

- **La nota del elegido va bajo la REJILLA, no bajo su tesela.** Medida
  desde la tesela, un elegido de la primera fila deja la nota cruzada sobre
  dos marcas de la segunda.
- **Sin título ni subtítulo hay que colapsar la cabecera.** Su
  `margin-bottom` sigue ocupando y descentra el bloque trece píxeles: no se
  lee como un error, se lee como una maqueta mal centrada, que es peor.

Cuando hay elegido, **los demás RECEDEN**. Destacar uno subiendo su brillo
lo saca de la paleta; bajando el de los otros, no.

### `antes-despues.html` · cortinilla sobre metraje

**El «antes» es el metraje de verdad sin grading, no una imitación.** Es
todo el valor del componente. Un «antes» falseado bajando la saturación
demuestra el efecto que se le aplique, no el grading que lleva la pieza.

> **Aviso medido:** con el LUT de marca esa comparación **no se ve**. El
> grading cambia la imagen una mediana de **5/255 — un 2 %**, con el
> percentil 95 en 18. La causa es de diseño: la cámara ya entrega S-Cinetone
> y al LUT le queda poco trabajo. Con un LUT fuerte se lee de sobra, así que
> el mecanismo está bien; lo que estaba mal elegido era QUÉ se comparaba.

### Lo normal es revelar una IMAGEN

Por eso la capa acepta `imagen`, y es el uso principal:

```json
{ "capa": "antesdespues", "template": "antes-despues.html",
  "t": 12.0, "duracion": 5.0, "cortinilla": true,
  "imagen": "assets/broll/auditoria_antes.png",
  "config": { "duration": 5.0, "hasta": 0.64, "viaje": 1.8,
              "antes": "LO QUE ENCONTRÓ", "despues": "LO QUE HICE" } }
```

El lado «antes» es la captura —el fallo, el diseño viejo, el diff— y el
«después» eres tú contándolo. Es la comparación que de verdad hace una pieza
técnica, y a diferencia del revelado por metraje **se ve siempre**, porque
los dos lados no tienen por qué parecerse.

Con `imagen` **decaen los dos avisos** del revelado por metraje: ni el LUT
ni `--aroll completo` hacen falta, porque la imagen no tiene que casar con
el encuadre de nada.

`ajuste` decide el encaje: **`cubrir`** (defecto) llena el cuadro y recorta,
porque una captura con bandas al lado del metraje se lee como un error de
montaje; **`contener`** la deja entera sobre el fondo de marca, para cuando
lo que importa es leerla completa.

**La imagen no pasa por el LUT**: es un asset, no metraje. Graduar una
captura de pantalla la tiñe de bronce y deja de ser la captura.

**Y `-loop 1` va SIEMPRE con `-t`.** Una imagen fija entra en bucle porque
el revelado dura segundos, pero sin cota es una entrada infinita y
`alphamerge` espera a que terminen todas las suyas: la composición **no
falla, se cuelga**. Medido: diez minutos sin escribir un fotograma más. Se
acota a la duración de la pieza y no a la de la capa, para que su reloj
coincida con el del A-Roll — la máscara viene desplazada a `t0` y una imagen
que empezara en 0 se emparejaría descolocada.

**No pases de `hasta: 0.65`** si quieres conservar el rótulo derecho: cada
rótulo se apaga cuando su lado se queda sin sitio para él, y con el canto al
70 % «DESPUÉS» no llega nunca a verse entero. Es la regla funcionando, pero
sorprende.

Se consigue **reusando el motor de máscaras del cristal**, que resulta ser
más general de lo que su nombre decía: la plantilla emite su segunda pasada
y ffmpeg recorta con esa silueta una **segunda cadena de A-Roll idéntica
salvo en el LUT**. Mismo corte, mismo recorte por rostro, mismo zoom por
tramo — sale de llamar dos veces a la misma función, así que solo puede
diferir lo que se le pasa. Con la geometría replicada a mano, los dos lados
mostrarían encuadres distintos del mismo instante.

De ahí `.silueta`, nueva en `_tokens.css`: una región de máscara **sin
vidrio**. Con la clase `.cristal` el panel se vería además como una
pastilla difuminada en la pasada de detalle. El cristal es UN uso de la
máscara, no la máscara.

**«Arrastrable» en vídeo no puede significar interacción.** No hay ratón y
el fotograma se calcula, no se reacciona. Significa que se ve el AGARRE —el
tirador con sus dos flechas— y que el canto se mueve con la inercia de una
mano. Por eso la curva es `inOutCubic` y no `outCubic`: una mano que agarra
arranca despacio, y con `outCubic` el canto sale disparado en el primer
fotograma y se lee como un barrido automático. Nada de `outBack` ni
`outElastic`: §11 los prohíbe y aquí además mentirían, porque un tirador no
rebota.

Tres piezas en el canto, y las tres hacen falta: la **línea** marca el
corte, el **degradado** le da grosor óptico para que no parezca un error de
compresión, y el **resplandor** lo despega del metraje cuando los dos lados
tienen luminancia parecida — que es lo normal en un antes/después de
grading, donde el corte puede caer sobre una pared lisa.

**El ancho de la máscara se redondea al píxel.** En fracciones, ffmpeg
recibe un alfa con un borde a medio tono y el canto se ve doble: una línea
nítida junto a una difusa de un píxel.

Cada rótulo se desvanece cuando su lado se queda sin sitio, con **el umbral
medido** —el ancho real del rótulo más su margen— y no con un porcentaje:
«ANTES» y «DESPUÉS» no miden lo mismo y un porcentaje único deja a uno de
los dos pisando el canto.

Dos casos en los que el compositor **avisa y omite el revelado**, en vez de
componer algo que parece funcionar:

- **Sin LUT** los dos lados serían el mismo píxel. La cortinilla se vería
  moverse sin revelar nada, que es peor que no ponerla.
- **Con el metraje en columna** (`--aroll izquierda|derecha`) el lado crudo
  tendría que repetir el escalado, el relleno difuminado y el overlay de la
  columna, y cualquier diferencia se vería como un salto en el canto.

Va **abajo en el orden de apilado**, justo tras `fondo` y `globo`: revela
metraje, así que forma parte del plano y cualquier tarjeta tiene que poder
taparla.

### Las dos quedan para planes escritos a mano

Como `compare-ab` y `split-versus`, y por la misma razón de §12: su
contenido no se puede inventar. La rejilla necesita una lista de marcas
reales y la cortinilla solo significa algo cuando hay un grading que
comparar. `dirigir.py` no puede elegirlas —`candidatas_para` exige
`RELLENABLES` y no están— y **no llevan guardia a propósito**: una guardia
sobre una plantilla inalcanzable es el error de `faq-card` al revés, mentir
sobre el catálogo en la otra dirección.

---

## §18 · Zona segura de plataforma

Este repo compone un 1080x1920 **limpio**, y nadie lo ve así. Reels, TikTok
y Shorts dibujan encima: abajo a la izquierda el caption con el usuario y la
pista de audio, abajo del todo la navegación o el CTA, a la derecha la
columna de acciones, arriba la cabecera y el progreso.

Y el problema no es que la interfaz exista, es que **§6 empuja justo hacia
ella**. `face.json` manda la UI al tercio inferior (`y ≈ 0.72`) cuando la
cara está arriba o centrada, que es el caso normal; el colocador resuelve
los choques con el rostro empujando hacia abajo; y los subtítulos viven
abajo por diseño. Las tres decisiones son correctas por separado y apuntan
al mismo sitio: el único que no se ve.

Medido en la pieza montada, con la banda que se declara abajo:

| capa | ocupa | dentro de la banda |
|---|---|---|
| `kineticcaptions` | y 1520-1760 | **240 px abajo — la banda entera** |
| `headlineclipper` | y 92-652 | 138 px arriba |

O sea: los subtítulos de esa pieza caen **enteros** dentro de la banda
inferior estimada. No es un ajuste fino, es la línea de lectura.

### La banda, y por qué está en fracciones

| plataforma | arriba | abajo |
|---|---|---|
| `reels` | 12 % | 24 % |
| `tiktok` | 12 % | 24 % |
| `shorts` | 12 % | 24 % |
| `ninguna` | — | — |

**`reels` está MEDIDO; `tiktok` y `shorts` HEREDAN esa medición** (decisión
del 13-ago-2026: misma anatomía de UI, y la medida real es más estricta que
la estimación ciega que tenían). La diferencia importa y el informe de
`colocar.py` la dice en voz alta: heredado no es medido, y una banda medida
que se presenta como estimación acaba descontada por quien la lee. (Esta
tabla decía 22 % abajo para las tres desde antes de la medición: era la
mención equivocada que `comprobar_docs` no caza.)

La medida de Reels, sobre dos capturas de iPhone (1179x2556) de reels
DISTINTOS, el 4 de agosto de 2026:

| elemento | píxeles de pantalla |
|---|---|
| barra de estado del sistema + navegación (`+`, For you / Friends, ajustes) | 0 → 300 |
| avatar, usuario, «Translate with AI», copy, «Followed by», progreso y pestañas | 1905 → 2556 |

Eso es **11,7 % arriba y 25,5 % abajo**, y la banda inferior se queda en el
**24 %**: el 25,5 % salió de la captura con el copy MÁS LARGO que había
—usuario, «Translate with AI», dos líneas de texto y «Followed by»—, y
tratar ese caso como el normal reserva de más. La captura de copy corto
daba 21,8 %. La estimación anterior era 12 % y 22 %: el borde superior
estaba bien y el inferior se quedaba corto.

### La columna de la derecha, que es un RECTÁNGULO

Los iconos —likes, comentarios, compartir, el menú y la miniatura— suben
mucho más arriba que la banda inferior, y modelarlos como una banda de
altura completa marcaba cualquier gráfico ancho. Medido sobre la misma
captura: van de y=1191 a y=2195 de pantalla, que sobre el vídeo son y
995-1914 del lienzo, y arrancan en x=1044 de 1179.

| | fracción |
|---|---|
| ancho, desde el borde derecho | 12 % |
| desde qué altura | 52 % |

Un gráfico centrado no la toca por ancho que sea; uno pegado a la derecha
la pisa aunque esté a media altura, que es justo lo que las dos bandas
horizontales daban por bueno.

### Una advertencia sobre el encaje

La pieza puede salir a pantalla completa —lo normal— o **encajada por
ancho con bandas negras**, que es lo que hace Instagram cuando el vídeo es
9:16 exacto y el teléfono más alto. Medido en una captura de una pieza de
este pipeline: el vídeo ocupó y 104-2200 de 2556, con 104 px de negro
arriba y 355 abajo. Con bandas la interfaz tapa MENOS lienzo, así que las
fracciones de esta tabla son el caso conservador — el lado correcto.

**Cómo se miden**, ya no en prosa sino en un comando: dos capturas de piezas
distintas y `scripts/medir_zona_segura.py --regla`, que dibuja la retícula
de coordenadas encima para leer las fronteras. Su modo automático —aislar la
interfaz porque es lo único que coincide entre dos vídeos— solo vale para
interfaces OPACAS, y con la de Instagram se niega a medir en vez de inventar
una banda: es texto suelto sobre el vídeo, y entre letra y letra se ve lo de
debajo.

### Avisa, no mueve

`colocar.py --plataforma reels|tiktok|shorts|ninguna` (defecto `reels`)
mide la caja real de cada gráfico por su alfa —incluidos los subtítulos, que
el reparto de choques salta por ser cromo, y las capas con `colocar: false`,
que son las colocadas a mano— y dice cuántos píxeles mete en cada banda.

No propone `dy` y no cambia el código de salida, a propósito: un
desplazamiento calculado sobre una estimación se hereda como si estuviera
medido, y el fallo sería invisible. Además, cuando la cara está baja **no
hay respuesta buena**: entre el rostro, la banda de lectura y la interfaz
de la app no queda hueco, y lo que hay que cambiar es el encuadre o el zoom
del tramo, no el `dy` de una tarjeta.

`--plataforma ninguna` lo apaga. Es lo que hay que usar cuando la pieza no
va a una de las tres.

### El eje horizontal no se modela

La columna de acciones de la derecha ocupa sitio y aquí no se comprueba.
Es la misma declaración que `POS_*`, `FRAME_LEFT` y `MODE_FULL_MOTION`: lo
que el pipeline no sabe hacer se **declara** en vez de fingirse. Comprobarlo
marcaría como problema toda tarjeta a sangre —que son casi todas— y un
aviso que salta siempre no es un aviso.

---

## §19 · Catálogo importado (HyperFrames)

Ciento veintiséis piezas del catálogo de **HyperFrames** (HeyGen, Apache-2.0) viven
en `templates/` con el prefijo `hf-`. No son plantillas de este repo
disfrazadas: son suyas, traídas con `scripts/importar_bloque.js`, y esta
sección existe porque una plantilla que nadie nombra es una plantilla que
nadie sabe para qué es.

<!-- HF:inicio · lista generada por scripts/importar_bloque.js -->

| plantilla | qué es | gesto medido |
|---|---|---|
| `hf-app-showcase.html` | app-showcase | 5.50 s |
| `hf-apple-money-count.html` | — | 4.76 s |
| `hf-beat-freeze-cut.html` | Beat Freeze Cut | 6.00 s |
| `hf-blue-sweater-intro-video.html` | Blue Sweater Intro Video | 11.24 s |
| `hf-camcorder-hud.html` | — | 1.20 s |
| `hf-caption-clip-wipe.html` | Clip Wipe | 8.08 s |
| `hf-caption-editorial-emphasis.html` | Editorial Emphasis | 7.70 s |
| `hf-caption-emoji-pop.html` | Emoji Pop | 7.70 s |
| `hf-caption-gradient-fill.html` | Gradient Fill | 8.20 s |
| `hf-caption-highlight.html` | Highlight | 7.80 s |
| `hf-caption-kinetic-slam.html` | Kinetic Slam | 7.80 s |
| `hf-caption-parallax-layers.html` | Parallax Layers | 8.00 s |
| `hf-caption-pill-karaoke.html` | Pill Karaoke | 7.70 s |
| `hf-caption-weight-shift.html` | Weight Shift | 7.70 s |
| `hf-chromatic-radial-split.html` | — | 1.20 s |
| `hf-cinematic-zoom.html` | — | 1.20 s |
| `hf-code-3d-extrude.html` | Code 3D Extrude | 1.20 s |
| `hf-code-diff.html` | Code Diff | 1.20 s |
| `hf-code-highlight.html` | Code Highlight Sweep | 1.20 s |
| `hf-code-morph.html` | Code Morph | 1.20 s |
| `hf-code-particle-assemble.html` | Code Particle Assemble | 1.20 s |
| `hf-code-scroll.html` | Code Scroll To Line | 1.20 s |
| `hf-code-shader-dissolve.html` | Code Shader Dissolve | 1.20 s |
| `hf-code-typing.html` | Code Typing | 1.20 s |
| `hf-cross-warp-morph.html` | — | 1.20 s |
| `hf-data-chart.html` | Data Chart | 9.50 s |
| `hf-domain-warp-dissolve.html` | — | 1.20 s |
| `hf-flash-through-white.html` | — | 1.20 s |
| `hf-flowchart-vertical.html` | Flowchart Vertical | 8.50 s |
| `hf-flowchart.html` | Flowchart | 8.50 s |
| `hf-freeze-frame-dressing.html` | — | 1.20 s |
| `hf-glitch.html` | — | 1.20 s |
| `hf-gravitational-lens.html` | — | 1.20 s |
| `hf-hw-arrow.html` | — | 3.98 s |
| `hf-hw-boil.html` | — | 3.98 s |
| `hf-hw-box-label.html` | — | 3.98 s |
| `hf-hw-callout-circle.html` | — | 4.98 s |
| `hf-hw-frame.html` | — | 8 s |
| `hf-hw-path-text.html` | — | 6 s |
| `hf-hw-pipeline.html` | — | 7 s |
| `hf-hw-scribble-transition.html` | — | 1.49 s |
| `hf-hw-text-cloud.html` | — | 6 s |
| `hf-hw-title.html` | — | 6 s |
| `hf-hw-underline.html` | — | 3.98 s |
| `hf-instagram-follow.html` | — | 2.19 s |
| `hf-ios26-liquid-glass.html` | Devices Canvas — HTML-in-Canvas API Showcase | 15.00 s |
| `hf-light-leak.html` | — | 1.20 s |
| `hf-liquid-glass-context-menu.html` | Liquid Glass Context Menu | 1.20 s |
| `hf-liquid-glass-media-controls.html` | Liquid Glass Media Controls | 1.20 s |
| `hf-liquid-glass-notification.html` | — | 1.20 s |
| `hf-liquid-glass-widgets.html` | Liquid Glass Widgets | 1.20 s |
| `hf-logo-outro.html` | Logo Outro | 1.20 s |
| `hf-lower-third-bild.html` | — | 1.20 s |
| `hf-lt-accent-underline.html` | — | 1.49 s |
| `hf-lt-bold-block.html` | — | 1.49 s |
| `hf-lt-clean-bar.html` | — | 1.49 s |
| `hf-lt-color-block.html` | — | 1.49 s |
| `hf-lt-dark-card.html` | — | 1.69 s |
| `hf-lt-kicker-name.html` | — | 1.69 s |
| `hf-lt-mask-reveal.html` | — | 1.69 s |
| `hf-lt-side-rule.html` | — | 1.49 s |
| `hf-lt-soft-pill.html` | — | 1.49 s |
| `hf-lt-stack-bars.html` | — | 1.29 s |
| `hf-macos-notification.html` | — | 1.25 s |
| `hf-macos-tahoe-liquid-glass.html` | Devices Canvas — HTML-in-Canvas API Showcase | 15.00 s |
| `hf-mk-background.html` | — | 9.98 s |
| `hf-mk-callout-highlight.html` | — | 8 s |
| `hf-mk-clone-wall-transition.html` | — | 2.36 s |
| `hf-mk-line-graph.html` | — | 7 s |
| `hf-mk-placeholder-grid.html` | — | 7.98 s |
| `hf-mk-progress-stat.html` | — | 7 s |
| `hf-mk-specs-list.html` | — | 8 s |
| `hf-mk-usage-arc.html` | — | 2.16 s |
| `hf-morph-text.html` | Morph Text | 15.00 s |
| `hf-news-ticker.html` | News Ticker | 6.96 s |
| `hf-north-korea-locked-down.html` | — | 6.74 s |
| `hf-nyc-paris-flight.html` | — | 5.62 s |
| `hf-organic-light-leak-overlay.html` | — | 4.00 s |
| `hf-reddit-post.html` | — | 1.25 s |
| `hf-ridged-burn.html` | — | 1.20 s |
| `hf-ripple-waves.html` | — | 1.20 s |
| `hf-sdf-iris.html` | — | 1.20 s |
| `hf-spain-map.html` | Spain Map | 1.20 s |
| `hf-spotify-card.html` | — | 4.70 s |
| `hf-swirl-vortex.html` | — | 1.20 s |
| `hf-thermal-distortion.html` | — | 1.20 s |
| `hf-tiktok-follow.html` | — | 2.19 s |
| `hf-transitions-3d.html` | 3D Transitions | 1.20 s |
| `hf-transitions-blur.html` | — | 19.30 s |
| `hf-transitions-cover.html` | Cover Transitions Showcase | 19.20 s |
| `hf-transitions-destruction.html` | — | 8.81 s |
| `hf-transitions-dissolve.html` | — | 23.80 s |
| `hf-transitions-distortion.html` | Distortion Transitions | 20.90 s |
| `hf-transitions-grid.html` | Grid Transitions | 10.90 s |
| `hf-transitions-light.html` | Light Transitions Showcase | 19.20 s |
| `hf-transitions-mechanical.html` | — | 14.80 s |
| `hf-transitions-other.html` | — | 19.30 s |
| `hf-transitions-push.html` | — | 23.80 s |
| `hf-transitions-radial.html` | Radial Transitions | 14.25 s |
| `hf-transitions-scale.html` | — | 14.80 s |
| `hf-ui-3d-reveal.html` | ui-3d-reveal | 13.30 s |
| `hf-us-map-bubble.html` | US Bubble Map | 1.20 s |
| `hf-us-map-flow.html` | US Flow Map | 1.20 s |
| `hf-us-map-hex.html` | US Hex Grid Map | 8.74 s |
| `hf-us-map.html` | US Map | 1.20 s |
| `hf-vfx-iphone-device.html` | Devices Canvas — HTML-in-Canvas API Showcase | 1.20 s |
| `hf-vfx-liquid-background.html` | — | 1.20 s |
| `hf-vfx-liquid-glass.html` | Liquid Glass Parallax | 20.00 s |
| `hf-vfx-magnetic.html` | Magnetic Cursor — HTML-in-Canvas | 15.00 s |
| `hf-vfx-portal.html` | HTML Portal Transition | 1.20 s |
| `hf-vfx-text-cursor.html` | VFX Text Cursor | 5.54 s |
| `hf-vpn-youtube-spot.html` | — | 7.75 s |
| `hf-whip-pan.html` | — | 1.20 s |
| `hf-world-map.html` | World Map | 1.20 s |
| `hf-x-post.html` | — | 1.25 s |
| `hf-yt-camera-move.html` | — | 2.16 s |
| `hf-yt-circle-pointer.html` | — | 2.37 s |
| `hf-yt-comment-card.html` | — | 8 s |
| `hf-yt-feather-highlight.html` | — | 1.54 s |
| `hf-yt-lcd-background.html` | — | 10 s |
| `hf-yt-logo-intro.html` | — | 6 s |
| `hf-yt-lower-third.html` | — | 2.19 s |
| `hf-yt-prism-title.html` | — | 6 s |
| `hf-yt-screen-warp.html` | — | 1.83 s |
| `hf-yt-vertical-fill.html` | — | 8 s |

<!-- HF:fin -->

### Lo que cumplen, y por qué se puede confiar

Pasan el mismo humo que las nuestras: `setup` devuelve duración, la raíz no
es opaca, se mueven en los tres instantes que se muestrean, ninguna usa
`modo` como clave propia y ningún fotograma sale vacío. El puente es de
cuatro líneas porque los dos motores hacen lo mismo —posicionar la animación
en el segundo `t`, sin tocar el reloj del navegador— y por tanto **el
determinismo se conserva**: mismo `t`, mismo pixel.

### Lo que NO cumplen todavía, dicho aquí y no escondido

- **Paleta.** Las variables de re-vestido de cada familia (`--mk-*`,
  `--yt-*`, `--hw-*`, `--cap-*`) están cruzadas con `_tokens.css`, así que
  responden al tema. Los hexadecimales que no pasan por variable siguen ahí,
  delimitados con `PALETA-AJENA` y **contados aparte** por
  `auditar_estilo.js`. Ese número es la deuda y se ve.
- **Sonido.** Entran mudas POR DEFECTO; `config.cue` (+ `cueGain`) pide un
  sonido del banco a mano. Lo que falta es la tabla del director que sepa
  qué suena cada familia sin pedírselo capa a capa.
- **Anclas.** ~~Ninguna publica `anclas()`~~ — desactualizado, y esta viñeta
  fue el aviso: el puente MIDE la caja de tinta (unión de rectángulos
  visibles a coordenadas de lienzo, dos pasadas para no devolver el lienzo
  entero) y las 125 generadas la publican; verificado headless el 13-ago
  (lower-third → y 1306, alto 228). `colocar.py` las ve como a cualquier
  plantilla propia. La diferencia que queda: la caja medida es la del
  bloque entero, no «la parte que importa» que una plantilla propia declara
  con criterio.
- **Maqueta.** Están pensadas para 1920×1080 y aquí se escalan al ancho del
  lienzo vertical dentro de una caja de su tamaño declarado. Es un apaño
  —`config.encaje: false` lo desactiva— y la solución de verdad es rehacer
  la maqueta en vertical, pieza a pieza.
- **Salida.** Sus bloques entran y se quedan puestos; la salida la pone el
  puente, genérica, y se apaga con `config.salida: false` cuando la pieza
  tenga la suya.

### La regla que sí es innegociable

§1 sigue mandando: **nada de neón**. Del catálogo quedan fuera
`caption-neon-glow`, `caption-neon-accent`, `caption-glitch-rgb`,
`caption-particle-burst` y `caption-matrix-decode`, que resaltan con luz y no
con contraste ni peso. Que una pieza esté en el catálogo no la hace de marca.
