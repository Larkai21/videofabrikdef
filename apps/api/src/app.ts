import { mkdirSync } from 'node:fs';
import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { createDb, InvalidTransitionError, type Db } from '@fabrica/db';
import type { ApiContext } from './lib/context.js';
import { createBullEnqueuer, type Enqueuer } from './lib/enqueuer.js';
import { env, loadEnv, resolveDataDir } from './lib/env.js';
import { HttpError } from './lib/errors.js';
import { createRedisEventBus, type EventBus } from './lib/events.js';
import { registerChannelRoutes } from './routes/channels.js';
import { registerComponentRoutes } from './routes/components.js';
import { registerEventRoutes } from './routes/events.js';
import { registerIdeaRoutes } from './routes/ideas.js';
import { registerInboxRoutes } from './routes/inbox.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerLibraryBrowseRoutes } from './routes/library-browse.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerStockRoutes } from './routes/stock.js';
import { registerTimelineRoutes } from './routes/timeline.js';
import { registerVideoRoutes } from './routes/videos.js';

export { toFileUrl } from './lib/files.js';

export interface BuildAppOptions {
  // inyectables para tests (fastify.inject sin Redis); por defecto, reales
  db?: { db: Db; client: { end(): Promise<void> } };
  enqueuer?: Enqueuer;
  events?: EventBus;
  logger?: boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  loadEnv();
  const redisUrl = env('REDIS_URL', 'redis://localhost:56379');

  const ownsDb = !opts.db;
  const dbBundle = opts.db ?? createDb();
  const ownsEnqueuer = !opts.enqueuer;
  const enqueuer = opts.enqueuer ?? createBullEnqueuer(redisUrl);
  const ownsEvents = !opts.events;
  const events = opts.events ?? createRedisEventBus(redisUrl);

  const libraryDir = resolveDataDir('LIBRARY_DIR');
  const outputsDir = resolveDataDir('OUTPUTS_DIR');
  mkdirSync(libraryDir, { recursive: true });
  mkdirSync(outputsDir, { recursive: true });

  const app = fastify({
    logger: opts.logger === false ? false : { level: process.env.LOG_LEVEL ?? 'info' },
  });

  // tolerar POST sin cuerpo en las rutas de puertas
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (body === '' || body === undefined) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  // solo el dashboard local: reflejar cualquier origen convertiría las rutas
  // de escritura (sin autenticación en el MVP monousuario) en drive-by
  const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(cors, { origin: corsOrigins });
  await app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024 } });
  await app.register(fastifyStatic, {
    root: outputsDir,
    prefix: '/files/outputs/',
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: libraryDir,
    prefix: '/files/library/',
    decorateReply: false,
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.statusCode).send({ error: error.label, detail: error.detail });
    }
    if (error instanceof InvalidTransitionError) {
      return reply.code(409).send({ error: 'transición inválida', detail: error.message });
    }
    if (error instanceof ZodError) {
      const detail = error.issues
        .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
        .join('; ');
      return reply.code(400).send({ error: 'validación', detail });
    }
    const fallback = error as { statusCode?: unknown; message?: unknown };
    const statusCode = typeof fallback.statusCode === 'number' ? fallback.statusCode : 500;
    if (statusCode >= 500) req.log.error(error);
    return reply.code(statusCode).send({
      error: statusCode >= 500 ? 'error interno' : 'petición inválida',
      detail: typeof fallback.message === 'string' ? fallback.message : String(error),
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: 'no encontrado', detail: `${req.method} ${req.url}` });
  });

  const ctx: ApiContext = { db: dbBundle.db, enqueuer, events, libraryDir, outputsDir };

  registerChannelRoutes(app, ctx);
  registerIdeaRoutes(app, ctx);
  registerInboxRoutes(app, ctx);
  registerVideoRoutes(app, ctx);
  registerTimelineRoutes(app, ctx);
  registerStockRoutes(app, ctx);
  registerLibraryRoutes(app, ctx);
  registerLibraryBrowseRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);
  registerComponentRoutes(app, ctx);
  registerEventRoutes(app, ctx);

  app.addHook('onClose', async () => {
    if (ownsEnqueuer) await enqueuer.close();
    if (ownsEvents) await events.close();
    if (ownsDb) await dbBundle.client.end();
  });

  return app;
}
