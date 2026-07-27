import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { QueueName } from '@fabrica/shared';

// La API solo produce jobs; el estado de negocio vive en Postgres.
// Inyectable en buildApp para que los tests no dependan de Redis.
export interface Enqueuer {
  enqueue(queue: QueueName, job: string, payload: unknown): Promise<void>;
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
    async close() {
      await Promise.all([...queues.values()].map((q) => q.close()));
      connection.disconnect();
    },
  };
}
