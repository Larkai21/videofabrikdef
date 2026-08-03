# Motion graphics: qué se hereda de `editor-youtube`

El catálogo de motion graphics de `QuantumBBoy/editor-youtube` (58 plantillas) es
la referencia visual de este proyecto. Este documento dice qué se copió, qué no,
y por qué — para que nadie tenga que volver a averiguarlo leyendo los dos repos.

## Por qué se puede portar de verdad

Aquel repo anima con **Playwright fotografiando un HTML**; este anima con
**Remotion renderizando React fotograma a fotograma**. Parecen incompatibles y no
lo son, por una decisión suya:

> Playwright no captura animaciones CSS en tiempo real de forma fiable […] Aquí
> el tiempo es un PARÁMETRO, no un reloj: la plantilla se posiciona con `seek(t)`
> y luego se fotografía. Mismo t → mismo píxel, siempre.
> — `templates/_engine.js`

Eso es exactamente `useCurrentFrame()`. Comprobado: **ninguna de sus 56
plantillas usa `@keyframes` ni `animation:` de CSS**, todo pasa por `draw(t)`.
Así que las curvas y las coreografías se copian literalmente, no se aproximan. Y
encaja con el principio 6 de este proyecto: sin fetch, sin aleatoriedad sin
semilla, animación solo en función de `t`.

## Qué se copia

**El motor** (`packages/video/src/effects/motion.ts`). Ya existía un port
parcial; al comparar con el original había derivado en tres cosas, y las tres
importaban:

|                   | estaba                               | está                                                                                                                                                                                                  |
| ----------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inCubic`         | no existía                           | portada. Faltaba también en el original, que documenta el fallo: como `span` cae a LINEAL con la curva `undefined`, dos plantillas decían en su comentario que aceleraban mientras no aceleraban nada |
| `outBack`         | s = 1,70158, que se pasa un **10 %** | se conserva porque hay temas que la usan, y se añade `outBack6` (s = 1,2827), calibrada al **6 %** que fija su guía de marca                                                                          |
| `outElastic`      | «para los pop de entrada»            | marcada `@deprecated`: su primera regla PROHÍBE los rebotes elásticos y su propia prueba falla si una plantilla la invoca. Aquí no la usa nadie                                                       |
| `ciclo`, `reposo` | no existían                          | portadas. Cada efecto se hacía su entrada y su salida a mano, que es de donde salen las divergencias de ritmo                                                                                         |

El test resuelve el sobrepaso **numéricamente** en cada pasada en vez de leer el
número escrito, igual que hace `test_motor.py` allí: si alguien toca la
constante, se entera.

**Las medidas** (`packages/video/src/effects/tokens.ts`): escala tipográfica,
espaciado, radios y la rampa del acento. Son las que dan el aire del catálogo y
están calibradas.

**Las coreografías**, efecto a efecto. Ejemplo, `hero-stat.html` → `StatOdometer`:
el contador va con `outExpo` y no con `outCubic` —«un contador lineal parece un
cronómetro; este parece que aterriza en la cifra»— y la etiqueta entra al 85 % de
la subida, porque si entra antes compite con la cifra y no se lee ninguna.

## Qué NO se copia: la paleta

Aquel repo es «papel y tinta» con azul de sello. Este canal tiene su paleta en el
design system del brand kit, **editable por canal**, así que los colores salen
siempre de `DesignTokens` y lo que se hereda es el reparto de papeles: qué es
fondo, qué es tinta, qué manda y qué acompaña.

No es solo que sea de otro canal. Su paleta está argumentada contra sí misma —el
acento es azul porque el rojo quedaba a ΔE 4,5 de la señal de error, y «un sello
de PROHIBIDO en el rojo del cromo de marca deja de significar nada»—. Copiar los
hex sin ese razonamiento sería quedarse con el resultado y perder el motivo.

**Excepción, y también es suya:** los colores de SEÑAL no son de marca.
`--senal-ok` verde y `--senal-no` rojo se copian tal cual y NO cambian con la
paleta del canal, porque un visto y un choque significan lo que significan.

## Qué queda por portar

De las 58 plantillas, este pipeline emite diez tipos de efecto: los siete originales
(`text_callout`, `stat_card`, `stat_odometer`, `quote_card`, `kinetic_text`,
`device_frame`, `annotation`) más los TRES DE LISTA portados del catálogo el
31-jul-2026 — `split_versus`, `pasos_flow` y `tendencia` — con intención
declarable (`comparacion`/`pasos`/`tendencia` en `edit-intents.ts`, campo
`items`). No son «más efectos»: son las tres formas en que un guion de este
nicho se pone a ENUMERAR, y enumerar en voz alta es lo que produce los rótulos
locutados que costó un sprint quitar. Si la lista se dibuja, la voz puede
escribirse en prosa. El resto del catálogo —`compare-ab`, `timer-ring`,
`stamp-banned`, `terminal`…— sigue sin quien lo pida.
