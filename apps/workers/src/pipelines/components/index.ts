import { Worker, type Job } from 'bullmq';
import {
  JOBS,
  QUEUES,
  type ComponentsAuthorJob,
  type ComponentsValidateJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { videoSrcLock } from '../../lib/locks.js';
import { handleComponentsAuthor, registerComponentsAuthorMock } from './author.js';
import { handleComponentsValidate, syncRegistryFromDb } from './validate.js';

// Validador y autor del brand kit (SPEC §10, docs/render.md §2). Concurrencia 1:
// la copia a packages/video/src/kit y la regeneración del registry no admiten
// carreras. La cola transporta dos jobs: validate (zip subido) y author (la IA
// escribe el componente y luego encola su propia validación con autoActivate).
export async function registerComponentsWorkers(ctx: WorkerContext): Promise<Worker[]> {
  registerComponentsAuthorMock();
  // auto-reparación al arrancar: src/kit y el registry se regeneran desde la
  // BD (clon nuevo o despliegue sin las copias del kit)
  try {
    await videoSrcLock.run(() => syncRegistryFromDb(ctx));
  } catch (err) {
    ctx.logger.warn({ err }, 'No se pudo sincronizar el registry del kit al arrancar');
  }
  const worker = new Worker<ComponentsValidateJob | ComponentsAuthorJob>(
    QUEUES.components,
    async (job) => {
      if (job.name === JOBS.components.validate) {
        await handleComponentsValidate(ctx, job as Job<ComponentsValidateJob>);
        return;
      }
      if (job.name === JOBS.components.author) {
        await handleComponentsAuthor(ctx, job as Job<ComponentsAuthorJob>);
        return;
      }
      ctx.logger.warn({ job: job.name }, 'Job desconocido en la cola de componentes');
    },
    { connection: ctx.connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    ctx.logger.error({ job: job?.id, err: err.message }, 'Job de componentes fallido');
  });
  return [worker];
}
