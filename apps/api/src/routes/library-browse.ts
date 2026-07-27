import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { assets, beats } from '@fabrica/db';
import {
  JOBS,
  QUEUES,
  type LibraryAssetDto,
  type LibraryListDto,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { extOf, isVideoExt, kindFromPath } from '../lib/beats.js';
import { conflict, notFound } from '../lib/errors.js';
import { toFileUrl } from '../lib/files.js';

// Navegación de la biblioteca (SPEC §11): grid con filtros, procedencia y
// candidatos a purga. El borrado es manual y solo si nada lo referencia.

// Espejo de apps/workers/src/pipelines/library/purge.ts (los workers no se
// importan desde la API): sin usos + 90 días de antigüedad + ningún beat.
const PURGE_AFTER_DAYS = 90;

function purgeCutoff(now: Date): Date {
  return new Date(now.getTime() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000);
}

const referencedByBeats = sql<boolean>`EXISTS (SELECT 1 FROM beats WHERE beats.asset_id = ${assets.id})`;

function purgeCondition(now: Date): SQL {
  const condition = and(
    eq(assets.timesUsed, 0),
    lt(assets.createdAt, purgeCutoff(now)),
    sql`NOT (${referencedByBeats})`,
  );
  if (!condition) throw new Error('Condición de purga vacía');
  return condition;
}

const listQuerySchema = z.object({
  kind: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).optional(),
  channel: z.string().trim().min(1).optional(),
  purge: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Escapa los comodines de ILIKE para que la búsqueda sea literal. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, '\\$&')}%`;
}

function resolveAbsPath(libraryDir: string, assetPath: string): string {
  return path.isAbsolute(assetPath) ? assetPath : path.join(libraryDir, assetPath);
}

function thumbDiskPath(
  libraryDir: string,
  row: { id: string; channelId: string | null },
): string {
  return path.join(libraryDir, 'assets', row.channelId ?? 'shared', 'thumbs', `${row.id}.jpg`);
}

/**
 * Imágenes: el propio archivo sirve de miniatura. Clips: el thumb JPEG que
 * genera el backfill (ffmpeg -frames:v 1) si existe; null mientras tanto.
 */
async function thumbUrlFor(
  libraryDir: string,
  row: { id: string; channelId: string | null; path: string },
): Promise<string | null> {
  const abs = resolveAbsPath(libraryDir, row.path);
  const ext = extOf(abs);
  if (kindFromPath(abs) === 'image') return toFileUrl(abs);
  if (isVideoExt(ext)) {
    const thumb = thumbDiskPath(libraryDir, row);
    const exists = await fs.access(thumb).then(
      () => true,
      () => false,
    );
    if (exists) return toFileUrl(thumb);
  }
  return null;
}

export function registerLibraryBrowseRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/library', async (req): Promise<LibraryListDto> => {
    const query = listQuerySchema.parse(req.query);
    const now = new Date();
    const cutoff = purgeCutoff(now);

    const conditions: SQL[] = [];
    if (query.kind) conditions.push(eq(assets.kind, query.kind));
    if (query.channel) {
      // la vista escopada incluye los assets compartidos (música, b-roll común)
      const scoped = or(eq(assets.channelId, query.channel), eq(assets.scope, 'shared'));
      if (scoped) conditions.push(scoped);
    }
    if (query.q) {
      const pattern = likePattern(query.q);
      const textMatch = or(
        ilike(assets.caption, pattern),
        ilike(assets.originQuery, pattern),
        sql`array_to_string(${assets.tags}, ' ') ILIKE ${pattern}`,
      );
      if (textMatch) conditions.push(textMatch);
    }
    if (query.purge === 'true') conditions.push(purgeCondition(now));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await ctx.db
      .select({ asset: assets, referenced: referencedByBeats })
      .from(assets)
      .where(where)
      .orderBy(desc(assets.createdAt))
      .limit(query.limit)
      .offset(query.offset);

    const [totalRow] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(assets)
      .where(where);

    const items: LibraryAssetDto[] = await Promise.all(
      rows.map(async ({ asset, referenced }) => ({
        id: asset.id,
        scope: asset.scope,
        channel_id: asset.channelId,
        kind: asset.kind,
        url: toFileUrl(resolveAbsPath(ctx.libraryDir, asset.path)),
        thumb_url: await thumbUrlFor(ctx.libraryDir, asset),
        source: asset.source,
        license: asset.license,
        duration_ms: asset.durationMs,
        width: asset.width,
        height: asset.height,
        tags: asset.tags,
        caption: asset.caption,
        origin_query: asset.originQuery,
        times_used: asset.timesUsed,
        last_video_id: asset.lastVideoId,
        purge_candidate:
          asset.timesUsed === 0 && asset.createdAt.getTime() < cutoff.getTime() && !referenced,
        created_at: asset.createdAt.toISOString(),
      })),
    );

    return { assets: items, total: totalRow?.n ?? 0 };
  });

  app.delete('/library/:id', async (req) => {
    const { id } = req.params as { id: string };
    const [asset] = await ctx.db.select().from(assets).where(eq(assets.id, id)).limit(1);
    if (!asset) throw notFound(`El asset ${id} no existe en la biblioteca`);

    // referencias directas (asset_id) y también dentro de candidates (un
    // beat con el asset elegido desde biblioteca aún sin ingerir)
    const candidateNeedle = `%"library:${id}"%`;
    const [ref] = await ctx.db
      .select({ id: beats.id })
      .from(beats)
      .where(or(eq(beats.assetId, id), sql`${beats.candidates}::text LIKE ${candidateNeedle}`))
      .limit(1);
    if (ref) throw conflict('El asset está referenciado por un vídeo y no se puede borrar');
    if (asset.timesUsed > 0) throw conflict('El asset se ha usado en vídeos y no se puede borrar');

    // archivo y thumb solo si viven bajo la biblioteca (nunca rutas arbitrarias)
    const abs = resolveAbsPath(ctx.libraryDir, asset.path);
    const rel = path.relative(ctx.libraryDir, abs);
    if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      await fs.rm(abs, { force: true });
    }
    await fs.rm(thumbDiskPath(ctx.libraryDir, asset), { force: true });
    await ctx.db.delete(assets).where(eq(assets.id, id));
    return { ok: true as const };
  });

  app.post('/library/backfill', async () => {
    await ctx.enqueuer.enqueue(QUEUES.library, JOBS.library.backfill, {});
    return { ok: true as const };
  });

  // re-embebido completo tras cambiar el modelo de embeddings; el job pausa
  // los polls de fuentes mientras corre y aborta si el backend no es el real
  app.post('/library/reembed', async () => {
    await ctx.enqueuer.enqueue(QUEUES.library, JOBS.library.reembed, {});
    return { ok: true as const };
  });
}
