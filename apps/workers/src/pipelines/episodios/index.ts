import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Worker, type Job } from 'bullmq';
import { and, eq, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { channels, episodes, markIncidentEpisode, shorts, transitionEpisode } from '@fabrica/db';
import {
  JOBS,
  PRICES,
  QUEUES,
  type HighlightsProposeJob,
  type MediaDownloadJob,
  type MediaTranscribeJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { closeCost, failCost, openCost } from '../../lib/ledger.js';
import { createMedia, EPISODE_MAX_S } from '../../providers/media.js';
import { createStt } from '../../providers/stt.js';
import { loudnormToWav, measureLufs, probeDurationMs } from '../tts/audio.js';
import { computeBeats, type BeatToken } from '../tts/beats.js';
import { montarMaestroClip } from './clip.js';
import { directHighlights } from './highlights.js';
import { detectarSilencios } from './silencios.js';
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
    // el cruce puntuación×pausa es la señal del principio 1. Los silencios se
    // miden en el AUDIO (silencedetect): Whisper alarga la última palabra de
    // cada frase y por sus tiempos casi no hay huecos (trampa del hermano).
    const silencios = await detectarSilencios(ep.audioPath);
    const gate = cruzarConPausas(tokens, { silencios });
    const spans = spansDePausas(tokens, totalMs, silencios);
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
          model:
            stt.name === 'whisper'
              ? 'whisper-1'
              : stt.name === 'mlx'
                ? (process.env.STT_MLX_MODEL ?? 'turbo')
                : 'mock',
          bloques,
          gate,
          silencios: silencios.length,
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

export interface TramoEncuadre {
  from_ms: number;
  to_ms: number;
  x: number | null;
}

/**
 * Plan de encuadre por PLANO: cambios de plano (scene detection) + cara más
 * grande de cada uno (Vision de macOS, sidecar encuadre-clip.py). Se degrada
 * a un único tramo sin cara —el foco global del humano— si el sidecar falla:
 * el clip sale igual, solo peor encuadrado, y el plan lo delata.
 */
async function planDeEncuadre(
  mediaPath: string,
  fromMs: number,
  toMs: number,
  log: { warn: (o: unknown, m: string) => void },
): Promise<TramoEncuadre[]> {
  const python = process.env.STT_MLX_PYTHON ?? 'python3.12';
  const script = new URL('../../../scripts/encuadre-clip.py', import.meta.url).pathname;
  try {
    const r = await ejec(
      python,
      [
        script,
        '--input',
        mediaPath,
        '--from',
        (fromMs / 1000).toFixed(3),
        '--to',
        (toMs / 1000).toFixed(3),
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const plan = (JSON.parse(r.stdout) as { tramos: TramoEncuadre[] }).tramos;
    if (plan.length > 0) return plan;
  } catch (err) {
    log.warn({ err }, 'El plan de encuadre por plano falló; foco global');
  }
  return [{ from_ms: 0, to_ms: toMs - fromMs, x: null }];
}

/**
 * Pre-corta el segmento del episodio: ffmpeg como utilidad de ingesta
 * (precedente reducirA1080). El clip queda YA en 1080×1920 con el encuadre
 * POR PLANO horneado — un foco fijo encuadraba al único que no hablaba
 * (medido en el primer clip real); el salto de x cae exactamente en el corte
 * de realización, así que no se ve como movimiento sino como cambio de plano.
 */
async function precortarClip(params: {
  mediaPath: string;
  fromMs: number;
  toMs: number;
  focusX: number;
  width: number;
  height: number;
  destDir: string;
  plan: TramoEncuadre[];
}): Promise<{ clipVideoPath: string; clipAudioPath: string; lufs: number }> {
  const { mediaPath, fromMs, toMs, focusX, width, height, destDir, plan } = params;
  fs.mkdirSync(destDir, { recursive: true });
  const durS = ((toMs - fromMs) / 1000).toFixed(3);
  const desdeS = (fromMs / 1000).toFixed(3);
  const cropW = Math.round((height * 9) / 16);
  const xPx = (fx: number): number =>
    Math.min(width - cropW, Math.max(0, Math.round(width * fx - cropW / 2)));

  // cada tramo con su x (histéresis de 0,08: un salto que no se aprecia no
  // merece re-encuadre) y concat sin re-codificar — mismos parámetros
  const partes: string[] = [];
  let xPrev = focusX;
  for (const [i, t] of plan.entries()) {
    let fx = t.x ?? xPrev;
    if (Math.abs(fx - xPrev) < 0.08) fx = xPrev;
    xPrev = fx;
    const parte = path.join(destDir, `.parte-${i}.mp4`);
    await ejec('ffmpeg', [
      '-nostdin',
      '-loglevel',
      'error',
      '-ss',
      ((fromMs + t.from_ms) / 1000).toFixed(3),
      '-i',
      mediaPath,
      '-t',
      ((t.to_ms - t.from_ms) / 1000).toFixed(3),
      '-vf',
      `crop=${cropW}:${height}:${xPx(fx)}:0,scale=1080:1920,fps=30`,
      '-c:v',
      'libx264',
      '-crf',
      '18',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-y',
      parte,
    ]);
    partes.push(parte);
  }
  const lista = path.join(destDir, '.partes.txt');
  fs.writeFileSync(lista, partes.map((p) => `file '${p}'`).join('\n'));
  const clipVideoPath = path.join(destDir, 'clip.mp4');
  await ejec('ffmpeg', [
    '-nostdin',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    lista,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    '-y',
    clipVideoPath,
  ]);
  for (const p of partes) fs.rmSync(p, { force: true });
  fs.rmSync(lista, { force: true });
  // la voz del clip, normalizada a la referencia del repo (−16 LUFS) como la
  // del TTS; la entrega sube a −14 en el render, igual que siempre
  const crudo = path.join(destDir, '.voz-cruda.wav');
  await ejec('ffmpeg', [
    '-nostdin',
    '-loglevel',
    'error',
    '-ss',
    desdeS,
    '-i',
    mediaPath,
    '-t',
    durS,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '44100',
    '-y',
    crudo,
  ]);
  const clipAudioPath = path.join(destDir, 'voz.wav');
  await loudnormToWav(crudo, clipAudioPath);
  fs.rmSync(crudo, { force: true });
  const lufs = (await measureLufs(clipAudioPath)) ?? -16;
  return { clipVideoPath, clipAudioPath, lufs };
}

export async function handleProposeHighlights(
  ctx: WorkerContext,
  job: Job<HighlightsProposeJob>,
): Promise<void> {
  const { episodeId, excluir, force } = job.data;
  const log = ctx.logger.child({ episodeId, queue: QUEUES.highlights });

  const [ep] = await ctx.db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1);
  if (!ep) throw new Error(`Episodio no encontrado: ${episodeId}`);
  if (ep.state !== 'listo') {
    log.info({ state: ep.state }, 'Los clips salen de un episodio listo; job ignorado');
    return;
  }
  if (ep.focus === null) {
    // sin encuadre elegido el pre-corte no sabe qué recortar: incidencia con
    // el arreglo dicho, no un fallo mudo
    await ctx.publishEvent({
      type: 'incident',
      episode_id: episodeId,
      queue: QUEUES.highlights,
      message: 'Elige el encuadre del episodio antes de proponer clips',
      suggested_action: 'reintentar',
    });
    return;
  }
  if (ep.beats === null || ep.transcriptPath === null || !fs.existsSync(ep.transcriptPath)) {
    throw new Error('Faltan los beats o el transcript; reintenta la transcripción');
  }

  // idempotencia: con propuestas vivas no se re-propone salvo force
  if (force !== true) {
    const vivos = await ctx.db
      .select({ id: shorts.id })
      .from(shorts)
      .where(and(eq(shorts.episodeId, episodeId), ne(shorts.state, 'descartado')));
    if (vivos.length > 0) {
      log.info({ vivos: vivos.length }, 'El episodio ya tiene clips propuestos; job ignorado');
      return;
    }
  }

  const { tokens } = JSON.parse(fs.readFileSync(ep.transcriptPath, 'utf8')) as {
    tokens: BeatToken[];
  };
  const beatsDirector = ep.beats.map((b) => ({ ...b, edits: 0 }));
  const { candidatos, source } = await directHighlights(ctx, {
    episodeId,
    channelId: ep.channelId,
    titulo: ep.sourceTitle ?? ep.sourceUrl,
    canal: ep.sourceChannelName ?? '—',
    beats: beatsDirector,
    ...(excluir !== undefined ? { excluir } : {}),
  });
  if (candidatos.length === 0) {
    log.warn('El director no encontró ningún clip; 0 propuestas');
    await ctx.publishEvent({ type: 'inbox_changed' });
    return;
  }

  const [canal] = await ctx.db
    .select({ name: channels.name, profile: channels.profile, avatarPath: channels.avatarPath })
    .from(channels)
    .where(eq(channels.id, ep.channelId))
    .limit(1);

  const previos = await ctx.db
    .select({ idx: shorts.idx })
    .from(shorts)
    .where(eq(shorts.episodeId, episodeId));
  let siguienteIdx = previos.reduce((max, s) => Math.max(max, s.idx + 1), 0);

  const creados = [];
  for (const c of candidatos) {
    const id = nanoid(12);
    const destDir = path.join(episodeDir(ctx, episodeId), 'clips', id);
    const plan = await planDeEncuadre(ep.mediaPath!, c.from_ms, c.to_ms, log);
    log.info(
      { tramos: plan.length, conCara: plan.filter((t) => t.x !== null).length },
      'Plan de encuadre por plano',
    );
    const corte = await precortarClip({
      mediaPath: ep.mediaPath!,
      fromMs: c.from_ms,
      toMs: c.to_ms,
      focusX: ep.focus.x,
      width: ep.width ?? 1920,
      height: ep.height ?? 1080,
      destDir,
      plan,
    });
    const master = montarMaestroClip({
      shortId: id,
      episodio: {
        id: episodeId,
        channelId: ep.channelId,
        sourceUrl: ep.sourceUrl,
        sourceTitle: ep.sourceTitle,
        sourceChannelName: ep.sourceChannelName,
        beats: ep.beats,
      },
      cand: c,
      tokens,
      clipVideoPath: corte.clipVideoPath,
      clipAudioPath: corte.clipAudioPath,
      lufs: corte.lufs,
      encuadrePlan: plan,
      brand: {
        ...(canal?.name !== undefined ? { channel_name: canal.name } : {}),
        ...(canal?.profile?.brand_design !== undefined
          ? { design: canal.profile.brand_design }
          : {}),
        ...(canal?.avatarPath !== null && canal?.avatarPath !== undefined
          ? { avatar_path: canal.avatarPath }
          : {}),
      },
    });
    // la telemetría mínima del clip: quién eligió (patrón short_telemetry)
    const conTelemetria = {
      ...master,
      short_telemetry: {
        planos_antes: master.beats?.length ?? 0,
        planos_despues: master.beats?.length ?? 0,
        segundos_por_plano: Number(((c.to_ms - c.from_ms) / 1000 / (master.beats?.length ?? 1)).toFixed(2)),
        efectos_heredados: 0,
        efectos_colocados: 0,
        director: source,
      },
    };
    creados.push({
      id,
      videoId: null,
      episodeId,
      channelId: ep.channelId,
      idx: siguienteIdx++,
      state: 'propuesto',
      fromMs: c.from_ms,
      toMs: c.to_ms,
      title: c.title,
      hook: c.hook,
      reason: c.reason,
      score: c.score,
      master: conTelemetria,
    });
    log.info({ clip: id, s: Math.round((c.to_ms - c.from_ms) / 1000) }, 'Clip pre-cortado');
  }

  await ctx.db.insert(shorts).values(creados);
  for (const s of creados) {
    await ctx.publishEvent({
      type: 'short_state',
      short_id: s.id,
      episode_id: episodeId,
      state: 'propuesto',
    });
  }
  await ctx.publishEvent({ type: 'inbox_changed' });
  log.info({ propuestos: creados.length, source }, 'Clips propuestos');
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
  const highlightsWorker = new Worker(
    QUEUES.highlights,
    async (job) => {
      if (job.name === JOBS.highlights.propose) {
        await handleProposeHighlights(ctx, job as Job<HighlightsProposeJob>);
        return;
      }
      ctx.logger.warn({ job: job.name }, 'Job desconocido en la cola de highlights');
    },
    { connection: ctx.connection, concurrency: 1 },
  );
  return [worker, highlightsWorker];
}
