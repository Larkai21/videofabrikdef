import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker, type Job } from 'bullmq';
import { and, eq, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import PQueue from 'p-queue';
import {
  assets as assetsTable,
  beats as beatsTable,
  channels,
  markIncident,
  transitionVideo,
  videos,
} from '@fabrica/db';
import {
  channelSettingsSchema,
  JOBS,
  QUEUES,
  SCENE_GAP_MS,
  SECTION_GAP_MS,
  type AssetsMatchJob,
  type Scene,
  type TtsSynthesizeJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { closeCost, failCost, openCost } from '../../lib/ledger.js';
import { createTts, type TtsFactory, type TtsProvider, type TtsSceneAudio } from '../../providers/tts.js';
import {
  concatWavs,
  loudnormToWav,
  makeSilence,
  measureLufs,
  probeDurationMs,
  toAacPreview,
  toWav,
} from './audio.js';
import { computeBeats, type BeatSceneSpan } from './beats.js';
import { synthesizeSceneConPausas } from './frases.js';
import { buildCues } from './cues.js';
import { MUSIC_DURATION_TOLERANCE_MS, mixMusicUnderVoice, pickMusicTrack } from './music.js';
import { alignSceneTokens, type TimedToken } from './words.js';

// Worker de voz (docs/voz-y-beats.md): síntesis POR ESCENA, concat con
// silencios, loudnorm, cues y beats. Entrada guion_ok → salida audio.

const SCENE_CONCURRENCY = 3;
const SCENE_RETRIES = 2;
const INTERNAL_SILENCE_WARN_MS = 1_500;
const DURATION_DEVIATION_WARN = 0.15;

function fmtTime(ms: number): string {
  const totalS = Math.floor(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function synthesizeWithRetry(
  tts: TtsProvider,
  scene: Scene,
  opts: { voiceId: string; rate: string },
  contabiliza?: (chars: number) => void,
): Promise<TtsSceneAudio> {
  try {
    // por FRASE, con pausa de respiración entre ellas (PAUSE_SENTENCE_MS);
    // el retry vive dentro, por frase — reintentar la escena entera tiraría
    // las frases ya sintetizadas
    return await synthesizeSceneConPausas(tts, scene.text, opts, SCENE_RETRIES, contabiliza);
  } catch (err) {
    throw err instanceof Error
      ? err
      : new Error(`Fallo sintetizando la escena ${scene.id}: ${String(err)}`);
  }
}

async function runSynthesize(ctx: WorkerContext, factory: TtsFactory, job: Job<TtsSynthesizeJob>) {
  const { videoId } = job.data;
  const { db, logger } = ctx;

  const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);
  if (video.state === 'audio') {
    // auto-reparación: la transición hizo commit pero el encolado de match
    // no llegó (caída o blip de Redis); re-encolar es inocuo (runMatch
    // omite beats bloqueados y no repite la transición)
    logger.warn({ videoId }, 'Vídeo ya en audio: re-encolando el matching de assets');
    await ctx.queues.assets.add(JOBS.assets.match, { videoId } satisfies AssetsMatchJob);
    return;
  }
  if (video.state !== 'guion_ok') {
    logger.info({ videoId, state: video.state }, 'El vídeo no está en guion_ok; se omite la síntesis');
    return;
  }

  const master = video.master;
  const scenes = master.script?.scenes ?? [];
  if (scenes.length === 0) throw new Error('El guion no tiene escenas que sintetizar');

  const [channel] = await db.select().from(channels).where(eq(channels.id, video.channelId));
  const voice = channel?.profile?.voice;
  const rate = voice?.rate ?? '-8%';
  const settings = channelSettingsSchema.parse(channel?.settings ?? {});
  // proveedor por canal: profile.voice.provider decide; sin clave cae a edge
  const tts = factory.providerFor(voice?.provider);
  // si el proveedor pedido degradó (p. ej. elevenlabs sin clave), su voice_id
  // no existe en el proveedor efectivo: usar la voz neuronal por defecto del
  // idioma del canal en vez de garantizar el fallo de toda síntesis
  const fallbackVoice =
    channel?.profile?.language === 'en' ? 'en-US-AndrewNeural' : 'es-ES-AlvaroNeural';
  const degradedProvider =
    voice?.provider !== undefined && tts.name !== 'mock' && tts.name !== voice.provider;
  const voiceId = degradedProvider ? fallbackVoice : (voice?.voice_id ?? fallbackVoice);
  if (degradedProvider) {
    logger.warn(
      { pedido: voice?.provider, efectivo: tts.name, voz: voiceId },
      'Proveedor de voz degradado: se usa la voz por defecto del idioma',
    );
  }

  await ctx.publishEvent({
    type: 'job_progress',
    video_id: videoId,
    queue: QUEUES.tts,
    progress: 5,
    detail: `Sintetizando ${scenes.length} escenas con voz ${voiceId}`,
  });

  // ledger ANTES de la llamada externa (caracteres; unitCost 0 en ambos:
  // edge es gratuito y elevenlabs va por suscripción — se vigilan caracteres)
  const totalChars = scenes.reduce((acc, s) => acc + s.text.length, 0);
  const handle = await openCost(db, {
    videoId,
    channelId: video.channelId,
    provider: tts.name === 'elevenlabs' ? 'elevenlabs' : 'edge-tts',
    operation: 'tts',
    meta: {
      scenes: scenes.length,
      voice: voiceId,
      provider: tts.name,
      ...(tts.model ? { model: tts.model } : {}),
    },
  });

  const sceneResults = new Array<TtsSceneAudio>(scenes.length);
  // caracteres REALMENTE enviados al proveedor: la síntesis por frase
  // reintenta frase a frase, y ElevenLabs cobra cada petición aunque falle —
  // apuntar totalChars mentiría por lo bajo justo cuando hay reintentos
  let charsFacturados = 0;
  const contabiliza = (chars: number): void => {
    charsFacturados += chars;
  };
  // sin fugas: los temporales de las escenas ya sintetizadas se barren
  // también cuando la síntesis o la concatenación fallan a mitad
  const sweepSceneTmp = async () => {
    await Promise.allSettled(
      sceneResults
        .filter((r): r is TtsSceneAudio => Boolean(r))
        .map((r) => fs.rm(path.dirname(r.audioPath), { recursive: true, force: true })),
    );
  };
  try {
    const queue = new PQueue({ concurrency: SCENE_CONCURRENCY });
    await Promise.all(
      scenes.map((scene, i) =>
        queue.add(async () => {
          sceneResults[i] = await synthesizeWithRetry(tts, scene, { voiceId, rate }, contabiliza);
        }),
      ),
    );
    await closeCost(db, handle, { units: charsFacturados || totalChars, unitCost: 0 });
  } catch (err) {
    await failCost(db, handle, err instanceof Error ? err.message : String(err));
    await sweepSceneTmp();
    throw err;
  }

  await ctx.publishEvent({
    type: 'job_progress',
    video_id: videoId,
    queue: QUEUES.tts,
    progress: 50,
    detail: 'Escenas sintetizadas; concatenando audio',
  });

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fabrica-voice-'));
  try {
    // conversión homogénea a WAV 44,1 kHz mono y medición real por escena
    const sceneWavs: string[] = [];
    const sceneDurMs: number[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const result = sceneResults[i];
      if (!result) throw new Error(`Falta el audio de la escena ${i}`);
      const wav = path.join(workDir, `scene-${i}.wav`);
      await toWav(result.audioPath, wav);
      sceneWavs.push(wav);
      sceneDurMs.push(await probeDurationMs(wav));
      await fs.rm(path.dirname(result.audioPath), { recursive: true, force: true });
    }

    // silencios: 300 ms misma sección, 450 ms al cambiar de sección
    const silence300 = path.join(workDir, 'silence-300.wav');
    const silence450 = path.join(workDir, 'silence-450.wav');
    await makeSilence(SCENE_GAP_MS, silence300);
    await makeSilence(SECTION_GAP_MS, silence450);

    const parts: string[] = [];
    const sceneOffsets: number[] = [];
    let cursor = 0;
    for (let i = 0; i < scenes.length; i++) {
      if (i > 0) {
        const sectionChange = scenes[i]?.section !== scenes[i - 1]?.section;
        parts.push(sectionChange ? silence450 : silence300);
        cursor += sectionChange ? SECTION_GAP_MS : SCENE_GAP_MS;
      }
      sceneOffsets.push(cursor);
      parts.push(sceneWavs[i] ?? '');
      cursor += sceneDurMs[i] ?? 0;
    }

    const concatPath = path.join(workDir, 'concat.wav');
    await concatWavs(parts, concatPath);

    // post: loudnorm −16 LUFS / −1,5 dBTP → WAV master + AAC preview
    const audioDir = path.join(ctx.outputsDir, videoId, 'audio');
    await fs.mkdir(audioDir, { recursive: true });
    const voiceWav = path.join(audioDir, 'voice.wav');
    const voiceAac = path.join(audioDir, 'voice.m4a');
    await loudnormToWav(concatPath, voiceWav);

    // música de fondo (S2): DESPUÉS del loudnorm de la voz; la voz sola se
    // conserva como voice.wav y el master pasa a ser voice-mix.wav solo si la
    // mezcla no cambia la duración (±50 ms). Cualquier fallo → voz sola.
    let masterAudioPath = voiceWav;
    if (settings.background_music) {
      const tracks = await db
        .select({ id: assetsTable.id, path: assetsTable.path })
        .from(assetsTable)
        .where(
          and(
            eq(assetsTable.kind, 'music'),
            or(eq(assetsTable.channelId, video.channelId), eq(assetsTable.scope, 'shared')),
          ),
        );
      const track = pickMusicTrack(videoId, tracks);
      if (!track) {
        logger.info(
          { videoId },
          'Música de fondo activa pero sin pistas kind music en la biblioteca; sigue la voz sola',
        );
      } else {
        const musicPath = path.isAbsolute(track.path)
          ? track.path
          : path.join(ctx.libraryDir, track.path);
        const mixWav = path.join(audioDir, 'voice-mix.wav');
        try {
          const voiceDurationMs = await probeDurationMs(voiceWav);
          await mixMusicUnderVoice({ voicePath: voiceWav, musicPath, outPath: mixWav, voiceDurationMs });
          const mixDurationMs = await probeDurationMs(mixWav);
          if (Math.abs(mixDurationMs - voiceDurationMs) <= MUSIC_DURATION_TOLERANCE_MS) {
            masterAudioPath = mixWav;
            logger.info({ videoId, trackId: track.id }, 'Música de fondo mezclada a -22 dB');
          } else {
            logger.warn(
              { videoId, voiceDurationMs, mixDurationMs },
              'La mezcla de música cambió la duración; se descarta y sigue la voz sola',
            );
          }
        } catch (err) {
          logger.warn({ videoId, err }, 'Fallo mezclando la música de fondo; sigue la voz sola');
        }
      }
    }
    await toAacPreview(masterAudioPath, voiceAac);

    const durationMs = await probeDurationMs(masterAudioPath);
    const lufs = await measureLufs(masterAudioPath, logger);

    await ctx.publishEvent({
      type: 'job_progress',
      video_id: videoId,
      queue: QUEUES.tts,
      progress: 75,
      detail: `Audio master de ${fmtTime(durationMs)} normalizado`,
    });

    // re-basado de palabras al tiempo global + tokens con puntuación
    const tokens: TimedToken[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const result = sceneResults[i];
      if (!scene || !result) continue;
      tokens.push(...alignSceneTokens(scene.text, result.words, i, sceneOffsets[i] ?? 0));
    }
    tokens.sort((a, b) => a.from_ms - b.from_ms);

    // chequeo: silencio interno > 1,5 s (no bloquea)
    for (let i = 0; i < tokens.length - 1; i++) {
      const gap = (tokens[i + 1]?.from_ms ?? 0) - (tokens[i]?.to_ms ?? 0);
      if (gap > INTERNAL_SILENCE_WARN_MS) {
        await ctx.publishEvent({
          type: 'job_progress',
          video_id: videoId,
          queue: QUEUES.tts,
          progress: 80,
          detail: `Aviso: silencio interno de ${(gap / 1000).toFixed(1).replace('.', ',')} s en ${fmtTime(tokens[i]?.to_ms ?? 0)}`,
        });
      }
    }

    // chequeo: desvío de duración frente al objetivo del canal (no bloquea)
    const targetMs = settings.target_minutes * 60_000;
    const deviation = Math.abs(durationMs - targetMs) / targetMs;
    if (deviation > DURATION_DEVIATION_WARN) {
      await ctx.publishEvent({
        type: 'job_progress',
        video_id: videoId,
        queue: QUEUES.tts,
        progress: 82,
        detail: `Aviso: duración de ${fmtTime(durationMs)} frente al objetivo de ${fmtTime(targetMs)} (desvío ${(deviation * 100).toFixed(0)}%)`,
      });
    }

    const cues = buildCues(tokens, durationMs);

    const sceneSpans: BeatSceneSpan[] = scenes.map((scene, i) => ({
      idx: i,
      visual_query: scene.visual_query,
      from_ms: sceneOffsets[i] ?? 0,
      to_ms: (sceneOffsets[i] ?? 0) + (sceneDurMs[i] ?? 0),
    }));
    const computed = await computeBeats(tokens, sceneSpans, durationMs, (texts) =>
      ctx.embeddings.embed(texts),
    );
    for (const beat of computed) {
      if (beat.multiScene) {
        logger.info(
          { videoId, beatIdx: beat.idx },
          `Beat ${beat.idx} multi_scene: abarca escenas con queries muy distintas; se prioriza la primera`,
        );
      }
    }

    // idempotente: borra los beats previos del vídeo antes de insertar
    await db.delete(beatsTable).where(eq(beatsTable.videoId, videoId));
    if (computed.length > 0) {
      await db.insert(beatsTable).values(
        computed.map((b) => ({
          id: nanoid(),
          videoId,
          idx: b.idx,
          fromMs: b.from_ms,
          toMs: b.to_ms,
          text: b.text,
          visualQuery: b.visual_query,
          status: 'pending',
        })),
      );
    }

    // el maestro guarda audio y cues; los beats viven en su tabla.
    // scene_spans es el mismo cálculo que alimenta computeBeats, persistido: es
    // el índice que permite al director de edición buscar la palabra disparadora
    // de una escena en SU ventana, y no en todo el vídeo. Sin él, una palabra
    // repetida se anclaría en su primera aparición, casi siempre la equivocada.
    const newMaster = {
      ...master,
      audio: { path: masterAudioPath, duration_ms: durationMs, lufs },
      cues,
      scene_spans: scenes.map((scene, i) => ({
        scene_id: scene.id,
        from_ms: sceneOffsets[i] ?? 0,
        to_ms: (sceneOffsets[i] ?? 0) + (sceneDurMs[i] ?? 0),
      })),
    };
    await db
      .update(videos)
      .set({ master: newMaster, updatedAt: new Date() })
      .where(eq(videos.id, videoId));

    await transitionVideo(db, videoId, 'audio', { expectFrom: 'guion_ok' });
    await ctx.queues.assets.add(JOBS.assets.match, { videoId } satisfies AssetsMatchJob);

    await ctx.publishEvent({ type: 'video_state', video_id: videoId, state: 'audio' });
    await ctx.publishEvent({ type: 'inbox_changed' });
    await ctx.publishEvent({
      type: 'job_progress',
      video_id: videoId,
      queue: QUEUES.tts,
      progress: 100,
      detail: `Voz lista: ${computed.length} beats y ${cues.length} cues`,
    });
    logger.info(
      { videoId, durationMs, beats: computed.length, cues: cues.length },
      'Síntesis de voz completada',
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
    await sweepSceneTmp();
  }
}

export async function registerTtsWorkers(ctx: WorkerContext): Promise<Worker[]> {
  const factory = createTts(ctx.logger);
  ctx.logger.info({ tts: factory.base.name }, 'Proveedor de TTS base inicializado');

  const worker = new Worker<TtsSynthesizeJob>(
    QUEUES.tts,
    async (job) => {
      if (job.name !== JOBS.tts.synthesize) {
        ctx.logger.warn({ job: job.name }, 'Job desconocido en la cola tts');
        return;
      }
      try {
        await runSynthesize(ctx, factory, job);
      } catch (err) {
        const attempts = job.opts.attempts ?? 1;
        const isFinal = job.attemptsMade + 1 >= attempts;
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error({ err, videoId: job.data.videoId, isFinal }, 'Fallo en la síntesis de voz');
        if (isFinal) {
          try {
            await markIncident(ctx.db, job.data.videoId, {
              message: `La síntesis de voz falló: ${message}`,
              suggested_action: 'reintentar',
              queue: QUEUES.tts,
            });
            await ctx.publishEvent({
              type: 'incident',
              video_id: job.data.videoId,
              queue: QUEUES.tts,
              message: `La síntesis de voz falló: ${message}`,
              suggested_action: 'reintentar',
            });
          } catch (incidentErr) {
            ctx.logger.error({ err: incidentErr }, 'No se pudo registrar la incidencia de tts');
          }
        }
        throw err;
      }
    },
    { connection: ctx.connection, concurrency: 1 },
  );

  return [worker];
}
