# Motion graphics verticales: qué se hereda de HyperFrames

Hermano de `docs/motion-graphics.md`, que documenta el port desde
`QuantumBBoy/editor-youtube`. Este cubre la segunda fuente:
`heygen-com/hyperframes` (Apache-2.0), y el formato 9:16.

## Por qué se puede portar, y qué NO se adopta

HyperFrames anima con `gsap.timeline({ paused: true })` posicionado por seek —el
mismo paradigma que `seek(t)` del hermano, y por tanto equivalente a
`useCurrentFrame()`—, así que las coreografías se copian en vez de aproximarse.

**No se adopta el motor.** HyperFrames renderiza HTML con Puppeteer: sería un
segundo motor de render junto a Remotion, con su propio Chromium, su toolchain y
su forma de empaquetar. Y la librería tampoco entra: una timeline de GSAP es
estado mutable, y aquí la posición se deriva del frame.

Dos avisos que no aplicaban al hermano:

- **Algunas piezas usan `@keyframes` de CSS**, que no es seekable. Allí la
  garantía era global —ninguna de sus 56 plantillas los usaba—; aquí hay que
  mirar pieza a pieza.
- **El catálogo es apaisado.** De 179 `registry-item.json`, 136 declaran
  1920×1080 y solo 4 declaran 1080×1920. Los 16 `caption-*` están compuestos a
  1920×1080 y se adaptan escalando el escenario. Se porta su **gramática**,
  nunca su layout.

## Qué se porta

| pieza                  | qué aporta                                                    | destino                          |
| ---------------------- | ------------------------------------------------------------- | -------------------------------- |
| `caption-kinetic-slam` | una palabra en pantalla; cuerpo ajustado por medida           | `themes/SubtitulosCineticos.tsx` |
| `caption-pill-karaoke` | tope de palabras por grupo y la cola de 300 ms tras la última | `themes/agrupar.ts`              |
| `caption-weight-shift` | el peso variable como gesto de énfasis                        | la entrada impar del tema        |
| `caption-highlight`    | el resalte por palabra                                        | el subrayado de keyword          |
| `motion-blur`          | desenfoque direccional ligado a la velocidad                  | el whip-pan                      |
| `whip-pan`             | la coreografía del latigazo                                   | `effects/transitions.tsx`        |
| `yt-vertical-fill`     | la idea del relleno y el `inset` del desenfoque               | `encuadre.ts`                    |

Tres rechazos deliberados dentro de lo que sí se porta:

- El `back.out(2.2)` de kinetic-slam **se pasa un ~22 %** cuando la guía de marca
  heredada fija el tope en 6 %. Se usa `outBack6`, que es esa curva calibrada y
  con test numérico.
- Su barrido lateral entra y sale **por el borde derecho**, justo encima de la
  columna de botones de la plataforma.
- La **píldora sólida** de pill-karaoke es el cromo de los subtítulos
  automáticos de la plataforma: ponerla es firmar el vídeo con la marca de otro.
  El fondo lo da el `scrim` del canal.

Y del whip-pan se porta la coreografía pero no la implementación: la suya
reconstruye el DOM en un canvas 2D dibujando cajas y texto elemento a elemento
para poder texturizarlo con WebGL, y por el camino pierde radios, sombras,
imágenes y máscaras. Aquí es `translateX` + `blur`.

El desenfoque va ligado a la **velocidad**, no al progreso. Como la derivada de
`inOutCubic` es una parábola, basta `4·p·(1-p)`: cero en los extremos, máximo en
mitad del barrido. Eso es lo que lo hace leer como un latigazo y no como un
deslizamiento borroso. Y la capa desborda 1,5× el blur, o el propio desenfoque
descubre un canto en el borde del lienzo.

## Qué no se porta

| pieza(s)                                            | por qué                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| los 12 `transitions-*`                              | son showcases de 11-24 s, no componentes                                                |
| las 12 transiciones de shader                       | reconstruyen el DOM en canvas; pierden todo lo que no sea una caja                      |
| 9 `caption-*` de neón, arcoíris, partículas y emoji | los prohíbe la regla 1 heredada; `blend-difference` además invierte el acento del canal |
| los 24 `code-snippet-*`                             | este canal no enseña código, y si lo hiciera `DeviceFrame` ya es el marco               |
| `ios26-liquid-glass` y familia                      | cromo de un sistema operativo ajeno; `glassSurface` ya da el cristal DE ESTE canal      |
| `yt-logo-intro`, `lt-*`, `lower-third-bild`         | rótulos de otras marcas                                                                 |
| los 7 `hw-*`                                        | traen su propia fuente, y `design.font_family` solo admite Inter                        |
| `freeze-frame-dressing`                             | exige el sujeto recortado del fondo: un modelo nuevo en el camino crítico               |
| `grain-overlay`, `vignette`                         | ya son `Ambience`, y van con CSS keyframes                                              |

## Lo que el formato cambia por sí solo

**El Ken Burns cambia de eje.** En apaisado el elemento se renderiza al tamaño
del lienzo, así que panear descubre bordes: por eso el paneo es del 2 % y va
atado a un zoom de 1,08 que lo tapa. En vertical, un 16:9 a `cover` sobre
1080×1920 se renderiza a 3413×1920: sobran ±1166 px en horizontal y cero en
vertical. El paneo vertical desaparece, el horizontal sube al 12 % sin descubrir
nada, y el zoom baja a 1,04 porque sobre un recorte que ya amplía 1,78× se
empieza a ver el pixelado del origen 1080p.

**Los efectos NO se encogen en bloque.** Hubo un `scale(ancho/1920)` sobre toda
la capa, con el argumento de que su tipografía está calibrada sobre 1920 y a
1080 saldría 1,78× más grande en relativo. Duró hasta que se miró un short
renderizado: el callout se dibujaba a 26 px efectivos y era **ilegible en un
móvil**. Lo que se calibró en 1920 es el **ancho de las piezas grandes**, no el
cuerpo del texto —46 px sobre 1080 son el 4,3 % del ancho, que está bien—, así
que cada pieza se arregla donde toca: `KineticText` deriva su tamaño del ancho
del lienzo, y las que no caben se maquetan en columna.

**Los subtítulos suben de 54 a ~128 px.** Sobre 1920, 54 px son el 2,8 % del
ancho; sobre 1080, 128 px son el 11,9 %. Cuatro veces más grande en relativo, y
eso es la gramática del formato.

## Las bandas de la plataforma

No se estiman: salen de medir dos capturas de iPhone 1179×2556 de reels
distintos (`editor-youtube/BRAND_RULES.md` §18). Cabecera 11,7 % → se adopta
12 %; interfaz inferior 25,5 % → se adopta 24,5 %, redondeando **siempre hacia
arriba**.

Se copia también su aviso: **está medido en Reels; en Shorts y TikTok no**.
Instagram además puede encajar por ancho con bandas negras, en cuyo caso la
interfaz tapa menos lienzo, así que estas fracciones son el caso conservador.

Tercer testigo independiente: el único montaje 1080×1920 completo del catálogo
de HyperFrames pone sus subtítulos en `bottom: 672`, aún más conservador.

La columna de botones se modela como **rectángulo** y no como banda de altura
completa: como banda marcaría cualquier gráfico ancho y centrado como problema,
y esos no la tocan.

## Qué queda por portar

Los tres micro-FX de _gramática de vertical_ **ya están portados**
(12-ago-2026): `stamp-banned` → `sello` (la palabra estampada que cae de golpe
y rebota), `notification-pop` → `aviso` (notificación de sistema que entra y
sale por arriba) y `text-stack-offset` → `apilado` (la palabra tres veces con
offset alternado y peso creciente). Viven en el catálogo de `micro-fx.ts` con
`soloVertical` —el motivo del descarte original sigue vigente en 16:9— y
`conPalabra`: la palabra disparadora viaja en `annotation.text` y ES la pieza.
Sus stills están en el banco de legibilidad (`preview:marca --vertical`).

Queda el freeze-cut del gancho, ahora con instrumento que lo juzgue
(`analizarShort` + banco de legibilidad): candidato natural del sprint
siguiente.

`SplitVersus`, `PasosFlow` y `Tendencia` **ya viajan**: se maquetan en columna
cuando el lienzo es vertical, que es el eje que este formato sí tiene. Son las
únicas formas del catálogo que dibujan una RELACIÓN y no texto dentro de un
rectángulo, y además el director de edición ya las puede PEDIR (`versus`,
`pasos`, `tendencia` en su esquema de momentos), no solo heredarlas del guion.
El motivo está medido: la voz decía «los tres pasos» y en pantalla salía un
rótulo que ponía «los tres pasos».

Siguen fuera `device_frame` —el marco de navegador es 16:9 por definición, y no
hay maquetación que lo salve— e `imagen_apoyo`.
