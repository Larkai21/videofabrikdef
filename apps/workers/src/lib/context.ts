import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { createDb, type Db } from '@fabrica/db';
import { EVENTS_CHANNEL, QUEUES, type FabricaEvent, type QueueName } from '@fabrica/shared';
import { env, loadEnv, resolveDataDir } from './env.js';
import { createEmbeddings, type EmbeddingsProvider } from '../providers/embeddings.js';
import { createLlm, type LlmProvider } from '../providers/llm.js';

export interface WorkerContext {
  db: Db;
  dbClient: { end: () => Promise<void> };
  connection: Redis;
  pub: Redis;
  queues: Record<QueueName, Queue>;
  logger: pino.Logger;
  llm: LlmProvider;
  embeddings: EmbeddingsProvider;
  libraryDir: string;
  outputsDir: string;
  publishEvent: (event: FabricaEvent) => Promise<void>;
}

export function createWorkerContext(): WorkerContext {
  loadEnv();
  const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.stdout.isTTY ? { target: 'pino-pretty' } : undefined,
  });

  const redisUrl = env('REDIS_URL', 'redis://localhost:56379');
  // BullMQ exige maxRetriesPerRequest: null en la conexión de workers
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const pub = new Redis(redisUrl);

  const { db, client } = createDb();

  const queues = Object.fromEntries(
    Object.values(QUEUES).map((name) => [
      name,
      new Queue(name, {
        connection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 500 },
        },
      }),
    ]),
  ) as Record<QueueName, Queue>;

  const publishEvent = async (event: FabricaEvent) => {
    await pub.publish(EVENTS_CHANNEL, JSON.stringify(event));
  };

  return {
    db,
    dbClient: client,
    connection,
    pub,
    queues,
    logger,
    llm: createLlm(logger),
    embeddings: createEmbeddings(logger),
    libraryDir: resolveDataDir('LIBRARY_DIR'),
    outputsDir: resolveDataDir('OUTPUTS_DIR'),
    publishEvent,
  };
}
