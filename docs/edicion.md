# Edición y sonido

Cómo se decide qué overlay entra, cuándo y con qué sonido. Cruza
`apps/workers/src/pipelines/assets/editing-director.ts` (decide),
`packages/shared` (contrato y catálogos) y `packages/video` (pinta y suena).

## 1. El guion declara, el director coloca

El orden es guion → voz → beats → edición, así que el director trabaja sobre una
narración ya hablada. Antes **releía** esa narración y adivinaba: pedía al modelo
un texto de tarjeta y luego buscaba esa palabra en los cues para anclarla; si no
la encontraba, el efecto caía al inicio del beat. La desincronización era el
síntoma de que el texto no era literal, y no se registraba en ningún sitio.

Ahora la escena **declara** su intención (`edit_intents` en `sceneSchema`):

```
trigger_word   palabra EXACTA del text de esa misma escena
card_text      copy de la tarjeta, 2-4 palabras
value+claim_idx  solo para cifras, con el claim del que salen
```

Como la palabra la acaba de escribir el propio guionista, el anclaje no puede
fallar por construcción. Y si aun así no resuelve (el texto se reescribió, la
palabra se repite y no hay `scene_spans`), **el efecto se descarta y se cuenta**:
nunca se coloca mal.

Tres capas, en prioridad decreciente:

| capa | qué hace |
|---|---|
| declarada | lo que el guion pidió; gana siempre |
| reglas | estructura (riser, whoosh de sección, zoom) + red de seguridad de cifras y dominios, esta última solo en beats sin declarar |
| IA | rellena los beats que quedan huecos. **Si no hay huecos, no se llama**: cuanto mejor declara el guion, menos IA y menos coste |

### Garantías que se comprueban en código, no en el prompt

- `trigger_word` está literalmente en el texto de su escena (`validateSceneIntents`).
- Una cifra en pantalla aparece en la escena o en `research.claims` (`figureBackedBy`).
- El copy de tarjeta no pasa de cuatro palabras: es un titular, no una transcripción.
- La `keyword` de un momento de la IA se pronuncia dentro de ese beat, o se descarta.
- Al reescribir el texto de una escena (edición humana, parche del juez, ajuste de
  duración), las intenciones cuya palabra desapareció se caen solas.

## 2. Carriles y presupuesto

El recorte anterior ordenaba por prioridad y truncaba: un orden total **sin
tiempo**. Si el primer minuto daba seis tarjetas y el séptimo una, la del séptimo
moría aunque ese minuto estuviera vacío. Medido sobre un vídeo real, la
distribución de overlays por minuto era `[6, 3, 1]`.

Ahora hay carriles con presupuesto propio, porque compiten por cosas distintas:

| carril | tipos | compite por |
|---|---|---|
| tarjetas | stat_card, stat_odometer, quote_card, kinetic_text, device_frame, text_callout | el centro de la pantalla |
| cámara | zoom_punch | nada: es un movimiento del b-roll |
| acentos | annotation, micro_fx | la atención |
| subrayado | keyword_highlight | el subtítulo |
| sonido | sfx | el oído, y se deriva de los anteriores |

`spreadByWindows` parte el vídeo en tantas ventanas como permita el presupuesto y
elige un candidato por ventana. **La prioridad decide dentro de la ventana, nunca
entre ventanas.** Es determinista: los empates se rompen por `from_ms`.

Constantes en `packages/shared/src/constants.ts`, **por minuto** porque el vídeo
es largo:

```
FX_CARDS_PER_MIN = 1.2      ~10 tarjetas en 8 min, una cada ~50 s
FX_MICRO_PER_MIN = 0.9      ~7 acentos en 8 min
FX_KEYWORDS_PER_MIN = 2.5   ~20; antes NO tenía tope ninguno
FX_SFX_PER_MIN = 6          fusible, no objetivo: si muerde, algo va mal
```

Las separaciones y la guarda **no** escalan con la duración porque son
perceptivas: `FX_CARD_SEP_MS` 20 s, `FX_MICRO_SEP_MS` 25 s (≈2 beats: dos
acentos en el mismo beat se leen como un tic del montaje), `FX_CARD_GUARD_MS`
600 ms (lo que tarda el ojo en acabar de leer la entrada de una tarjeta).

> Los números del proyecto hermano (6 micro-fx, 7 s de separación) **no se
> escalan linealmente**: allí están en el régimen «la separación es el cuello de
> botella» y darían 72 acentos en diez minutos. Lo que se conserva es la rareza
> relativa.

## 3. Catálogo de micro-FX

Acentos de menos de segundo y medio disparados por **una palabra pronunciada**.
Cada efecto entra una sola vez por vídeo, así que el techo estructural es el
tamaño del catálogo por muy largo que sea el vídeo. Definidos en
`packages/shared/src/micro-fx.ts` con sus disparadores ya normalizados.

| id | dispara con | forma | sonido |
|---|---|---|---|
| tachado | jamás, nunca, error, mito, falso… | annotation `strike` | clic |
| visto | correcto, funciona, resuelto, listo… | annotation `check` | notificacion |
| diana | mira, fíjate, detalle, exacto… | annotation `circle` | tic |
| subida | crece, multiplica, escala, exponencial… | micro_fx `spark_up` | aparicion |
| caída | cae, desploma, hunde, pierde… | micro_fx `spark_down` | subgrave |
| candado | truco, desbloquea, secreto, atajo… | micro_fx `padlock` | clic |
| cronómetro | rápido, urgente, deprisa, enseguida… | micro_fx `timer` | tic |

**Podas deliberadas.** Una pieza de 50 s tolera disparadores frecuentes porque
solo hay sitio para seis efectos. En ocho minutos, un disparador frecuente
garantiza que el efecto se gasta en la primera aparición, que casi siempre es la
vacía. Por eso fuera `no` (~40 por guion), `hecho` («de hecho» es muletilla) y
`lista` (en tecnología es sustantivo). Los multi-token («ya mismo») son
imposibles: la normalización borra los espacios.

## 4. Catálogo de sonido

Catorce efectos, todos **sintetizados** con expresiones de ffmpeg
(`packages/video/scripts/make-sfx.ts`, `pnpm sfx`): nada se descarga, así que no
hay licencias que respetar ni ficheros que falten al clonar. Los `.wav` se
commitean y un test cruza `SFX_NAMES` con el disco en los dos sentidos.

| efecto | dura | para qué |
|---|---|---|
| riser | 1,00 s | arranque del cuerpo, sobre el gancho |
| impacto | 0,50 s | aterrizaje del gancho, tras el riser |
| whoosh | 0,60 s | cambio de sección; es el único que significa «cambiamos de tema» |
| pop | 0,16 s | entrada de tarjeta o etiqueta |
| ding | 0,45 s | cifra destacada |
| deslizar | 0,32 s | entrada de la tarjeta de cita |
| tecleo | 0,80 s | marco de navegador con texto tecleándose |
| destello | 0,22 s | remate de la tipografía cinética |
| clic | 0,09 s | acento de tachado o candado |
| tic | 0,055 s | acento de foco o cronómetro |
| aparicion | 0,45 s | acento de crecimiento |
| subgrave | 1,20 s | acento de desplome |
| notificacion | 0,42 s | acento de confirmación |
| resolucion | 1,60 s | cierre del último beat |

**Por qué suenan así.** La altura baja con el tiempo, y la fase es la *integral*
de f(t), no `2π·f(t)·t` — esto último da el doble de pendiente y suena a dibujos
animados. La envolvente es exponencial: la lineal suena sintética. El transitorio
de ruido de los primeros milisegundos es lo que hace que un golpe se perciba
fuerte sin subir el volumen. El `ding` es una quinta justa (880→1320 Hz, razón
3:2) porque un intervalo consonante suena a «hecho» y uno disonante a error. El
`tecleo` cae en 8 ms y el `clic` en 47: una tecla es masa golpeando un tope, no un
contacto eléctrico.

Los niveles viven en `LongForm.tsx` tipados como `Record<SfxName, number>`, así
que **añadir un sonido sin nivelarlo no compila**. Tres familias sobre un máster
a −16 LUFS: banda ancha baja (clic 0,30, tecleo 0,26), graves cortos medios
(impacto 0,45, subgrave 0,42) y tonos agudos algo más altos (notificacion 0,44).

### Por qué no hay cama ambiental

El proyecto hermano lleva un `lecho` de ruido rosa a −42 dB para que el silencio
digital no suene a fallo de audio. Aquí no hace falta y sería contraproducente:
ya hay música bajo la voz con *ducking* sidechain a −22 dB, así que ese silencio
no existe; es un bucle de 4 s y la capa de SFX es de disparos únicos; y entraría
después del `loudnorm` a −16 LUFS, subiendo el suelo de ruido de un máster ya
normalizado sin que la música lo agachara nunca.

## 5. Herramientas

```bash
pnpm sfx                                                    # regenera los 14 .wav
pnpm --filter @fabrica/workers exec tsx scripts/ab-edicion.ts <videoId>
pnpm --filter @fabrica/video exec tsx scripts/render-master.ts <master.json> <out.mp4> [desde] [hasta]
```

`ab-edicion` recalcula la línea de edición de un vídeo ya renderizado y compara
el reparto por minuto, sin regenerar guion ni voz. `render-master` renderiza un
tramo de cualquier maestro, para ver dos montajes del mismo vídeo uno al lado del
otro.
