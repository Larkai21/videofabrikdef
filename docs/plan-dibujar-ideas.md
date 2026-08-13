# Plan: que el sistema sepa dibujar cualquier idea

Sprint propuesto el 5-ago-2026. **Parcialmente ejecutado** (estado a
13-ago-2026): la Fase 1 entera y el port a columna de la Fase 2 ya están en el
código (`2ea9b43`, `166b98c`, `fdf072d`, `3efcb57`, `abf086b`), y el informe de
cobertura de la Fase 5 también (`cobertura` en `packages/shared/src/calidad.ts`).
Las notas «(ejecutado)» de abajo citan el código; el resto del documento sigue
siendo el diseño vigente de lo que falta.

## El problema, con números

Medido el 5-ago-2026 sobre los tres vídeos producidos y los shorts sacados de
ellos:

| | planos | efectos visibles |
| --- | --- | --- |
| Vídeo largo A (7,6 min) | 1 cada 3,9 s | 26, de los cuales **10 son `keyword_highlight`** |
| Vídeo largo B (4,3 min) | 1 cada 8,3 s | 12, 6 de ellos keyword |
| Vídeo largo C (6,1 min) | 1 cada 4,6 s | 15, 4 de ellos keyword |
| Shorts (antes del ritmo) | 1 cada 2,8-11,3 s | **0-2 por pieza** |

`keyword_highlight` solo tiñe una palabra del subtítulo: no es un gráfico. Los
overlays reales salen a **~2 por minuto**. En una pieza de treinta segundos eso
es uno, y a veces ninguno.

El ritmo de corte ya está resuelto (`b21e3f3`: de 11,3 s a 2,6 s por plano
troceando lo aprobado). Lo que queda es que **la pantalla diga algo** cuando la
voz dice algo.

## Por qué hoy no puede

Tres capas, y las tres están cortas.

**1. El vocabulario no dibuja ideas, dibuja texto en cajas.** De los 16 tipos de
efecto, doce son «texto o cifra dentro de un rectángulo»: `text_callout`,
`quote_card`, `stat_card`, `stat_odometer`, `kinetic_text`, `device_frame`… Solo
tres describen una RELACIÓN —`split_versus` (dos cosas enfrentadas),
`pasos_flow` (un proceso), `tendencia` (algo que sube o baja)—.

> **(ejecutado, `3efcb57`)** Los tres YA viajan al vertical: se maquetan en
> COLUMNA cuando el lienzo es vertical (`col = lienzo.vertical` en
> `SplitVersus`/`PasosFlow`, `packages/video/src/effects/index.tsx`) y
> `SHORT_EDIT_ALLOWED` los permite con su motivo medido
> (`packages/shared/src/short-json.ts:186-194`). La versión anterior de este
> párrafo — «los tres están desactivados en vertical porque se maquetan en
> fila» — describía el código de antes de `3efcb57` y contradecía a
> `docs/motion-graphics-vertical.md`, que es quien tenía razón.

Para «cuello de botella» no hay nada. Tampoco para «esto depende de aquello»,
«de aquí salen tres caminos», «esto creció y luego se hundió», «A es 10 veces B»
o «esto ocurre en este orden».

**2. La decisión no elige forma, elige plantilla.** El guionista declara
`edit_intents` con cinco valores (`stat`, `callout`, `kinetic`, `comparacion`,
`pasos`, `tendencia`) y el director de edición los coloca. Nadie se pregunta
«¿qué imagen explica esta frase?»: se pregunta «¿qué plantilla encaja con la
etiqueta que puso el guionista?».

**3. La densidad está atada al beat.** `dedupeAndCap` impone **un overlay visual
por beat**, y un beat dura 8-15 s. Es una regla buena para el vídeo largo —evita
amontonar— pero es un techo duro: un short de 25 s tiene 2-3 beats, así que por
muchos efectos que se generen, salen 2 o 3. Los presupuestos (`FX_CARDS_PER_MIN`
y compañía) van por minuto, y sobre 30 s dan 0,6 tarjetas.

> **(ejecutado, `166b98c` + `fdf072d`)** La capa 3 ya no está corta:
> `dedupeAndCap` acepta un `PresupuestoFx` cuyo `granoMs` sustituye al beat
> como franja de no-amontonamiento, y el largo sigue pasando
> `presupuestoLargo()` por defecto (editing-director.ts:1090-1130). Las capas
> 1 y 2 siguen siendo el diseño pendiente (fases 2 y 3).

## Lo que este sprint entrega

Que el sistema, ante una frase cualquiera, sepa **elegir una forma que la
explique, rellenarla con los datos correctos y colocarla** — en los dos formatos
y con la densidad que cada uno pide.

---

## Fase 1 — Densidad por formato **(ejecutada)**

Desbloquea el short inmediatamente y no añade vocabulario. Ejecutada en
`2ea9b43` (constantes), `166b98c` (pasada propia `efectosDelShort` +
`PRESUPUESTO_VERTICAL`) y `fdf072d` (el prompt vertical pregunta por segundos):
los tres puntos de abajo describen exactamente lo que quedó en el código.

- **Presupuesto por pieza, no por minuto.** `spreadByWindows` ya reparte en
  ventanas; lo que falta es que el número de ventanas venga dado en vez de
  derivarse de `duración × tasa/min`. Sobre 30 s la tasa por minuto degenera a
  una sola ventana y el mecanismo se pierde. Las constantes verticales
  (`SHORT_CARDS_MAX = 3`, `SHORT_MICRO_MAX = 4`, `SHORT_KEYWORDS_MAX = 8`,
  `SHORT_ZOOMS_MAX = 5`) las consume `PRESUPUESTO_VERTICAL`
  (editing-director.ts:1105-1117), absoluto por pieza; cuando este plan se
  escribió no las consumía nadie.
- **La unidad de no-amontonamiento deja de ser el beat.** Pasa a ser una
  separación temporal (`FX_CARD_SEP_MS`, que ya existe). Un beat de 12 s puede
  llevar dos tarjetas si están separadas 7 s; un beat de 3 s no lleva dos.
- **Pasada propia sobre la ventana del short.** `directEdits` corre sobre los
  beats y cues del short, ya rebasados a 0. Una llamada LLM por short.

**Riesgo y cómo se acota.** `editing-director.ts` son 1200 líneas y es la parte
más calibrada del repo: cada constante lleva escrito el fallo medido que la fijó.
Todo cambio entra **por parámetro con el valor del largo como defecto**, igual
que se hizo con `trocearCongelado` y con `computeBrollTrack`. La prueba de que no
se ha movido nada: re-generar los efectos de los tres vídeos existentes y
comparar el maestro campo a campo.

## Fase 2 — Vocabulario de formas

Cada forma nueva es: componente Remotion + tipo en `EDIT_TYPES` + clasificación
en `EDIT_RENDER_KIND` y `SHORT_EDIT_ALLOWED` + payload en la unión discriminada
+ su línea en el prompt. Los dos `Record` completos son la red: un tipo sin
clasificar no compila.

**Primero, recuperar lo que ya existe (ejecutado, `3efcb57` + `abf086b`).**
`split_versus`, `pasos_flow` y `tendencia` ya se maquetan en columna en
vertical y `SHORT_EDIT_ALLOWED` los permite; además el director de edición del
short puede PEDIRLOS (`versus`, `pasos`, `tendencia` en su esquema de
momentos), no solo heredarlos del guion. Eso ya da tres relaciones:
comparación, proceso y evolución. `pasos_flow` con una estación estrangulada
**es** un cuello de botella.

**Después, las relaciones que faltan.** Propuesta, por orden de cuántas frases
de este nicho cubren:

| forma | qué relación dibuja | frase típica |
| --- | --- | --- |
| `cuello` | un flujo que se estrecha | «el cuello de botella está en la memoria» |
| `barras` | A frente a B con magnitud | «diez veces más barato» |
| `linea_tiempo` | orden de hechos | «primero pasó esto, y en julio aquello» |
| `arbol` | de una cosa salen varias | «de ahí salen tres estrategias» |
| `capas` | qué va encima de qué | «la aplicación se apoya en el modelo» |
| `ciclo` | algo que se retroalimenta | «y eso vuelve a alimentar al sistema» |

Se portan del catálogo de HyperFrames y de `editor-youtube` con la disciplina de
`docs/motion-graphics.md`: la coreografía, no el código; la paleta sale de los
`DesignTokens`; y se documenta qué se descarta y por qué.

## Fase 3 — El director que elige la forma

Hoy el guionista etiqueta y el director coloca. La pieza que falta es **decidir
qué forma explica una frase**.

- **El guion declara la RELACIÓN, no la plantilla.** `edit-intents.ts` pasa de
  cinco etiquetas a un vocabulario de relaciones (`compara`, `secuencia`,
  `deriva`, `estrangula`, `crece`, `contiene`…). El guionista ya declara
  `trigger_word` y eso hace el anclaje infalible; lo que cambia es la semántica
  de la etiqueta.
- **Un pase de relleno para los tramos mudos.** Sobre los segundos que quedan
  sin nada en pantalla, un director pregunta: «esta frase, ¿qué relación
  expresa, y con qué datos?». Devuelve forma + payload, validado contra el
  esquema de esa forma.
- **La regla que no se toca:** la palabra disparadora tiene que estar
  literalmente en el texto (`validateSceneIntents`). Es lo que hace que el
  anclaje por cues no pueda fallar, y costó un sprint.

## Fase 4 — Datos para la forma

Una forma sin datos correctos es peor que ninguna. Hoy `items` es texto libre y
`value` una cadena.

- Cada forma declara **su payload** en la unión discriminada: `barras` necesita
  dos etiquetas y dos magnitudes; `linea_tiempo`, hitos con fecha; `cuello`, las
  etapas y cuál estrangula.
- **Las cifras siguen saliendo de `claims`**, que es la única fuente permitida
  en pantalla. Una forma que pida una magnitud que el research no respalda no se
  dibuja: es la misma regla que ya audita `analizarMaster`.
- Lectura tolerante, como `editsFieldSchema`: un payload malformado descarta ESE
  efecto, nunca tumba el maestro.

## Fase 5 — Saber si ha funcionado

- **Informe de cobertura (ejecutado, `3833796`)**: cuántos segundos de la pieza
  no tienen nada en pantalla más allá del b-roll y el subtítulo. Es el número
  que mide este sprint. Vive en `cobertura` (packages/shared/src/calidad.ts),
  entra en `analizarMaster` y `analizarShort` como `cobertura_grafica` +
  `hueco_grafico_s` (con el desglose de huecos), y lo imprimen `pnpm calidad`
  y el A/B de `scripts/ab-edicion.ts`.
- **Previews por forma**: cada forma nueva, con la marca real, en los dos
  lienzos. `preview:marca` ya hace esto para las cuatro piezas del kit.
- **Banco de frases**: 30-40 frases reales de los guiones producidos, con la
  forma que un humano elegiría. Es el conjunto contra el que se mide si el
  director acierta, y sin él «mejorar el prompt» es opinión. Mismo patrón que
  `scripts/etiquetar.ts` para el matching.

---

## Orden y por qué

1 desbloquea el short con lo que ya hay y no toca vocabulario: es la única fase
que da valor sin depender de las demás.

2 antes que 3 a propósito: no tiene sentido enseñar al director a elegir entre
formas que no existen. Y reactivar los tres de lista da vocabulario nuevo por el
precio de un port de maquetación.

4 va pegada a 2 —cada forma llega con su payload— pero se lista aparte porque la
regla de las cifras es transversal y hay que decidirla una vez.

5 debería empezar antes de terminar 2: sin el informe de cobertura y sin el
banco de frases, las fases 2 y 3 se evalúan a ojo.

## Lo que este plan NO propone

- **Generar imágenes con IA.** Está prohibido en el cuerpo del vídeo y no se
  reabre. Las formas se dibujan con SVG y CSS deterministas.
- **Un segundo motor de render.** HyperFrames y editor-youtube son catálogos de
  referencia; las coreografías se portan a Remotion.
- **Tocar la ley temporal.** Ninguna forma mueve un corte: se colocan sobre los
  ms del audio, como todo lo demás.
