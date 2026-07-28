// Colas BullMQ y contratos de sus payloads. La cola solo transporta trabajo:
// todo estado de negocio vive en Postgres. Jobs idempotentes y reanudables.

import type { ComponentType } from './component-manifest.js';

export const QUEUES = {
  sources: 'sources',
  ideas: 'ideas',
  script: 'script',
  tts: 'tts',
  assets: 'assets',
  render: 'render',
  components: 'components',
  library: 'library',
  publish: 'publish',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// nombres de job por cola
export const JOBS = {
  sources: { poll: 'poll', bootstrap: 'bootstrap', avatar: 'avatar' },
  ideas: { score: 'score' },
  script: { generate: 'generate', judge: 'judge', refine: 'refine', thumbnailBrief: 'thumbnail-brief' },
  tts: { synthesize: 'synthesize' },
  assets: { match: 'match', ingest: 'ingest' },
  render: { video: 'video' },
  components: { validate: 'validate', author: 'author' },
  library: { backfill: 'backfill', purgeScan: 'purge-scan', reembed: 'reembed' },
  publish: { upload: 'upload' },
} as const;

export interface SourcePollJob {
  sourceId: string;
}

export interface SourcesBootstrapJob {
  channelId: string;
  niche: string;
  competitors: string[];
}

// Generación del avatar/personaje del canal con Flux (Fase 5). Un solo job por
// canal; escribe library/assets/<canal>/avatar.png y setea channels.avatar_path.
export interface ChannelAvatarGenerateJob {
  channelId: string;
  // pista opcional del humano para variar el resultado
  seedSalt?: string;
}

export interface IdeasScoreJob {
  channelId: string;
}

export interface ScriptGenerateJob {
  videoId: string;
  // motivo de reescritura si el humano la pidió (regeneración dirigida)
  rewriteReason?: string;
  // packaging_first: generar SOLO títulos y conceptos de miniatura; el guion
  // se escribe después para cumplir la promesa del título elegido
  packagingOnly?: boolean;
}

export interface ScriptJudgeJob {
  videoId: string;
}

export interface ScriptRefineJob {
  videoId: string;
  patchTargets: string[];
  reasons: string[];
}

// Brief de miniatura de alta conversión (LLM): escribe outputs/<id>/
// thumbnail-brief.json con {brief (ES), prompt (EN)} para que el humano genere y
// suba la miniatura. Se encola al terminar el render y bajo demanda desde Entrega.
export interface ThumbnailBriefJob {
  videoId: string;
}

export interface TtsSynthesizeJob {
  videoId: string;
}

export interface AssetsMatchJob {
  videoId: string;
  // si se pasa, re-matchear solo estos beats (descartes con motivo)
  beatIdxs?: number[];
}

export interface AssetsIngestJob {
  videoId: string;
}

export interface RenderVideoJob {
  videoId: string;
}

export interface ComponentsValidateJob {
  componentId: string;
  // si lo escribió la IA (components.author): al validar OK se auto-activa
  // para su tipo en el canal, sin intervención humana
  autoActivate?: boolean;
}

// Autoría por IA de un componente del brand kit (Fase 4): el worker pide a la
// LLM los tres ficheros del zip (manifest/schema/component), los escribe bajo
// library/components/ y encola components.validate con autoActivate.
export interface ComponentsAuthorJob {
  channelId: string;
  type: ComponentType;
}

export interface LibraryBackfillJob {
  // sin assetIds: barre todos los assets sin embedding o sin caption
  assetIds?: string[];
}

export interface LibraryPurgeScanJob {
  channelId?: string;
}

// re-embebido completo tras cambiar el modelo de embeddings (invalida TODAS
// las similitudes; orden fijo raw_items → ideas → assets)
export interface LibraryReembedJob {
  // opcional: limitar a tablas concretas; por defecto, todas
  tables?: ('raw_items' | 'ideas' | 'assets')[];
}

// subida a YouTube en privado (SPEC S3): siempre disparada por una aprobación
// humana desde la bandeja, nunca automática al terminar el render
export interface PublishUploadJob {
  videoId: string;
}

// Progreso y eventos se publican en Redis pub/sub con este canal
export const EVENTS_CHANNEL = 'fabrica:events';
