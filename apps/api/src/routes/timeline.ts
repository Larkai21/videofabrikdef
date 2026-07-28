import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { beats, transitionVideo, videos } from '@fabrica/db';
import {
  beatActionRequestSchema,
  JOBS,
  QUEUES,
  type AssetsMatchJob,
  type BeatCandidate,
  type TimelineDto,
  type VideoState,
} from '@fabrica/shared';
import {
  beatRowToTimelineDto,
  libraryAssetId,
  originLabel,
  provisionalFit,
} from '../lib/beats.js';
import type { ApiContext } from '../lib/context.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { toFileUrl } from '../lib/files.js';
import { loadAssetFiles } from './videos.js';

type VideoRow = typeof videos.$inferSelect;

async function loadVideo(ctx: ApiContext, id: string): Promise<VideoRow> {
  const [row] = await ctx.db.select().from(videos).where(eq(videos.id, id)).limit(1);
  if (!row) throw notFound(`Vídeo ${id} no existe`);
  return row;
}

export function registerTimelineRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/videos/:id/timeline', async (req): Promise<TimelineDto> => {
    const { id } = req.params as { id: string };
    const video = await loadVideo(ctx, id);
    const rows = await ctx.db
      .select()
      .from(beats)
      .where(eq(beats.videoId, id))
      .orderBy(asc(beats.idx));
    const assetFiles = await loadAssetFiles(
      ctx,
      rows.flatMap((r) => (r.assetId ? [r.assetId] : [])),
    );

    return {
      video_id: id,
      state: video.state as VideoState,
      audio_url: video.master.audio ? toFileUrl(video.master.audio.path) : null,
      duration_ms: video.master.audio?.duration_ms ?? rows.at(-1)?.toMs ?? 0,
      beats: rows.map((r) =>
        beatRowToTimelineDto(r, r.assetId ? assetFiles.get(r.assetId) : undefined),
      ),
      edits: video.master.edits ?? [],
    };
  });

  app.post('/videos/:id/beats/:idx', async (req) => {
    const params = req.params as { id: string; idx: string };
    const idx = Number.parseInt(params.idx, 10);
    if (!Number.isInteger(idx) || idx < 0) throw badRequest('Índice de beat inválido');
    const body = beatActionRequestSchema.parse(req.body);

    const video = await loadVideo(ctx, params.id);
    if (video.state !== 'assets') {
      throw conflict(`La curación solo procede en assets (estado actual: ${video.state})`);
    }
    const [row] = await ctx.db
      .select()
      .from(beats)
      .where(and(eq(beats.videoId, params.id), eq(beats.idx, idx)))
      .limit(1);
    if (!row) throw notFound(`El beat ${idx} no existe en el vídeo ${params.id}`);

    const lockWithCandidate = async (candidate: BeatCandidate) => {
      const beatMs = row.toMs - row.fromMs;
      const reordered = [candidate, ...(row.candidates ?? []).filter((c) => c.ref !== candidate.ref)];
      await ctx.db
        .update(beats)
        .set({
          status: 'locked',
          candidates: reordered,
          chosenScore: candidate.score,
          chosenOrigin: originLabel(candidate),
          assetId: libraryAssetId(candidate),
          fit: provisionalFit(candidate, beatMs),
          discardReason: null,
        })
        .where(eq(beats.id, row.id));
    };

    switch (body.action) {
      case 'approve': {
        // con elegido previo (p. ej. subida propia) basta con bloquear
        if (row.assetId && row.fit) {
          await ctx.db.update(beats).set({ status: 'locked', discardReason: null }).where(eq(beats.id, row.id));
          break;
        }
        const top = row.candidates?.[0];
        if (!top) throw conflict('El beat no tiene candidatos: busca en stock o sube un archivo');
        await lockWithCandidate(top);
        break;
      }
      case 'choose': {
        if (!body.ref) throw badRequest('La acción choose requiere ref');
        // la búsqueda libre de stock manda el candidato completo en el body
        // (sus resultados no están en beats.candidates)
        const candidate =
          (row.candidates ?? []).find((c) => c.ref === body.ref) ??
          (body.candidate?.ref === body.ref ? body.candidate : undefined);
        if (!candidate) throw notFound(`El candidato ${body.ref} no está en el beat ${idx}`);
        await lockWithCandidate(candidate);
        break;
      }
      case 'discard': {
        await ctx.db
          .update(beats)
          .set({
            status: 'review',
            discardReason: body.reason ?? 'sin motivo',
            assetId: null,
            fit: null,
            chosenScore: null,
            chosenOrigin: null,
          })
          .where(eq(beats.id, row.id));
        const payload: AssetsMatchJob = { videoId: params.id, beatIdxs: [idx] };
        await ctx.enqueuer.enqueue(QUEUES.assets, JOBS.assets.match, payload);
        break;
      }
    }
    return { ok: true as const };
  });

  app.post('/videos/:id/approve-timeline', async (req) => {
    const { id } = req.params as { id: string };
    const video = await loadVideo(ctx, id);
    // puerta idempotente: si la transición hizo commit pero el encolado
    // falló (blip de Redis), repetir la petición re-encola y devuelve ok
    if (video.state === 'timeline_ok') {
      await ctx.enqueuer.enqueue(QUEUES.assets, JOBS.assets.ingest, { videoId: id });
      return { ok: true as const };
    }
    const rows = await ctx.db
      .select({ idx: beats.idx, status: beats.status })
      .from(beats)
      .where(eq(beats.videoId, id))
      .orderBy(asc(beats.idx));
    if (!rows.length) throw conflict('El vídeo no tiene beats');
    const pending = rows.filter((r) => r.status !== 'locked').map((r) => r.idx);
    if (pending.length) {
      throw conflict(`Beats sin aprobar: ${pending.join(', ')}`);
    }

    await transitionVideo(ctx.db, id, 'timeline_ok', { expectFrom: 'assets' });
    await ctx.enqueuer.enqueue(QUEUES.assets, JOBS.assets.ingest, { videoId: id });
    await ctx.events.publish({ type: 'video_state', video_id: id, state: 'timeline_ok' });
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const };
  });
}
