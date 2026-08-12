import fs from 'node:fs';
import path from 'node:path';
import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { episodes, markIncidentEpisode, transitionEpisode } from '@fabrica/db';
import { JOBS, QUEUES, type MediaDownloadJob, type MediaTranscribeJob } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { closeCost, failCost, openCost } from '../../lib/ledger.js';
import { createMedia, EPISODE_MAX_S } from '../../providers/media.js';

// Worker de episodios externos (clipping). Fase B1: solo la descarga; la
// transcripción (B2) registra su job pero de momento avisa y no hace nada,
// para que un encolado accidental no muera en «job desconocido».
//
// Idempotencia contra DISCO además de contra el estado: si el mp4 y el wav
// existen y el probe da bien, re-ejecutar el job no re-descarga (el patrón de
// los jobs de assets).

function episodeDir(ctx: WorkerContext, episodeId: string): string {
  return path.join(ctx.libraryDir, 'episodes', episodeId);
}

async function handleDownload(ctx: WorkerContext, job: Job<MediaDownloadJob>): Promise<void> {
  const { episodeId } = job.data;
  const log = ctx.logger.child({ episodeId, queue: QUEUES.media });
  const media = createMedia(log);

  const [ep] = await ctx.db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1);
  if (!ep) throw new Error(`Episodio no encontrado: ${episodeId}`);
  if (ep.state !== 'nuevo' && ep.state !== 'descargando') {
    log.info({ state: ep.state }, 'El episodio no está pendiente de descarga; job ignorado');
    return;
  }

  // idempotencia contra disco: descarga anterior completa → saltar al estado
  const dir = episodeDir(ctx, episodeId);
  if (
    ep.mediaPath !== null &&
    ep.audioPath !== null &&
    fs.existsSync(ep.mediaPath) &&
    fs.existsSync(ep.audioPath)
  ) {
    log.info('El mp4 y el wav ya existen; no se re-descarga');
    if (ep.state === 'descargando') {
      await transitionEpisode(ctx.db, episodeId, 'transcribiendo');
      await ctx.publishEvent({ type: 'episode_state', episode_id: episodeId, state: 'transcribiendo' });
    }
    return;
  }

  if (ep.state === 'nuevo') {
    await transitionEpisode(ctx.db, episodeId, 'descargando', { expectFrom: 'nuevo' });
    await ctx.publishEvent({ type: 'episode_state', episode_id: episodeId, state: 'descargando' });
  }

  try {
    // paso 1: metadatos. Validan ANTES de mover un byte.
    const meta = await media.probe(ep.sourceUrl);
    if (meta.isLive) {
      throw new Error('Es un directo en emisión: el pipeline trabaja con el VOD');
    }
    if (meta.durationS > EPISODE_MAX_S) {
      throw new Error(
        `Dura ${Math.round(meta.durationS / 60)} min y el tope son 4 h; no es material de clips`,
      );
    }

    // paso 2: el fichero, con el gasto apuntado (unidades = MB, coste 0)
    const handle = await openCost(ctx.db, {
      episodeId,
      channelId: ep.channelId,
      provider: 'yt-dlp',
      operation: 'download',
      meta: { url: ep.sourceUrl },
    });
    let resultado;
    try {
      resultado = await media.download(ep.sourceUrl, dir);
      await closeCost(ctx.db, handle, {
        units: Math.round(resultado.bytes / 1_000_000),
        unitCost: 0,
      });
    } catch (err) {
      await failCost(ctx.db, handle, err instanceof Error ? err.message : String(err));
      throw err;
    }

    await ctx.db
      .update(episodes)
      .set({
        sourceVideoId: meta.sourceVideoId,
        sourceTitle: meta.title,
        sourceChannelName: meta.channelName,
        sourceChannelUrl: meta.channelUrl,
        sourcePublishedAt: meta.publishedAt,
        durationMs: Math.round(meta.durationS * 1000),
        width: resultado.width,
        height: resultado.height,
        mediaPath: resultado.mediaPath,
        audioPath: resultado.audioPath,
        downloadedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episodeId));
    await transitionEpisode(ctx.db, episodeId, 'transcribiendo', { expectFrom: 'descargando' });
    await ctx.publishEvent({ type: 'episode_state', episode_id: episodeId, state: 'transcribiendo' });
    await ctx.publishEvent({ type: 'inbox_changed' });
    log.info(
      { mb: Math.round(resultado.bytes / 1_000_000), titulo: meta.title },
      'Episodio descargado',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // en el último intento la incidencia queda en la fila con acción sugerida
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      await markIncidentEpisode(ctx.db, episodeId, {
        message: `Fallo en la descarga: ${message}`,
        suggested_action: 'reintentar',
        job: { queue: QUEUES.media, name: JOBS.media.download, data: { episodeId } },
      });
      await ctx.publishEvent({
        type: 'incident',
        episode_id: episodeId,
        queue: QUEUES.media,
        message,
        suggested_action: 'reintentar',
      });
    }
    throw err;
  }
}

export async function registerMediaWorkers(ctx: WorkerContext): Promise<Worker[]> {
  const worker = new Worker(
    QUEUES.media,
    async (job) => {
      if (job.name === JOBS.media.download) {
        await handleDownload(ctx, job as Job<MediaDownloadJob>);
        return;
      }
      if (job.name === JOBS.media.transcribe) {
        // B2: transcripción + beats. Registrado para que un encolado temprano
        // no muera en «job desconocido»; de momento solo avisa.
        const { episodeId } = (job as Job<MediaTranscribeJob>).data;
        ctx.logger.warn({ episodeId }, 'transcribe aún no implementado (fase B2)');
        return;
      }
      ctx.logger.warn({ job: job.name }, 'Job desconocido en la cola de media');
    },
    // concurrency 1: una descarga de GB no debe competir consigo misma
    { connection: ctx.connection, concurrency: 1 },
  );
  return [worker];
}
