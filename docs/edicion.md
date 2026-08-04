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

| capa      | qué hace                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| declarada | lo que el guion pidió; gana siempre                                                                                           |
| reglas    | estructura (riser, whoosh de sección, zoom) + red de seguridad de cifras y dominios, esta última solo en beats sin declarar   |
| IA        | rellena los beats que quedan huecos. **Si no hay huecos, no se llama**: cuanto mejor declara el guion, menos IA y menos coste |

El texto de la escena y sus `trigger_word` llegan ya pasados por
`normalizaEscena` (la forma que se LOCUTA, ver docs/voz-y-beats.md §1): texto y
disparadores se normalizan A LA VEZ, o un «GPT-5.6» declarado dejaría de casar
con el «GPT 5.6» que se oye.

### Garantías que se comprueban en código, no en el prompt

- `trigger_word` está literalmente en el texto de su escena (`validateSceneIntents`).
- Una cifra en pantalla aparece en la escena o en `research.claims` (`figureBackedBy`).
- El copy de tarjeta no pasa de cuatro palabras: es un titular, no una transcripción.
- La `keyword` de un momento de la IA se pronuncia dentro de ese beat, o se descarta.
- Al reescribir el texto de una escena (edición humana, parche del juez, ajuste de
  duración), las intenciones cuya palabra desapareció se caen solas.
- Un `device` cuyo texto no parece dominio/URL/comando (`deviceTextValido`) se
  DEGRADA a callout en las dos capas: el contenido vale, teclearlo en una barra de
  direcciones no («emergency stop» pasó los filtros genéricos y salió tecleado).
- Las cifras en pantalla salen del formateador compartido (`displayCifra`):
  StatCard, StatOdometer y el aviso del informe usan la misma convención (punto de
  millar desde 5 dígitos; los decimales no van al rodillo).

### El inserto (`imagen_apoyo`)

La intención `inserto` («aquí se nombra una entidad concreta») no monta el edit en
el director: se ancla y queda pendiente de imagen. La resolución vive en el
pipeline (`insertos.ts`): fotos de Pexels → Wikimedia Commons con filtro de
licencias, veto del juez de planos (todos los insertos en una llamada), descarga
solo del ganador y alta en `assets` con su licencia. El que vuelve entra como edit
DECLARADO con `image_path` congelado y `credit` si la licencia exige atribución
(se pinta pequeña en el recuadro y se agrega a description.txt). El que no vuelve
se cae sin dejar hueco: mejor sin inserto que con el logo equivocado. La capa IA
no puede proponer insertos.

**Y si el guion no lo pide, lo pide el sistema.** `insertoAutomatico` saca la
entidad principal del TÍTULO (o de los claims) y la ancla en su primera mención
pronunciada. La asimetría es la clave: el guion habla en corto («Musk») y el
título escribe el nombre completo («Elon Musk») — el completo sirve para BUSCAR
la imagen y el corto para ANCLARLA. Es la misma red determinista que `DOMAIN_RE`
→ device_frame, y el juez la veta igual. Uno por vídeo.

**Carril propio, no el de tarjetas.** Fue un error de diseño corregido tras verlo
en un vídeo real: con el inserto compitiendo en el carril de tarjetas, el de
«Elon Musk» (24,6 s) moría siempre contra el texto cinético del gancho, que cae en
la misma ventana de 50 s y tiene más prioridad. Una tarjeta es intercambiable —si
cae, entra otra en la ventana siguiente—; el inserto es la ÚNICA vía de enseñar a
la persona nombrada, y además llega con una imagen ya buscada, juzgada y
descargada. Su carril no usa la rejilla de ventanas: esa existe para cuando sobra
material y aquí escasea (dos insertos separados por dos minutos caían en la misma
casilla). El criterio es orden temporal, separación mínima y tope
`FX_INSERTOS_PER_MIN`, con guarda para no pisar una tarjeta (comparten banda
superior).

## 2. Carriles y presupuesto

El recorte anterior ordenaba por prioridad y truncaba: un orden total **sin
tiempo**. Si el primer minuto daba seis tarjetas y el séptimo una, la del séptimo
moría aunque ese minuto estuviera vacío. Medido sobre un vídeo real, la
distribución de overlays por minuto era `[6, 3, 1]`.

Ahora hay carriles con presupuesto propio, porque compiten por cosas distintas:

| carril    | tipos                                                                                                              | compite por                            |
| --------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| tarjetas  | stat_card, stat_odometer, quote_card, kinetic_text, device_frame, text_callout, split_versus, pasos_flow, tendencia | el centro de la pantalla               |
| insertos  | imagen_apoyo                                                                                                        | la banda superior (guarda vs tarjetas) |
| cámara    | zoom_punch                                                                                                          | nada: es un movimiento del b-roll      |
| acentos   | annotation, micro_fx                                                                                                | la atención                            |
| subrayado | keyword_highlight                                                                                                   | el subtítulo                           |
| sonido    | sfx                                                                                                                 | el oído, y se deriva de los anteriores |

El carril de tarjetas se DERIVA del contrato (`EDIT_RENDER_KIND` overlay +
`zoom_punch` explícito, menos `imagen_apoyo` que tiene el suyo): un tipo nuevo
clasificado overlay entra solo, sin lista que olvidar — antes eran dos listas de
literales y divergían con el informe.

`spreadByWindows` parte el vídeo en tantas ventanas como permita el presupuesto y
elige un candidato por ventana. **La prioridad decide dentro de la ventana, nunca
entre ventanas.** Es determinista: los empates se rompen por `from_ms`.

La puerta de la capa IA (`hacenFaltaMasTarjetas`) cuenta DOBLE: presupuesto global
Y cobertura por ventana. Solo el global dejaba escapar el caso medido (2 minutos
mudos con el presupuesto cubierto): si el guion concentra sus tarjetas al
principio, el total cumple pero hay tramos de ~50 s vacíos. En la cobertura solo
cuentan overlays de verdad — un golpe de zoom no rescata a un minuto de sentirse
vacío. La ventana es la del reparto (`durationMs/presupuesto`), no el minuto de
reloj del informe: alinearlas se probó y se revirtió (los minutos mudos venían de
falta de candidatos, no de la rejilla).

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

| id         | dispara con                             | forma                 | sonido       |
| ---------- | --------------------------------------- | --------------------- | ------------ |
| tachado    | jamás, nunca, error, mito, falso…       | annotation `strike`   | clic         |
| visto      | correcto, funciona, resuelto, listo…    | annotation `check`    | notificacion |
| diana      | mira, fíjate, detalle, exacto…          | annotation `circle`   | tic          |
| subida     | crece, multiplica, escala, exponencial… | micro_fx `spark_up`   | aparicion    |
| caída      | cae, desploma, hunde, pierde…           | micro_fx `spark_down` | subgrave     |
| candado    | truco, desbloquea, secreto, atajo…      | micro_fx `padlock`    | clic         |
| cronómetro | rápido, urgente, deprisa, enseguida…    | micro_fx `timer`      | tic          |

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

| efecto       | dura    | para qué                                                         |
| ------------ | ------- | ---------------------------------------------------------------- |
| riser        | 1,00 s  | arranque del cuerpo, sobre el gancho                             |
| impacto      | 0,50 s  | aterrizaje del gancho, tras el riser                             |
| whoosh       | 0,60 s  | cambio de sección; es el único que significa «cambiamos de tema» |
| pop          | 0,16 s  | entrada de tarjeta o etiqueta                                    |
| ding         | 0,45 s  | cifra destacada                                                  |
| deslizar     | 0,32 s  | entrada de la tarjeta de cita                                    |
| tecleo       | 0,80 s  | marco de navegador con texto tecleándose                         |
| destello     | 0,22 s  | remate de la tipografía cinética                                 |
| clic         | 0,09 s  | acento de tachado o candado                                      |
| tic          | 0,055 s | acento de foco o cronómetro                                      |
| aparicion    | 0,45 s  | acento de crecimiento                                            |
| subgrave     | 1,20 s  | acento de desplome                                               |
| notificacion | 0,42 s  | acento de confirmación                                           |
| resolucion   | 1,60 s  | cierre del último beat                                           |

**Por qué suenan así.** La altura baja con el tiempo, y la fase es la _integral_
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

### El sonido de la intro y de la outro

Lo coloca la COMPOSICIÓN (`kitSfxCues` en brand-kit.ts), no las piezas del kit:
el contrato de esos componentes es visual, los escribe una IA y no deben poder
meter audio por su cuenta. Intro: riser durante todo el dibujado, impacto al
28 % de la pieza (donde aterriza el logotipo — un golpe sobre pantalla vacía
suena a error de montaje) y destello en la entrega. Outro: resolución + pop del
«suscríbete». Motivo: las dos piezas salían en silencio DIGITAL (−91 dB
medidos) porque el único audio del montaje era la voz.

### Por qué no hay cama ambiental

El proyecto hermano lleva un `lecho` de ruido rosa a −42 dB para que el silencio
digital no suene a fallo de audio. Aquí no hace falta y sería contraproducente:
ya hay música bajo la voz con _ducking_ sidechain a −22 dB, así que ese silencio
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

## 6. Qué pinta cada tipo (EDIT_RENDER_KIND)

`EDIT_RENDER_KIND` (`master-json.ts`) clasifica los 15 tipos en
`overlay | anotacion | subtitulo | camara | audio` y es un `Record` COMPLETO:
añadir un tipo a `EDIT_TYPES` sin clasificarlo no compila. Existe por un fallo
concreto: `pasos_flow` llegó al máster con componente, rama de render y etiqueta
en la timeline, y aun así no salió en pantalla, porque el render decidía qué
montar con una lista de literales que nadie comprobaba. El render, el informe
de calidad Y el reparto del director derivan de este Record en vez de mantener
cada uno su lista. `imagen_apoyo` (el inserto) es overlay: entra solo en
overlayCues, suprime la tarjeta de sección solapada y cuenta como tarjeta.
