import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { markIncidentShort, shorts, transitionShort, videos } from '@fabrica/db';
import {
  analizarShort,
  cuesToSrt,
  cuesToVtt,
  QUEUES,
  renderableShortV1,
  type RenderableShort,
  type RenderShortJob,
} from '@fabrica/shared';
import { renderMedia, renderStill, selectComposition, ensureBrowser } from '@remotion/renderer';
import type { WorkerContext } from '../../lib/context.js';
import { env } from '../../lib/env.js';
import { ensureBundle } from './bundle.js';
import { ajustarLoudnessEntrega } from './loudness.js';
import { rewriteMasterMedia } from './media-rewrite.js';

// Render de un short aprobado. Vive en la cola `render` y no en la de shorts a
// propósito: esa cola tiene concurrency 1, y un short y un vídeo largo
// renderizando a la vez repartirían las vCPU entre dos Chromium.
//
// El bundle es el MISMO que el del largo: solo cambia el id que selecciona la
// composición.

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Descripción de publicación del short: gancho, hashtags y de dónde sale. */
function descripcionDe(short: RenderableShort, tituloLargo: string): string {
  const hashtags = short.seo?.tags
    .slice(0, 5)
    .map((t) => `#${t.replace(/[^\p{L}\p{N}]/gu, '')}`)
    .filter((t) => t.length > 1)
    .join(' ');
  return [short.short.hook, hashtags, `Vídeo completo: ${tituloLargo}`]
    .filter((p) => p !== undefined && p !== '')
    .join('\n\n');
}

async function writeShortOutputs(
  outDir: string,
  short: RenderableShort,
  tituloLargo: string,
): Promise<void> {
  await fsp.writeFile(path.join(outDir, 'title.txt'), `${short.short.title}\n`);
  await fsp.writeFile(
    path.join(outDir, 'description.txt'),
    `${descripcionDe(short, tituloLargo)}\n`,
  );
  await fsp.writeFile(path.join(outDir, 'tags.txt'), `${(short.seo?.tags ?? []).join('\n')}\n`);
  // offset 0: el short no antepone intro, a diferencia del vídeo largo
  await fsp.writeFile(path.join(outDir, 'subtitles.srt'), cuesToSrt(short.cues, 0));
  await fsp.writeFile(path.join(outDir, 'subtitles.vtt'), cuesToVtt(short.cues, 0));
  await fsp.writeFile(path.join(outDir, 'master.json'), JSON.stringify(short, null, 2));
}

export async function handleRenderShort(
  ctx: WorkerContext,
  job: Job<RenderShortJob>,
): Promise<void> {
  const { shortId } = job.data;
  const log = ctx.logger.child({ shortId, queue: QUEUES.render });

  const [short] = await ctx.db.select().from(shorts).where(eq(shorts.id, shortId)).limit(1);
  if (!short) throw new Error(`Short no encontrado: ${shortId}`);

  const parsed = renderableShortV1.safeParse(short.master);
  if (!parsed.success) {
    // fallo permanente: reintentar no lo va a arreglar
    const message = 'El maestro del short no está completo; vuelve a proponerlo';
    log.error({ issues: parsed.error.issues.slice(0, 5) }, message);
    await markIncidentShort(ctx.db, shortId, { message, suggested_action: 'regenerar' });
    await ctx.publishEvent({
      type: 'short_state',
      short_id: shortId,
      video_id: short.videoId,
      state: 'incidencia',
    });
    await ctx.publishEvent({
      type: 'incident',
      video_id: short.videoId,
      queue: QUEUES.render,
      message,
      suggested_action: 'regenerar',
    });
    return;
  }
  const master = parsed.data;

  // puerta idempotente, espejo de la del vídeo largo
  if (short.state === 'aprobado') {
    await transitionShort(ctx.db, shortId, 'render', { expectFrom: 'aprobado' });
    await ctx.publishEvent({
      type: 'short_state',
      short_id: shortId,
      video_id: short.videoId,
      state: 'render',
    });
  } else if (short.state === 'hecho') {
    log.info('El short ya está en hecho; render duplicado ignorado');
    return;
  } else if (short.state !== 'render') {
    throw new Error(`Estado inesperado para renderizar el short: ${short.state}`);
  }

  try {
    await ensureBrowser();
    const serveUrl = await ensureBundle(ctx);

    const filesBaseUrl = env('FILES_BASE_URL', `http://127.0.0.1:${env('API_PORT', '3001')}/files`);
    // sigue siendo obligatorio: OffthreadVideo solo carga http/https
    const inputProps = rewriteMasterMedia(master, {
      libraryDir: ctx.libraryDir,
      outputsDir: ctx.outputsDir,
      baseUrl: filesBaseUrl,
    });

    const composition = await selectComposition({ serveUrl, id: 'ShortForm', inputProps });
    const outDir = path.join(ctx.outputsDir, short.videoId, 'shorts', shortId);
    await fsp.mkdir(outDir, { recursive: true });

    let lastProgressAt = 0;
    log.info({ frames: composition.durationInFrames }, 'Comenzando el render del short');
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      crf: 18,
      audioCodec: 'aac',
      audioBitrate: '192k',
      pixelFormat: 'yuv420p',
      concurrency: Number(env('RENDER_CONCURRENCY', '4')),
      inputProps,
      outputLocation: path.join(outDir, 'video.mp4'),
      onProgress: ({ progress, renderedFrames }) => {
        const now = Date.now();
        if (progress < 1 && now - lastProgressAt < 2_000) return;
        lastProgressAt = now;
        void ctx.publishEvent({
          type: 'render_progress',
          video_id: short.videoId,
          // con el id aparte, la bandeja no enciende la barra del vídeo largo
          short_id: shortId,
          progress: Math.round(progress * 100),
          rendered_frames: renderedFrames,
          total_frames: composition.durationInFrames,
        });
      },
    });

    await ajustarLoudnessEntrega(path.join(outDir, 'video.mp4'), log);

    // Portada: un fotograma REAL del short, sin componente aparte. Al 10 % de
    // la pieza: con el 15 % caía TRES frames después de que la cartela se
    // retirara (se va en el 97 y el frame salía el 100), así que la portada se
    // quedaba sin titular.
    await renderStill({
      composition,
      serveUrl,
      frame: Math.round(composition.durationInFrames * 0.1),
      output: path.join(outDir, 'thumb.jpg'),
      imageFormat: 'jpeg',
      jpegQuality: 90,
      inputProps,
    });

    const [videoRow] = await ctx.db
      .select({ titleChosen: videos.titleChosen })
      .from(videos)
      .where(eq(videos.id, short.videoId))
      .limit(1);
    await writeShortOutputs(outDir, master, videoRow?.titleChosen ?? short.title);

    await ctx.db
      .update(shorts)
      .set({ outputDir: outDir, updatedAt: new Date() })
      .where(eq(shorts.id, shortId));
    await transitionShort(ctx.db, shortId, 'hecho', { expectFrom: 'render' });
    await ctx.publishEvent({
      type: 'render_progress',
      video_id: short.videoId,
      short_id: shortId,
      progress: 100,
      rendered_frames: composition.durationInFrames,
      total_frames: composition.durationInFrames,
    });
    await ctx.publishEvent({
      type: 'short_state',
      short_id: shortId,
      video_id: short.videoId,
      state: 'hecho',
    });
    await ctx.publishEvent({ type: 'inbox_changed' });
    // Puerta de calidad: espejo de la del largo (render/index.ts), con los
    // umbrales del formato. Avisa en el log de la entrega, no bloquea: el
    // short está entregado y el humano decide si el aviso pesa.
    try {
      const m = analizarShort(master);
      if (m.avisos.length > 0) {
        log.warn(
          { avisos: m.avisos.map((a) => `${a.gravedad}: ${a.detalle}`) },
          `Calidad: ${m.avisos.length} aviso(s) sobre el short terminado`,
        );
      } else {
        log.info({ planos: m.planos, cadencia: m.cadencia_planos_min }, 'Calidad: sin avisos');
      }
    } catch (err) {
      log.warn({ err }, 'No se pudo calcular el informe de calidad; el short está entregado');
    }
    log.info({ outDir }, 'Short renderizado');
  } catch (err) {
    const message = `Fallo en el render del short: ${errorMessage(err)}`;
    log.error({ err }, message);
    const ultimoIntento = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (ultimoIntento) {
      await markIncidentShort(ctx.db, shortId, {
        message: message.slice(0, 500),
        suggested_action: 'reintentar',
        queue: QUEUES.render,
      });
      await ctx.publishEvent({
        type: 'short_state',
        short_id: shortId,
        video_id: short.videoId,
        state: 'incidencia',
      });
      await ctx.publishEvent({
        type: 'incident',
        video_id: short.videoId,
        queue: QUEUES.render,
        message: message.slice(0, 500),
        suggested_action: 'reintentar',
      });
    }
    throw err;
  }
}
