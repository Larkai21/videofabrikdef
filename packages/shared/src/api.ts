import { z } from 'zod';
import { channelProfileV1 } from './channel-profile.js';
import { beatSchema, candidateSchema, masterVideoJsonV1 } from './master-json.js';
import { beatStatusSchema, ideaStatusSchema, videoStateSchema } from './states.js';

// DTOs de la API interna (docs/contratos.md §4). Contrato fijo entre
// apps/api y apps/dashboard: ambos importan de aquí.

export const wizardRequestSchema = z.object({
  niche: z.string().min(2),
  competitors: z.array(z.string()).default([]),
  language: z.enum(['es', 'en']).default('es'),
  name: z.string().min(1),
});
export type WizardRequest = z.infer<typeof wizardRequestSchema>;

export const channelDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  profile: channelProfileV1.nullable(),
  profile_approved: z.boolean(),
  // URL /files del avatar/personaje del canal, o null si no tiene
  avatar_url: z.string().nullable(),
  created_at: z.string(),
});
export type ChannelDto = z.infer<typeof channelDtoSchema>;

export const ideaDtoSchema = z.object({
  id: z.string(),
  channel_id: z.string(),
  title: z.string(),
  summary: z.string(),
  angle: z.string().nullable(),
  why_now: z.string().nullable(),
  score: z.number(),
  status: ideaStatusSchema,
  // orden manual del radar (null = ordena el score)
  manual_rank: z.number().int().nullable(),
  source_refs: z.array(
    z.object({
      url: z.string(),
      title: z.string().optional(),
      domain: z.string().optional(),
    }),
  ),
  created_at: z.string(),
});
export type IdeaDto = z.infer<typeof ideaDtoSchema>;

// Fuente de ideas visible en el radar de la bandeja.
export const sourceDtoSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  consecutive_failures: z.number().int(),
  last_fetched_at: z.string().nullable(),
});
export type SourceDto = z.infer<typeof sourceDtoSchema>;

// Reordenación manual del ranking: lista COMPLETA de ids visibles, en orden.
export const ideasOrderRequestSchema = z.object({
  channel: z.string().min(1),
  ids: z.array(z.string().min(1)).min(1).max(50),
});
export type IdeasOrderRequest = z.infer<typeof ideasOrderRequestSchema>;

export const youtubePublicationSchema = z.object({
  // estado de la publicación, SEPARADO de la máquina de estados del vídeo
  status: z.enum(['subiendo', 'subido', 'fallido']),
  youtube_id: z.string().nullable(),
  url: z.string().nullable(),
  privacy_status: z.string().nullable(),
  publish_at: z.string().nullable(),
  uploaded_at: z.string().nullable(),
  error: z.string().nullable(),
});
export type YoutubePublication = z.infer<typeof youtubePublicationSchema>;

export const inboxGateSchema = z.object({
  kind: z.enum(['idea', 'guion', 'timeline', 'entrega']),
  video_id: z.string().nullable(),
  channel_id: z.string(),
  step_label: z.string(),
  title: z.string(),
  meta: z.string(),
  eta_min: z.number(),
});

export const inboxRunningSchema = z.object({
  video_id: z.string(),
  title: z.string(),
  state: videoStateSchema,
  detail: z.string(),
  // 0–100 o null si no hay progreso medible
  progress: z.number().nullable(),
  cost_usd: z.number(),
  incident: z
    .object({
      message: z.string(),
      suggested_action: z.enum(['reintentar', 'regenerar', 'descartar']).nullable(),
    })
    .nullable(),
});

export const inboxDtoSchema = z.object({
  gates: z.array(inboxGateSchema),
  running: z.array(inboxRunningSchema),
  done: z.array(
    z.object({
      video_id: z.string(),
      title: z.string(),
      output_dir: z.string(),
      finished_at: z.string(),
      youtube: youtubePublicationSchema.nullable(),
    }),
  ),
  month_cost_usd: z.number(),
  month_videos: z.number(),
  month_budget_usd: z.number(),
});
export type InboxDto = z.infer<typeof inboxDtoSchema>;

export const videoDetailDtoSchema = z.object({
  id: z.string(),
  channel_id: z.string(),
  state: videoStateSchema,
  title_chosen: z.string().nullable(),
  master: masterVideoJsonV1,
  costs_total: z.number(),
  // URL /files de la miniatura OFICIAL: la subida por el humano (thumb_custom.*)
  // si existe, si no la auto-generada (thumb_a.jpg), o null si aún no hay
  thumbnail_url: z.string().nullable(),
  youtube: youtubePublicationSchema.nullable(),
  incident: z
    .object({
      message: z.string(),
      suggested_action: z.enum(['reintentar', 'regenerar', 'descartar']).nullable(),
    })
    .nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type VideoDetailDto = z.infer<typeof videoDetailDtoSchema>;

// Brief de miniatura de alta conversión: descripción detallada en español de
// cómo debería ser la imagen (para que el humano la genere) + un prompt en
// inglés listo para pegar en un generador de imágenes. Se persiste como
// outputs/<id>/thumbnail-brief.json.
export const thumbnailBriefSchema = z.object({
  brief: z.string(),
  prompt: z.string(),
});
export type ThumbnailBrief = z.infer<typeof thumbnailBriefSchema>;

export const timelineBeatDtoSchema = beatSchema.extend({
  discard_reason: z.string().nullable().optional(),
  // similitud del asset elegido (para la barra de la UI)
  chosen_score: z.number().nullable().optional(),
  // origen legible: 'Pexels · clip 8842190', 'Biblioteca · b-roll 44'…
  chosen_origin: z.string().nullable().optional(),
});

export const timelineDtoSchema = z.object({
  video_id: z.string(),
  state: videoStateSchema,
  audio_url: z.string().nullable(),
  duration_ms: z.number(),
  beats: z.array(timelineBeatDtoSchema),
});
export type TimelineDto = z.infer<typeof timelineDtoSchema>;

export const beatActionRequestSchema = z.object({
  action: z.enum(['approve', 'choose', 'discard']),
  // para choose: candidate.ref
  ref: z.string().optional(),
  // para choose desde la búsqueda libre de stock: el candidato completo
  // (sus resultados no viven en beats.candidates hasta que se elige uno)
  candidate: candidateSchema.optional(),
  // para discard: motivo (alimenta la regeneración)
  reason: z.string().optional(),
});
export type BeatActionRequest = z.infer<typeof beatActionRequestSchema>;

export const scriptEditRequestSchema = z.object({
  scenes: z.array(
    z.object({
      id: z.string(),
      // una escena vacía revienta la síntesis con el proveedor real
      text: z.string().trim().min(1, 'el texto de la escena no puede quedar vacío'),
    }),
  ),
});
export type ScriptEditRequest = z.infer<typeof scriptEditRequestSchema>;

export const titleChoiceRequestSchema = z.object({
  chosen_idx: z.number().int().min(0).max(2),
});
export type TitleChoiceRequest = z.infer<typeof titleChoiceRequestSchema>;

export const stockSearchResultSchema = z.object({
  results: z.array(candidateSchema),
});
export type StockSearchResult = z.infer<typeof stockSearchResultSchema>;

export const beatStatusUpdateSchema = z.object({
  idx: z.number().int(),
  status: beatStatusSchema,
});

export const channelSettingsUpdateSchema = z.object({
  monthly_budget_usd: z.number().positive().optional(),
  target_minutes: z.number().min(0.5).max(20).optional(),
  anti_repeat_n: z.number().int().min(0).optional(),
  background_music: z.boolean().optional(),
  brand_components: z.record(z.string(), z.string()).optional(),
  publish_schedule: z
    .object({
      weekday: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
    })
    .nullable()
    .optional(),
});
export type ChannelSettingsUpdate = z.infer<typeof channelSettingsUpdateSchema>;

export const componentDtoSchema = z.object({
  id: z.string(),
  channel_id: z.string(),
  type: z.string(),
  name: z.string(),
  version: z.string(),
  status: z.enum(['pending', 'validated', 'failed']),
  log: z.string().nullable(),
  preview_url: z.string().nullable(),
  // preview animada (mp4 del render de humo) para verla en bucle; null en
  // miniaturas (still) o si aún no está validado
  preview_video_url: z.string().nullable(),
  active: z.boolean(),
  created_at: z.string(),
});
export type ComponentDto = z.infer<typeof componentDtoSchema>;

export const libraryAssetDtoSchema = z.object({
  id: z.string(),
  scope: z.string(),
  channel_id: z.string().nullable(),
  kind: z.string(),
  url: z.string(),
  thumb_url: z.string().nullable(),
  source: z.string(),
  license: z.string(),
  duration_ms: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  tags: z.array(z.string()),
  caption: z.string().nullable(),
  origin_query: z.string().nullable(),
  times_used: z.number(),
  last_video_id: z.string().nullable(),
  favorite: z.boolean(),
  purge_candidate: z.boolean(),
  created_at: z.string(),
});
export type LibraryAssetDto = z.infer<typeof libraryAssetDtoSchema>;

export const libraryListDtoSchema = z.object({
  assets: z.array(libraryAssetDtoSchema),
  total: z.number(),
});
export type LibraryListDto = z.infer<typeof libraryListDtoSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });

export const errorResponseSchema = z.object({
  error: z.string(),
  detail: z.string().optional(),
});
