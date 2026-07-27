import type { Job } from 'bullmq';
import { asc, gt, eq, inArray, isNotNull, and, sql } from 'drizzle-orm';
import { assets, ideas, rawItems } from '@fabrica/db';
import { JOBS, QUEUES, type LibraryReembedJob } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { buildAssetEmbedText } from '../../lib/embed-text.js';
import { centroid } from '../ideas/scoring.js';

// Re-embebido total (docs/assets-y-biblioteca.md §1): cambiar el modelo de
// embeddings invalida TODAS las similitudes, así que hay que regenerar los
// vectores de raw_items, ideas y assets con el modelo activo. Job de la cola
// 'library' con nombre JOBS.library.reembed (payload en @fabrica/shared).
//
// Idempotente y reanudable: procesa por orden de id en lotes de 100; el cursor
// (fase + último id) se guarda en el progress del job, así un reintento retoma
// donde se quedó. Reprocesar una fila es un overwrite puro, sin efectos dobles.
//
// Orden de fases fijo: raw_items → ideas → assets. Las ideas se re-derivan
// como centroide de los embeddings NUEVOS de su cluster, por eso van después.

export const REEMBED_JOB_NAME = JOBS.library.reembed;

export type ReembedTable = 'raw_items' | 'ideas' | 'assets';
export type { LibraryReembedJob };

// video_id sintético para los eventos job_progress (el esquema del evento
// exige video_id y este job no pertenece a ningún vídeo)
export const REEMBED_PROGRESS_VIDEO_ID = 'library-reembed';

export const REEMBED_BATCH_SIZE = 100;

const PHASE_ORDER: ReembedTable[] = ['raw_items', 'ideas', 'assets'];

// --- constructores de texto: DEBEN calcar los de los pipelines originales ---

// igual que clusterNewItems en pipelines/sources/poll.ts
export function rawItemEmbeddingText(row: { title: string; excerpt: string | null }): string {
  return `${row.title} ${row.excerpt ?? ''}`.trim();
}

// texto canónico compartido por ingesta, backfill y re-embebido
export function assetEmbeddingText(row: {
  caption: string | null;
  originQuery: string | null;
  tags: string[];
}): string {
  return buildAssetEmbedText(row.caption, row.originQuery, row.tags);
}

// solo para ideas sin cluster con embeddings: texto de la ficha
export function ideaFallbackEmbeddingText(row: { title: string; summary: string }): string {
  return `${row.title}. ${row.summary}`.trim();
}

// normaliza el payload: sin duplicados y siempre en el orden canónico de fases
export function normalizeTables(tables?: ReembedTable[]): ReembedTable[] {
  if (!tables || tables.length === 0) return PHASE_ORDER;
  const wanted = new Set(tables);
  return PHASE_ORDER.filter((t) => wanted.has(t));
}

interface ReembedCursor {
  phase: ReembedTable;
  lastId: string | null;
}

function readCursor(progress: unknown): ReembedCursor | null {
  if (typeof progress !== 'object' || progress === null) return null;
  const p = progress as { phase?: unknown; lastId?: unknown };
  if (typeof p.phase !== 'string' || !PHASE_ORDER.includes(p.phase as ReembedTable)) return null;
  return {
    phase: p.phase as ReembedTable,
    lastId: typeof p.lastId === 'string' ? p.lastId : null,
  };
}

// fases ya completadas en una ejecución anterior del MISMO job (reintento)
export function resumePlan(
  tables: ReembedTable[],
  cursor: ReembedCursor | null,
): { table: ReembedTable; startAfterId: string | null }[] {
  if (!cursor) return tables.map((table) => ({ table, startAfterId: null }));
  const cursorIdx = PHASE_ORDER.indexOf(cursor.phase);
  return tables
    .filter((table) => PHASE_ORDER.indexOf(table) >= cursorIdx)
    .map((table) => ({
      table,
      startAfterId: table === cursor.phase ? cursor.lastId : null,
    }));
}

async function countRows(ctx: WorkerContext, table: ReembedTable): Promise<number> {
  const target = table === 'raw_items' ? rawItems : table === 'ideas' ? ideas : assets;
  const [row] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(target);
  return row?.n ?? 0;
}

interface PhaseRuntime {
  ctx: WorkerContext;
  job: Job<LibraryReembedJob>;
  total: number;
  processed: number;
}

async function publishProgress(rt: PhaseRuntime, phase: ReembedTable, lastId: string | null): Promise<void> {
  await rt.job.updateProgress({ phase, lastId });
  const progress = rt.total > 0 ? Math.min(100, Math.round((rt.processed / rt.total) * 100)) : 100;
  await rt.ctx.publishEvent({
    type: 'job_progress',
    video_id: REEMBED_PROGRESS_VIDEO_ID,
    queue: QUEUES.library,
    progress,
    detail: `Re-embebido de ${phase}: ${rt.processed} de ${rt.total} filas`,
  });
}

async function reembedRawItems(rt: PhaseRuntime, startAfterId: string | null): Promise<void> {
  const { ctx } = rt;
  let lastId = startAfterId;
  for (;;) {
    const rows = await ctx.db
      .select({ id: rawItems.id, title: rawItems.title, excerpt: rawItems.excerpt })
      .from(rawItems)
      .where(lastId ? gt(rawItems.id, lastId) : undefined)
      .orderBy(asc(rawItems.id))
      .limit(REEMBED_BATCH_SIZE);
    if (rows.length === 0) break;
    const vectors = await ctx.embeddings.embed(rows.map(rawItemEmbeddingText));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const vec = vectors[i];
      if (!row || !vec) continue;
      await ctx.db.update(rawItems).set({ embedding: vec }).where(eq(rawItems.id, row.id));
    }
    lastId = rows[rows.length - 1]?.id ?? lastId;
    rt.processed += rows.length;
    await publishProgress(rt, 'raw_items', lastId);
  }
}

async function reembedIdeas(rt: PhaseRuntime, startAfterId: string | null): Promise<void> {
  const { ctx } = rt;
  let lastId = startAfterId;
  for (;;) {
    const rows = await ctx.db
      .select({
        id: ideas.id,
        clusterId: ideas.clusterId,
        title: ideas.title,
        summary: ideas.summary,
      })
      .from(ideas)
      .where(lastId ? gt(ideas.id, lastId) : undefined)
      .orderBy(asc(ideas.id))
      .limit(REEMBED_BATCH_SIZE);
    if (rows.length === 0) break;

    // centroide con los embeddings nuevos de los raw_items del cluster
    const clusterIds = [...new Set(rows.map((r) => r.clusterId).filter((c): c is string => c !== null))];
    const members = clusterIds.length
      ? await ctx.db
          .select({ clusterId: rawItems.clusterId, embedding: rawItems.embedding })
          .from(rawItems)
          .where(and(inArray(rawItems.clusterId, clusterIds), isNotNull(rawItems.embedding)))
      : [];
    const vecsByCluster = new Map<string, number[][]>();
    for (const m of members) {
      if (!m.clusterId || !m.embedding) continue;
      const list = vecsByCluster.get(m.clusterId) ?? [];
      list.push(m.embedding);
      vecsByCluster.set(m.clusterId, list);
    }

    // ideas sin cluster vivo: embedding del texto de la ficha, en un solo lote
    const fallbackIdx: number[] = [];
    const fallbackTexts: string[] = [];
    const newVectors = new Array<number[] | null>(rows.length).fill(null);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const clusterVecs = row.clusterId ? vecsByCluster.get(row.clusterId) : undefined;
      if (clusterVecs && clusterVecs.length > 0) {
        newVectors[i] = centroid(clusterVecs);
      } else {
        fallbackIdx.push(i);
        fallbackTexts.push(ideaFallbackEmbeddingText(row));
      }
    }
    if (fallbackTexts.length > 0) {
      const embedded = await ctx.embeddings.embed(fallbackTexts);
      for (let j = 0; j < fallbackIdx.length; j++) {
        const idx = fallbackIdx[j];
        const vec = embedded[j];
        if (idx !== undefined && vec) newVectors[idx] = vec;
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const vec = newVectors[i];
      if (!row || !vec) continue;
      await ctx.db.update(ideas).set({ embedding: vec }).where(eq(ideas.id, row.id));
    }
    lastId = rows[rows.length - 1]?.id ?? lastId;
    rt.processed += rows.length;
    await publishProgress(rt, 'ideas', lastId);
  }
}

async function reembedAssets(rt: PhaseRuntime, startAfterId: string | null): Promise<void> {
  const { ctx } = rt;
  let lastId = startAfterId;
  let skipped = 0;
  for (;;) {
    const rows = await ctx.db
      .select({
        id: assets.id,
        caption: assets.caption,
        originQuery: assets.originQuery,
        tags: assets.tags,
      })
      .from(assets)
      .where(lastId ? gt(assets.id, lastId) : undefined)
      .orderBy(asc(assets.id))
      .limit(REEMBED_BATCH_SIZE);
    if (rows.length === 0) break;

    const withText: { id: string; text: string }[] = [];
    for (const row of rows) {
      const text = assetEmbeddingText(row);
      if (text.length > 0) withText.push({ id: row.id, text });
      else skipped += 1; // sin caption, query ni tags: no hay nada que embeber
    }
    if (withText.length > 0) {
      const vectors = await ctx.embeddings.embed(withText.map((w) => w.text));
      for (let i = 0; i < withText.length; i++) {
        const entry = withText[i];
        const vec = vectors[i];
        if (!entry || !vec) continue;
        await ctx.db.update(assets).set({ embedding: vec }).where(eq(assets.id, entry.id));
      }
    }
    lastId = rows[rows.length - 1]?.id ?? lastId;
    rt.processed += rows.length;
    await publishProgress(rt, 'assets', lastId);
  }
  if (skipped > 0) {
    ctx.logger.warn({ skipped }, 'Assets sin texto indexable; conservan su embedding anterior');
  }
}

export async function runReembed(ctx: WorkerContext, job: Job<LibraryReembedJob>): Promise<void> {
  const tables = normalizeTables(job.data.tables);
  const plan = resumePlan(tables, readCursor(job.progress));

  // sonda ANTES de tocar filas: fuerza la carga real del modelo, de modo que
  // describe() refleje el backend efectivo (no el intención) y un backend
  // degradado aborte el job en vez de migrar todo a hash anunciando e5
  await ctx.embeddings.embed(['sonda de re-embebido']);
  const backend = ctx.embeddings.describe();
  if (ctx.embeddings.name === 'fastembed' && backend.backend !== 'e5-transformers') {
    throw new Error(
      `Re-embebido abortado: backend efectivo '${backend.backend}' en lugar de e5-transformers`,
    );
  }
  ctx.logger.info(
    { tables: plan.map((p) => p.table), backend, jobId: job.id },
    'Re-embebido de la biblioteca iniciado',
  );

  // los polls escriben embeddings y clusters en paralelo: pausar la cola de
  // fuentes evita clustering contra un espacio vectorial mixto
  await ctx.queues.sources.pause().catch(() => {});
  try {
    const rt: PhaseRuntime = { ctx, job, total: 0, processed: 0 };
    for (const step of plan) rt.total += await countRows(ctx, step.table);

    for (const step of plan) {
      if (step.table === 'raw_items') await reembedRawItems(rt, step.startAfterId);
      else if (step.table === 'ideas') await reembedIdeas(rt, step.startAfterId);
      else await reembedAssets(rt, step.startAfterId);
    }

    const finalBackend = ctx.embeddings.describe();
    await ctx.publishEvent({
      type: 'job_progress',
      video_id: REEMBED_PROGRESS_VIDEO_ID,
      queue: QUEUES.library,
      progress: 100,
      detail: `Re-embebido completado: ${rt.processed} filas con el modelo ${finalBackend.model}`,
    });
    ctx.logger.info(
      { filas: rt.processed, backend: finalBackend },
      'Re-embebido de la biblioteca completado',
    );
  } finally {
    await ctx.queues.sources.resume().catch(() => {});
  }
}

// Encolado con id único (BullMQ prohíbe ':' en ids custom). No se usa un id
// determinista puro porque un job completado con removeOnComplete por contador
// bloquearía re-ejecuciones futuras con el mismo id.
export async function enqueueReembed(
  ctx: WorkerContext,
  payload: LibraryReembedJob = {},
): Promise<void> {
  await ctx.queues.library.add(REEMBED_JOB_NAME, payload, {
    jobId: `library-reembed-${Date.now()}`,
  });
}
