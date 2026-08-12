import fs from 'node:fs';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { shorts, transitionShort, videos } from '@fabrica/db';
import {
  extractYoutubeId,
  JOBS,
  QUEUES,
  shortDiscardRequestSchema,
  shortPublicadoRequestSchema,
  shortTitleRequestSchema,
  type ShortDetailDto,
  type ShortDto,
  type ShortsListDto,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { masterWithFileUrls } from '../lib/master.js';

// Shorts verticales recortados de un vídeo ya entregado.
//
// El humano ELIGE entre los candidatos que propone el director y descarta los
// que no; NO mueve la ventana. Un control para arrastrar from_ms/to_ms es un asa
// de recorte —lo que el principio 1 prohíbe— y además rompería el invariante
// técnico: la ventana cae en frontera de beat, que es lo que hereda la garantía
// de que el corte no parte una frase.

type ShortRow = typeof shorts.$inferSelect;

async function loadShort(ctx: ApiContext, id: string): Promise<ShortRow> {
  const [row] = await ctx.db.select().from(shorts).where(eq(shorts.id, id)).limit(1);
  if (!row) throw notFound(`Short ${id} no existe`);
  return row;
}

export function shortToDto(row: ShortRow): ShortDto {
  return toDto(row);
}

function toDto(row: ShortRow): ShortDto {
  const rendido = row.outputDir !== null && row.state === 'hecho';
  const rel =
    row.episodeId !== null
      ? `outputs/episodios/${row.episodeId}/shorts/${row.id}`
      : `outputs/${row.videoId}/shorts/${row.id}`;
  const thumb =
    rendido && row.outputDir !== null && fs.existsSync(path.join(row.outputDir, 'thumb.jpg'))
      ? `/files/${rel}/thumb.jpg`
      : null;
  return {
    id: row.id,
    video_id: row.videoId,
    episode_id: row.episodeId,
    idx: row.idx,
    state: row.state as ShortDto['state'],
    from_ms: row.fromMs,
    to_ms: row.toMs,
    duration_ms: row.toMs - row.fromMs,
    title: row.title,
    hook: row.hook,
    reason: row.reason,
    score: row.score,
    output_dir: row.outputDir,
    video_url: rendido ? `/files/${rel}/video.mp4` : null,
    thumbnail_url: thumb,
    published_at: row.publishedAt?.toISOString() ?? null,
    youtube_id: row.youtubeId,
    metrics: row.metrics,
    incident: row.incident
      ? { message: row.incident.message, suggested_action: row.incident.suggested_action }
      : null,
    created_at: row.createdAt.toISOString(),
  };
}

export function registerShortRoutes(app: FastifyInstance, ctx: ApiContext): void {
  // Pide al director que proponga fragmentos. Idempotente por dedupeId: dos
  // clics seguidos no lanzan dos veces al LLM.
  app.post('/videos/:id/shorts', async (req) => {
    const { id } = req.params as { id: string };
    const [video] = await ctx.db.select().from(videos).where(eq(videos.id, id)).limit(1);
    if (!video) throw notFound(`Vídeo ${id} no existe`);
    if (video.state !== 'hecho') {
      throw conflict(`Los shorts se recortan de un vídeo terminado (estado actual: ${video.state})`);
    }
    // «proponer otros»: no vuelven ni las descartadas (con su motivo, la única
    // señal humana que el director puede aprender) ni las VIVAS — sin estas el
    // director podía re-proponer una ventana ya propuesta o aprobada, porque
    // force salta la guarda de idempotencia y toCandidatos solo desolapa
    // dentro de la misma tanda
    const previos = await ctx.db
      .select({
        fromMs: shorts.fromMs,
        toMs: shorts.toMs,
        state: shorts.state,
        discardReason: shorts.discardReason,
      })
      .from(shorts)
      .where(eq(shorts.videoId, id));
    const excluir = previos.map((s) =>
      s.state === 'descartado'
        ? {
            from_ms: s.fromMs,
            to_ms: s.toMs,
            ...(s.discardReason !== null ? { reason: s.discardReason } : {}),
          }
        : { from_ms: s.fromMs, to_ms: s.toMs, reason: 'ya propuesta o aprobada' },
    );
    const vivos = previos.filter((s) => s.state !== 'descartado').length;

    const res = await ctx.enqueuer.enqueue(
      QUEUES.shorts,
      JOBS.shorts.propose,
      { videoId: id, ...(excluir.length > 0 ? { excluir } : {}), ...(vivos === 0 ? {} : { force: true }) },
      { dedupeId: `shorts-${id}` },
    );
    return { ok: true as const, ya_en_curso: !res.enqueued };
  });

  app.get('/videos/:id/shorts', async (req): Promise<ShortsListDto> => {
    const { id } = req.params as { id: string };
    const rows = await ctx.db
      .select()
      .from(shorts)
      .where(eq(shorts.videoId, id))
      .orderBy(asc(shorts.idx));
    return { shorts: rows.map(toDto) };
  });

  // El detalle trae el maestro con las rutas de medio ya servibles, que es lo
  // que previsualiza el player del dashboard.
  app.get('/shorts/:id', async (req): Promise<ShortDetailDto> => {
    const { id } = req.params as { id: string };
    const row = await loadShort(ctx, id);
    return { ...toDto(row), master: masterWithFileUrls(row.master) };
  });

  // El título es contenido, no un corte: se puede cambiar mientras el short
  // siga siendo una propuesta.
  app.patch('/shorts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = shortTitleRequestSchema.parse(req.body);
    const row = await loadShort(ctx, id);
    if (row.state !== 'propuesto') {
      throw conflict(`El título solo se cambia mientras es una propuesta (estado: ${row.state})`);
    }
    // se escribe en la fila Y en el maestro congelado: el render pinta la
    // cartela desde el maestro, no desde la fila
    await ctx.db
      .update(shorts)
      .set({
        title: body.title,
        master: { ...row.master, short: { ...row.master.short, title: body.title } },
        updatedAt: new Date(),
      })
      .where(eq(shorts.id, id));
    return { ok: true as const, title: body.title };
  });

  app.post('/shorts/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    const row = await loadShort(ctx, id);
    // idempotente: si la transición hizo commit pero el encolado falló,
    // repetir la petición re-encola en vez de devolver conflicto
    if (row.state === 'aprobado') {
      await ctx.enqueuer.enqueue(
        QUEUES.render,
        JOBS.render.short,
        { shortId: id },
        { dedupeId: `short-${id}` },
      );
      return { ok: true as const };
    }
    await transitionShort(ctx.db, id, 'aprobado', { expectFrom: 'propuesto' });
    try {
      await ctx.enqueuer.enqueue(
        QUEUES.render,
        JOBS.render.short,
        { shortId: id },
        { dedupeId: `short-${id}` },
      );
    } catch (err) {
      // compensación: sin job, un short 'aprobado' se queda esperando para
      // siempre y el botón de aprobar ya no vuelve a aparecer
      await transitionShort(ctx.db, id, 'descartado').catch(() => {});
      throw err;
    }
    await ctx.events.publish({
      type: 'short_state',
      short_id: id,
      ...(row.videoId !== null ? { video_id: row.videoId } : {}),
      ...(row.episodeId !== null ? { episode_id: row.episodeId } : {}),
      state: 'aprobado',
    });
    return { ok: true as const };
  });

  app.post('/shorts/:id/discard', async (req) => {
    const { id } = req.params as { id: string };
    const body = shortDiscardRequestSchema.parse(req.body ?? {});
    const row = await loadShort(ctx, id);
    await transitionShort(ctx.db, id, 'descartado');
    if (body.reason !== undefined) {
      await ctx.db.update(shorts).set({ discardReason: body.reason }).where(eq(shorts.id, id));
    }
    await ctx.events.publish({
      type: 'short_state',
      short_id: id,
      ...(row.videoId !== null ? { video_id: row.videoId } : {}),
      ...(row.episodeId !== null ? { episode_id: row.episodeId } : {}),
      state: 'descartado',
    });
    return { ok: true as const };
  });

  app.post('/shorts/:id/retry', async (req) => {
    const { id } = req.params as { id: string };
    const row = await loadShort(ctx, id);
    if (row.state !== 'incidencia') {
      throw conflict(`Solo se reintenta un short en incidencia (estado: ${row.state})`);
    }
    await transitionShort(ctx.db, id, 'aprobado', { expectFrom: 'incidencia' });
    await ctx.enqueuer.enqueue(
      QUEUES.render,
      JOBS.render.short,
      { shortId: id },
      { dedupeId: `short-${id}` },
    );
    return { ok: true as const };
  });

  // Marcado manual, igual que en el vídeo largo: no toca la máquina de estados.
  // Con `url_or_id` además captura el id de YouTube, que es lo que convierte el
  // casado del CSV de Studio (pnpm metricas) en exacto en vez de por título.
  app.post('/shorts/:id/publicado', async (req) => {
    const { id } = req.params as { id: string };
    const body = shortPublicadoRequestSchema.parse(req.body ?? {});
    const row = await loadShort(ctx, id);
    if (row.state !== 'hecho') {
      throw conflict('Solo se marca como publicado un short terminado');
    }
    let youtubeId: string | null = null;
    if (body.url_or_id !== undefined) {
      youtubeId = extractYoutubeId(body.url_or_id);
      if (youtubeId === null) {
        throw badRequest('No parece un id ni una URL de YouTube');
      }
    }
    const publishedAt = row.publishedAt ?? new Date();
    await ctx.db
      .update(shorts)
      .set({ publishedAt, ...(youtubeId !== null ? { youtubeId } : {}), updatedAt: new Date() })
      .where(eq(shorts.id, id));
    return {
      ok: true as const,
      published_at: publishedAt.toISOString(),
      ...(youtubeId !== null ? { youtube_id: youtubeId } : {}),
    };
  });

  app.get('/shorts/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await loadShort(ctx, id);
    if (row.state !== 'hecho' || row.outputDir === null) {
      throw conflict('El short aún no está renderizado');
    }
    const file = path.join(row.outputDir, 'video.mp4');
    if (!fs.existsSync(file)) throw notFound('Falta el MP4 del short');
    const nombre = `${row.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'short'}.mp4`;
    return reply
      .header('content-type', 'video/mp4')
      .header('content-disposition', `attachment; filename="${nombre}"`)
      .send(fs.createReadStream(file));
  });
}
