import { z } from 'zod';
import { channelProfileV1 } from './channel-profile.js';
import {
  episodeClaimSchema,
  episodeLicenseSchema,
  episodePlatformSchema,
  episodeStateSchema,
} from './episode-states.js';
import { beatSchema, candidateSchema, editSchema, masterVideoJsonV1 } from './master-json.js';
import { videoMetricsSchema } from './metrics.js';
import { reelFormatSchema, reelStateSchema } from './reel-states.js';
import { shortMasterV1 } from './short-json.js';
import { shortStateSchema } from './short-states.js';
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

// Panel de costes: desglose del ledger por proveedor y por operación.
export const costBreakdownRowSchema = z.object({
  key: z.string(),
  cost_usd: z.number(),
  calls: z.number(),
});
export const costsDtoSchema = z.object({
  total_usd: z.number(),
  by_provider: z.array(costBreakdownRowSchema),
  by_operation: z.array(costBreakdownRowSchema),
});
export type CostsDto = z.infer<typeof costsDtoSchema>;

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
  // quién lo subió. Opcional y sin .default(): las filas escritas antes de que
  // existiera este campo no lo traen, y un default lo haría REQUERIDO en la
  // salida de z.infer, que rompe los `youtube: video.youtube ?? null` de la API.
  // Ausente se lee como 'api'.
  origin: z.enum(['api', 'manual']).optional(),
  youtube_id: z.string().nullable(),
  url: z.string().nullable(),
  privacy_status: z.string().nullable(),
  publish_at: z.string().nullable(),
  uploaded_at: z.string().nullable(),
  error: z.string().nullable(),
});
export type YoutubePublication = z.infer<typeof youtubePublicationSchema>;

// Marcado manual: el humano subió el vídeo por su cuenta y solo registra el
// resultado. No encola nada ni toca la máquina de estados. El esquema queda
// tonto a propósito y la extracción del id se valida en la ruta, para dar un
// mensaje en español en vez de un ZodError serializado.
export const manualPublicationRequestSchema = z.object({
  url_or_id: z.string().trim().min(1),
});
export type ManualPublicationRequest = z.infer<typeof manualPublicationRequestSchema>;

// ---- episodios externos (clipping) ----

export const episodeCreateRequestSchema = z.object({
  url: z.string().trim().url(),
  channel_id: z.string().min(1),
});
export type EpisodeCreateRequest = z.infer<typeof episodeCreateRequestSchema>;

export const episodeDtoSchema = z.object({
  id: z.string(),
  channel_id: z.string(),
  state: episodeStateSchema,
  source_url: z.string(),
  source_platform: episodePlatformSchema,
  source_title: z.string().nullable(),
  source_channel_name: z.string().nullable(),
  license_status: episodeLicenseSchema,
  duration_ms: z.number().int().nullable(),
  /** x (0..1) del encuadre elegido por el humano; null si aún no eligió */
  focus_x: z.number().nullable(),
  /** reclamaciones registradas a mano; el historial de defensa */
  claims: z.array(episodeClaimSchema),
  incident: z
    .object({
      message: z.string(),
      suggested_action: z.enum(['reintentar', 'regenerar', 'descartar']).nullable(),
    })
    .nullable(),
  downloaded_at: z.string().nullable(),
  transcribed_at: z.string().nullable(),
  created_at: z.string(),
});
export type EpisodeDto = z.infer<typeof episodeDtoSchema>;

export const episodesListDtoSchema = z.object({ episodes: z.array(episodeDtoSchema) });
export type EpisodesListDto = z.infer<typeof episodesListDtoSchema>;

/** Registro manual de una reclamación sobre un episodio. */
export const episodeClaimRequestSchema = z.object({
  kind: z.enum(['content_id', 'manual', 'peticion_creador']),
  action: z.string().trim().min(1),
  note: z.string().trim().optional(),
});
export type EpisodeClaimRequest = z.infer<typeof episodeClaimRequestSchema>;

/**
 * Elección humana del encuadre 9:16 del episodio: la x (0..1) del centro del
 * recorte. Elegir entre candidatos, no un asa de arrastre — y en multicámara
 * un foco fijo elige el MENOS MALO; el foco por plano es v2.
 */
export const episodeFocusRequestSchema = z.object({ x: z.number().min(0).max(1) });
export type EpisodeFocusRequest = z.infer<typeof episodeFocusRequestSchema>;

export const episodeEncuadresDtoSchema = z.object({
  /** tres tiras (misma x en tres instantes) servidas por /files */
  opciones: z.array(
    z.object({ id: z.enum(['izq', 'centro', 'dcha']), x: z.number(), url: z.string() }),
  ),
  elegido_x: z.number().nullable(),
});
export type EpisodeEncuadresDto = z.infer<typeof episodeEncuadresDtoSchema>;

// ---- reels (módulo editor: A-roll propio + guion de dirección) ----

/**
 * Una capa del plan del editor. El contrato completo del plan es del módulo
 * (apps/editor valida con validar_plan.py contra su catálogo de capas); aquí
 * solo se fija lo que la UI necesita para listar y editar sin adivinar.
 */
export const reelPlanLayerSchema = z.looseObject({
  capa: z.string(),
  template: z.string().optional(),
  t: z.number().optional(),
  duracion: z.number().optional(),
});
export type ReelPlanLayer = z.infer<typeof reelPlanLayerSchema>;

export const reelDtoSchema = z.object({
  id: z.string(),
  channel_id: z.string(),
  state: reelStateSchema,
  title: z.string(),
  formato: reelFormatSchema,
  duration_ms: z.number().int().nullable(),
  /** nº de capas del plan; null mientras prepare no lo haya escrito */
  plan_capas: z.number().int().nullable(),
  /** URL /files del MP4 final cuando está renderizado */
  video_url: z.string().nullable(),
  portada_url: z.string().nullable(),
  incident: z
    .object({
      message: z.string(),
      suggested_action: z.enum(['reintentar', 'regenerar', 'descartar']).nullable(),
    })
    .nullable(),
  created_at: z.string(),
});
export type ReelDto = z.infer<typeof reelDtoSchema>;

/** El detalle añade el plan entero (lo que la pantalla edita) y el guion. */
export const reelDetailDtoSchema = reelDtoSchema.extend({
  plan: z.array(reelPlanLayerSchema).nullable(),
  guion: z.record(z.string(), z.unknown()),
});
export type ReelDetailDto = z.infer<typeof reelDetailDtoSchema>;

export const reelsListDtoSchema = z.object({ reels: z.array(reelDtoSchema) });
export type ReelsListDto = z.infer<typeof reelsListDtoSchema>;

export const reelPlanUpdateRequestSchema = z.object({
  plan: z.array(reelPlanLayerSchema).min(1),
});
export type ReelPlanUpdateRequest = z.infer<typeof reelPlanUpdateRequestSchema>;

// ---- shorts verticales ----

// Marcado manual del short, espejo del largo pero con el id OPCIONAL: marcar
// publicado sin id sigue valiendo (queda el casado por título), y con id el
// casado del CSV de Studio pasa a ser exacto.
export const shortPublicadoRequestSchema = z.object({
  url_or_id: z.string().trim().min(1).optional(),
});
export type ShortPublicadoRequest = z.infer<typeof shortPublicadoRequestSchema>;

export const shortDtoSchema = z.object({
  id: z.string(),
  video_id: z.string().nullable(),
  episode_id: z.string().nullable(),
  idx: z.number().int(),
  state: shortStateSchema,
  from_ms: z.number().int(),
  to_ms: z.number().int(),
  duration_ms: z.number().int(),
  title: z.string(),
  hook: z.string(),
  reason: z.string(),
  score: z.number(),
  output_dir: z.string().nullable(),
  /** URL /files del MP4 cuando está renderizado */
  video_url: z.string().nullable(),
  thumbnail_url: z.string().nullable(),
  published_at: z.string().nullable(),
  youtube_id: z.string().nullable(),
  /** telemetría importada del CSV de Studio (pnpm metricas); null sin datos */
  metrics: videoMetricsSchema.nullable(),
  incident: z
    .object({
      message: z.string(),
      suggested_action: z.enum(['reintentar', 'regenerar', 'descartar']).nullable(),
    })
    .nullable(),
  created_at: z.string(),
});
export type ShortDto = z.infer<typeof shortDtoSchema>;

/** El detalle añade el maestro, que es lo que previsualiza el player. */
export const shortDetailDtoSchema = shortDtoSchema.extend({ master: shortMasterV1 });
export type ShortDetailDto = z.infer<typeof shortDetailDtoSchema>;

export const shortsListDtoSchema = z.object({ shorts: z.array(shortDtoSchema) });
export type ShortsListDto = z.infer<typeof shortsListDtoSchema>;

// El título es CONTENIDO, no un corte: misma frontera que separa editar el
// guion (permitido) de mover los beats (prohibido).
export const shortTitleRequestSchema = z.object({ title: z.string().trim().min(1).max(60) });
export type ShortTitleRequest = z.infer<typeof shortTitleRequestSchema>;

export const shortDiscardRequestSchema = z.object({ reason: z.string().trim().max(200).optional() });
export type ShortDiscardRequest = z.infer<typeof shortDiscardRequestSchema>;

export const inboxGateSchema = z.object({
  // `episodio_listo` (episodio transcrito sin clips vivos), `clips_episodio`
  // (clips propuestos esperando firma) y `reel_plan` (plan del editor esperando
  // firma) son puertas que no paran ningún vídeo del raíl: la bandeja las
  // pinta en su propia sección
  kind: z.enum([
    'idea',
    'guion',
    'timeline',
    'entrega',
    'episodio_listo',
    'clips_episodio',
    'reel_plan',
  ]),
  video_id: z.string().nullable(),
  /** solo en las puertas de clipping; enlaza a /episodios/:id/clips */
  episode_id: z.string().nullable().optional(),
  /** solo episodio_listo: el selector de encuadre vive en /episodios, así
      que la ficha enlaza allí mientras falte y a la pantalla de clips después */
  encuadre_pendiente: z.boolean().optional(),
  /** solo en la puerta del plan del reel; enlaza a /reels/:id */
  reel_id: z.string().nullable().optional(),
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
      // Fecha de alta del vídeo, y la que ORDENA la galería: es inmutable.
      // `finished_at` es updatedAt y lo pisa cada escritura de publicación, así
      // que marcar como publicado un vídeo antiguo lo saltaría al principio de
      // una lista ordenada por «más reciente».
      created_at: z.string(),
      // URL /files de la miniatura oficial, para la galería de la bandeja;
      // null mientras no haya ninguna generada ni subida
      thumbnail_url: z.string().nullable(),
      youtube: youtubePublicationSchema.nullable(),
    }),
  ),
  month_cost_usd: z.number(),
  month_videos: z.number(),
  month_budget_usd: z.number(),
  /**
   * Saldo REAL de la clave del proveedor, frente al `month_cost_usd`, que es
   * una estimación a partir de los tokens. Null si no hay clave o si el
   * proveedor no responde: es un dato de apoyo y nunca puede tumbar la bandeja.
   *
   * Existe porque los dos números se separaron: el ledger marcaba 1,85 $ con la
   * clave a 3,05 $ y devolviendo 403. Verlos juntos es lo que avisa.
   */
  provider_balance: z
    .object({
      proveedor: z.literal('openrouter'),
      gastado_usd: z.number(),
      tope_usd: z.number().nullable(),
      queda_usd: z.number().nullable(),
    })
    .nullable(),
  // fuentes de scraping caídas (fallos consecutivos): el funnel de ideas se seca
  // en silencio si no se avisa
  stale_sources: z.array(z.object({ id: z.string(), label: z.string(), failures: z.number() })),
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
  /** telemetría importada del CSV de Studio (pnpm metricas); hasta ahora se
   * guardaba y NINGUNA pantalla la enseñaba — el bucle moría en la BD */
  metrics: videoMetricsSchema.nullable(),
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
  // efectos de edición (director) para revisar/quitar en la curación
  edits: z.array(editSchema),
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
  // componente integrado (no subido por zip): no se puede borrar y se activa
  // por ref; su id es 'builtin:<ref>'
  builtin: z.boolean().default(false),
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
