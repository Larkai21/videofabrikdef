import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { beats, transitionVideo, videos } from '@fabrica/db';
import {
  beatActionRequestSchema,
  JOBS,
  QUEUES,
  type AssetsMatchJob,
  type BeatCandidate,
  type StoredSubvisual,
  type TimelineDto,
  type VideoState,
} from '@fabrica/shared';
import { beatRowToTimelineDto, libraryAssetId, originLabel, provisionalFit } from '../lib/beats.js';
import type { ApiContext } from '../lib/context.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { toFileUrl } from '../lib/files.js';
import { loadAssetFiles } from './videos.js';

type VideoRow = typeof videos.$inferSelect;

/**
 * Aplica la elección del humano al PRIMER sub-plano del beat.
 *
 * El primero y no todos porque la timeline enseña una ficha por beat: lo que el
 * humano ha mirado y aprobado es ese plano. Los demás sub-planos son otros
 * momentos del mismo beat, con su propia consulta, y cambiarlos sería decidir
 * por él sobre algo que no ha visto.
 */
export function elegirEnSubplano(
  visuals: StoredSubvisual[] | null,
  candidate: BeatCandidate,
  beatMs: number,
): StoredSubvisual[] | null {
  if (!visuals || visuals.length === 0) return visuals;
  const [primero, ...resto] = visuals;
  if (!primero) return visuals;
  return [
    {
      ...primero,
      status: 'locked',
      candidates: [candidate, ...primero.candidates.filter((c) => c.ref !== candidate.ref)],
      chosen_score: candidate.score,
      chosen_origin: originLabel(candidate),
      asset_id: libraryAssetId(candidate),
      fit: provisionalFit(candidate, primero.to_ms - primero.from_ms || beatMs),
    },
    ...resto,
  ];
}

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
      const reordered = [
        candidate,
        ...(row.candidates ?? []).filter((c) => c.ref !== candidate.ref),
      ];
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
          // Y el sub-plano, o la elección del humano no llega al MP4.
          //
          // El beat guarda su elección en las columnas de arriba, pero la
          // ingesta descarga lo que diga `visuals[*].candidates[0]`, que es
          // otra lista. Resultado medido: en el vídeo de hoy elegí a mano los
          // 25 planos y el render usó los 25 originales. El beat 0 decía
          // «Pexels · video:6101367» (un juez con su mazo) y en pantalla salía
          // un hacha partiendo leña, que era el candidato que la máquina había
          // puesto primero.
          //
          // La puerta de curación llevaba siendo decorativa desde que existen
          // los sub-planos, y no había forma de notarlo: la API respondía
          // {ok:true} y la ficha del beat mostraba el origen correcto.
          visuals: elegirEnSubplano(row.visuals, candidate, beatMs),
        })
        .where(eq(beats.id, row.id));
    };

    switch (body.action) {
      case 'approve': {
        // con elegido previo (p. ej. subida propia) basta con bloquear
        if (row.assetId && row.fit) {
          await ctx.db
            .update(beats)
            .set({ status: 'locked', discardReason: null })
            .where(eq(beats.id, row.id));
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
    // `auto_ok` significa que la máquina va sobrada de confianza en ese plano
    // (SPEC §9: «verde = auto-aprobado; ámbar = revisar»), así que cruza la
    // puerta igual que `locked`. Antes exigía `locked` en TODOS y el humano
    // tenía que pulsar aprobar 36 veces, incluida la mitad que la máquina daba
    // por buena. Ese es el motivo de que la curación no filtre nada: 36 clics
    // obligatorios sin información se despachan en fila, y de 181 beats
    // curados no salió ni un solo descarte. Lo que hay que revisar es lo ámbar.
    const pending = rows
      .filter((r) => r.status !== 'locked' && r.status !== 'auto_ok')
      .map((r) => r.idx);
    if (pending.length) {
      throw conflict(`Beats sin revisar: ${pending.join(', ')}`);
    }

    await transitionVideo(ctx.db, id, 'timeline_ok', { expectFrom: 'assets' });
    await ctx.enqueuer.enqueue(QUEUES.assets, JOBS.assets.ingest, { videoId: id });
    await ctx.events.publish({ type: 'video_state', video_id: id, state: 'timeline_ok' });
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const };
  });
}
