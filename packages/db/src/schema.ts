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
    costsTotal: doublePrecision('costs_total').notNull().default(0),
    outputDir: text('output_dir'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('videos_state_idx').on(t.state), index('videos_channel_idx').on(t.channelId)],
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
    discardReason: text('discard_reason'),
  },
  (t) => [uniqueIndex('beats_video_idx_idx').on(t.videoId, t.idx)],
);

export const assets = pgTable(
  'assets',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull().default('channel'), // channel|shared
    channelId: text('channel_id').references(() => channels.id),
    kind: text('kind').notNull(), // clip|image|music|screenshot|upload
    path: text('path').notNull(),
    source: text('source').notNull(), // pexels|pixabay|flux|playwright|upload
    sourceRef: text('source_ref'),
    license: text('license').notNull(),
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    tags: text('tags').array().notNull().default([]),
    caption: text('caption'),
    originQuery: text('origin_query'),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMS }),
    timesUsed: integer('times_used').notNull().default(0),
    lastVideoId: text('last_video_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('assets_channel_kind_idx').on(t.channelId, t.kind),
    index('assets_embedding_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
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

export const costLedger = pgTable(
  'cost_ledger',
  {
    id: text('id').primaryKey(),
    videoId: text('video_id').references(() => videos.id),
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
  (t) => [index('cost_ledger_video_idx').on(t.videoId)],
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
