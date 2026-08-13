import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Worker, type Job } from 'bullmq';
import { and, eq, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { channels, episodes, markIncidentEpisode, shorts, transitionEpisode } from '@fabrica/db';
import {
  channelSettingsSchema,
  JOBS,
  PRICES,
  QUEUES,
  type HighlightsProposeJob,
  type MediaDownloadJob,
  type MediaTranscribeJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { closeCost, failCost, openCost } from '../../lib/ledger.js';
import { exprCropX, suavizarKf, type KeyframeEncuadre } from './encuadre.js';
import { marcarRelleno } from './relleno.js';
import { createMedia, EPISODE_MAX_S } from '../../providers/media.js';
import { createStt } from '../../providers/stt.js';
import { loudnormToWav, measureLufs, probeDurationMs } from '../tts/audio.js';
import { computeBeats, type BeatToken } from '../tts/beats.js';
import { calcularKeeps, remapearTokens } from './apretar.js';
import { montarMaestroClip } from './clip.js';
import { candidatoDeVentana, directHighlights } from './highlights.js';
import { ajustarVentanaAFrase } from './fronteras.js';
import { detectarRisas, risaTrasBeat } from './risas.js';
import { detectarSilencios } from './silencios.js';
import { aTokens, cruzarConPausas, spansDePausas } from './tokens.js';

const ejec = promisify(execFile);

/** Bloques de ~10 min: el endpoint de whisper admite 25 MB por fichero. */
const BLOQUE_S = 600;

/** Aspecto de la tarjeta del layout de clips (90 % × 53,3 % de 1080×1920). */
const CLIP_TARJETA_AR = (0.9 * 1080) / (0.533 * 1920);

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
    // el idioma NO va fijo: el clipping ingiere material AJENO en cualquier
    // idioma (la referencia replica un canal inglés). Forzar 'es' sobre una
    // entrevista inglesa no falló: ALUCINÓ un bloque entero en falso español
    // (certificación 13-ago-2026, Conan/Cranston). El primer bloque va en
    // detección automática y el idioma detectado queda CLAVADO para el resto
    // — la detección por bloque suelto derraparía en bloques que arrancan
    // con música o silencio.
    let idioma = 'auto';
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
        const r = await stt.transcribe(bloqueWav, { lang: idioma, ...(prompt !== '' ? { prompt } : {}) });
        await closeCost(ctx.db, handle, {
          units: Number((durBloque / 60).toFixed(2)),
          unitCost: stt.name === 'whisper' ? PRICES.openai.stt_per_minute : 0,
        });
        if (idioma === 'auto' && r.language !== undefined && r.language !== '') {
          idioma = r.language;
          log.info({ idioma }, 'Idioma del episodio detectado y clavado para el resto de bloques');
        }
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
    // carcajadas: sonido sin palabras (estirón del ASR o hueco no cubierto
    // por silencio). El beat que acaba en risa lleva la marca: es el remate
    // confirmado por la gente y el director corta ahí (risas.ts)
    const risas = detectarRisas(tokens, silencios);

    fs.writeFileSync(transcriptPath, JSON.stringify({ tokens }, null, 1));
    await ctx.db
      .update(episodes)
      .set({
        transcriptPath,
        beats: beats.map((b) => {
          const risa = risaTrasBeat(b.to_ms, risas);
          return {
            idx: b.idx,
            from_ms: b.from_ms,
            to_ms: b.to_ms,
            text: b.text,
            ...(risa !== undefined ? { risa_despues_ms: risa } : {}),
          };
        }),
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
  /** serie cruda del hablante (reloj de la VENTANA); el suavizado es del worker */
  kf?: { t_ms: number; x: number }[];
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
 * DENTRO del plano, si el sidecar trajo serie (kf), la x deja de estar
 * clavada: paneo suave por keyframes (suavizarKf + zona muerta), horneado en
 * la expresión del crop — el hablante que se mece ya no se sale del cuadro.
 */
async function precortarClip(params: {
  mediaPath: string;
  /** piezas en el reloj de ORIGEN, ya apretadas y con su x de encuadre */
  piezas: {
    src_from_ms: number;
    src_to_ms: number;
    x: number | null;
    kf?: { t_ms: number; x: number }[];
  }[];
  focusX: number;
  width: number;
  height: number;
  destDir: string;
}): Promise<{
  clipVideoPath: string;
  clipAudioPath: string;
  lufs: number;
  durMs: number;
  /** keyframes suavizados por pieza (reloj de ORIGEN); null = x fija */
  kfPorPieza: (KeyframeEncuadre[] | null)[];
}> {
  const { mediaPath, piezas, focusX, width, height, destDir } = params;
  fs.mkdirSync(destDir, { recursive: true });
  // El recorte va al ASPECTO DE LA TARJETA (~0,95:1), no a 9:16: la tarjeta
  // del layout es casi cuadrada y un pre-corte más alto la obligaba a
  // recortar por el centro — las cabezas, que en el plano original viven
  // arriba, salían decapitadas. Con el aspecto igualado se ve TODO el alto
  // del plano y la cara queda a su altura natural.
  const cropW = Math.round(height * CLIP_TARJETA_AR);
  const xPx = (fx: number): number =>
    Math.min(width - cropW, Math.max(0, Math.round(width * fx - cropW / 2)));

  // cada pieza con su x (histéresis de 0,08) y VÍDEO+AUDIO cortados por la
  // MISMA frontera: la concatenación no puede desincronizar lo que comparte
  // puntos de corte
  const partesV: string[] = [];
  const partesA: string[] = [];
  const kfPorPieza: (KeyframeEncuadre[] | null)[] = [];
  let xPrev = focusX;
  for (const [i, t] of piezas.entries()) {
    let fx = t.x ?? xPrev;
    if (Math.abs(fx - xPrev) < 0.08) fx = xPrev;
    xPrev = fx;
    // tracking continuo: la serie llega en reloj de VENTANA/ORIGEN y el crop
    // corre en el reloj del SEGMENTO (-ss lo pone a cero)
    const serie = (t.kf ?? [])
      .filter((k) => k.t_ms >= t.src_from_ms && k.t_ms <= t.src_to_ms)
      .map((k) => ({ t_ms: k.t_ms - t.src_from_ms, x: k.x }));
    const suaves = suavizarKf(fx, serie);
    const conPaneo = suaves.length > 1;
    kfPorPieza.push(
      conPaneo ? suaves.map((k) => ({ t_ms: t.src_from_ms + k.t_ms, x: k.x })) : null,
    );
    // el siguiente arranque compara contra donde el paneo DEJÓ la cámara
    if (conPaneo) xPrev = suaves[suaves.length - 1]!.x;
    const xExpr = conPaneo
      ? `'${exprCropX(suaves.map((k) => ({ t_s: k.t_ms / 1000, x_px: xPx(k.x) })))}'`
      : String(xPx(fx));
    const desdeS = (t.src_from_ms / 1000).toFixed(3);
    const durS = ((t.src_to_ms - t.src_from_ms) / 1000).toFixed(3);
    const parteV = path.join(destDir, `.v-${i}.mp4`);
    await ejec('ffmpeg', [
      '-nostdin', '-loglevel', 'error',
      '-ss', desdeS, '-i', mediaPath, '-t', durS,
      '-vf', `crop=${cropW}:${height}:${xExpr}:0,scale=1080:1920,fps=30`,
      '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p', '-an', '-y', parteV,
    ]);
    partesV.push(parteV);
    const parteA = path.join(destDir, `.a-${i}.wav`);
    await ejec('ffmpeg', [
      '-nostdin', '-loglevel', 'error',
      '-ss', desdeS, '-i', mediaPath, '-t', durS,
      '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', '-y', parteA,
    ]);
    partesA.push(parteA);
  }

  const listaV = path.join(destDir, '.v.txt');
  fs.writeFileSync(listaV, partesV.map((f) => `file '${f}'`).join('\n'));
  const clipVideoPath = path.join(destDir, 'clip.mp4');
  await ejec('ffmpeg', [
    '-nostdin', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
    '-i', listaV, '-c', 'copy', '-movflags', '+faststart', '-y', clipVideoPath,
  ]);

  const listaA = path.join(destDir, '.a.txt');
  fs.writeFileSync(listaA, partesA.map((f) => `file '${f}'`).join('\n'));
  const crudo = path.join(destDir, '.voz-cruda.wav');
  await ejec('ffmpeg', [
    '-nostdin', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
    '-i', listaA, '-c', 'copy', '-y', crudo,
  ]);
  const clipAudioPath = path.join(destDir, 'voz.wav');
  await loudnormToWav(crudo, clipAudioPath);
  const lufs = (await measureLufs(clipAudioPath)) ?? -16;

  for (const f of [...partesV, ...partesA, listaV, listaA, crudo]) fs.rmSync(f, { force: true });
  const durMs = piezas.reduce((acc, t) => acc + (t.src_to_ms - t.src_from_ms), 0);
  return { clipVideoPath, clipAudioPath, lufs, durMs, kfPorPieza };
}

export async function handleProposeHighlights(
  ctx: WorkerContext,
  job: Job<HighlightsProposeJob>,
): Promise<void> {
  const { episodeId, excluir, force, ventana } = job.data;
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

  // idempotencia: con propuestas vivas no se re-propone salvo force (la
  // subventana explícita convive con lo vivo: es un encargo, no una ronda)
  if (force !== true && ventana === undefined) {
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
  let candidatos;
  let source: 'llm' | 'fallback' | 'operador';
  if (ventana !== undefined) {
    // subventana del operador: sin LLM y sin exclusiones — una persona ya
    // eligió; el pipeline solo ajusta a beats y frases y pre-corta
    const c = candidatoDeVentana(ventana, beatsDirector);
    if (c === null) {
      log.warn({ ventana }, 'La subventana no toca ningún beat; 0 propuestas');
      await ctx.publishEvent({ type: 'inbox_changed' });
      return;
    }
    candidatos = [c];
    source = 'operador';
  } else {
    const res = await directHighlights(ctx, {
      episodeId,
      channelId: ep.channelId,
      titulo: ep.sourceTitle ?? ep.sourceUrl,
      canal: ep.sourceChannelName ?? '—',
      beats: beatsDirector,
      ...(excluir !== undefined ? { excluir } : {}),
    });
    candidatos = res.candidatos;
    source = res.source;
  }
  if (candidatos.length === 0) {
    log.warn('El director no encontró ningún clip; 0 propuestas');
    await ctx.publishEvent({ type: 'inbox_changed' });
    return;
  }

  const [canal] = await ctx.db
    .select({
      name: channels.name,
      profile: channels.profile,
      avatarPath: channels.avatarPath,
      settings: channels.settings,
    })
    .from(channels)
    .where(eq(channels.id, ep.channelId))
    .limit(1);
  const ajustes = channelSettingsSchema.parse(canal?.settings ?? {});

  const previos = await ctx.db
    .select({ idx: shorts.idx })
    .from(shorts)
    .where(eq(shorts.episodeId, episodeId));
  let siguienteIdx = previos.reduce((max, s) => Math.max(max, s.idx + 1), 0);

  const creados = [];
  for (const c0 of candidatos) {
    // fronteras dignas: la ventana ni arranca ni muere a mitad de frase —
    // extiende el final al cierre (o lo retrae) y salta arranques a medias.
    // Los encargos del operador no se retraen: la ventana la eligió una
    // persona y en run-ons sin puntuación la retracción se come el remate
    const c = {
      ...c0,
      ...ajustarVentanaAFrase({ from_ms: c0.from_ms, to_ms: c0.to_ms }, tokens, {
        retraer: source !== 'operador',
      }),
    };
    const id = nanoid(12);
    const destDir = path.join(episodeDir(ctx, episodeId), 'clips', id);
    const tokensVentana = tokens.filter((t) => t.from_ms >= c.from_ms && t.to_ms <= c.to_ms);
    // 1a) corte SEMÁNTICO opcional (flag por canal): frases de relleno que el
    //     director marca y el apretado corta como silencio sintético; si el
    //     LLM falla, [] y el clip sale igual, solo menos apretado
    const quitar = ajustes.clips_relleno
      ? await marcarRelleno(ctx, {
          episodeId,
          channelId: ep.channelId,
          shortId: id,
          tokens: tokensVentana,
        })
      : [];
    // 1b) APRETADO: fuera los silencios muertos de la ventana (keeps con el
    //     mapa de reloj origen→salida; receta del hermano) + el relleno marcado
    const keeps = calcularKeeps(
      tokens,
      c.from_ms,
      c.to_ms,
      quitar.length > 0 ? { quitar } : {},
    );
    // 2) encuadre por plano Y por hablante sobre la ventana de ORIGEN
    const plan = await planDeEncuadre(ep.mediaPath!, c.from_ms, c.to_ms, log);
    // 3) piezas = keeps ∩ tramos de encuadre, en el reloj de ORIGEN
    const piezas: {
      src_from_ms: number;
      src_to_ms: number;
      x: number | null;
      kf?: { t_ms: number; x: number }[];
    }[] = [];
    for (const k of keeps) {
      for (const t of plan) {
        const tFrom = c.from_ms + t.from_ms;
        const tTo = c.from_ms + t.to_ms;
        const from = Math.max(k.src_from_ms, tFrom);
        const to = Math.min(k.src_to_ms, tTo);
        if (to - from > 80) {
          // la serie del tramo viaja con la pieza, ya en reloj de ORIGEN;
          // el suavizado y el recorte por pieza son cosa del pre-corte
          const kf = (t.kf ?? []).map((p) => ({ t_ms: c.from_ms + p.t_ms, x: p.x }));
          piezas.push({
            src_from_ms: from,
            src_to_ms: to,
            x: t.x,
            ...(kf.length >= 2 ? { kf } : {}),
          });
        }
      }
    }
    if (piezas.length === 0) {
      piezas.push({ src_from_ms: c.from_ms, src_to_ms: c.to_ms, x: null });
    }
    const recortadoMs = c.to_ms - c.from_ms - keeps.reduce((a, k) => a + (k.out_to_ms - k.out_from_ms), 0);
    log.info(
      {
        keeps: keeps.length,
        tramosEncuadre: plan.length,
        piezas: piezas.length,
        segundosFuera: Number((recortadoMs / 1000).toFixed(1)),
        rellenoQuitado: quitar.length,
      },
      'Apretado y encuadre del clip',
    );
    const corte = await precortarClip({
      mediaPath: ep.mediaPath!,
      piezas,
      focusX: ep.focus.x,
      width: ep.width ?? 1920,
      height: ep.height ?? 1080,
      destDir,
    });
    // 4) todo lo que viaja al maestro se traduce al reloj de SALIDA
    const tokensSalida = remapearTokens(tokensVentana, keeps);
    const beatsSalida = keeps.map((k, i) => ({
      idx: i,
      from_ms: k.out_from_ms,
      to_ms: k.out_to_ms,
      text: tokensSalida
        .filter((t) => t.from_ms >= k.out_from_ms && t.to_ms <= k.out_to_ms)
        .map((t) => t.raw)
        .join(' ')
        .slice(0, 300),
    }));
    const master = montarMaestroClip({
      shortId: id,
      episodio: {
        id: episodeId,
        channelId: ep.channelId,
        sourceUrl: ep.sourceUrl,
        sourceTitle: ep.sourceTitle,
        sourceChannelName: ep.sourceChannelName,
      },
      cand: c,
      salida: { dur_ms: corte.durMs, beats: beatsSalida, tokens: tokensSalida },
      clipVideoPath: corte.clipVideoPath,
      clipAudioPath: corte.clipAudioPath,
      lufs: corte.lufs,
      encuadrePlan: piezas.map((pz, i) => ({
        from_ms: pz.src_from_ms - c.from_ms,
        to_ms: pz.src_to_ms - c.from_ms,
        x: pz.x,
        // los keyframes SUAVIZADOS que el crop horneó de verdad (auditoría),
        // al mismo reloj de la ventana que from_ms/to_ms
        ...(corte.kfPorPieza[i]
          ? {
              kf: corte.kfPorPieza[i]!.map((k) => ({
                t_ms: k.t_ms - c.from_ms,
                x: k.x,
              })),
            }
          : {}),
      })),
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
