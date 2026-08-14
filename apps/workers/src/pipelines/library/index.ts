import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker, type Job } from 'bullmq';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { assets, channels } from '@fabrica/db';
import {
  JOBS,
  PRICES,
  QUEUES,
  type LibraryBackfillJob,
  type LibraryHarvestJob,
  type LibraryPurgeScanJob,
  type LibraryReembedJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { cosecharDesdeStock } from '../assets/index.js';
import { buildAssetEmbedText } from '../../lib/embed-text.js';
import { closeCost, failCost, openCost } from '../../lib/ledger.js';
import {
  extractCaptionJpeg,
  probeMedia,
  toDataUrl,
  visualKindOf,
  type VisualKind,
} from './media.js';
import { purgeCandidatesCondition } from './purge.js';
import { runReembed } from './reembed.js';
import { CAPTION_PROMPT, mergeTags } from './tags.js';

// Worker de biblioteca (SPEC §11, docs/assets-y-biblioteca.md §6–§7):
// - library.backfill: caption VLM + tags + embedding para assets sin indexar
//   (subidas manuales, ingestas antiguas). Diario y bajo demanda desde la UI.
// - library.purge-scan: cuenta candidatos a purga y avisa; el borrado es
//   SIEMPRE manual desde la UI.

const BATCH_SIZE = 20;

// los eventos job_progress exigen video_id; el backfill no pertenece a ningún
// vídeo, así que se emite con este id sentinela y el dashboard lo lee por cola
export const LIBRARY_EVENT_ID = 'library';

type AssetRow = typeof assets.$inferSelect;

function resolveAbsPath(libraryDir: string, assetPath: string): string {
  return path.isAbsolute(assetPath) ? assetPath : path.join(libraryDir, assetPath);
}

/** Solo las subidas genéricas se reclasifican; el resto de kinds ya es fiable. */
function reclassifyKind(kind: string, visual: VisualKind): string {
  if (kind !== 'upload') return kind;
  if (visual === 'video') return 'clip';
  if (visual === 'image') return 'image';
  if (visual === 'audio') return 'music';
  return kind;
}

function thumbPathFor(libraryDir: string, asset: Pick<AssetRow, 'id' | 'channelId'>): string {
  return path.join(libraryDir, 'assets', asset.channelId ?? 'shared', 'thumbs', `${asset.id}.jpg`);
}

type BackfillOutcome = 'captioned' | 'indexed' | 'skipped';

async function backfillAsset(
  ctx: WorkerContext,
  asset: AssetRow,
  tmpDir: string,
): Promise<BackfillOutcome> {
  const { db, logger } = ctx;
  const absPath = resolveAbsPath(ctx.libraryDir, asset.path);
  const exists = await fs.access(absPath).then(
    () => true,
    () => false,
  );
  if (!exists) {
    logger.warn({ assetId: asset.id, path: absPath }, 'Asset sin archivo en disco; se omite');
    return 'skipped';
  }

  const visual = visualKindOf(absPath);
  const needsProbe =
    (visual === 'video' && (asset.durationMs === null || asset.width === null)) ||
    (visual === 'image' && asset.width === null) ||
    (visual === 'audio' && asset.durationMs === null);
  const probed = needsProbe
    ? await probeMedia(absPath, logger)
    : { durationMs: asset.durationMs, width: asset.width, height: asset.height };

  let caption = asset.caption;
  let outcome: BackfillOutcome = 'indexed';

  if (caption === null && (visual === 'video' || visual === 'image')) {
    const framePath = path.join(tmpDir, `${asset.id}.jpg`);
    const ok = await extractCaptionJpeg(
      { filePath: absPath, visual, durationMs: asset.durationMs ?? probed.durationMs },
      framePath,
      logger,
    );
    if (ok) {
      // el fotograma reescalado sirve también de thumb para los clips
      if (visual === 'video') {
        const thumb = thumbPathFor(ctx.libraryDir, asset);
        await fs.mkdir(path.dirname(thumb), { recursive: true });
        await fs.copyFile(framePath, thumb).catch((err: unknown) => {
          logger.warn({ err, assetId: asset.id }, 'No se pudo guardar el thumb del clip');
        });
      }
      try {
        const dataUrl = await toDataUrl(framePath);
        const { caption: raw } = await ctx.llm.captionImage(dataUrl, CAPTION_PROMPT);
        const clean = raw.trim();
        if (clean !== '') {
          caption = clean;
          outcome = 'captioned';
        }
      } catch (err) {
        // sin caption este asset se reintenta en el próximo backfill diario
        logger.warn({ err, assetId: asset.id }, 'Caption VLM falló; se indexa sin caption');
      } finally {
        await fs.rm(framePath, { force: true });
      }
    }
  } else if (caption === null && visual === 'audio') {
    // el VLM no aplica al audio: caption sintético para marcarlo procesado
    caption = `Pista de audio · ${path.basename(absPath)}`;
  }

  const tags = caption === null ? asset.tags : mergeTags(asset.tags, caption);
  // texto canónico compartido con ingesta y reembed (lib/embed-text.ts)
  const embedText = buildAssetEmbedText(caption, asset.originQuery);
  const [embedding] =
    embedText === '' ? [null] : await ctx.embeddings.embed([embedText], 'passage');

  const newKind = reclassifyKind(asset.kind, visual);
  const updated = await db
    .update(assets)
    .set({
      caption,
      tags,
      embedding: embedding ?? null,
      ...(newKind !== asset.kind ? { kind: newKind } : {}),
      ...(asset.durationMs === null && probed.durationMs !== null && visual !== 'image'
        ? { durationMs: probed.durationMs }
        : {}),
      ...(asset.width === null && probed.width !== null ? { width: probed.width } : {}),
      ...(asset.height === null && probed.height !== null ? { height: probed.height } : {}),
    })
    .where(eq(assets.id, asset.id))
    .returning({ id: assets.id });
  if (updated.length === 0) {
    // el asset se borró mientras se etiquetaba: sin fila no debe quedar thumb
    await fs.rm(thumbPathFor(ctx.libraryDir, asset), { force: true }).catch(() => {});
    logger.info({ assetId: asset.id }, 'Asset borrado durante el backfill; thumb retirado');
    return 'skipped';
  }
  return outcome;
}

/**
 * Posters que faltan. El thumb solo se generaba camino del caption VLM, así
 * que un clip captioned en una pasada vieja (o ingerido antes de que la
 * ingesta lo hiciera) se quedaba sin póster para siempre: la consulta del
 * backfill no lo vuelve a visitar (auditoría UI 2026-08, hallazgo 10). Este
 * pase mira el DISCO, no la BD, y es ffmpeg local: coste cero, corre en cada
 * backfill aunque no haya nada que etiquetar.
 */
async function repararPosters(ctx: WorkerContext): Promise<number> {
  const { db, logger } = ctx;
  const rows = await db
    .select({
      id: assets.id,
      channelId: assets.channelId,
      path: assets.path,
      durationMs: assets.durationMs,
    })
    .from(assets)
    .orderBy(asc(assets.createdAt));

  let creados = 0;
  for (const row of rows) {
    const absPath = resolveAbsPath(ctx.libraryDir, row.path);
    if (visualKindOf(absPath) !== 'video') continue;
    const thumb = thumbPathFor(ctx.libraryDir, row);
    const hayThumb = await fs.access(thumb).then(
      () => true,
      () => false,
    );
    if (hayThumb) continue;
    const hayArchivo = await fs.access(absPath).then(
      () => true,
      () => false,
    );
    if (!hayArchivo) continue;
    await fs.mkdir(path.dirname(thumb), { recursive: true });
    const ok = await extractCaptionJpeg(
      { filePath: absPath, visual: 'video', durationMs: row.durationMs },
      thumb,
      logger,
    );
    if (ok) creados += 1;
  }
  if (creados > 0) logger.info({ creados }, 'Posters de clips reparados');
  return creados;
}

async function runBackfill(ctx: WorkerContext, job: Job<LibraryBackfillJob>): Promise<void> {
  const { db, logger } = ctx;
  // pase 0, antes del etiquetado: la reparación no depende de qué quede por
  // captionar y tiene que correr también cuando no queda nada
  const posters = await repararPosters(ctx);
  const conditions = [or(isNull(assets.embedding), isNull(assets.caption))];
  const assetIds = job.data.assetIds ?? [];
  if (assetIds.length > 0) conditions.push(inArray(assets.id, assetIds));

  const rows = await db
    .select()
    .from(assets)
    .where(and(...conditions))
    .orderBy(asc(assets.createdAt));

  if (rows.length === 0) {
    logger.info('Backfill de biblioteca: no hay assets pendientes de etiquetar');
    await ctx.publishEvent({
      type: 'job_progress',
      video_id: LIBRARY_EVENT_ID,
      queue: QUEUES.library,
      progress: 100,
      detail:
        posters > 0
          ? `Biblioteca al día · ${posters} ${posters === 1 ? 'póster reparado' : 'posters reparados'}`
          : 'Biblioteca al día: nada pendiente de etiquetar',
    });
    return;
  }

  const tmpDir = path.join(ctx.libraryDir, '.tmp-backfill');
  await fs.mkdir(tmpDir, { recursive: true });

  let processed = 0;
  let captioned = 0;
  let skipped = 0;

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    // regla del ledger: la fila se abre ANTES de las llamadas VLM del lote
    const handle = await openCost(db, {
      provider: ctx.llm.ledgerProvider,
      operation: 'vlm_caption',
      meta: { source: 'library.backfill', batch: start / BATCH_SIZE + 1, size: batch.length },
    });
    let batchCaptioned = 0;
    try {
      for (const asset of batch) {
        const outcome = await backfillAsset(ctx, asset, tmpDir);
        processed += 1;
        if (outcome === 'captioned') {
          batchCaptioned += 1;
          captioned += 1;
        } else if (outcome === 'skipped') {
          skipped += 1;
        }
      }
      await closeCost(db, handle, {
        units: batchCaptioned,
        unitCost: ctx.llm.name === 'mock' ? 0 : PRICES.openai.vlm_caption_per_image,
      });
    } catch (err) {
      await failCost(db, handle, err instanceof Error ? err.message : String(err));
      throw err;
    }
    await ctx.publishEvent({
      type: 'job_progress',
      video_id: LIBRARY_EVENT_ID,
      queue: QUEUES.library,
      progress: Math.round((processed / rows.length) * 100),
      detail: `Etiquetados ${processed} de ${rows.length} assets`,
    });
  }

  await fs.rm(tmpDir, { recursive: true, force: true });
  logger.info({ total: rows.length, captioned, skipped }, 'Backfill de biblioteca completado');
}

async function runPurgeScan(ctx: WorkerContext, job: Job<LibraryPurgeScanJob>): Promise<void> {
  const { db, logger } = ctx;
  const base = purgeCandidatesCondition(new Date());
  const condition = job.data.channelId ? and(base, eq(assets.channelId, job.data.channelId)) : base;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assets)
    .where(condition);
  const candidates = row?.n ?? 0;
  logger.info(
    { candidates, channelId: job.data.channelId ?? 'todos' },
    'Barrido de purga: candidatos sin uso en 90 días (el borrado es manual desde la UI)',
  );
  // la UI enseña el toggle «candidatos a purga»; solo se avisa de que hay novedades
  await ctx.publishEvent({ type: 'inbox_changed' });
}

/**
 * Cosecha semanal: por canal, las example_queries de sus pilares ROTADAS por
 * número de semana (cada lunes toca un tramo distinto de la taxonomía; con
 * pocas queries repite y la caché/idempotencia lo absorben). Topes cortos a
 * propósito: 8 consultas y 12 assets por canal y semana — crecimiento
 * constante, no una tarde de descargas.
 */
async function runHarvest(ctx: WorkerContext, job: Job<LibraryHarvestJob>): Promise<void> {
  const { db, logger } = ctx;
  const filas = await db
    .select({ id: channels.id, profile: channels.profile })
    .from(channels)
    .where(job.data.channelId ? eq(channels.id, job.data.channelId) : undefined);
  const QUERIES_POR_RUN = 8;
  // semana ISO aproximada: días desde epoch / 7 — solo se usa para ROTAR
  const semana = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  let total = 0;
  for (const canal of filas) {
    const pool = (canal.profile?.pillars ?? []).flatMap((p) => p.example_queries);
    if (pool.length === 0) continue;
    const desde = (semana * QUERIES_POR_RUN) % pool.length;
    const queries = Array.from(
      { length: Math.min(QUERIES_POR_RUN, pool.length) },
      (_, i) => pool[(desde + i) % pool.length]!,
    );
    total += await cosecharDesdeStock(ctx, canal.id, queries, {
      topePorQuery: 3,
      topeTotal: 12,
    });
  }
  logger.info({ canales: filas.length, cosechados: total }, 'Cosecha semanal completada');
  await ctx.publishEvent({
    type: 'job_progress',
    video_id: LIBRARY_EVENT_ID,
    queue: QUEUES.library,
    progress: 100,
    detail:
      total > 0
        ? `Cosecha semanal: ${total} ${total === 1 ? 'clip nuevo' : 'clips nuevos'} en biblioteca`
        : 'Cosecha semanal: nada nuevo que valiera la pena',
  });
}

export async function registerLibraryWorkers(ctx: WorkerContext): Promise<Worker[]> {
  // schedulers repetibles e idempotentes (upsert por id, sin ':' en los ids):
  // backfill diario de madrugada y barrido de purga el día 1 de cada mes
  try {
    await ctx.queues.library.upsertJobScheduler(
      'library-backfill',
      { pattern: '30 4 * * *' },
      { name: JOBS.library.backfill, data: {} satisfies LibraryBackfillJob },
    );
    await ctx.queues.library.upsertJobScheduler(
      'library-purge-scan',
      { pattern: '0 5 1 * *' },
      { name: JOBS.library.purgeScan, data: {} satisfies LibraryPurgeScanJob },
    );
    // cosecha temática los lunes de madrugada: la biblioteca crece sola por la
    // taxonomía del canal usando el rate limit ocioso, en vez de crecer solo
    // como subproducto de producir vídeos
    await ctx.queues.library.upsertJobScheduler(
      'library-cosecha',
      { pattern: '0 6 * * 1' },
      { name: JOBS.library.harvest, data: {} satisfies LibraryHarvestJob },
    );
  } catch (err) {
    ctx.logger.warn({ err }, 'No se pudieron registrar los schedulers de biblioteca');
  }

  const worker = new Worker<LibraryBackfillJob | LibraryPurgeScanJob | LibraryReembedJob>(
    QUEUES.library,
    async (job) => {
      try {
        if (job.name === JOBS.library.backfill) {
          await runBackfill(ctx, job as Job<LibraryBackfillJob>);
        } else if (job.name === JOBS.library.purgeScan) {
          await runPurgeScan(ctx, job as Job<LibraryPurgeScanJob>);
        } else if (job.name === JOBS.library.reembed) {
          await runReembed(ctx, job as Job<LibraryReembedJob>);
        } else if (job.name === JOBS.library.harvest) {
          await runHarvest(ctx, job as Job<LibraryHarvestJob>);
        } else {
          ctx.logger.warn({ job: job.name }, 'Job desconocido en la cola library');
        }
      } catch (err) {
        // attemptsMade cuenta intentos ANTERIORES dentro del procesador
        const attempts = job.opts.attempts ?? 1;
        const isFinal = job.attemptsMade + 1 >= attempts;
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error({ err, job: job.name, isFinal }, 'Fallo en la cola library');
        if (isFinal && job.name === JOBS.library.backfill) {
          // sin vídeo asociado: incidencia informativa, no bloquea ningún pipeline
          await ctx
            .publishEvent({
              type: 'incident',
              queue: QUEUES.library,
              message: `El etiquetado de la biblioteca falló: ${message}`,
              suggested_action: 'reintentar',
            })
            .catch(() => {});
        }
        throw err;
      }
    },
    { connection: ctx.connection, concurrency: 1 },
  );

  return [worker];
}
