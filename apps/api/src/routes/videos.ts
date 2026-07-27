import type { FastifyInstance } from 'fastify';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { assets, beats, channels, transitionVideo, videos } from '@fabrica/db';
import {
  JOBS,
  QUEUES,
  scriptEditRequestSchema,
  titleChoiceRequestSchema,
  type MasterVideoJson,
  type QueueName,
  type VideoDetailDto,
  type VideoState,
} from '@fabrica/shared';
import { beatRowToBeat, kindFromPath, type AssetFileInfo } from '../lib/beats.js';
import type { ApiContext } from '../lib/context.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { masterWithFileUrls } from '../lib/master.js';
import { publishVideo } from './youtube.js';

type VideoRow = typeof videos.$inferSelect;

async function loadVideo(ctx: ApiContext, id: string): Promise<VideoRow> {
  const [row] = await ctx.db.select().from(videos).where(eq(videos.id, id)).limit(1);
  if (!row) throw notFound(`Vídeo ${id} no existe`);
  return row;
}

export async function loadAssetFiles(
  ctx: ApiContext,
  assetIds: string[],
): Promise<Map<string, AssetFileInfo>> {
  const map = new Map<string, AssetFileInfo>();
  if (!assetIds.length) return map;
  const rows = await ctx.db
    .select({ id: assets.id, path: assets.path })
    .from(assets)
    .where(inArray(assets.id, assetIds));
  for (const row of rows) map.set(row.id, { path: row.path, kind: kindFromPath(row.path) });
  return map;
}

const rewriteBodySchema = z.object({ reason: z.string().min(1) });

// Job de la etapa que arranca DESDE cada estado, para reintentos tras incidencia.
function retryJob(
  state: VideoState,
  videoId: string,
  master: MasterVideoJson,
  opts: { packagingFirst: boolean },
): { queue: QueueName; job: string; payload: unknown } | null {
  switch (state) {
    case 'idea_aprobada':
      // con packaging_first el retry debe repetir el modo packaging
      // (`packagingOnly` es la extensión local del payload; ver routes/ideas.ts)
      return {
        queue: QUEUES.script,
        job: JOBS.script.generate,
        payload: { videoId, ...(opts.packagingFirst ? { packagingOnly: true } : {}) },
      };
    case 'guion_borrador':
      // packaging: seo sin guion → con título elegido se reencarga el guion;
      // sin título, se repite el packaging (el juez no tendría qué comparar)
      if (!master.script && master.seo) {
        return {
          queue: QUEUES.script,
          job: JOBS.script.generate,
          payload: {
            videoId,
            ...(master.seo.chosen_idx == null ? { packagingOnly: true } : {}),
          },
        };
      }
      // si ya hay título elegido la incidencia vino del juez; si no, del generador
      return master.seo?.chosen_idx != null
        ? { queue: QUEUES.script, job: JOBS.script.judge, payload: { videoId } }
        : { queue: QUEUES.script, job: JOBS.script.generate, payload: { videoId } };
    case 'guion_ok':
      return { queue: QUEUES.tts, job: JOBS.tts.synthesize, payload: { videoId } };
    case 'audio':
    case 'assets':
      return { queue: QUEUES.assets, job: JOBS.assets.match, payload: { videoId } };
    case 'timeline_ok':
      return { queue: QUEUES.assets, job: JOBS.assets.ingest, payload: { videoId } };
    case 'render':
      return { queue: QUEUES.render, job: JOBS.render.video, payload: { videoId } };
    default:
      return null;
  }
}

export function registerVideoRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/videos/:id', async (req): Promise<VideoDetailDto> => {
    const { id } = req.params as { id: string };
    const video = await loadVideo(ctx, id);

    // fusión de beats: master.beats solo existe tras assets.ingest (congelado);
    // durante la curación la fuente de verdad es la tabla beats
    let master = video.master;
    if (!master.beats?.length) {
      const rows = await ctx.db
        .select()
        .from(beats)
        .where(eq(beats.videoId, id))
        .orderBy(asc(beats.idx));
      if (rows.length) {
        const assetFiles = await loadAssetFiles(
          ctx,
          rows.flatMap((r) => (r.assetId ? [r.assetId] : [])),
        );
        master = {
          ...master,
          beats: rows.map((r) => beatRowToBeat(r, r.assetId ? assetFiles.get(r.assetId) : undefined)),
        };
      }
    }

    return {
      id: video.id,
      channel_id: video.channelId,
      state: video.state as VideoState,
      title_chosen: video.titleChosen ?? null,
      master: masterWithFileUrls(master),
      costs_total: video.costsTotal,
      youtube: video.youtube ?? null,
      incident: video.incident
        ? { message: video.incident.message, suggested_action: video.incident.suggested_action }
        : null,
      created_at: video.createdAt.toISOString(),
      updated_at: video.updatedAt.toISOString(),
    };
  });

  app.put('/videos/:id/script', async (req) => {
    const { id } = req.params as { id: string };
    const body = scriptEditRequestSchema.parse(req.body);
    const video = await loadVideo(ctx, id);
    if (video.state !== 'guion_borrador') {
      throw conflict(`El guion solo se edita en guion_borrador (estado actual: ${video.state})`);
    }
    const script = video.master.script;
    if (!script) throw conflict('El vídeo aún no tiene guion');

    const known = new Set(script.scenes.map((s) => s.id));
    for (const edit of body.scenes) {
      if (!known.has(edit.id)) throw badRequest(`Escena desconocida: ${edit.id}`);
    }
    const edits = new Map(body.scenes.map((s) => [s.id, s.text]));
    const scenes = script.scenes.map((scene) => {
      const text = edits.get(scene.id);
      if (text === undefined || text === scene.text) return scene;
      return { ...scene, text, edited_by_human: true };
    });

    await ctx.db
      .update(videos)
      .set({ master: { ...video.master, script: { ...script, scenes } }, updatedAt: new Date() })
      .where(eq(videos.id, id));
    return { ok: true as const };
  });

  app.post('/videos/:id/title', async (req) => {
    const { id } = req.params as { id: string };
    const body = titleChoiceRequestSchema.parse(req.body);
    const video = await loadVideo(ctx, id);
    if (video.state !== 'guion_borrador') {
      throw conflict(`El título se elige en guion_borrador (estado actual: ${video.state})`);
    }
    const seo = video.master.seo;
    if (!seo) throw conflict('El vídeo aún no tiene paquete SEO');
    const title = seo.titles[body.chosen_idx];
    if (!title) throw badRequest(`No existe el título ${body.chosen_idx}`);

    await ctx.db
      .update(videos)
      .set({
        titleChosen: title,
        master: { ...video.master, seo: { ...seo, chosen_idx: body.chosen_idx } },
        updatedAt: new Date(),
      })
      .where(eq(videos.id, id));

    // sin guion todavía (packaging_first) el juez no tiene nada que comparar:
    // se encolará al terminar write-script, desde el propio worker de guion
    if (video.master.script) {
      await ctx.enqueuer.enqueue(QUEUES.script, JOBS.script.judge, { videoId: id });
    }
    return { ok: true as const };
  });

  // packaging_first: con el título confirmado, encarga el guion "para cumplir
  // la promesa" (script.generate normal conserva el seo elegido y encola al juez)
  app.post('/videos/:id/write-script', async (req) => {
    const { id } = req.params as { id: string };
    const video = await loadVideo(ctx, id);
    if (video.state !== 'guion_borrador') {
      throw conflict(`El guion se encarga en guion_borrador (estado actual: ${video.state})`);
    }
    if (video.master.script) {
      throw conflict('El vídeo ya tiene guion; usa la reescritura si quieres otro borrador');
    }
    const seo = video.master.seo;
    if (!seo) throw conflict('El vídeo aún no tiene paquete de packaging');
    if (seo.chosen_idx === null) {
      throw conflict('Elige un título antes de encargar el guion');
    }
    await ctx.enqueuer.enqueue(QUEUES.script, JOBS.script.generate, { videoId: id });
    return { ok: true as const };
  });

  app.post('/videos/:id/approve-script', async (req) => {
    const { id } = req.params as { id: string };
    const video = await loadVideo(ctx, id);
    // puerta idempotente: si la transición hizo commit pero el encolado
    // falló, repetir la petición re-encola en vez de devolver conflicto
    if (video.state === 'guion_ok') {
      await ctx.enqueuer.enqueue(QUEUES.tts, JOBS.tts.synthesize, { videoId: id });
      return { ok: true as const };
    }
    // en fase de packaging aún no hay guion: aprobar sin guion encallaría el
    // vídeo en guion_ok con una síntesis imposible
    if (!video.master.script) {
      throw conflict('El vídeo aún no tiene guion; confirma el título y encarga el guion');
    }
    await transitionVideo(ctx.db, id, 'guion_ok', { expectFrom: 'guion_borrador' });
    await ctx.enqueuer.enqueue(QUEUES.tts, JOBS.tts.synthesize, { videoId: id });
    await ctx.events.publish({ type: 'video_state', video_id: id, state: 'guion_ok' });
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const };
  });

  app.post('/videos/:id/rewrite', async (req) => {
    const { id } = req.params as { id: string };
    const body = rewriteBodySchema.parse(req.body);
    const video = await loadVideo(ctx, id);
    if (video.state !== 'guion_borrador') {
      throw conflict(`La reescritura solo procede en guion_borrador (estado actual: ${video.state})`);
    }
    // en fase de packaging no hay guion que reescribir: una reescritura aquí
    // saltaría la puerta del título y regeneraría el seo elegido
    if (!video.master.script) {
      throw conflict('El vídeo aún no tiene guion; confirma el título y encarga el guion');
    }
    await ctx.enqueuer.enqueue(QUEUES.script, JOBS.script.generate, {
      videoId: id,
      rewriteReason: body.reason,
    });
    return { ok: true as const };
  });

  app.post('/videos/:id/retry', async (req) => {
    const { id } = req.params as { id: string };
    const video = await loadVideo(ctx, id);
    if (video.state !== 'incidencia') {
      throw conflict(`Solo se reintenta desde incidencia (estado actual: ${video.state})`);
    }
    const target = video.stateBeforeIncident as VideoState | null;
    if (!target) throw conflict('La incidencia no registra estado previo');

    await transitionVideo(ctx.db, id, target, { expectFrom: 'incidencia' });
    // si la incidencia registró el job exacto que falló, se re-encola tal
    // cual (una reescritura fallida no debe convertirse en un judge)
    const recorded = video.incident?.job;
    if (recorded) {
      await ctx.enqueuer.enqueue(
        recorded.queue as QueueName,
        recorded.name,
        recorded.data ?? { videoId: id },
      );
    } else {
      const [channel] = await ctx.db
        .select({ profile: channels.profile })
        .from(channels)
        .where(eq(channels.id, video.channelId))
        .limit(1);
      const job = retryJob(target, id, video.master, {
        packagingFirst: channel?.profile?.flags.packaging_first === true,
      });
      if (job) await ctx.enqueuer.enqueue(job.queue, job.job, job.payload);
    }

    await ctx.events.publish({ type: 'video_state', video_id: id, state: target });
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const };
  });

  // S3: aprobación humana de la subida a YouTube en privado desde la bandeja.
  // No toca la máquina de estados (hecho es terminal); el estado de la subida
  // vive en videos.youtube. La lógica es del módulo de publicación.
  app.post('/videos/:id/publish', async (req) => {
    const { id } = req.params as { id: string };
    return publishVideo(ctx, id);
  });
}
