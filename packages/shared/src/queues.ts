// Colas BullMQ y contratos de sus payloads. La cola solo transporta trabajo:
// todo estado de negocio vive en Postgres. Jobs idempotentes y reanudables.

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
  sources: { poll: 'poll', bootstrap: 'bootstrap' },
  ideas: { score: 'score' },
  script: { generate: 'generate', judge: 'judge', refine: 'refine' },
  tts: { synthesize: 'synthesize' },
  assets: { match: 'match', ingest: 'ingest' },
  render: { video: 'video' },
  components: { validate: 'validate' },
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
