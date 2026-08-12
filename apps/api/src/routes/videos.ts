import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { asc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { assets, beats, channels, markIncident, transitionVideo, videos } from '@fabrica/db';
import {
  JOBS,
  manualPublicationRequestSchema,
  QUEUES,
  scriptEditRequestSchema,
  titleChoiceRequestSchema,
  normalizaLocucion,
  wordInText,
  type MasterVideoJson,
  type QueueName,
  type ThumbnailBriefJob,
  type VideoDetailDto,
  type VideoState,
} from '@fabrica/shared';
import { beatRowToBeat, kindFromPath, type AssetFileInfo } from '../lib/beats.js';
import type { ApiContext } from '../lib/context.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { officialThumbnailUrl } from '../lib/files.js';
import { masterWithFileUrls } from '../lib/master.js';
import { markPublishedByHand, publishVideo } from './youtube.js';

type VideoRow = typeof videos.$inferSelect;

const THUMB_UPLOAD_EXTS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

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
          beats: rows.map((r) =>
            beatRowToBeat(r, r.assetId ? assetFiles.get(r.assetId) : undefined),
          ),
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
      thumbnail_url: await officialThumbnailUrl(ctx.outputsDir, id),
      youtube: video.youtube ?? null,
      metrics: video.metrics ?? null,
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
    let efectosCaidos = 0;
    const scenes = script.scenes.map((scene) => {
      const crudo = edits.get(scene.id);
      if (crudo === undefined || crudo === scene.text) return scene;
      // La misma normalización de locución que aplica el worker al escribir el
      // guion. Sin ella, editar a mano una escena que contenga «GPT-5.6»
      // reintroduce la forma que el sintetizador lee mal, y el arreglo dura
      // hasta la primera corrección humana.
      const text = normalizaLocucion(crudo);
      // Al reescribir la escena, las intenciones visuales que apuntaban a una
      // palabra que ya no está se caen: si se conservaran, el efecto se anclaría
      // en el sitio equivocado o se perdería en silencio durante el montaje.
      //
      // El disparador se normaliza ANTES de comprobar si sigue estando. Si no,
      // un «GPT-5.6» declarado dejaría de casar con el «GPT 5.6» normalizado y
      // el efecto se caería por un cambio que nadie pidió.
      const kept = (scene.edit_intents ?? [])
        .map((i) => ({ ...i, trigger_word: normalizaLocucion(i.trigger_word) }))
        .filter((i) => wordInText(text, i.trigger_word));
      efectosCaidos += (scene.edit_intents?.length ?? 0) - kept.length;
      const { edit_intents: _previas, ...resto } = scene;
      return {
        ...resto,
        text,
        edited_by_human: true,
        ...(kept.length > 0 ? { edit_intents: kept } : {}),
      };
    });

    await ctx.db
      .update(videos)
      .set({ master: { ...video.master, script: { ...script, scenes } }, updatedAt: new Date() })
      .where(eq(videos.id, id));
    return { ok: true as const };
  });

  // Editar la auto-edición: quitar efectos (callouts, punches, tarjetas, SFX)
  // durante la curación. master.edits es mutable hasta que ingest lo congela;
  // solo en estado 'assets' (los directores ya lo calcularon en el match).
  app.patch('/videos/:id/edits', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ remove: z.array(z.number().int().nonnegative()) }).parse(req.body);
    const video = await loadVideo(ctx, id);
    if (video.state !== 'assets') {
      throw conflict(
        `Los efectos solo se editan durante la curación (estado actual: ${video.state})`,
      );
    }
    const edits = video.master.edits ?? [];
    const remove = new Set(body.remove);
    const next = edits.filter((_, i) => !remove.has(i));
    await ctx.db
      .update(videos)
      .set({ master: { ...video.master, edits: next }, updatedAt: new Date() })
      .where(eq(videos.id, id));
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const, edits: next };
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
    // sin título elegido el vídeo cruza esta puerta y muere veinte minutos
    // después en el render (render/index.ts exige seo.chosen_idx), tras haber
    // gastado voz y assets. La puerta 2 es «elegir título Y firmar el guion»:
    // que falle aquí, gratis, y no al final
    if (video.master.seo?.chosen_idx == null) {
      throw conflict('Elige un título antes de firmar el guion: el render lo necesita');
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
      throw conflict(
        `La reescritura solo procede en guion_borrador (estado actual: ${video.state})`,
      );
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
    // el render se encola SIEMPRE con jobId determinista (la ingesta usa
    // `render-<id>`): sin replicarlo aquí, el cadáver del render fallido
    // bloqueaba el re-add en silencio y el retry devolvía ok sin hacer nada
    const dedupeFor = (queue: QueueName): { dedupeId: string } | undefined =>
      queue === QUEUES.render ? { dedupeId: `render-${id}` } : undefined;
    // La transición de arriba ya está COMMITEADA y borró la incidencia: si el
    // encolado falla ahora (Redis parpadea, el cadáver aún bloqueado), sin
    // compensación el vídeo quedaría en el estado destino SIN job y SIN botón
    // de reintentar — atascado hasta tocar la BD a mano. La compensación
    // restaura la incidencia original y deja el retry vivo.
    const originalIncident = video.incident;
    try {
      // si la incidencia registró el job exacto que falló, se re-encola tal
      // cual (una reescritura fallida no debe convertirse en un judge)
      const recorded = originalIncident?.job;
      if (recorded) {
        await ctx.enqueuer.enqueue(
          recorded.queue as QueueName,
          recorded.name,
          recorded.data ?? { videoId: id },
          dedupeFor(recorded.queue as QueueName),
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
        if (job) await ctx.enqueuer.enqueue(job.queue, job.job, job.payload, dedupeFor(job.queue));
      }
    } catch (err) {
      await markIncident(ctx.db, id, {
        message:
          originalIncident?.message !== undefined
            ? `${originalIncident.message} (el reintento no pudo encolarse; vuelve a intentarlo)`
            : 'El reintento no pudo encolarse; vuelve a intentarlo',
        suggested_action: originalIncident?.suggested_action ?? 'reintentar',
        ...(originalIncident?.queue !== undefined ? { queue: originalIncident.queue } : {}),
        ...(originalIncident?.job !== undefined ? { job: originalIncident.job } : {}),
      });
      throw err;
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

  // El humano lo subió por su cuenta y solo registra el resultado: mismo
  // criterio que /publish, no toca la máquina de estados ni encola nada.
  app.post('/videos/:id/mark-published', async (req) => {
    const { id } = req.params as { id: string };
    const body = manualPublicationRequestSchema.parse(req.body);
    return markPublishedByHand(ctx, id, body.url_or_id);
  });

  // Descarga del MP4 final como attachment. /files sirve inline (el player lo
  // necesita); esta ruta fuerza el diálogo de guardado del navegador.
  // loadVideo valida el id contra la BD antes de tocar el disco.
  app.get('/videos/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const video = await loadVideo(ctx, id);
    if (video.state !== 'hecho') throw conflict('El vídeo aún no está renderizado');
    const filePath = path.join(ctx.outputsDir, id, 'video.mp4');
    const info = await stat(filePath).catch(() => null);
    if (info === null || !info.isFile()) throw notFound(`No hay video.mp4 en outputs/${id}`);
    const slug = (video.titleChosen ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 80);
    return reply
      .header('content-type', 'video/mp4')
      .header('content-length', info.size)
      .header('content-disposition', `attachment; filename="${slug === '' ? id : slug}.mp4"`)
      .send(createReadStream(filePath));
  });

  // Abre la carpeta de entregables en el gestor de archivos del SISTEMA DONDE
  // CORRE LA API (en el MVP, la misma máquina que el navegador). En un VPS sin
  // entorno gráfico responde 409; el aviso del dashboard remite a la ruta en
  // disco, que sigue visible en la tarjeta.
  app.post('/videos/:id/reveal', async (req) => {
    const { id } = req.params as { id: string };
    await loadVideo(ctx, id);
    const dir = path.join(ctx.outputsDir, id);
    const info = await stat(dir).catch(() => null);
    if (info === null || !info.isDirectory()) throw notFound(`Aún no existe outputs/${id}`);
    const opener =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'explorer'
          : 'xdg-open';
    try {
      // sin timeout, un xdg-open mal cableado deja la petición colgada
      await promisify(execFile)(opener, [dir], { timeout: 5_000 });
    } catch {
      // explorer.exe sale con código 1 aunque abra la ventana (nodejs/node#14967)
      if (process.platform !== 'win32') {
        throw conflict('No se pudo abrir la carpeta en este sistema; usa la ruta mostrada');
      }
    }
    return { ok: true };
  });

  // Brief de miniatura de alta conversión: encola el job LLM que escribe
  // outputs/<id>/thumbnail-brief.json (descripción ES + prompt EN). El vídeo
  // debe estar renderizado (existe la carpeta de salida).
  app.post('/videos/:id/thumbnail-brief', async (req) => {
    const { id } = req.params as { id: string };
    const video = await loadVideo(ctx, id);
    if (video.state !== 'hecho') throw conflict('El vídeo aún no está renderizado');
    const payload: ThumbnailBriefJob = { videoId: id };
    await ctx.enqueuer.enqueue(QUEUES.script, JOBS.script.thumbnailBrief, payload);
    return { ok: true as const };
  });

  // Subida de la miniatura definitiva (la genera el humano a partir del brief).
  // Pasa a ser la miniatura OFICIAL: outputs/<id>/thumb_custom.<ext> — la usa la
  // subida a YouTube y se muestra en Entrega por delante de las auto-generadas.
  app.post('/videos/:id/thumbnail', async (req) => {
    const { id } = req.params as { id: string };
    const video = await loadVideo(ctx, id);
    if (video.state !== 'hecho') throw conflict('El vídeo aún no está renderizado');
    const dir = path.join(ctx.outputsDir, id);
    await mkdir(dir, { recursive: true });

    let saved: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const ext = THUMB_UPLOAD_EXTS[part.mimetype];
        if (ext === undefined) throw badRequest('La miniatura debe ser PNG, JPG o WebP');
        // una sola miniatura personalizada: se limpian las anteriores
        for (const e of await readdir(dir).catch(() => [])) {
          if (/^thumb_custom\.(png|jpg|jpeg|webp)$/i.test(e)) {
            await rm(path.join(dir, e), { force: true }).catch(() => {});
          }
        }
        saved = path.join(dir, `thumb_custom.${ext}`);
        await pipeline(part.file, createWriteStream(saved));
      }
    }
    if (saved === null) throw badRequest('Falta el archivo de imagen en el multipart');

    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const, thumbnail_url: `/files/outputs/${id}/${path.basename(saved)}` };
  });
}
