import { Worker } from 'bullmq';
import {
  JOBS,
  QUEUES,
  type ChannelAvatarGenerateJob,
  type SourcePollJob,
  type SourcesBootstrapJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { handleAvatarGenerate } from './avatar.js';
import { handleBootstrap } from './bootstrap.js';
import { registerSourcesMocks } from './mocks.js';
import { handleSourcePoll } from './poll.js';
import { syncSourceSchedulers } from './scheduler.js';

export async function registerSourcesWorkers(ctx: WorkerContext): Promise<Worker[]> {
  registerSourcesMocks();
  try {
    await syncSourceSchedulers(ctx);
  } catch (err) {
    ctx.logger.error({ err }, 'No se pudieron sincronizar los schedulers de fuentes');
  }

  const worker = new Worker(
    QUEUES.sources,
    async (job) => {
      if (job.name === JOBS.sources.poll) {
        return handleSourcePoll(ctx, job.data as SourcePollJob, {
          made: job.attemptsMade,
          total: job.opts.attempts ?? 1,
        });
      }
      if (job.name === JOBS.sources.bootstrap) {
        return handleBootstrap(ctx, job.data as SourcesBootstrapJob);
      }
      if (job.name === JOBS.sources.avatar) {
        return handleAvatarGenerate(ctx, job.data as ChannelAvatarGenerateJob);
      }
      ctx.logger.warn({ name: job.name }, 'Job desconocido en la cola sources');
    },
    { connection: ctx.connection, concurrency: 2 },
  );

  // sin vídeo asociado no hay incidencia: los fallos de fuentes solo se loguean
  worker.on('failed', (job, err) => {
    ctx.logger.error({ jobId: job?.id, name: job?.name, err }, 'Fallo en job de sources');
  });

  return [worker];
}
