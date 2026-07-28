import { z } from 'zod';
import { designTokensSchema } from './design.js';
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
  lufs: z.number(),
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
});

export const candidateSchema = z.object({
  ref: z.string(),
  provider: z.enum(['library', 'pexels', 'pixabay', 'flux']),
  score: z.number(),
  thumb_url: z.string().optional(),
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
] as const;
export const editTypeSchema = z.enum(EDIT_TYPES);
export type EditType = z.infer<typeof editTypeSchema>;

export const SFX_NAMES = ['whoosh', 'pop', 'riser', 'ding'] as const;
export const sfxNameSchema = z.enum(SFX_NAMES);

export const editSchema = z.object({
  type: editTypeSchema,
  from_ms: z.number().int().nonnegative(),
  to_ms: z.number().int().nonnegative(),
  // beat al que se ancla (zoom_punch necesita saber en qué beat escalar)
  beat_idx: z.number().int().nonnegative().optional(),
  // palabra clave (keyword_highlight) o texto de callout/quote (text_callout/quote_card)
  keyword: z.string().optional(),
  text: z.string().optional(),
  // tarjeta de dato: cifra + etiqueta
  value: z.string().optional(),
  label: z.string().optional(),
  // efecto de sonido a disparar (built-in de public/sfx)
  sfx: sfxNameSchema.optional(),
  // variación determinista si hiciera falta
  seed: z.number().optional(),
});
export type Edit = z.infer<typeof editSchema>;

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
  seo: seoSchema.optional(),
  audio: audioSchema.optional(),
  cues: z.array(cueSchema).optional(),
  beats: z.array(beatSchema).optional(),
  segments: z.array(segmentSchema).optional(),
  // línea de tiempo de efectos de edición (director de edición); opcional
  edits: z.array(editSchema).optional(),
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
