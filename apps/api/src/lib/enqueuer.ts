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
   *
   * Devuelve si de verdad se encoló: `enqueued: false` significa que ya hay
   * un job vivo con ese id. El llamador decide si eso es un ok (el job vivo
   * hará el trabajo) o un conflicto que contar — un `void` aquí era un 200
   * que podía mentir.
   */
  enqueue(
    queue: QueueName,
    job: string,
    payload: unknown,
    opts?: { dedupeId?: string },
  ): Promise<{ enqueued: boolean; reason?: 'job_vivo' }>;
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
        return { enqueued: true };
      }
      const existing = await q.getJob(dedupeId);
      if (existing) {
        // OJO: no fundir un error transitorio de Redis con el estado real —
        // tratar un job vivo como cadáver lo borraría en marcha. Si getState
        // falla, se propaga y el llamador compensa.
        const state = await existing.getState();
        if (state === 'active' || state === 'waiting' || state === 'delayed') {
          // ya hay un job vivo haciendo exactamente esto; encolar otro con el
          // mismo id sería descartado igualmente
          return { enqueued: false, reason: 'job_vivo' };
        }
        const removed = await q.remove(dedupeId);
        if (removed === 0) {
          throw new Error('El job anterior aún se está liberando; reintenta en unos segundos');
        }
      }
      await q.add(job, payload, { jobId: dedupeId });
      return { enqueued: true };
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
