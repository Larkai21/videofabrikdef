import { z } from 'zod';
import { RATIO_IMAGENES_MAX } from './constants.js';
import { designTokensSchema } from './design.js';

// ChannelProfile v1 (docs/contratos.md §1). Se sintetiza en el wizard,
// el humano lo edita y aprueba, y se inyecta como contexto en todo lo generado.

export const channelProfileV1 = z.object({
  version: z.literal('1'),
  identity: z.object({
    name: z.string().min(1),
    positioning: z.string(),
    audience: z.string(),
    tone: z.array(z.string()),
  }),
  // personaje/mascota del canal (nombre + descripción) para el avatar y la marca
  character: z
    .object({
      name: z.string(),
      description: z.string(),
    })
    .optional(),
  // design system editable (colores + tipografía); si falta, se usa defaultDesign()
  brand_design: designTokensSchema.optional(),
  language: z.enum(['es', 'en']),
  pillars: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      example_queries: z.array(z.string()),
    }),
  ),
  style: z.object({
    // sufijo para prompts de Flux y queries de stock
    visual_prompt_suffix: z.string(),
    stock_query_lang: z.enum(['en', 'es']),
    // temas/palabras prohibidos
    banned: z.array(z.string()),
    /**
     * Techo de imágenes fijas en el b-roll, de 0 a 1. Gobierna tres sitios a la
     * vez: cuántas plazas de finalista pueden ir a fotos, cuánto tiene que
     * ganar una foto para llevarse el plano, y el umbral con el que el informe
     * de calidad audita el vídeo terminado.
     *
     * 0 significa «quiero todo vídeo», y es una PREFERENCIA FUERTE, no una
     * prohibición: siempre queda una plaza de reserva. Sin ella, un tramo sin
     * ningún clip relevante cae a Flux, que genera una imagen y encima cuesta:
     * se acabaría con más imágenes, no con menos.
     */
    broll_imagenes_max_pct: z.number().min(0).max(1).default(RATIO_IMAGENES_MAX),
  }),
  voice: z.object({
    provider: z.enum(['edge', 'elevenlabs']),
    voice_id: z.string(),
    // ajuste de velocidad estilo edge-tts, p. ej. '-8%'
    rate: z.string(),
  }),
  title_patterns: z.array(
    z.object({
      template: z.string(),
      example: z.string(),
      source: z.enum(['mined', 'manual']),
    }),
  ),
  high_cpm_topics: z.array(z.string()),
  flags: z.object({
    packaging_first: z.boolean(),
    ai_disclosure: z.boolean(),
  }),
});

export type ChannelProfile = z.infer<typeof channelProfileV1>;

// settings de canal (columna channels.settings) — no forma parte del perfil editable
export const channelSettingsSchema = z.object({
  llm: z
    .object({
      model: z.string().default('gpt-5-mini'),
      quality_tier: z.enum(['default', 'high']).default('default'),
    })
    .default({ model: 'gpt-5-mini', quality_tier: 'default' }),
  scoring: z
    .object({
      external: z.number().default(30),
      fit: z.number().default(25),
      freshness: z.number().default(15),
      saturation: z.number().default(20),
      commercial: z.number().default(10),
      freshness_tau_hours: z.number().default(48),
    })
    .default({
      external: 30,
      fit: 25,
      freshness: 15,
      saturation: 20,
      commercial: 10,
      freshness_tau_hours: 48,
    }),
  anti_repeat_n: z.number().int().default(8),
  monthly_budget_usd: z.number().default(15),
  // duración objetivo de locución en minutos (SPEC: 6–9; corto para pruebas)
  target_minutes: z.number().default(7),
  // componentes activos del brand kit por tipo: refs "nombre@versión" del
  // registry; los vídeos nacen con esta selección en master.brand
  brand_components: z
    .record(z.string(), z.string())
    .default({ subtitle_theme: 'subtitulos-basicos@0.1.0' }),
  // música de fondo: pista de library/assets/music por mood a −22 dB (S2)
  background_music: z.boolean().default(false),
  // programación de publicación (S3): al aprobar la subida, publishAt salta
  // al siguiente hueco (día de la semana 0=domingo…6, hora local del VPS);
  // sin regla, el vídeo queda en privado sin fecha
  publish_schedule: z
    .object({
      weekday: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
    })
    .nullable()
    .default(null),
  // conexión OAuth del canal de YouTube (refresh token del propietario);
  // instalación monousuario en VPS propio: vive en settings jsonb
  youtube: z
    .object({
      refresh_token: z.string(),
      channel_title: z.string().optional(),
      connected_at: z.string(),
    })
    .nullable()
    .default(null),
});

export type ChannelSettings = z.infer<typeof channelSettingsSchema>;
