import { z } from 'zod';
import { designTokensSchema } from './design.js';
import { editIntentsFieldSchema } from './edit-intents.js';
import { scriptReviewSchema } from './script-review.js';
import { beatStatusSchema } from './states.js';

// MasterVideoJson v1 (docs/contratos.md §2). El maestro se construye por fases:
// las secciones son opcionales mientras el pipeline avanza y `renderableMasterV1`
// exige lo necesario para renderizar. Reglas: beats[].from_ms/to_ms son la ley
// temporal (solo los escribe el worker de voz); candidates se vacía al aprobar
// la timeline.

export const researchSchema = z.object({
  sources: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      domain: z.string(),
      published_at: z.string().nullable(),
    }),
  ),
  summary: z.string(),
  claims: z.array(z.object({ text: z.string(), source_idx: z.number().int() })),
  angles: z.array(z.string()),
});

export const sceneSchema = z.object({
  id: z.string(),
  section: z.enum(['hook', 'body', 'cta']),
  text: z.string(),
  visual_query: z.string(),
  emphasis: z.boolean().optional(),
  edited_by_human: z.boolean().optional(),
  // Intención visual declarada por el propio guionista: trigger_word es una
  // palabra que él mismo puso en `text`, así que el anclaje por cues no puede
  // fallar. Opcional: los maestros anteriores no la traen y el director de
  // edición cae a su comportamiento de siempre.
  // Tolerante a propósito: una intención mal escrita se cae sola en vez de
  // tumbar el guion entero (ver editIntentsFieldSchema). El recorte al tope por
  // escena lo hace sweepIntents, que además registra el motivo.
  edit_intents: editIntentsFieldSchema.optional(),
});

export const scriptSchema = z.object({
  scenes: z.array(sceneSchema),
  hook_notes: z.string(),
});

export const seoSchema = z.object({
  titles: z.tuple([z.string(), z.string(), z.string()]),
  chosen_idx: z.number().int().min(0).max(2).nullable(),
  description: z.string(),
  tags: z.array(z.string()),
  thumbnails: z.array(z.object({ text: z.string(), visual: z.string() })),
});

export const wordSchema = z.object({
  from_ms: z.number().int().nonnegative(),
  to_ms: z.number().int().nonnegative(),
  w: z.string(),
});

export const cueSchema = z.object({
  from_ms: z.number().int().nonnegative(),
  to_ms: z.number().int().nonnegative(),
  text: z.string(),
  words: z.array(wordSchema),
});

export const audioSchema = z.object({
  path: z.string(),
  duration_ms: z.number().int().positive(),
  // null = no se pudo medir. Antes se anotaba el objetivo «como aproximación»,
  // así que un maestro con lufs exactamente −16 podía venir de una medida real
  // o de una medida fallida, y no había forma de distinguirlo. Un dato inventado
  // que se parece a uno bueno es peor que la ausencia del dato.
  lufs: z.number().nullable(),
});

export const fitSchema = z.object({
  // trim: clip ≥ beat, se recorta; stretch: clip algo más corto, una sola
  // pasada ralentizada (playback_rate < 1); loop: último recurso, repite;
  // kenburns: imágenes fijas con zoom/paneo.
  mode: z.enum(['trim', 'stretch', 'loop', 'kenburns']),
  offset_ms: z.number().int().nonnegative().optional(),
  loops: z.number().int().positive().optional(),
  // solo en 'stretch': factor de reproducción (0 < r < 1) para llenar el beat
  // en una única pasada sin reiniciar el clip.
  playback_rate: z.number().positive().optional(),
});

// `path` y `kind` se rellenan al descargar el asset elegido (extensión
// compatible del contrato: el render no consulta la base de datos).
export const beatAssetSchema = z.object({
  id: z.string(),
  fit: fitSchema,
  effect: z.string().optional(),
  path: z.string().optional(),
  kind: z.enum(['clip', 'image']).optional(),
  // de dónde vino el PICK del matching, congelado en la ingesta: es lo que
  // permite al informe de calidad agregar la cuota de biblioteca sin BD
  // (chosen_origin vive en la tabla beats y no sobrevive a la congelación)
  origin: z.enum(['library', 'pexels', 'pixabay', 'wikimedia', 'flux', 'upload']).optional(),
  // Cómo encuadrar el plano en un lienzo VERTICAL. Lo estampa el recorte a
  // short a partir de las dimensiones y el tipo que la biblioteca ya conoce;
  // el render largo lo ignora. Vive aquí y no en un esquema de beat propio del
  // short para que los sub-planos lo hereden sin duplicar el anidamiento.
  // Valores en short-json.ts (SHORT_FRAMINGS).
  encuadre: z.enum(['recorte', 'cover', 'entero']).optional(),
});

export const candidateSchema = z.object({
  ref: z.string(),
  // 'wikimedia' solo aparece en candidatos de inserto (imagen de referencia de
  // una entidad con nombre); la cascada de b-roll no lo usa
  provider: z.enum(['library', 'pexels', 'pixabay', 'flux', 'wikimedia']),
  score: z.number(),
  thumb_url: z.string().optional(),
  // URL servible (/files/...) que la API deriva de meta.path para los
  // candidatos de biblioteca y de flux, que no traen thumb_url. Es campo de
  // SALIDA: no se persiste en el maestro, se calcula al serializar el DTO.
  preview_url: z.string().optional(),
  // metadatos del proveedor necesarios para descargar/mostrar sin re-consultar
  meta: z.record(z.string(), z.unknown()).optional(),
});

// Sub-plano: un corte visual DENTRO del beat, para variar el b-roll más rápido
// (biblioteca en «bibliotecas», nave en «industria»). `keyword` es la palabra
// que ancla el corte (opcional: sin ella el tramo va por idea, no por palabra).
// Cuando un beat tiene varios `visuals`, esa lista manda; `beat.asset` refleja
// el primero (compatibilidad con dashboard/miniaturas). Los cortes NO cambian
// los límites del beat (principio 1): solo su contenido interno.
export const subvisualSchema = z.object({
  from_ms: z.number().int().nonnegative(),
  to_ms: z.number().int().nonnegative(),
  visual_query: z.string(),
  keyword: z.string().optional(),
  asset: beatAssetSchema.optional(),
});

export const beatSchema = z.object({
  idx: z.number().int().nonnegative(),
  from_ms: z.number().int().nonnegative(),
  to_ms: z.number().int().nonnegative(),
  text: z.string(),
  visual_query: z.string(),
  status: beatStatusSchema,
  asset: beatAssetSchema.optional(),
  candidates: z.array(candidateSchema).optional(),
  // sub-planos internos (1..MAX_VISUALS_PER_BEAT); ausente = 1 plano (asset)
  visuals: z.array(subvisualSchema).optional(),
});

// Forma PERSISTIDA de un sub-plano durante la curación (tabla beats): como el
// beat pero por sub-plano (candidatos + elegido). Al ingerir se congela en
// `subvisualSchema` (con `asset` resuelto) dentro del máster.
export const storedSubvisualSchema = z.object({
  from_ms: z.number().int().nonnegative(),
  to_ms: z.number().int().nonnegative(),
  visual_query: z.string(),
  keyword: z.string().optional(),
  status: beatStatusSchema,
  candidates: z.array(candidateSchema),
  fit: fitSchema.nullable(),
  chosen_origin: z.string().nullable(),
  chosen_score: z.number().nullable(),
  asset_id: z.string().nullable(),
});

export const brandSchema = z.object({
  // nombre visible del canal para intro/outro/rótulos (el render no lee BD)
  channel_name: z.string().optional(),
  // coletilla del canal, la segunda línea de su cabecera de YouTube
  tagline: z.string().optional(),
  // tokens de diseño congelados (colores/tipografía); el render no lee BD
  design: designTokensSchema.optional(),
  // avatar/personaje del canal (URL /files ya reescrita en el render)
  avatar_path: z.string().optional(),
  // valores "tipo@versión" resueltos por el registry generado
  components: z.object({
    intro: z.string().optional(),
    outro: z.string().optional(),
    title_card: z.string().optional(),
    lower_third: z.string().optional(),
    subtitle_theme: z.string(),
    transition: z.string().optional(),
    thumbnail_template: z.string().optional(),
  }),
});

export const costsSchema = z.object({
  total_usd: z.number(),
  by_provider: z.record(z.string(), z.number()),
});

// Segmentos temáticos del vídeo (los produce el director de capítulos): el
// beat donde empieza cada uno + su tiempo, para la tarjeta de sección centrada
// y para los capítulos de la descripción de YouTube.
export const segmentSchema = z.object({
  title: z.string().min(1),
  beat_idx: z.number().int().nonnegative(),
  from_ms: z.number().int().nonnegative(),
});

// Tramo de audio de cada escena del guion. NO es ley temporal: la ley siguen
// siendo los beats (principio 1). Es el ÍNDICE que acota en qué ventana de los
// cues hay que buscar la palabra disparadora de una escena, para que una palabra
// repetida en el vídeo se ancle donde toca. Lo escribe el worker de voz con los
// mismos ms que alimentan el cálculo de beats.
export const sceneSpanSchema = z.object({
  scene_id: z.string(),
  from_ms: z.number().int().nonnegative(),
  to_ms: z.number().int().nonnegative(),
});
export type SceneSpan = z.infer<typeof sceneSpanSchema>;

// Línea de tiempo de EDICIÓN (la produce el director de edición): efectos
// anclados en ms sobre la ley temporal del audio (nunca cambian los cortes,
// principio 1). Opcional → no afecta al render de maestros antiguos.
export const EDIT_TYPES = [
  'zoom_punch',
  'keyword_highlight',
  'text_callout',
  'stat_card',
  'quote_card',
  'sfx',
  // tipografía cinética palabra a palabra (gancho); usa `text`
  'kinetic_text',
  // count-up de rodillo mecánico para cifras; usa `value` (+ `label`)
  'stat_odometer',
  // marca dibujada a mano sobre el b-roll (círculo/subrayado/flecha); `style` +
  // `text` (etiqueta opcional)
  'annotation',
  // marco de navegador/móvil con texto/URL tecleándose; `style` + `text`
  'device_frame',
  // acento gráfico de menos de segundo y medio anclado a UNA palabra
  // pronunciada (ver micro-fx.ts); `style` elige la forma
  'micro_fx',
  // Los tres del catálogo de motion graphics. Existen porque son las tres
  // formas en que el guion se pone a enumerar, y enumerar en voz alta es lo que
  // produce los rótulos locutados: si la lista se dibuja, la voz puede callarse.
  // dos cosas enfrentadas (antes/ahora, A/B); usa `items` con exactamente dos
  'split_versus',
  // un proceso de 2 a 4 estaciones escalonadas; usa `items`
  'pasos_flow',
  // una cifra que se dispara o se hunde; `value` + `style` (sube|baja) + `label`
  'tendencia',
  // A frente a B CON magnitud («diez veces más barato»): dos barras a escala.
  // `items` = las dos etiquetas, `values` = las dos magnitudes tal y como se
  // dicen, en la MISMA unidad (la barra se escala con su parte numérica).
  // Elegida por frecuencia en calibracion/frases-etiquetadas.json (3/39):
  // split_versus enfrenta dos cosas pero no dice CUÁNTO, y eso es justo lo que
  // este nicho compara («semanas frente a horas», «10x frente a 1x»).
  'barras',
  // orden de hechos con su CUÁNDO («primero pasó esto, y en julio aquello»):
  // hitos sobre una línea. pasos_flow ordena un proceso pero no lleva fechas,
  // y la fecha es lo que convierte la lista en historia. `hitos` = 2-4 pares
  // fecha + texto. Banco de frases: 2/39.
  'linea_tiempo',
  // imagen REAL de referencia de una entidad con nombre (producto, empresa,
  // modelo), superpuesta al plano cuando la voz la menciona; `image_path`
  // congelado en workers + `text` (el término) + `credit` (atribución si la
  // licencia la exige). Nunca imagen generada: cascada foto de stock →
  // Wikimedia Commons.
  'imagen_apoyo',
] as const;
export const editTypeSchema = z.enum(EDIT_TYPES);
export type EditType = z.infer<typeof editTypeSchema>;

/**
 * Cómo se pinta cada efecto. Es un `Record` COMPLETO a propósito: añadir un
 * tipo a `EDIT_TYPES` sin clasificarlo aquí no compila.
 *
 * Ese es todo el motivo de que exista. `pasos_flow` llegó al máster con sus
 * items, tenía componente en `effects/`, tenía su rama en `EditOverlay` y su
 * etiqueta en la timeline… y no salió en pantalla, porque el render decidía
 * qué montar con una lista de literales escrita a mano que nadie comprobaba.
 * Un tipo nuevo no se colaba: se caía, en silencio, después del render.
 *
 * - `overlay`: cubre la pantalla y se monta en su propia Sequence.
 * - `anotacion`: se dibuja sobre el plano, con su propia capa.
 * - `subtitulo`: modifica el subtítulo en vez de pintar encima.
 * - `camara`: mueve el plano (no pinta nada propio).
 * - `audio`: no se ve.
 */
/**
 * Dónde se pinta cada efecto. Existe porque producir y auditar discrepaban:
 * `dedupeAndCap` deja convivir un inserto arriba con una cifra en el centro
 * —una foto en la banda superior y un dato centrado es un montaje normal— y el
 * informe los denunciaba como solape. Con el presupuesto viejo casi nunca
 * coincidían; al subirlo, el aviso salta en un vídeo perfectamente montado.
 *
 * `Record` COMPLETO por el mismo motivo que EDIT_RENDER_KIND: un efecto nuevo
 * sin decidir dónde vive no compila. `null` = no ocupa sitio en pantalla.
 */
export const EDIT_BANDA: Record<EditType, 'superior' | 'centro' | null> = {
  // banda superior: no compiten con lo centrado
  text_callout: 'superior',
  imagen_apoyo: 'superior',
  // centro de la pantalla: estos sí se pisan entre ellos
  stat_card: 'centro',
  stat_odometer: 'centro',
  quote_card: 'centro',
  kinetic_text: 'centro',
  device_frame: 'centro',
  split_versus: 'centro',
  pasos_flow: 'centro',
  tendencia: 'centro',
  barras: 'centro',
  linea_tiempo: 'centro',
  // no ocupan sitio: mueven la cámara, tiñen el subtítulo, marcan el b-roll o suenan
  zoom_punch: null,
  keyword_highlight: null,
  annotation: null,
  micro_fx: null,
  sfx: null,
};

export const EDIT_RENDER_KIND: Record<
  EditType,
  'overlay' | 'anotacion' | 'subtitulo' | 'camara' | 'audio'
> = {
  zoom_punch: 'camara',
  keyword_highlight: 'subtitulo',
  text_callout: 'overlay',
  stat_card: 'overlay',
  quote_card: 'overlay',
  sfx: 'audio',
  kinetic_text: 'overlay',
  stat_odometer: 'overlay',
  annotation: 'anotacion',
  device_frame: 'overlay',
  micro_fx: 'anotacion',
  split_versus: 'overlay',
  pasos_flow: 'overlay',
  tendencia: 'overlay',
  barras: 'overlay',
  linea_tiempo: 'overlay',
  imagen_apoyo: 'overlay',
};

// Efectos de sonido integrados. Se sintetizan con ffmpeg en
// packages/video/scripts/make-sfx.ts (deterministas y sin licencias) y el render
// los carga por convención de nombre: public/sfx/<nombre>.wav. Añadir un nombre
// aquí obliga a darle receta y volumen, y el typecheck lo exige.
export const SFX_NAMES = [
  'whoosh',
  'pop',
  'riser',
  'ding',
  'impacto',
  'clic',
  'tic',
  'tecleo',
  'deslizar',
  'destello',
  'subgrave',
  'aparicion',
  'notificacion',
  'resolucion',
] as const;
export const sfxNameSchema = z.enum(SFX_NAMES);
export type SfxName = z.infer<typeof sfxNameSchema>;

const editBase = {
  from_ms: z.number().int().nonnegative(),
  to_ms: z.number().int().nonnegative(),
  // beat al que se ancla (zoom_punch necesita saber en qué beat escalar)
  beat_idx: z.number().int().nonnegative().optional(),
  // variación determinista si hiciera falta
  seed: z.number().optional(),
};

/**
 * Unión discriminada por `type`: cada efecto exige el campo SIN EL CUAL el
 * render pinta un hueco. Con el objeto plano anterior, un stat_card sin `value`
 * validaba y llegaba a la composición como una tarjeta de dato vacía.
 *
 * `style` queda libre (no enum) para no acoplar el contrato a la lista de formas
 * de annotation/micro_fx/device_frame, que crece en el paquete de vídeo.
 */
export const editSchema = z.discriminatedUnion('type', [
  // sin beat_idx el punch no sabe qué plano escalar
  z.object({
    ...editBase,
    type: z.literal('zoom_punch'),
    beat_idx: z.number().int().nonnegative(),
  }),
  z.object({ ...editBase, type: z.literal('sfx'), sfx: sfxNameSchema }),
  z.object({ ...editBase, type: z.literal('keyword_highlight'), keyword: z.string().min(1) }),
  z.object({ ...editBase, type: z.literal('text_callout'), text: z.string().min(1) }),
  z.object({ ...editBase, type: z.literal('quote_card'), text: z.string().min(1) }),
  z.object({ ...editBase, type: z.literal('kinetic_text'), text: z.string().min(1) }),
  z.object({
    ...editBase,
    type: z.literal('stat_card'),
    value: z.string().min(1),
    label: z.string().optional(),
  }),
  z.object({
    ...editBase,
    type: z.literal('stat_odometer'),
    value: z.string().min(1),
    label: z.string().optional(),
  }),
  // Los tres del catálogo de motion graphics. `items` son rótulos cortos que se
  // leen en pantalla mientras la voz sigue: si la lista se DIBUJA, la narración
  // puede dejar de recitarla, que es la causa de los rótulos locutados.
  z.object({
    ...editBase,
    type: z.literal('split_versus'),
    items: z.array(z.string().min(1)).length(2),
  }),
  z.object({
    ...editBase,
    type: z.literal('pasos_flow'),
    items: z.array(z.string().min(1)).min(2).max(4),
  }),
  z.object({
    ...editBase,
    type: z.literal('tendencia'),
    value: z.string().min(1),
    /** sube | baja: el perfil de la curva, no un color de marca */
    style: z.string().min(1),
    label: z.string().optional(),
  }),
  // dos barras a escala: sin las dos magnitudes no hay nada que escalar, así
  // que son obligatorias — una barra sin número sería un split_versus disfrazado
  z.object({
    ...editBase,
    type: z.literal('barras'),
    /** las dos etiquetas, en el mismo orden que `values` */
    items: z.array(z.string().min(1)).length(2),
    /** las dos magnitudes como se DICEN («3 semanas», «10x»), misma unidad */
    values: z.array(z.string().min(1)).length(2),
    label: z.string().optional(),
  }),
  // sin fecha no hay línea de tiempo, hay una lista: cada hito exige su cuándo
  z.object({
    ...editBase,
    type: z.literal('linea_tiempo'),
    hitos: z
      .array(z.object({ fecha: z.string().min(1), texto: z.string().min(1) }))
      .min(2)
      .max(4),
  }),
  // annotation es la única sin payload obligatorio: es una marca sobre el b-roll
  z.object({
    ...editBase,
    type: z.literal('annotation'),
    style: z.string().optional(),
    text: z.string().optional(),
  }),
  z.object({
    ...editBase,
    type: z.literal('device_frame'),
    text: z.string().min(1),
    style: z.string().optional(),
  }),
  z.object({ ...editBase, type: z.literal('micro_fx'), style: z.string().min(1) }),
  // sin image_path no hay nada que enseñar: mejor que el edit se caiga en la
  // lectura tolerante a que el render pinte un recuadro vacío. `text` es el
  // término que ilustra (lo enseña la timeline y lo audita el informe);
  // `credit` es la atribución que la licencia exija (Wikimedia CC BY/BY-SA) y
  // acaba en description.txt.
  z.object({
    ...editBase,
    type: z.literal('imagen_apoyo'),
    image_path: z.string().min(1),
    text: z.string().min(1),
    credit: z.string().optional(),
  }),
]);
export type Edit = z.infer<typeof editSchema>;

/**
 * Lectura TOLERANTE del campo ya persistido. Endurecer sin esto rompería el
 * parse del maestro en el worker de assets, en el render y en el player del
 * dashboard: un solo efecto viejo malformado dejaría el vídeo sin render Y sin
 * previsualización. Aquí el que no cumple se descarta y el maestro sigue vivo.
 */
export const editsFieldSchema = z.array(z.unknown()).transform((raw) =>
  raw.flatMap((item) => {
    const parsed = editSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }),
);

/** Cuántos efectos descartaría la lectura tolerante, para poder AVISAR. */
export function countInvalidEdits(raw: unknown): number {
  return Array.isArray(raw) ? raw.filter((i) => !editSchema.safeParse(i).success).length : 0;
}

/** Texto que lleva un efecto, sin tener que estrechar el tipo en cada consumidor. */
export function editPayloadText(e: Edit): string | undefined {
  if ('text' in e && e.text !== undefined) return e.text;
  if ('value' in e) return e.value;
  if ('keyword' in e) return e.keyword;
  if ('sfx' in e) return e.sfx;
  return undefined;
}

/**
 * Qué pasó al generar el guion, para poder diagnosticarlo después.
 *
 * Existe porque el sistema de intenciones declaradas rendía muy por debajo de su
 * capacidad y no había forma de saber por qué: si el modelo declaraba pocas, si
 * la validación las tiraba, o si las borraba la pasada de duración. El aviso se
 * escribía en el log y se perdía. Esto es barato (unas decenas de bytes) y es la
 * diferencia entre arreglar con datos y arreglar a ciegas.
 */
export const scriptTelemetrySchema = z.object({
  words: z.number().int().nonnegative(),
  target_words: z.number().int().nonnegative(),
  scenes: z.number().int().nonnegative(),
  /** declaradas por el modelo, ANTES de validarlas */
  intents_declared: z.number().int().nonnegative(),
  /** las que sobreviven en el maestro final */
  intents_kept: z.number().int().nonnegative(),
  /** las que tiró la validación, con su motivo */
  intents_dropped: z
    .array(z.object({ scene_id: z.string(), effect: z.string(), reason: z.string() }))
    .default([]),
  /** las que se perdieron al reescribir el texto en la pasada de duración */
  intents_lost_in_length_pass: z.number().int().nonnegative().default(0),
  length_pass_ran: z.boolean().default(false),
});
export type ScriptTelemetry = z.infer<typeof scriptTelemetrySchema>;

export const masterVideoJsonV1 = z.object({
  version: z.literal('1'),
  video: z.object({
    id: z.string(),
    channel_id: z.string(),
    idea_id: z.string(),
    fps: z.literal(30),
    width: z.literal(1920),
    height: z.literal(1080),
  }),
  research: researchSchema.optional(),
  script: scriptSchema.optional(),
  // revisión del juez con rúbrica; opcional, los maestros anteriores no la traen
  script_review: scriptReviewSchema.optional(),
  script_telemetry: scriptTelemetrySchema.optional(),
  /**
   * Con qué reglas de b-roll se produjo ESTE vídeo. Se congela al matchear
   * porque el informe de calidad tiene que auditar contra el techo que estaba
   * en vigor, no contra el que tenga el canal el día que se lee el informe: si
   * no, cambiar el ajuste re-califica en silencio todos los vídeos viejos y el
   * histórico deja de poder compararse consigo mismo.
   */
  broll_telemetry: z.object({ imagenes_max_pct: z.number().min(0).max(1) }).optional(),
  seo: seoSchema.optional(),
  audio: audioSchema.optional(),
  cues: z.array(cueSchema).optional(),
  beats: z.array(beatSchema).optional(),
  // índice escena → tramo de audio; lo usa el director para anclar por palabra
  scene_spans: z.array(sceneSpanSchema).optional(),
  segments: z.array(segmentSchema).optional(),
  // línea de tiempo de efectos de edición (director de edición); opcional y de
  // lectura tolerante, para no tumbar maestros anteriores al endurecimiento
  edits: editsFieldSchema.optional(),
  brand: brandSchema.optional(),
  costs: costsSchema.optional(),
});

export type MasterVideoJson = z.infer<typeof masterVideoJsonV1>;
export type Scene = z.infer<typeof sceneSchema>;
export type Cue = z.infer<typeof cueSchema>;
export type Word = z.infer<typeof wordSchema>;
export type Beat = z.infer<typeof beatSchema>;
export type Subvisual = z.infer<typeof subvisualSchema>;
export type StoredSubvisual = z.infer<typeof storedSubvisualSchema>;
export type Segment = z.infer<typeof segmentSchema>;
export type BeatAsset = z.infer<typeof beatAssetSchema>;
export type BeatCandidate = z.infer<typeof candidateSchema>;
export type Fit = z.infer<typeof fitSchema>;
export type Seo = z.infer<typeof seoSchema>;
export type Research = z.infer<typeof researchSchema>;

// Lo que exige el render: audio, cues, beats con asset resuelto (path incluido)
// y al menos el tema de subtítulos del brand kit.
export const renderableMasterV1 = masterVideoJsonV1
  .required({ audio: true, cues: true, beats: true, brand: true, script: true, seo: true })
  .superRefine((master, ctx) => {
    for (const beat of master.beats) {
      if (!beat.asset?.path || !beat.asset.kind) {
        ctx.addIssue({
          code: 'custom',
          path: ['beats', beat.idx, 'asset'],
          message: `El beat ${beat.idx} no tiene asset resuelto con path y kind`,
        });
      }
      if (beat.status !== 'locked') {
        ctx.addIssue({
          code: 'custom',
          path: ['beats', beat.idx, 'status'],
          message: `El beat ${beat.idx} no está locked (timeline sin aprobar)`,
        });
      }
    }
    if (master.seo.chosen_idx === null) {
      ctx.addIssue({ code: 'custom', path: ['seo', 'chosen_idx'], message: 'Falta elegir título' });
    }
  });

export type RenderableMaster = z.infer<typeof renderableMasterV1>;
