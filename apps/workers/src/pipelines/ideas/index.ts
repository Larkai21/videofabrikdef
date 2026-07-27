import { Worker } from 'bullmq';
import { JOBS, QUEUES, type IdeasScoreJob } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { registerIdeasMocks } from './mocks.js';
import { handleIdeasScore } from './score.js';

export async function registerIdeasWorkers(ctx: WorkerContext): Promise<Worker[]> {
  registerIdeasMocks();

  const worker = new Worker(
    QUEUES.ideas,
    async (job) => {
      if (job.name === JOBS.ideas.score) {
        return handleIdeasScore(ctx, job.data as IdeasScoreJob);
      }
      ctx.logger.warn({ name: job.name }, 'Job desconocido en la cola ideas');
    },
    { connection: ctx.connection, concurrency: 1 },
  );

  // sin vídeo asociado no hay incidencia: los fallos de scoring solo se loguean
  worker.on('failed', (job, err) => {
    ctx.logger.error({ jobId: job?.id, name: job?.name, err }, 'Fallo en job de ideas');
  });

  return [worker];
}
