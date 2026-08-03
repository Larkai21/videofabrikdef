import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { markIncident, transitionVideo, videos } from '@fabrica/db';
import {
  analizarMaster,
  cuesToSrt,
  cuesToVtt,
  JOBS,
  QUEUES,
  renderableMasterV1,
  type RenderableMaster,
  type RenderVideoJob,
  type ThumbnailBriefJob,
} from '@fabrica/shared';
import {
  computeChapters,
  mergeChaptersIntoDescription,
  segmentsToChapters,
} from '@fabrica/video/chapters';
import { webpackOverride } from '@fabrica/video/bundling';
import { componentMeta } from '@fabrica/video/registry-meta';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { WorkerContext } from '../../lib/context.js';
import { env, REPO_ROOT } from '../../lib/env.js';
import { videoSrcLock } from '../../lib/locks.js';
import { ajustarLoudnessEntrega } from './loudness.js';
import { rewriteMasterMedia } from './media-rewrite.js';

// ESTRATEGIA DE MEDIOS — decidida leyendo @remotion/renderer 4.0.499:
// el proxy de OffthreadVideo (offthread-video-server.js → assets/read-file.js)
// solo descarga src http:// o https:// (y data:); las rutas absolutas del
// sistema de archivos y file:// NO son cargables ni por el compositor ni por
// Chromium (el bundle se sirve desde su propio servidor local). Por tanto se
// aplica la opción (b): antes de renderizar, las rutas absolutas bajo
// LIBRARY_DIR/OUTPUTS_DIR se reescriben a URLs de la API
// (FILES_BASE_URL, por defecto http://127.0.0.1:3001/files, que sirve ambos
// directorios bajo /files/library y /files/outputs; en dev la API siempre está
// levantada). El render de humo de packages/video no depende de esto: usa
// rutas relativas resueltas con staticFile desde el public/ del bundle.

const require = createRequire(import.meta.url);

function videoPackageDir(): string {
  // resuelve el subpath exportado para localizar packages/video sin asumir
  // la estructura del repo (funciona también instalado en contenedor)
  const entry = require.resolve('@fabrica/video/entry');
  return path.resolve(path.dirname(entry), '..');
}

async function hashTree(
  hash: ReturnType<typeof createHash>,
  dir: string,
  relBase: string,
): Promise<void> {
  const entries = (await fsp.readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = `${relBase}/${entry.name}`;
    if (entry.isDirectory()) await hashTree(hash, abs, rel);
    else if (entry.isFile()) {
      hash.update(rel);
      try {
        hash.update(await fsp.readFile(abs));
      } catch {
        // archivo desaparecido entre readdir y readFile (poda del kit en
        // vuelo): se anota la ausencia; el candado evita el caso normal
        hash.update('desaparecido');
      }
    }
  }
}

// bundle() una vez por versión del código de la composición: la clave es el
// hash de packages/video/src + fuentes + package.json, cacheado en un
// directorio gitignoreado. Los renders siguientes reutilizan el bundle.
async function ensureBundle(ctx: WorkerContext): Promise<string> {
  // candado compartido con la validación del brand kit: sin él, la
  // regeneración del registry puede mutar src/kit entre el cálculo del hash
  // y el bundle, y el marcador perpetuaría un bundle mezclado
  return videoSrcLock.run(async () => {
    const pkgDir = videoPackageDir();
    const hash = createHash('sha1');
    await hashTree(hash, path.join(pkgDir, 'src'), 'src');
    // la composición importa @fabrica/shared: un cambio ahí también invalida
    const sharedDir = path.dirname(require.resolve('@fabrica/shared'));
    await hashTree(hash, sharedDir, 'shared/src');
    const publicDir = path.join(pkgDir, 'public');
    if (fs.existsSync(publicDir)) await hashTree(hash, publicDir, 'public');
    hash.update(await fsp.readFile(path.join(pkgDir, 'package.json')));
    const key = hash.digest('hex').slice(0, 16);

    const outDir = path.join(REPO_ROOT, '.turbo', 'remotion-bundle', key);
    const marker = path.join(outDir, '.bundle-completo');
    if (fs.existsSync(marker)) return outDir;
    await fsp.rm(outDir, { recursive: true, force: true });
    ctx.logger.info({ key }, 'Empaquetando la composición de Remotion');
    const serveUrl = await bundle({
      entryPoint: path.join(pkgDir, 'src', 'entry.ts'),
      publicDir: path.join(pkgDir, 'public'),
      outDir,
      webpackOverride,
    });
    await fsp.writeFile(marker, key);
    return serveUrl;
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function writeOutputs(outDir: string, master: RenderableMaster): Promise<void> {
  const chosenIdx = master.seo.chosen_idx;
  if (chosenIdx === null) throw new Error('Falta elegir título (seo.chosen_idx)');
  const title = master.seo.titles[chosenIdx] ?? master.seo.titles[0];
  // capítulos reales del director de capítulos si hay ≥2 segmentos; si no,
  // se derivan de las secciones hook/body/cta (comportamiento anterior)
  // Los tiempos del maestro son del AUDIO; el MP4 antepone la intro de marca,
  // así que los capítulos (salvo 0:00) se desplazan lo que dure la intro.
  // Medido antes del arreglo: «1:17» escrito y 1:20 real — el clic aterrizaba
  // en la cola de la sección anterior. La duración sale de la meta generada
  // (sin React), con la misma degradación que el layout: ref no registrada o
  // sin duración fija → la intro no se monta → offset 0.
  const introRef = master.brand?.components.intro;
  const metaIntro = introRef !== undefined ? componentMeta[introRef] : undefined;
  // el gate del layout es DOBLE: ref registrado BAJO EL TIPO intro y con
  // duración fija. Replicar solo la duración calculaba el offset de una intro
  // que la composición no monta (reproducido con components.intro apuntando a
  // una outro: +4 s falsos en todos los capítulos).
  const introFrames = metaIntro?.type === 'intro' ? (metaIntro.fixed_duration_frames ?? 0) : 0;
  const introMs = Math.round((introFrames / master.video.fps) * 1000);
  const chapters =
    master.segments && master.segments.length >= 2
      ? segmentsToChapters(master.segments, introMs)
      : computeChapters(master.script.scenes, master.beats, introMs);
  // sustituye {timestamps} o, si el LLM escribió tiempos literales
  // (estimados, a menudo fuera de la duración real), ese bloque entero
  let description = mergeChaptersIntoDescription(master.seo.description, chapters);
  // atribución de los insertos: las licencias CC BY/BY-SA de Wikimedia Commons
  // EXIGEN acreditar; el credit viaja congelado en cada edit imagen_apoyo y
  // aquí se agrega una sola vez por autor/licencia
  const creditos = [
    ...new Set(
      (master.edits ?? []).flatMap((e) =>
        e.type === 'imagen_apoyo' && e.credit !== undefined && e.credit !== '' ? [e.credit] : [],
      ),
    ),
  ];
  if (creditos.length > 0) {
    description += `\n\nImágenes: ${creditos.join(' · ')}`;
  }
  await fsp.writeFile(path.join(outDir, 'title.txt'), `${title}\n`);
  await fsp.writeFile(path.join(outDir, 'description.txt'), `${description}\n`);
  await fsp.writeFile(path.join(outDir, 'tags.txt'), `${master.seo.tags.join('\n')}\n`);
  // subtítulos para subir junto al MP4: transformación pura de los cues, con el
  // MISMO desplazamiento de intro que los capítulos (los cues van en reloj del
  // audio; el MP4 antepone la intro de marca)
  const cues = master.cues ?? [];
  if (cues.length > 0) {
    await fsp.writeFile(path.join(outDir, 'subtitles.srt'), cuesToSrt(cues, introMs));
    await fsp.writeFile(path.join(outDir, 'subtitles.vtt'), cuesToVtt(cues, introMs));
  }
  // maestro congelado con rutas locales, para auditoría y re-render idéntico
  await fsp.writeFile(path.join(outDir, 'master.json'), JSON.stringify(master, null, 2));
}

async function handleRenderVideo(ctx: WorkerContext, job: Job<RenderVideoJob>): Promise<void> {
  const { videoId } = job.data;
  const log = ctx.logger.child({ videoId, queue: QUEUES.render });

  const [video] = await ctx.db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);

  const parsed = renderableMasterV1.safeParse(video.master);
  if (!parsed.success) {
    // fallo permanente: sin reintentos automáticos, el humano decide
    const detail = parsed.error.issues
      .slice(0, 3)
      .map((issue) => issue.message)
      .join('; ');
    const message = `El maestro no es renderizable: ${detail}`;
    log.error({ issues: parsed.error.issues.length }, message);
    await markIncident(ctx.db, videoId, {
      message,
      suggested_action: 'regenerar',
      queue: QUEUES.render,
    });
    await ctx.publishEvent({ type: 'video_state', video_id: videoId, state: 'incidencia' });
    await ctx.publishEvent({
      type: 'incident',
      video_id: videoId,
      queue: QUEUES.render,
      message,
      suggested_action: 'regenerar',
    });
    return;
  }
  const master = parsed.data;

  if (video.state === 'timeline_ok') {
    await transitionVideo(ctx.db, videoId, 'render', { expectFrom: 'timeline_ok' });
    await ctx.publishEvent({ type: 'video_state', video_id: videoId, state: 'render' });
  } else if (video.state === 'hecho') {
    // job duplicado tras una re-ejecución de la ingesta: no hay nada que hacer
    log.info('El vídeo ya está en hecho; render duplicado ignorado');
    return;
  } else if (video.state !== 'render') {
    // reanudación idempotente: solo se acepta el estado de la propia fase
    throw new Error(`Estado inesperado para renderizar: ${video.state}`);
  }

  try {
    await ensureBrowser();
    const serveUrl = await ensureBundle(ctx);

    const filesBaseUrl = env('FILES_BASE_URL', `http://127.0.0.1:${env('API_PORT', '3001')}/files`);
    const inputProps = rewriteMasterMedia(master, {
      libraryDir: ctx.libraryDir,
      outputsDir: ctx.outputsDir,
      baseUrl: filesBaseUrl,
    });

    const composition = await selectComposition({ serveUrl, id: 'LongForm', inputProps });
    const outDir = path.join(ctx.outputsDir, videoId);
    await fsp.mkdir(outDir, { recursive: true });

    let lastProgressAt = 0;
    log.info({ frames: composition.durationInFrames }, 'Comenzando el render del vídeo');
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
          video_id: videoId,
          progress: Math.round(progress * 100),
          rendered_frames: renderedFrames,
          total_frames: composition.durationInFrames,
        });
      },
    });

    // el MP4 sale con la voz a −16 (referencia de mezcla); la entrega va a −14
    await ajustarLoudnessEntrega(path.join(outDir, 'video.mp4'), log);

    // dos miniaturas con los dos conceptos del paquete SEO. Las inputProps
    // deben pasar TAMBIÉN por selectComposition: las props que renderiza la
    // Still son las resueltas ahí (sin esto, ambas salen con las default).
    const variants = [
      { variant: 'a', file: 'thumb_a.jpg' },
      { variant: 'b', file: 'thumb_b.jpg' },
    ] as const;
    // el avatar y los tokens ya reescritos a /files viajan en inputProps
    const thumbDesign = inputProps.brand?.design;
    const thumbAvatar = inputProps.brand?.avatar_path;
    for (let i = 0; i < variants.length; i += 1) {
      const item = variants[i];
      if (!item) continue;
      const concept = master.seo.thumbnails[i] ?? master.seo.thumbnails[0];
      const text = concept?.text ?? master.seo.titles[0];
      // el personaje del canal (si lo hay) aparece de fondo en la miniatura;
      // los colores salen del design system del canal
      const thumbProps = {
        text,
        variant: item.variant,
        ...(thumbDesign ? { design: thumbDesign } : {}),
        ...(thumbAvatar ? { image_path: thumbAvatar } : {}),
      };
      const thumbComposition = await selectComposition({
        serveUrl,
        id: 'Thumbnail',
        inputProps: thumbProps,
      });
      await renderStill({
        composition: thumbComposition,
        serveUrl,
        output: path.join(outDir, item.file),
        imageFormat: 'jpeg',
        jpegQuality: 90,
        inputProps: thumbProps,
      });
    }

    await writeOutputs(outDir, master);

    await ctx.db
      .update(videos)
      .set({ outputDir: outDir, updatedAt: new Date() })
      .where(eq(videos.id, videoId));
    await transitionVideo(ctx.db, videoId, 'hecho', { expectFrom: 'render' });
    await ctx.publishEvent({
      type: 'render_progress',
      video_id: videoId,
      progress: 100,
      rendered_frames: composition.durationInFrames,
      total_frames: composition.durationInFrames,
    });
    await ctx.publishEvent({ type: 'video_state', video_id: videoId, state: 'hecho' });
    // brief de miniatura de alta conversión: se genera aparte (LLM) y se escribe
    // outputs/<id>/thumbnail-brief.json; no bloquea la entrega del vídeo
    await ctx.queues.script.add(JOBS.script.thumbnailBrief, {
      videoId,
    } satisfies ThumbnailBriefJob);
    // Puerta de calidad: el informe corre solo, sobre el maestro que se acaba
    // de congelar, y sus avisos quedan en el log de la entrega. Es barato
    // (aritmética sobre el maestro) y evita descubrir un minuto mudo o una
    // palabra vacía resaltada DESPUÉS de subir el vídeo a mano.
    try {
      const m = analizarMaster(master);
      if (m.avisos.length > 0) {
        log.warn(
          { avisos: m.avisos.map((a) => `${a.gravedad}: ${a.detalle}`) },
          `Calidad: ${m.avisos.length} aviso(s) sobre el vídeo terminado`,
        );
      } else {
        log.info({ efectos: m.efectos, planos: m.planos }, 'Calidad: sin avisos');
      }
    } catch (err) {
      log.warn({ err }, 'No se pudo calcular el informe de calidad; el vídeo está entregado');
    }
    log.info({ outDir }, 'Render terminado y entregables escritos');
  } catch (err) {
    const message = `Fallo en el render: ${errorMessage(err)}`;
    log.error({ err }, message);
    // dentro del procesador attemptsMade cuenta los intentos ANTERIORES
    // (BullMQ lo incrementa al mover el job a failed/retry), de ahí el +1;
    // la incidencia solo se marca cuando se agotan los reintentos con backoff
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (isLastAttempt) {
      try {
        await markIncident(ctx.db, videoId, {
          message,
          suggested_action: 'reintentar',
          queue: QUEUES.render,
        });
        await ctx.publishEvent({ type: 'video_state', video_id: videoId, state: 'incidencia' });
        await ctx.publishEvent({
          type: 'incident',
          video_id: videoId,
          queue: QUEUES.render,
          message,
          suggested_action: 'reintentar',
        });
      } catch (incErr) {
        // el error original manda; no ocultarlo si la incidencia no se pudo marcar
        log.error({ err: incErr }, 'No se pudo marcar la incidencia de render');
      }
    }
    throw err;
  }
}

// Cola de render con concurrencia 1: un solo vídeo renderizando a la vez;
// el paralelismo (RENDER_CONCURRENCY pestañas de Chromium) va dentro del
// render, no entre renders (docs/render.md §3).
export async function registerRenderWorkers(ctx: WorkerContext): Promise<Worker[]> {
  const worker = new Worker<RenderVideoJob>(
    QUEUES.render,
    async (job) => {
      if (job.name !== JOBS.render.video) {
        ctx.logger.warn({ job: job.name }, 'Job desconocido en la cola de render');
        return;
      }
      await handleRenderVideo(ctx, job);
    },
    { connection: ctx.connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    ctx.logger.error({ job: job?.id, err: err.message }, 'Job de render fallido');
  });
  return [worker];
}
