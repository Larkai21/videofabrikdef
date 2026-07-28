import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { channels, rawItems, sources } from '@fabrica/db';
import {
  DEDUPE_COS,
  DEDUPE_WINDOW_DAYS,
  JOBS,
  SUPPORTED_SOURCE_KINDS,
  type IdeasScoreJob,
  type SourcePollJob,
  type SupportedSourceKind,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { parseArxiv } from './fetchers/arxiv.js';
import { parseHn } from './fetchers/hn.js';
import { parseRssFeed } from './fetchers/rss.js';
import { parseYoutubeFeed } from './fetchers/youtube.js';
import {
  FETCH_TIMEOUT_MS,
  USER_AGENT,
  normalizeItem,
  type FetchedItem,
  type NormalizedItem,
} from './normalize.js';

export type SupportedKind = SupportedSourceKind;

// La lista canónica vive en shared (la API la usa para filtrar el radar).
export const SUPPORTED_KINDS: ReadonlySet<string> = new Set(SUPPORTED_SOURCE_KINDS);

const UNHEALTHY_THRESHOLD = 5;
const SCORE_DEBOUNCE_MS = 30_000;

async function fetchBody(url: string): Promise<{ body: string; bytes: number }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  const body = await res.text();
  return { body, bytes: Buffer.byteLength(body, 'utf8') };
}

export async function fetchSourceItems(
  kind: SupportedKind,
  url: string,
): Promise<{ items: FetchedItem[]; bytes: number }> {
  const { body, bytes } = await fetchBody(url);
  switch (kind) {
    case 'hn':
      return { items: parseHn(JSON.parse(body)), bytes };
    case 'arxiv':
      // una sola petición HTTP por poll: respeta el rate de arXiv
      return { items: parseArxiv(body), bytes };
    case 'news':
    case 'rss':
      return { items: await parseRssFeed(body), bytes };
    case 'youtube':
      return { items: parseYoutubeFeed(body), bytes };
  }
}

interface InsertedRow {
  id: string;
  title: string;
  excerpt: string | null;
}

async function insertNewItems(
  ctx: WorkerContext,
  sourceId: string,
  items: FetchedItem[],
): Promise<InsertedRow[]> {
  const byHash = new Map<string, NormalizedItem>();
  for (const item of items) {
    const normalized = normalizeItem(item);
    if (normalized && !byHash.has(normalized.hash)) byHash.set(normalized.hash, normalized);
  }
  if (byHash.size === 0) return [];
  const rows = [...byHash.values()].map((n) => ({
    id: nanoid(),
    sourceId,
    urlCanonical: n.urlCanonical,
    title: n.title,
    excerpt: n.excerpt,
    publishedAt: n.publishedAt,
    metrics: n.metrics,
    lang: n.lang,
    hash: n.hash,
  }));
  return ctx.db
    .insert(rawItems)
    .values(rows)
    .onConflictDoNothing({ target: rawItems.hash })
    .returning({ id: rawItems.id, title: rawItems.title, excerpt: rawItems.excerpt });
}

// Dedupe semántico: vecino más cercano en la ventana de 14 días; cos ≥ 0,90
// hereda cluster_id, si no se abre cluster nuevo. Secuencial para que dos
// items nuevos y parecidos del mismo poll acaben en el mismo cluster.
async function clusterNewItems(ctx: WorkerContext, inserted: InsertedRow[]): Promise<void> {
  const texts = inserted.map((r) => `${r.title} ${r.excerpt ?? ''}`.trim());
  const vectors = await ctx.embeddings.embed(texts);
  for (let i = 0; i < inserted.length; i++) {
    const row = inserted[i];
    const vec = vectors[i];
    if (!row || !vec) continue;
    const vecLiteral = `[${vec.join(',')}]`;
    const neighbors = (await ctx.db.execute(sql`
      select cluster_id, 1 - (embedding <=> ${vecLiteral}::vector) as cos
      from raw_items
      where embedding is not null
        and cluster_id is not null
        and id <> ${row.id}
        and fetched_at > now() - (${DEDUPE_WINDOW_DAYS} * interval '1 day')
      order by embedding <=> ${vecLiteral}::vector
      limit 1
    `)) as unknown as Array<{ cluster_id: string | null; cos: number | string | null }>;
    const top = neighbors[0];
    const cos = top ? Number(top.cos) : 0;
    const clusterId = top?.cluster_id && cos >= DEDUPE_COS ? top.cluster_id : nanoid();
    await ctx.db
      .update(rawItems)
      .set({ embedding: vec, clusterId })
      .where(eq(rawItems.id, row.id));
  }
}

async function enqueueScoreJobs(ctx: WorkerContext, channelId: string | null): Promise<void> {
  const channelIds = channelId
    ? [channelId]
    : (await ctx.db.select({ id: channels.id }).from(channels)).map((r) => r.id);
  for (const id of channelIds) {
    // deduplication con ttl (y NO jobId fijo): las ráfagas de polls se funden
    // en un score, pero un add mientras otro score está ACTIVO crea job nuevo.
    // Con jobId estable, BullMQ lo descartaría en silencio y lo recién
    // insertado quedaría sin puntuar hasta el siguiente poll con material.
    await ctx.queues.ideas.add(
      JOBS.ideas.score,
      { channelId: id } satisfies IdeasScoreJob,
      {
        deduplication: { id: `score-${id}`, ttl: SCORE_DEBOUNCE_MS },
        delay: SCORE_DEBOUNCE_MS,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}

export async function handleSourcePoll(
  ctx: WorkerContext,
  data: SourcePollJob,
  // intentos de BullMQ: el evento de fallo solo se publica en el último para
  // no ensuciar el feed del radar con cada reintento
  attempt?: { made: number; total: number },
): Promise<void> {
  const [source] = await ctx.db.select().from(sources).where(eq(sources.id, data.sourceId));
  if (!source) {
    ctx.logger.warn({ sourceId: data.sourceId }, 'Poll de una fuente inexistente; se ignora');
    return;
  }
  if (!source.enabled) return;
  if (!SUPPORTED_KINDS.has(source.kind)) {
    ctx.logger.info(
      { sourceId: source.id, kind: source.kind },
      'Fuente no soportada en S1 (github y web requieren Playwright; reddit requiere OAuth)',
    );
    return;
  }
  const started = Date.now();
  try {
    const { items, bytes } = await fetchSourceItems(source.kind as SupportedKind, source.url);
    const inserted = await insertNewItems(ctx, source.id, items);
    if (inserted.length > 0) await clusterNewItems(ctx, inserted);
    await ctx.db
      .update(sources)
      .set({ consecutiveFailures: 0, lastFetchedAt: new Date() })
      .where(eq(sources.id, source.id));
    ctx.logger.info(
      {
        sourceId: source.id,
        kind: source.kind,
        bytes,
        durationMs: Date.now() - started,
        items: items.length,
        nuevos: inserted.length,
      },
      'Poll de fuente completado',
    );
    // feed en vivo del radar de ideas en la bandeja
    await ctx.publishEvent({
      type: 'source_poll',
      source_id: source.id,
      kind: source.kind,
      channel_id: source.channelId,
      items: items.length,
      nuevos: inserted.length,
    });
    if (inserted.length > 0) await enqueueScoreJobs(ctx, source.channelId);
  } catch (err) {
    const failures = source.consecutiveFailures + 1;
    await ctx.db
      .update(sources)
      .set({ consecutiveFailures: failures })
      .where(eq(sources.id, source.id));
    // attemptsMade cuenta intentos ANTERIORES dentro del procesador
    const isFinalAttempt = attempt === undefined || attempt.made + 1 >= attempt.total;
    if (isFinalAttempt) {
      await ctx.publishEvent({
        type: 'source_poll',
        source_id: source.id,
        kind: source.kind,
        channel_id: source.channelId,
        items: 0,
        nuevos: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (failures >= UNHEALTHY_THRESHOLD) {
      ctx.logger.warn(
        { sourceId: source.id, failures },
        'Fuente no saludable: acumula fallos consecutivos',
      );
    }
    throw err;
  }
}
