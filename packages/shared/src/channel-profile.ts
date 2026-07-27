import { z } from 'zod';

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
});

export type ChannelSettings = z.infer<typeof channelSettingsSchema>;
