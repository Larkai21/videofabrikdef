import type { FastifyInstance } from 'fastify';
import { asc, eq, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { sources } from '@fabrica/db';
import {
  JOBS,
  QUEUES,
  SUPPORTED_SOURCE_KINDS,
  type SourceDto,
  type SourcePollJob,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { badRequest } from '../lib/errors.js';

type SourceRow = typeof sources.$inferSelect;

// Etiqueta corta y humana para el feed del radar (el host basta; la URL
// completa es ruido en una línea de progreso).
function sourceLabel(row: SourceRow): string {
  try {
    const host = new URL(row.url).hostname.replace(/^www\./, '');
    return `${host} · ${row.kind}`;
  } catch {
    return `${row.id} · ${row.kind}`;
  }
}

function sourceDto(row: SourceRow): SourceDto {
  return {
    id: row.id,
    kind: row.kind,
    label: sourceLabel(row),
    enabled: row.enabled,
    consecutive_failures: row.consecutiveFailures,
    last_fetched_at: row.lastFetchedAt?.toISOString() ?? null,
  };
}

const pollBodySchema = z.object({ channel: z.string().min(1) });

// Solo fuentes con fetcher real: una kind sin soporte (github/web/reddit)
// nunca publicaría source_poll y dejaría la barra del radar sin completar.
const SUPPORTED = new Set<string>(SUPPORTED_SOURCE_KINDS);

export function registerSourceRoutes(app: FastifyInstance, ctx: ApiContext): void {
  // Fuentes del canal (más las compartidas con channel_id null): el radar
  // pinta con esto la barra de progreso de la búsqueda.
  app.get('/sources', async (req) => {
    const query = req.query as { channel?: string };
    const channel = typeof query.channel === 'string' ? query.channel.trim() : '';
    if (channel === '') throw badRequest('Falta el parámetro channel');
    const rows = await ctx.db
      .select()
      .from(sources)
      .where(or(eq(sources.channelId, channel), isNull(sources.channelId)))
      .orderBy(asc(sources.id));
    return rows.filter((r) => r.enabled && SUPPORTED.has(r.kind)).map(sourceDto);
  });

  // Búsqueda manual: encola un poll inmediato de cada fuente habilitada del
  // canal. Los schedulers periódicos siguen igual; esto solo adelanta la ronda.
  app.post('/sources/poll', async (req) => {
    const { channel } = pollBodySchema.parse(req.body);
    const rows = await ctx.db
      .select()
      .from(sources)
      .where(or(eq(sources.channelId, channel), isNull(sources.channelId)));
    const enabled = rows.filter((r) => r.enabled && SUPPORTED.has(r.kind));
    for (const source of enabled) {
      const payload: SourcePollJob = { sourceId: source.id };
      await ctx.enqueuer.enqueue(QUEUES.sources, JOBS.sources.poll, payload);
    }
    return { enqueued: enabled.length };
  });
}
