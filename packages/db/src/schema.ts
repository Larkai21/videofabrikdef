import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';
import type {
  BeatCandidate,
  ChannelProfile,
  ChannelSettings,
  ComponentManifest,
  Fit,
  MasterVideoJson,
  ShortMasterJson,
  StoredSubvisual,
  VideoMetrics,
} from '@fabrica/shared';
import { EMBEDDING_DIMS } from '@fabrica/shared';

// Modelo de datos mínimo (SPEC §5). El estado de negocio vive aquí;
// BullMQ solo transporta trabajo.

export const channels = pgTable('channels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  profile: jsonb('profile').$type<ChannelProfile>(),
  profileApproved: boolean('profile_approved').notNull().default(false),
  // derivados del scraping de bootstrap (cadencias, outliers, patrones)
  profileInputs: jsonb('profile_inputs'),
  settings: jsonb('settings').$type<ChannelSettings>(),
  // ruta local del avatar/personaje del canal (lo sube el humano);
  // se congela en master.brand.avatar_path y se sirve por /files en el render
  avatarPath: text('avatar_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sources = pgTable(
  'sources',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id').references(() => channels.id),
    kind: text('kind').notNull(), // rss|hn|reddit|news|web|youtube|arxiv|github
    url: text('url').notNull(),
    label: text('label'),
    config: jsonb('config'),
    cadenceMinutes: integer('cadence_minutes').notNull().default(120),
    lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sources_channel_idx').on(t.channelId)],
);

export const rawItems = pgTable(
  'raw_items',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    urlCanonical: text('url_canonical').notNull(),
    title: text('title').notNull(),
    excerpt: text('excerpt'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    metrics: jsonb('metrics'),
    lang: text('lang'),
    hash: text('hash').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMS }),
    clusterId: text('cluster_id'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('raw_items_hash_idx').on(t.hash),
    index('raw_items_cluster_idx').on(t.clusterId),
    index('raw_items_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

export const ideas = pgTable(
  'ideas',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id),
    clusterId: text('cluster_id'),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    angle: text('angle'),
    whyNow: text('why_now'),
    score: doublePrecision('score').notNull().default(0),
    scoreParts: jsonb('score_parts'),
    status: text('status').notNull().default('new'), // new|approved|discarded|snoozed
    // orden manual del radar: null = ordena el score; el humano manda si existe
    manualRank: integer('manual_rank'),
    discardReason: text('discard_reason'),
    sourceRefs: jsonb('source_refs')
      .$type<{ url: string; title?: string; domain?: string }[]>()
      .notNull()
      .default([]),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMS }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    index('ideas_channel_status_idx').on(t.channelId, t.status),
    index('ideas_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
);

export const videos = pgTable(
  'videos',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id),
    ideaId: text('idea_id')
      .notNull()
      .references(() => ideas.id),
    state: text('state').notNull().default('idea_aprobada'),
    stateBeforeIncident: text('state_before_incident'),
    incident: jsonb('incident').$type<{
      message: string;
      suggested_action: 'reintentar' | 'regenerar' | 'descartar' | null;
      queue?: string;
      job?: { queue: string; name: string; data?: Record<string, unknown> };
    }>(),
    titleChosen: text('title_chosen'),
    // publicación en YouTube (S3): estado aparte de la máquina del pipeline
    youtube: jsonb('youtube').$type<{
      status: 'subiendo' | 'subido' | 'fallido';
      // 'manual' = lo subió el humano por su cuenta y solo marcó el resultado
      // desde el dashboard. Ausente se lee como 'api'.
      origin?: 'api' | 'manual';
      youtube_id: string | null;
      url: string | null;
      privacy_status: string | null;
      publish_at: string | null;
      uploaded_at: string | null;
      error: string | null;
      // sesión resumable interna (no viaja en el DTO): reanudación tras crash
      session?: { location: string; total: number } | null;
    }>(),
    // maestro progresivo SIN beats: los beats viven en su tabla y se funden al leer
    master: jsonb('master').$type<MasterVideoJson>().notNull(),
    // telemetría de rendimiento importada a mano del CSV de YouTube Studio
    // (pnpm metricas <csv>); el MVP no toca la YouTube API
    metrics: jsonb('metrics').$type<VideoMetrics>(),
    costsTotal: doublePrecision('costs_total').notNull().default(0),
    outputDir: text('output_dir'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('videos_state_idx').on(t.state), index('videos_channel_idx').on(t.channelId)],
);

// Shorts verticales recortados de un vídeo ya entregado. Tabla propia y no un
// jsonb en `videos` porque son N por vídeo con ciclo de vida propio: un array
// dentro de la fila del vídeo sería read-modify-write, y dos aprobaciones
// simultáneas perderían una.
export const shorts = pgTable(
  'shorts',
  {
    id: text('id').primaryKey(),
    // el ORIGEN: exactamente uno de los dos (lo valida el contrato del
    // maestro y el código de propuesta; un short sin padre no se audita)
    videoId: text('video_id').references(() => videos.id),
    // episodio externo del pipeline de clipping
    episodeId: text('episode_id').references(() => episodes.id),
    // desnormalizado a propósito: la bandeja y el ledger filtran por canal sin
    // tener que unir con videos
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id),
    idx: integer('idx').notNull(),
    state: text('state').notNull().default('propuesto'),
    stateBeforeIncident: text('state_before_incident'),
    incident: jsonb('incident').$type<{
      message: string;
      suggested_action: 'reintentar' | 'regenerar' | 'descartar' | null;
      queue?: string;
      job?: { queue: string; name: string; data?: Record<string, unknown> };
    }>(),
    // la ventana en el reloj del vídeo largo
    fromMs: integer('from_ms').notNull(),
    toMs: integer('to_ms').notNull(),
    title: text('title').notNull(),
    hook: text('hook').notNull(),
    reason: text('reason').notNull().default(''),
    score: doublePrecision('score').notNull().default(0),
    /**
     * Maestro vertical CONGELADO en el momento de proponer, no recalculado al
     * renderizar. El maestro largo ya está congelado y `recortarMaster` es
     * determinista, así que congelar aquí consigue tres cosas: el player del
     * dashboard previsualiza EXACTAMENTE lo que se va a renderizar (invariante
     * de docs/render.md §6), el render no re-deriva nada, y un cambio futuro en
     * el recorte no re-califica en silencio los shorts ya aprobados —el mismo
     * razonamiento que broll_telemetry en el maestro largo—.
     */
    master: jsonb('master').$type<ShortMasterJson>().notNull(),
    outputDir: text('output_dir'),
    // publicación a mano, fuera de la máquina de estados igual que en videos
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // id del Short en YouTube, capturado al marcarlo publicado: es lo que
    // convierte el casado del CSV de Studio en exacto (el largo ya lo tenía
    // y la tabla de shorts no — sus filas caían para siempre en «sin casar»)
    youtubeId: text('youtube_id'),
    // telemetría de rendimiento importada a mano del CSV de Studio, como en
    // videos.metrics; mismas cinco cifras, así que se reutiliza el tipo
    metrics: jsonb('metrics').$type<VideoMetrics>(),
    discardReason: text('discard_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('shorts_video_idx_idx').on(t.videoId, t.idx),
    uniqueIndex('shorts_episode_idx_idx').on(t.episodeId, t.idx),
    index('shorts_state_idx').on(t.state),
    index('shorts_channel_idx').on(t.channelId),
  ],
);

export const beats = pgTable(
  'beats',
  {
    id: text('id').primaryKey(),
    videoId: text('video_id')
      .notNull()
      .references(() => videos.id),
    idx: integer('idx').notNull(),
    fromMs: integer('from_ms').notNull(),
    toMs: integer('to_ms').notNull(),
    text: text('text').notNull(),
    visualQuery: text('visual_query').notNull(),
    status: text('status').notNull().default('pending'), // pending|auto_ok|review|locked
    assetId: text('asset_id'),
    fit: jsonb('fit').$type<Fit>(),
    chosenScore: doublePrecision('chosen_score'),
    chosenOrigin: text('chosen_origin'),
    candidates: jsonb('candidates').$type<BeatCandidate[]>(),
    // sub-planos resueltos (1..N): el b-roll cambia dentro del beat. El plano
    // principal (visuals[0]) también rellena assetId/fit/candidates arriba, para
    // que la timeline (curación a nivel de beat) siga leyendo esos campos.
    visuals: jsonb('visuals').$type<StoredSubvisual[]>(),
    discardReason: text('discard_reason'),
  },
  (t) => [
    uniqueIndex('beats_video_idx_idx').on(t.videoId, t.idx),
    // la biblioteca comprueba «¿este asset lo usa algún beat?» con un EXISTS
    // correlacionado por fila (library-browse.ts), y la purga hace lo mismo:
    // sin índice son tantos recorridos de `beats` como assets se listen
    index('beats_asset_idx').on(t.assetId),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull().default('channel'), // channel|shared
    channelId: text('channel_id').references(() => channels.id),
    kind: text('kind').notNull(), // clip|image|music|screenshot|upload
    path: text('path').notNull(),
    source: text('source').notNull(), // pexels|pixabay|nasa|wikimedia|flux|playwright|upload
    sourceRef: text('source_ref'),
    license: text('license').notNull(),
    // atribución EXIGIDA por la licencia (CC BY/BY-SA: «Autor, CC BY 4.0, via
    // Wikimedia Commons»); null = la licencia no la exige. Viaja congelada al
    // maestro (beat.asset.credit) y de ahí a description.txt — es lo que
    // permite usar material con atribución como B-ROLL, no solo como inserto.
    credit: text('credit'),
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    tags: text('tags').array().notNull().default([]),
    caption: text('caption'),
    originQuery: text('origin_query'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMS }),
    timesUsed: integer('times_used').notNull().default(0),
    lastVideoId: text('last_video_id'),
    // marcado por el humano como favorito en la biblioteca
    favorite: boolean('favorite').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assets_channel_kind_idx').on(t.channelId, t.kind),
    index('assets_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    // la cascada pregunta «¿ya tengo este recurso de stock?» una vez por
    // sub-plano (hasta ~90 por vídeo) antes de descargar; sin índice cada
    // pregunta recorre entera la tabla que más crece
    index('assets_source_ref_idx').on(t.sourceRef),
  ],
);

export const components = pgTable(
  'components',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id),
    type: text('type').notNull(),
    name: text('name').notNull(),
    version: text('version').notNull(),
    path: text('path').notNull(),
    manifest: jsonb('manifest').$type<ComponentManifest>().notNull(),
    status: text('status').notNull().default('validated'), // validated|failed
    log: text('log'),
    previewPath: text('preview_path'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('components_name_version_idx').on(t.channelId, t.name, t.version)],
);

// Episodios EXTERNOS del pipeline de clipping (podcasts/directos de terceros
// de los que se recortan shorts). Tabla propia y no un vídeo con idea
// sintética: un episodio no nace del radar, no tiene guion ni SEO, y meterlo
// por videos rompería el radar, el ledger y el informe de calidad. Su material
// tampoco entra en assets — la cascada y su semántica de licencia son para
// material licenciado reutilizable, y un clip ajeno no lo es (vive en
// library/episodes/<id>/).
export const episodes = pgTable(
  'episodes',
  {
    id: text('id').primaryKey(),
    // el canal de CLIPS destino (channel_profile ya es multi-canal)
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id),
    state: text('state').notNull().default('nuevo'),
    stateBeforeIncident: text('state_before_incident'),
    incident: jsonb('incident').$type<{
      message: string;
      suggested_action: 'reintentar' | 'regenerar' | 'descartar' | null;
      queue?: string;
      job?: { queue: string; name: string; data?: Record<string, unknown> };
    }>(),
    // ---- fuente y derechos (día 1: es el registro de defensa) ----
    sourceUrl: text('source_url').notNull(),
    sourcePlatform: text('source_platform').notNull().$type<'youtube' | 'twitch'>(),
    sourceVideoId: text('source_video_id'),
    sourceTitle: text('source_title'),
    sourceChannelName: text('source_channel_name'),
    sourceChannelUrl: text('source_channel_url'),
    sourcePublishedAt: timestamp('source_published_at', { withTimezone: true }),
    licenseStatus: text('license_status').notNull().default('ajeno_sin_acuerdo'),
    // [{date, kind: content_id|manual|peticion_creador, short_id?, action, note?}]
    claims: jsonb('claims')
      .$type<
        {
          date: string;
          kind: 'content_id' | 'manual' | 'peticion_creador';
          short_id?: string;
          action: string;
          note?: string;
        }[]
      >()
      .notNull()
      .default([]),
    // ---- media y análisis ----
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    mediaPath: text('media_path'),
    audioPath: text('audio_path'),
    // el transcript (tokens con tiempos y sentenceEnd) va a DISCO
    // (library/episodes/<id>/transcript.json): son megas, como el WAV del TTS
    transcriptPath: text('transcript_path'),
    // encuadre elegido por el humano entre 3 fotogramas reales: {x: 0..1}
    focus: jsonb('focus').$type<{ x: number }>(),
    // ComputedBeat[] (~600 × 200 B en un episodio de 2 h: cabe de sobra)
    beats: jsonb('beats').$type<
      // risa_despues_ms: carcajada detectada rematando el beat (risas.ts);
      // señal para que el director corte en el golpe, no donde muere el tema
      { idx: number; from_ms: number; to_ms: number; text: string; risa_despues_ms?: number }[]
    >(),
    // {provider, model, chunks, gate: {...}, cost} — el gate de probar:stt
    // reproducido dentro del pipeline, estampado para poder auditarlo
    sttMeta: jsonb('stt_meta').$type<Record<string, unknown>>(),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
    transcribedAt: timestamp('transcribed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // el mismo episodio no se ingiere dos veces
    uniqueIndex('episodes_source_idx').on(t.sourcePlatform, t.sourceVideoId),
    index('episodes_state_idx').on(t.state),
    index('episodes_channel_idx').on(t.channelId),
  ],
);

// Reels del módulo editor (apps/editor): A-roll PROPIO + guion de dirección
// JSON → vertical terminado con plantillas HTML rasterizadas (Playwright) y
// composición ffmpeg. Tabla propia por el mismo argumento que episodes: no
// nace del radar, no tiene TTS ni assets de stock, y su motor de render es
// otro. El plan generado vive AQUÍ (jsonb) tras `preparando`: la BD es la
// fuente de verdad que el humano edita y el worker vuelca a build/plan.json
// justo antes de renderizar — así el render usa exactamente lo aprobado.
export const reels = pgTable(
  'reels',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => channels.id),
    state: text('state').notNull().default('nuevo'),
    stateBeforeIncident: text('state_before_incident'),
    incident: jsonb('incident').$type<{
      message: string;
      suggested_action: 'reintentar' | 'regenerar' | 'descartar' | null;
      queue?: string;
      job?: { queue: string; name: string; data?: Record<string, unknown> };
    }>(),
    title: text('title').notNull(),
    // lienzo del render (9:16 | 16:9 | 1:1); el catálogo de plantillas es el mismo
    formato: text('formato').notNull().default('9:16'),
    // A-roll subido por el humano: library/reels/<id>/input.mp4
    arollPath: text('aroll_path'),
    // guion de dirección (contrato en apps/editor/guiones/CONTRATO.md); se
    // congela al alta — regenerar el plan lo relee, no lo reescribe
    guion: jsonb('guion').$type<Record<string, unknown>>().notNull(),
    // plan de capas generado por prepare (leer_guion + silencios + validar);
    // editable por el humano SOLO en plan_listo
    plan: jsonb('plan').$type<Record<string, unknown>[]>(),
    buildDir: text('build_dir'),
    outputDir: text('output_dir'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reels_state_idx').on(t.state), index('reels_channel_idx').on(t.channelId)],
);

export const costLedger = pgTable(
  'cost_ledger',
  {
    id: text('id').primaryKey(),
    videoId: text('video_id').references(() => videos.id),
    // los episodios externos (clipping) no tienen fila en videos; su gasto
    // (download, stt, highlights) cuelga de aquí y del canal
    episodeId: text('episode_id').references(() => episodes.id),
    channelId: text('channel_id').references(() => channels.id),
    provider: text('provider').notNull(),
    operation: text('operation').notNull(),
    units: doublePrecision('units').notNull().default(0),
    unitCost: doublePrecision('unit_cost').notNull().default(0),
    cost: doublePrecision('cost').notNull().default(0),
    status: text('status').notNull().default('pending'), // pending|complete|failed
    meta: jsonb('meta'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cost_ledger_video_idx').on(t.videoId),
    // panel de costes: agregados por mes y por canal-mes
    index('cost_ledger_created_idx').on(t.createdAt),
    index('cost_ledger_channel_created_idx').on(t.channelId, t.createdAt),
  ],
);

export const stockCache = pgTable(
  'stock_cache',
  {
    id: text('id').primaryKey(),
    queryNorm: text('query_norm').notNull(),
    provider: text('provider').notNull(), // pexels|pixabay
    results: jsonb('results').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('stock_cache_query_provider_idx').on(t.queryNorm, t.provider)],
);

// Descripción visual de una miniatura de stock, indexada POR IMAGEN.
//
// Antes vivía dentro de la fila de stock_cache de la consulta que la generó,
// pero la descripción es de la imagen, no de la consulta: la misma miniatura
// que salía en dos búsquedas se describía (y se pagaba) dos veces. Medido sobre
// la base real: 1208 descripciones para 850 imágenes distintas, un 30 % tirado,
// y el porcentaje sube según se solapan más búsquedas.
export const captionCache = pgTable('caption_cache', {
  // ref canónica del proveedor (`stockRef` de shared):
  // 'pexels:video:123' | 'pexels:photo:456' | 'pixabay:video:789'
  ref: text('ref').primaryKey(),
  caption: text('caption').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
