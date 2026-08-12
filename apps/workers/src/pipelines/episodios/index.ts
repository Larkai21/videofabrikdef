import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { episodes, markIncidentEpisode, transitionEpisode } from '@fabrica/db';
import {
  JOBS,
  PRICES,
  QUEUES,
  type MediaDownloadJob,
  type MediaTranscribeJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { closeCost, failCost, openCost } from '../../lib/ledger.js';
import { createMedia, EPISODE_MAX_S } from '../../providers/media.js';
import { createStt } from '../../providers/stt.js';
import { probeDurationMs } from '../tts/audio.js';
import { computeBeats, type BeatToken } from '../tts/beats.js';
import { aTokens, cruzarConPausas, spansDePausas } from './tokens.js';

const ejec = promisify(execFile);

/** Bloques de ~10 min: el endpoint de whisper admite 25 MB por fichero. */
const BLOQUE_S = 600;

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
      await ctx.queues.media.add(JOBS.media.transcribe, {
        episodeId,
      } satisfies MediaTranscribeJob);
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
    // encadena la transcripción: el estado ya está en Postgres, la cola solo
    // transporta el trabajo
    await ctx.queues.media.add(JOBS.media.transcribe, { episodeId } satisfies MediaTranscribeJob);
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

// exportado como costura: los runners de validación lo llaman directo con un
// Job stub, sin competir con el worker vivo por la cola
export async function handleTranscribe(
  ctx: WorkerContext,
  job: Job<MediaTranscribeJob>,
): Promise<void> {
  const { episodeId } = job.data;
  const log = ctx.logger.child({ episodeId, queue: QUEUES.media });

  const [ep] = await ctx.db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1);
  if (!ep) throw new Error(`Episodio no encontrado: ${episodeId}`);
  if (ep.state !== 'transcribiendo') {
    log.info({ state: ep.state }, 'El episodio no está pendiente de transcribir; job ignorado');
    return;
  }
  if (ep.audioPath === null || !fs.existsSync(ep.audioPath)) {
    throw new Error('Falta el wav del episodio; reintenta desde la descarga');
  }

  const dir = episodeDir(ctx, episodeId);
  const transcriptPath = path.join(dir, 'transcript.json');
  // idempotencia contra disco: transcripción anterior completa → solo avanzar
  if (ep.transcriptPath !== null && fs.existsSync(ep.transcriptPath) && ep.beats !== null) {
    log.info('El transcript y los beats ya existen; no se re-transcribe');
    await transitionEpisode(ctx.db, episodeId, 'listo', { expectFrom: 'transcribiendo' });
    await ctx.publishEvent({ type: 'episode_state', episode_id: episodeId, state: 'listo' });
    return;
  }

  try {
    const stt = createStt(log);
    const durS = (await probeDurationMs(ep.audioPath)) / 1000;
    const bloques = Math.max(1, Math.ceil(durS / BLOQUE_S));
    const tokens: BeatToken[] = [];
    let prompt = '';
    for (let b = 0; b < bloques; b += 1) {
      const desde = b * BLOQUE_S;
      const durBloque = Math.min(BLOQUE_S, durS - desde);
      const bloqueWav = path.join(dir, `bloque-${b}.wav`);
      // corte por copia: utilidad de ingesta, el cuerpo sigue siendo Remotion
      await ejec('ffmpeg', [
        '-nostdin',
        '-loglevel',
        'error',
        '-ss',
        desde.toFixed(2),
        '-i',
        ep.audioPath,
        '-t',
        durBloque.toFixed(2),
        '-c',
        'copy',
        '-y',
        bloqueWav,
      ]);
      const handle = await openCost(ctx.db, {
        episodeId,
        channelId: ep.channelId,
        provider: 'openai',
        operation: 'stt',
        meta: { model: 'whisper-1', bloque: b },
      });
      try {
        const r = await stt.transcribe(bloqueWav, { lang: 'es', ...(prompt !== '' ? { prompt } : {}) });
        await closeCost(ctx.db, handle, {
          units: Number((durBloque / 60).toFixed(2)),
          unitCost: stt.name === 'whisper' ? PRICES.openai.stt_per_minute : 0,
        });
        tokens.push(...aTokens(r, desde * 1000));
        // encadenado: la cola del bloque anterior orienta el estilo del sig.
        prompt = r.text.slice(-200);
      } catch (err) {
        await failCost(ctx.db, handle, err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        fs.rmSync(bloqueWav, { force: true });
      }
      log.info({ bloque: b + 1, bloques }, 'Bloque transcrito');
    }
    if (tokens.length === 0) throw new Error('El STT no devolvió ninguna palabra');

    const totalMs = Math.round(durS * 1000);
    // el cruce puntuación×pausa es la señal del principio 1; el gate se
    // estampa para poder auditarlo (mismo cálculo que pnpm probar:stt)
    const gate = cruzarConPausas(tokens);
    const spans = spansDePausas(tokens, totalMs);
    const beats = await computeBeats(tokens, spans, totalMs, (texts) =>
      ctx.embeddings.embed(texts),
    );

    fs.writeFileSync(transcriptPath, JSON.stringify({ tokens }, null, 1));
    await ctx.db
      .update(episodes)
      .set({
        transcriptPath,
        beats: beats.map((b) => ({
          idx: b.idx,
          from_ms: b.from_ms,
          to_ms: b.to_ms,
          text: b.text,
        })),
        sttMeta: {
          provider: stt.name,
          model: stt.name === 'whisper' ? 'whisper-1' : 'mock',
          bloques,
          gate,
          palabras: tokens.length,
        },
        transcribedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episodeId));
    await transitionEpisode(ctx.db, episodeId, 'listo', { expectFrom: 'transcribiendo' });
    await ctx.publishEvent({ type: 'episode_state', episode_id: episodeId, state: 'listo' });
    await ctx.publishEvent({ type: 'inbox_changed' });
    log.info(
      { palabras: tokens.length, beats: beats.length, gate: gate.pct_confirmadas.toFixed(0) },
      'Episodio transcrito y troceado en beats',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      await markIncidentEpisode(ctx.db, episodeId, {
        message: `Fallo en la transcripción: ${message}`,
        suggested_action: 'reintentar',
        job: { queue: QUEUES.media, name: JOBS.media.transcribe, data: { episodeId } },
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
        await handleTranscribe(ctx, job as Job<MediaTranscribeJob>);
        return;
      }
      ctx.logger.warn({ job: job.name }, 'Job desconocido en la cola de media');
    },
    // concurrency 1: una descarga de GB no debe competir consigo misma
    { connection: ctx.connection, concurrency: 1 },
  );
  return [worker];
}
