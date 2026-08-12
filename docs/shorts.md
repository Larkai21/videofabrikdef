# Shorts verticales

Del vídeo largo ya entregado salen piezas de 20-59 s en 1080×1920. El sistema
propone qué fragmentos funcionan solos, el humano elige, y los elegidos se
re-renderizan con una gramática visual propia.

No es el vídeo largo recortado: cambia el lienzo, el encuadre de cada plano, el
tamaño y el ritmo de los subtítulos, el reparto de transiciones y lo que se
monta encima. Lo único que **no** cambia es la ley temporal: los cortes los
sigue fijando el audio.

## El recorte

`recortarMaster` (`packages/shared/src/short-cut.ts`) es una función pura: mismo
maestro y misma ventana → mismo resultado. Eso es lo que permite congelar el
maestro del short al proponerlo y que el player del dashboard previsualice
exactamente lo que se va a renderizar.

| sección          | qué se hace                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| `audio`          | **no se corta**. Misma ruta; el render lo desplaza con `<Audio trimBefore>` |
| `cues`           | los que solapan, con sus palabras filtradas y rebasadas a 0                 |
| `beats`          | los que solapan, clampados, y con **`idx` re-indexado a 0..n-1**            |
| `asset.fit`      | `offset_ms` avanza en `trim` y `loop`; `kenburns` y `stretch` no            |
| `asset.encuadre` | se estampa aquí desde `assets.width/height/kind`                            |
| `edits`          | los que solapan, remapeados a su nuevo beat y filtrados por formato         |
| `segments`       | se eliminan: un short de 35 s no tiene capítulos                            |
| `candidates`     | se vacían: el maestro vive en una columna jsonb                             |

Tres decisiones que el contrato no deja ver solas:

**El audio no se corta.** Cortar el WAV significaría un fichero nuevo por short,
una escritura de disco dentro de una función pura, y una desincronización
posible con unos word timestamps que ya están alineados.

**Los beats se re-indexan.** `BeatVisual` siembra las direcciones de Ken Burns
por `videoId:idx`; conservar los índices del largo daría un reparto que depende
de dónde se cortó, no de la pieza.

**Un efecto truncado por el borde se descarta** si le queda menos del 60 % de su
duración o menos de 400 ms. Un odómetro que empieza a contar y desaparece es
peor que ningún odómetro.

## Por qué la ventana no se puede arrastrar

`fronterasFuertes` reconstruye los finales de frase que el pipeline no persiste
—los `TimedToken` con `sentenceEnd` viven solo en el worker de voz y se tiran—
cruzando límites de beat con finales de cue, que sí se cierran en puntuación
fuerte. Como los beats se cortan preferentemente en fin de frase, **la frontera
de beat ES la garantía** de que el corte no parte una palabra.

Un control para mover `from_ms`/`to_ms` es un asa de recorte, que el principio 1
prohíbe, y además rompería ese invariante: una ventana arrastrada a mano
aterriza a mitad de sílaba. No existe endpoint para hacerlo.

Lo que el humano controla es lo mismo que en el resto del pipeline: **elegir**
entre N candidatos, **descartar con motivo** y pedir otros, y **editar el
título**, que es contenido y no un corte.

## El director

`apps/workers/src/pipelines/shorts/director.ts`. Una llamada LLM por vídeo.

Se le piden **índices de beat, no milisegundos**. Un modelo al que pides `from_ms`
devuelve números plausibles que caen a mitad de palabra; con índices el corte es
válido por construcción. El ajuste fino a la frontera fuerte lo hace el
normalizador, que es puro y se prueba sin LLM.

`toCandidatos` ajusta la duración estirando o encogiendo **por beats enteros**,
nunca por milisegundos sueltos —eso rompería la garantía—, y resuelve solapes
por score tanto entre candidatos como contra las ventanas ya descartadas.

`fallbackShorts` propone el arranque del vídeo si el LLM falla o si nada
sobrevive a la normalización: el job nunca se queda sin salida.

## Máquina de estados

`propuesto → aprobado → render → hecho`, más `descartado` e `incidencia`. Es
**propia** y no una extensión de la del vídeo: `VIDEO_TRANSITIONS.hecho = []` es
la garantía de que un vídeo entregado no se vuelve a mover, y un short existe
justamente después de esa entrega.

`hecho` y `descartado` son terminales. Un candidato rechazado se sustituye
pidiendo otra propuesta, no resucitando la anterior.

## Render

Va en la cola `render`, **no** en la de shorts: esa cola tiene `concurrency: 1`,
y un short y un largo renderizando a la vez repartirían las vCPU entre dos
Chromium. El bundle es el mismo para los dos formatos; solo cambia el id que
selecciona la composición.

Salida en `outputs/<videoId>/shorts/<shortId>/` — **ocho** entregables:
`video.mp4` (a −14 LUFS como el largo), `thumb.jpg` —un fotograma real al 10 %
de la pieza, acotado a la permanencia de la cartela (la regla del 10 % a secas
perdía el titular por encima de ~32 s)—, `title.txt`, `description.txt` con el
gancho más hashtags, `tags.txt`, `subtitles.srt`/`.vtt` **con offset 0** (el
short no antepone intro) y el `master.json` congelado. Tras escribirlos corre
la puerta de calidad (`analizarShort`, umbrales del formato): avisa en el log
de la entrega, no bloquea.

## Verificación

```bash
pnpm render:smoke                                          # cuarta pasada vertical
pnpm --filter @fabrica/video preview:marca --vertical      # con la marca real
```

El humo comprueba que la composición mide 1080×1920 y que su duración es la de
la ventana sin intro ni outro. Las previews son para juzgar la gramática, que no
se puede juzgar leyendo el código.
