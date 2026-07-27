import type { Worker } from 'bullmq';
import { createWorkerContext } from './lib/context.js';
import { registerSourcesWorkers } from './pipelines/sources/index.js';
import { registerIdeasWorkers } from './pipelines/ideas/index.js';
import { registerScriptWorkers } from './pipelines/script/index.js';
import { registerTtsWorkers } from './pipelines/tts/index.js';
import { registerAssetsWorkers } from './pipelines/assets/index.js';
import { registerRenderWorkers } from './pipelines/render/index.js';

const ctx = createWorkerContext();
ctx.logger.info(
  { llm: ctx.llm.name, embeddings: ctx.embeddings.name },
  'Arrancando workers de la fábrica',
);

const workers: Worker[] = [
  ...(await registerSourcesWorkers(ctx)),
  ...(await registerIdeasWorkers(ctx)),
  ...(await registerScriptWorkers(ctx)),
  ...(await registerTtsWorkers(ctx)),
  ...(await registerAssetsWorkers(ctx)),
  ...(await registerRenderWorkers(ctx)),
];

ctx.logger.info({ count: workers.length }, 'Workers registrados');

async function shutdown(signal: string) {
  ctx.logger.info({ signal }, 'Cerrando workers');
  await Promise.allSettled(workers.map((w) => w.close()));
  await Promise.allSettled(Object.values(ctx.queues).map((q) => q.close()));
  await ctx.connection.quit();
  await ctx.pub.quit();
  await ctx.dbClient.end();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
