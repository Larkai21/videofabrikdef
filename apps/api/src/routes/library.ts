import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { assets, beats, channels } from '@fabrica/db';
import type { BeatCandidate, Fit } from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { badRequest, notFound } from '../lib/errors.js';
import { extOf, isVideoExt } from '../lib/beats.js';
import { toFileUrl } from '../lib/files.js';

function tagsFromFilename(filename: string): string[] {
  const base = path.basename(filename, path.extname(filename));
  const tokens = base
    .toLowerCase()
    .split(/[^a-z0-9áéíóúñü]+/i)
    .filter((t) => t.length >= 3);
  return [...new Set(tokens)].slice(0, 8);
}

export function registerLibraryRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.post('/library/upload', async (req) => {
    const fields: Record<string, string> = {};
    let tmpPath: string | null = null;
    let filename = '';

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        filename = part.filename;
        const tmpDir = path.join(ctx.libraryDir, 'assets', '.tmp');
        await mkdir(tmpDir, { recursive: true });
        tmpPath = path.join(tmpDir, nanoid());
        await pipeline(part.file, createWriteStream(tmpPath));
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    const cleanup = async () => {
      if (tmpPath) await rm(tmpPath, { force: true });
    };

    if (!tmpPath || !filename) {
      throw badRequest('Falta el archivo en el multipart');
    }
    const channelId = fields.channel_id;
    if (!channelId) {
      await cleanup();
      throw badRequest('Falta el campo channel_id');
    }
    // el channel_id forma parte de la ruta en disco: alfabeto cerrado y
    // existencia en BD antes de tocar el sistema de archivos
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(channelId)) {
      await cleanup();
      throw badRequest('channel_id inválido');
    }
    const [channel] = await ctx.db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);
    if (!channel) {
      await cleanup();
      throw notFound(`El canal ${channelId} no existe`);
    }

    const ext = extOf(filename) || 'bin';
    const assetId = nanoid();
    const finalDir = path.join(ctx.libraryDir, 'assets', channelId, 'uploads');
    await mkdir(finalDir, { recursive: true });
    const finalPath = path.join(finalDir, `${assetId}.${ext}`);
    await rename(tmpPath, finalPath);

    await ctx.db.insert(assets).values({
      id: assetId,
      scope: 'channel',
      channelId,
      kind: 'upload',
      path: finalPath,
      source: 'upload',
      license: 'propia',
      tags: tagsFromFilename(filename),
      // TODO(backfill): caption VLM + embedding se rellenan en la ingesta S2
      embedding: null,
    });

    // asignación directa a un hueco de la timeline
    if (fields.video_id && fields.beat_idx !== undefined) {
      const idx = Number.parseInt(fields.beat_idx, 10);
      if (!Number.isInteger(idx) || idx < 0) throw badRequest('beat_idx inválido');
      const [row] = await ctx.db
        .select({ id: beats.id })
        .from(beats)
        .where(and(eq(beats.videoId, fields.video_id), eq(beats.idx, idx)))
        .limit(1);
      if (!row) throw notFound(`El beat ${idx} no existe en el vídeo ${fields.video_id}`);
      // fit provisional por extensión; el definitivo lo recalcula assets.ingest con ffprobe
      const fit: Fit = isVideoExt(ext) ? { mode: 'trim', offset_ms: 0 } : { mode: 'kenburns' };
      // convención candidates[0] = elegido: el panel debe mostrar la subida,
      // no el candidato que había antes
      const uploadCandidate: BeatCandidate = {
        ref: `library:${assetId}`,
        provider: 'library',
        score: 1,
        meta: {
          asset_id: assetId,
          kind: isVideoExt(ext) ? 'clip' : 'image',
          title: filename,
          path: finalPath,
        },
      };
      await ctx.db
        .update(beats)
        .set({
          assetId,
          status: 'locked',
          fit,
          candidates: [uploadCandidate],
          chosenScore: null,
          chosenOrigin: 'Biblioteca · subida propia',
          discardReason: null,
        })
        .where(eq(beats.id, row.id));
    }

    return { ok: true as const, asset_id: assetId, url: toFileUrl(finalPath) };
  });
}
