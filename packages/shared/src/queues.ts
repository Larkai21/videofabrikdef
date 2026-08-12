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
  shorts: 'shorts',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

// nombres de job por cola
export const JOBS = {
  sources: { poll: 'poll', bootstrap: 'bootstrap' },
  ideas: { score: 'score' },
  script: {
    generate: 'generate',
    judge: 'judge',
    refine: 'refine',
    thumbnailBrief: 'thumbnail-brief',
  },
  tts: { synthesize: 'synthesize' },
  assets: { match: 'match', ingest: 'ingest' },
  render: { video: 'video', short: 'short' },
  components: { validate: 'validate', author: 'author' },
  library: { backfill: 'backfill', purgeScan: 'purge-scan', reembed: 'reembed' },
  publish: { upload: 'upload' },
  shorts: { propose: 'propose' },
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
  // instrucciones por escena del juez; sin ellas el refinado reescribe a ciegas.
  // Opcional para no romper los jobs que ya estén en vuelo.
  notes?: Array<{ id: string; axis: string; issue: string; fix: string }>;
  // Vuelta de reparación. La primera la encola el juez y no la trae; la
  // segunda la encola el propio refinado cuando el linter demuestra que el
  // arreglo no se aplicó. Existe para que ese reintento tenga tope.
  pass?: number;
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
  // nº de intento de autoría (presente solo si vino de la IA): habilita la
  // auto-reparación al fallar la validación (re-autoría con el error)
  authorAttempt?: number;
}

// Autoría por IA de un componente del brand kit (Fase 4): el worker pide a la
// LLM los tres ficheros del zip (manifest/schema/component), los escribe bajo
// library/components/ y encola components.validate con autoActivate.
export interface ComponentsAuthorJob {
  channelId: string;
  type: ComponentType;
  // nº de intento (0 = primero). En reparaciones sube y trae el contexto del fallo.
  attempt?: number;
  // contexto de auto-reparación: ficheros previos + log del fallo para corregir
  repairContext?: {
    prevSchemaTs: string;
    prevComponentTsx: string;
    failureLog: string;
  };
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

// Propuesta de shorts a partir de un vídeo ya entregado. Una sola llamada al
// director por ejecución; `excluir` son las ventanas que no deben volver: las
// que el humano descartó (con su motivo, que es la única señal humana que el
// director puede aprender) Y las vivas — sin estas últimas, «proponer otros»
// podía re-proponer una ventana ya propuesta o aprobada.
export interface ShortsProposeJob {
  videoId: string;
  excluir?: { from_ms: number; to_ms: number; reason?: string }[];
  // vuelve a proponer aunque ya haya candidatos vivos
  force?: boolean;
}

// Render de un short aprobado. Va en la cola `render` y no en `shorts` para no
// romper el invariante de un solo Chromium a la vez (concurrency 1).
export interface RenderShortJob {
  shortId: string;
}

// Progreso y eventos se publican en Redis pub/sub con este canal
export const EVENTS_CHANNEL = 'fabrica:events';
