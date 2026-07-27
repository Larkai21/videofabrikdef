import { Worker, type Job } from 'bullmq';
import { z } from 'zod';
import { markIncident } from '@fabrica/db';
import {
  JOBS,
  QUEUES,
  type ScriptJudgeJob,
  type ScriptRefineJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { handleScriptGenerate } from './generate.js';
import { handleScriptJudge } from './judge.js';
import { registerScriptMocks } from './mocks.js';
import { handleScriptPackaging, type ScriptGenerateJobExt } from './packaging.js';
import { handleScriptRefine } from './refine.js';

// una salida LLM inválida se arregla regenerando; un fallo de red, reintentando
function isLlmValidationError(err: unknown): boolean {
  if (err instanceof z.ZodError || err instanceof SyntaxError) return true;
  const message = err instanceof Error ? err.message : '';
  return message.includes('esquema') || message.includes('JSON');
}

async function reportFinalFailure(
  ctx: WorkerContext,
  job: Job | undefined,
  err: Error,
): Promise<void> {
  ctx.logger.error({ jobId: job?.id, name: job?.name, err }, 'Fallo en job de script');
  if (!job) return;
  const attempts = job.opts.attempts ?? 1;
  if (job.attemptsMade < attempts) return;
  const videoId = (job.data as { videoId?: string }).videoId;
  if (!videoId) return;
  const suggested = isLlmValidationError(err) ? 'regenerar' : 'reintentar';
  const message = `Fallo definitivo en script.${job.name}: ${err.message}`.slice(0, 500);
  try {
    await markIncident(ctx.db, videoId, {
      message,
      suggested_action: suggested,
      queue: QUEUES.script,
    });
    await ctx.publishEvent({
      type: 'incident',
      video_id: videoId,
      queue: QUEUES.script,
      message,
      suggested_action: suggested,
    });
    await ctx.publishEvent({ type: 'video_state', video_id: videoId, state: 'incidencia' });
  } catch (markErr) {
    ctx.logger.error({ videoId, err: markErr }, 'No se pudo registrar la incidencia');
  }
}

export async function registerScriptWorkers(ctx: WorkerContext): Promise<Worker[]> {
  registerScriptMocks();

  const worker = new Worker(
    QUEUES.script,
    async (job) => {
      switch (job.name) {
        case JOBS.script.generate: {
          // packagingOnly (extensión local del payload, ver packaging.ts):
          // genera solo el paquete seo; sin el campo, generate normal
          const data = job.data as ScriptGenerateJobExt;
          return data.packagingOnly === true
            ? handleScriptPackaging(ctx, data)
            : handleScriptGenerate(ctx, data);
        }
        case JOBS.script.judge:
          return handleScriptJudge(ctx, job.data as ScriptJudgeJob);
        case JOBS.script.refine:
          return handleScriptRefine(ctx, job.data as ScriptRefineJob);
        default:
          ctx.logger.warn({ name: job.name }, 'Job desconocido en la cola script');
      }
    },
    { connection: ctx.connection, concurrency: 2 },
  );

  worker.on('failed', (job, err) => {
    void reportFinalFailure(ctx, job, err);
  });

  return [worker];
}
