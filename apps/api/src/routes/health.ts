import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { ApiContext } from '../lib/context.js';

// Salud del sistema: ping a Postgres + conteos de cada cola BullMQ
// (waiting/active/failed/delayed…). Da aviso temprano de una cola atascada o
// un dead-letter creciendo, que de otro modo pasarían inadvertidos.
export function registerHealthRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/health', async (_req, reply) => {
    let db = true;
    try {
      await ctx.db.execute(sql`select 1`);
    } catch {
      db = false;
    }
    let queues: Record<string, Record<string, number>> = {};
    let queuesOk = true;
    try {
      queues = await ctx.enqueuer.counts();
    } catch {
      queuesOk = false;
    }
    const ok = db && queuesOk;
    return reply.code(ok ? 200 : 503).send({ ok, db, queues });
  });
}
