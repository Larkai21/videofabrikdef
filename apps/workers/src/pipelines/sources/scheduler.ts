import type { Queue } from 'bullmq';
import { JOBS, type SourcePollJob } from '@fabrica/shared';
import { sources } from '@fabrica/db';
import type { WorkerContext } from '../../lib/context.js';
import { SUPPORTED_KINDS } from './poll.js';

// Un scheduler de BullMQ por fuente habilitada, con id estable 'poll:<sourceId>'
// para que el upsert sea idempotente entre reinicios.

export async function upsertPollScheduler(
  queue: Queue,
  source: { id: string; cadenceMinutes: number },
): Promise<void> {
  await queue.upsertJobScheduler(
    `poll:${source.id}`,
    { every: Math.max(1, source.cadenceMinutes) * 60_000 },
    { name: JOBS.sources.poll, data: { sourceId: source.id } satisfies SourcePollJob },
  );
}

export async function syncSourceSchedulers(ctx: WorkerContext): Promise<void> {
  const all = await ctx.db.select().from(sources);
  const wanted = new Map<string, { id: string; cadenceMinutes: number }>();
  for (const s of all) {
    if (!s.enabled) continue;
    if (!SUPPORTED_KINDS.has(s.kind)) {
      ctx.logger.info({ sourceId: s.id, kind: s.kind }, 'Sin scheduler: kind no soportado en S1');
      continue;
    }
    wanted.set(`poll:${s.id}`, { id: s.id, cadenceMinutes: s.cadenceMinutes });
  }
  const existing = await ctx.queues.sources.getJobSchedulers(0, -1, true);
  for (const scheduler of existing) {
    const key = scheduler.key;
    if (typeof key === 'string' && key.startsWith('poll:') && !wanted.has(key)) {
      await ctx.queues.sources.removeJobScheduler(key);
      ctx.logger.info({ scheduler: key }, 'Scheduler de fuente retirado');
    }
  }
  for (const source of wanted.values()) {
    await upsertPollScheduler(ctx.queues.sources, source);
  }
  ctx.logger.info({ schedulers: wanted.size }, 'Schedulers de fuentes sincronizados');
}
