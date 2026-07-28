import { z } from 'zod';
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

export const beatSchema = z.object({
  idx: z.number().int().nonnegative(),
  from_ms: z.number().int().nonnegative(),
  to_ms: z.number().int().nonnegative(),
  text: z.string(),
  visual_query: z.string(),
  status: beatStatusSchema,
  asset: beatAssetSchema.optional(),
  candidates: z.array(candidateSchema).optional(),
});

export const brandSchema = z.object({
  // nombre visible del canal para intro/outro/rótulos (el render no lee BD)
  channel_name: z.string().optional(),
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
  brand: brandSchema.optional(),
  costs: costsSchema.optional(),
});

export type MasterVideoJson = z.infer<typeof masterVideoJsonV1>;
export type Scene = z.infer<typeof sceneSchema>;
export type Cue = z.infer<typeof cueSchema>;
export type Word = z.infer<typeof wordSchema>;
export type Beat = z.infer<typeof beatSchema>;
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
