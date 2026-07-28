import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUES, type QueueName } from '@fabrica/shared';

export type QueueCounts = Record<string, Record<string, number>>;

// La API solo produce jobs; el estado de negocio vive en Postgres.
// Inyectable en buildApp para que los tests no dependan de Redis.
export interface Enqueuer {
  enqueue(queue: QueueName, job: string, payload: unknown): Promise<void>;
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
    async enqueue(queue, job, payload) {
      await queueFor(queue).add(job, payload);
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
