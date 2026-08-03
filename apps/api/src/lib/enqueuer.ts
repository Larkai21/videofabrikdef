import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUES, type QueueName } from '@fabrica/shared';

export type QueueCounts = Record<string, Record<string, number>>;

// La API solo produce jobs; el estado de negocio vive en Postgres.
// Inyectable en buildApp para que los tests no dependan de Redis.
export interface Enqueuer {
  /**
   * `dedupeId` replica el jobId determinista que usan los workers (p. ej.
   * `render-<videoId>`): si hay un job VIVO con ese id no se encola otro; si
   * hay un cadáver (completado/fallido), se limpia antes de encolar — BullMQ
   * descarta EN SILENCIO un add cuyo jobId ya existe, y eso convertía el
   * retry de render en un ok que no hacía nada.
   */
  enqueue(
    queue: QueueName,
    job: string,
    payload: unknown,
    opts?: { dedupeId?: string },
  ): Promise<void>;
  // conteos por cola (waiting/active/failed/delayed…) para /health
  counts(): Promise<QueueCounts>;
  close(): Promise<void>;
}

export function createBullEnqueuer(redisUrl: string): Enqueuer {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queues = new Map<QueueName, Queue>();

  const queueFor = (name: QueueName): Queue => {
    let queue = queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 500 },
        },
      });
      queues.set(name, queue);
    }
    return queue;
  };

  return {
    async enqueue(queue, job, payload, opts) {
      const q = queueFor(queue);
      const dedupeId = opts?.dedupeId;
      if (dedupeId === undefined) {
        await q.add(job, payload);
        return;
      }
      const existing = await q.getJob(dedupeId);
      if (existing) {
        const state = await existing.getState().catch(() => 'unknown');
        if (state === 'active' || state === 'waiting' || state === 'delayed') {
          // ya hay un job vivo haciendo exactamente esto; encolar otro con el
          // mismo id sería descartado igualmente — no hay nada que hacer
          return;
        }
        const removed = await q.remove(dedupeId);
        if (removed === 0) {
          throw new Error('El job anterior aún se está liberando; reintenta en unos segundos');
        }
      }
      await q.add(job, payload, { jobId: dedupeId });
    },
    async counts() {
      const out: QueueCounts = {};
      await Promise.all(
        Object.values(QUEUES).map(async (name) => {
          out[name] = await queueFor(name).getJobCounts();
        }),
      );
      return out;
    },
    async close() {
      await Promise.all([...queues.values()].map((q) => q.close()));
      connection.disconnect();
    },
  };
}
