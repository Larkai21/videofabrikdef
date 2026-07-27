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
  // para discard: motivo (alimenta la regeneración)
  reason: z.string().optional(),
});
export type BeatActionRequest = z.infer<typeof beatActionRequestSchema>;

export const scriptEditRequestSchema = z.object({
  scenes: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
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

export const okResponseSchema = z.object({ ok: z.literal(true) });

export const errorResponseSchema = z.object({
  error: z.string(),
  detail: z.string().optional(),
});
