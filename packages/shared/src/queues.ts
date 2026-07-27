// Colas BullMQ y contratos de sus payloads. La cola solo transporta trabajo:
// todo estado de negocio vive en Postgres. Jobs idempotentes y reanudables.

export const QUEUES = {
  sources: 'sources',
  ideas: 'ideas',
  script: 'script',
  tts: 'tts',
  assets: 'assets',
  render: 'render',
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

// Progreso y eventos se publican en Redis pub/sub con este canal
export const EVENTS_CHANNEL = 'fabrica:events';
