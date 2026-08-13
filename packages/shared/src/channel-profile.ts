import { z } from 'zod';
import { RATIO_IMAGENES_MAX } from './constants.js';
import { designTokensSchema } from './design.js';

// ChannelProfile v1 (docs/contratos.md §1). Se sintetiza en el wizard,
// el humano lo edita y aprueba, y se inyecta como contexto en todo lo generado.

export const channelProfileV1 = z.object({
  version: z.literal('1'),
  identity: z.object({
    name: z.string().min(1),
    // la segunda línea de la cabecera del canal («Noticias de tecnología e
    // IA»). Es texto de marca, corto y fijo, no el posicionamiento: eso es
    // contexto para el modelo y no cabe en pantalla.
    tagline: z.string().max(48).optional(),
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
    // sufijo de estilo para prompts de imagen (componentes del brand kit).
    // NO se concatena a las consultas de stock: hacía que Pixabay fallara por
    // longitud y comprimía todos los cosenos con una componente común.
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
     * prohibición: siempre queda una plaza de reserva. La cascada no tiene
     * generación de imagen detrás, así que un tramo sin ningún clip que encaje
     * se quedaría literalmente sin plano.
     */
    broll_imagenes_max_pct: z.number().min(0).max(1).default(RATIO_IMAGENES_MAX),
    /**
     * Si el visto bueno del juez de planos da el verde (auto_ok) al sub-plano.
     *
     * T_AUTO está descalibrado y documentado como no-corregible moviendo el
     * número (constants.ts): hoy ~6/35 beats salen en verde y el humano revisa
     * casi todo. El juez lee los pies de foto con precisión medida (24/25 sin
     * disparate), así que su confirmación es mejor puerta que un umbral ciego.
     * Off por defecto: se enciende por canal cuando sus números lo respalden.
     */
    broll_juez_aprueba: z.boolean().default(false),
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
  /**
   * Corte SEMÁNTICO de relleno en los clips de episodio: el LLM marca frases
   * prescindibles y el apretado las corta como si fueran silencio (el editor
   * de referencia lo hace a mano). Apagado por defecto: es una llamada más
   * por clip y quita material — se enciende por canal cuando se confía.
   */
  clips_relleno: z.boolean().default(false),
  /**
   * B-roll ilustrativo en los clips de episodio: el director marca frases
   * ilustrables y la cascada de biblioteca pone el plano (referencia: inserta
   * metraje sobre «driving in a car»). Encendido por defecto porque degrada
   * limpio: sin candidato digno en la biblioteca no hay inserto.
   */
  clips_broll: z.boolean().default(true),
  // duración objetivo de locución en minutos (SPEC: 6–9; corto para pruebas)
  /**
   * Duración objetivo en minutos. Se conserva por compatibilidad con los
   * ajustes ya guardados y como TECHO por defecto de `duracion`; lo que manda
   * es el rango.
   */
  target_minutes: z.number().default(7),
  /**
   * Rango editorial de duración. La longitud REAL la decide el material: una
   * noticia con dos datos no da un vídeo de doce minutos, y una con veinte no
   * cabe en cinco.
   *
   * Antes era un número fijo y el material solo podía ACORTAR (y solo hasta un
   * suelo de 2 min), así que todos los vídeos salían pidiendo las mismas 875
   * palabras y el que no daba para tanto se rellenaba. Con un rango, el número
   * fijo pasa a ser lo que siempre debió ser: los bordes de lo que este canal
   * publica.
   *
   * Por debajo del mínimo NO se acorta: se abre incidencia. Si el material no
   * da ni para el vídeo más corto del canal, el problema es la idea.
   */
  duracion: z
    .object({
      min: z.number().min(1).max(60),
      max: z.number().min(1).max(60),
    })
    .refine((d) => d.min <= d.max, { message: 'el mínimo no puede pasar del máximo' })
    .default({ min: 5, max: 12 }),
  // componentes activos del brand kit por tipo: refs "nombre@versión" del
  // registry; los vídeos nacen con esta selección en master.brand
  brand_components: z
    .record(z.string(), z.string())
    .default({ subtitle_theme: 'subtitulos-basicos@0.1.0' }),
  /**
   * ¿El avatar del canal sale EN EL VÍDEO (intro y outro)?
   *
   * Apagado por defecto. Un avatar cuadrado con su propio fondo y su viñeta
   * metido en un disco a pantalla completa canta: se lee como una foto pegada
   * encima, no como parte de la pieza. Y no es un problema de tamaño ni de
   * recorte, es que la imagen trae su propia iluminación y su propio encuadre.
   *
   * Mientras no esté resuelto, la intro se monta como la cabecera del canal —
   * entramado, logotipo y coletilla—, que además es más fiel: la cabecera
   * tampoco lleva el avatar dentro.
   *
   * No afecta a la miniatura ni a la cabecera del dashboard, que lo siguen
   * usando y ahí sí funciona: es una imagen pequeña sobre fondo neutro.
   */
  avatar_en_video: z.boolean().default(false),
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
