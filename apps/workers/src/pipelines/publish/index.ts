import fsp from 'node:fs/promises';
import path from 'node:path';
import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { channels, videos } from '@fabrica/db';
import {
  channelSettingsSchema,
  JOBS,
  nextPublishSlot,
  QUEUES,
  type PublishUploadJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { env } from '../../lib/env.js';
import { closeCost, failCost, openCost } from '../../lib/ledger.js';
import {
  createMockProvider,
  createYoutubeProvider,
  PermanentUploadError,
  type PublishProvider,
} from '../../providers/youtube.js';

// Subida a YouTube en PRIVADO (SPEC §12 y §14 S3), SIEMPRE aprobada por el
// humano desde la bandeja. La publicación NO toca la máquina de estados:
// 'hecho' es terminal y el estado de la subida vive en videos.youtube.

/** Error sin remedio con reintentos: se marca 'fallido' a la primera. */
export class PermanentPublishError extends Error {}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readDeliverable(outDir: string, file: string): Promise<string> {
  try {
    return await fsp.readFile(path.join(outDir, file), 'utf8');
  } catch {
    throw new PermanentPublishError(
      `Falta ${file} en la carpeta de salida; repite el render para regenerar los entregables`,
    );
  }
}

type VideoRow = typeof videos.$inferSelect;
type Publication = NonNullable<VideoRow['youtube']>;

async function saveYoutube(
  ctx: WorkerContext,
  videoId: string,
  publication: Publication,
): Promise<void> {
  await ctx.db
    .update(videos)
    .set({ youtube: publication, updatedAt: new Date() })
    .where(eq(videos.id, videoId));
}

/** 'fallido' con motivo legible + eventos; el humano reintenta desde Entrega. */
async function markUploadFailed(
  ctx: WorkerContext,
  videoId: string,
  message: string,
): Promise<void> {
  const [row] = await ctx.db
    .select({ youtube: videos.youtube })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);
  const prev = row?.youtube ?? null;
  await saveYoutube(ctx, videoId, {
    status: 'fallido',
    // se propaga el origen anterior, igual que el id y la url: un fallo no
    // convierte en subida por API lo que el humano había marcado a mano
    ...(prev?.origin !== undefined ? { origin: prev.origin } : {}),
    youtube_id: prev?.youtube_id ?? null,
    url: prev?.url ?? null,
    privacy_status: prev?.privacy_status ?? null,
    publish_at: prev?.publish_at ?? null,
    uploaded_at: null,
    error: message,
  });
  await ctx.publishEvent({
    type: 'incident',
    video_id: videoId,
    queue: QUEUES.publish,
    message,
    suggested_action: 'reintentar',
  });
  await ctx.publishEvent({ type: 'inbox_changed' });
}

function selectProvider(ctx: WorkerContext, refreshToken: string | null): PublishProvider {
  const name = env('PUBLISH_PROVIDER', 'mock');
  if (name !== 'youtube') {
    if (name !== 'mock') {
      ctx.logger.warn({ provider: name }, 'PUBLISH_PROVIDER desconocido; se usa el simulado');
    }
    return createMockProvider(ctx.logger);
  }
  const clientId = process.env.YT_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.YT_OAUTH_CLIENT_SECRET ?? '';
  if (clientId === '' || clientSecret === '') {
    // degradar a mock aquí marcaría 'subido' con un id falso: mejor un fallo claro
    throw new PermanentPublishError(
      'PUBLISH_PROVIDER=youtube pero faltan YT_OAUTH_CLIENT_ID/YT_OAUTH_CLIENT_SECRET en el .env',
    );
  }
  if (refreshToken === null || refreshToken === '') {
    throw new PermanentPublishError('El canal no está conectado a YouTube; conéctalo en Ajustes');
  }
  return createYoutubeProvider({ clientId, clientSecret, refreshToken }, ctx.logger);
}

async function handlePublishUpload(ctx: WorkerContext, job: Job<PublishUploadJob>): Promise<void> {
  const { videoId } = job.data;
  const log = ctx.logger.child({ videoId, queue: QUEUES.publish });

  const [video] = await ctx.db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);

  const publication = video.youtube;
  if (publication?.status === 'subido') {
    log.info('El vídeo ya está subido; job duplicado ignorado');
    return;
  }
  // la aprobación (POST /publish) deja 'subiendo' ANTES de encolar; cualquier
  // otra cosa es un job que se saltó la puerta
  if (publication === null || publication === undefined || publication.status !== 'subiendo') {
    throw new PermanentPublishError(
      `Estado de publicación inesperado: ${publication?.status ?? 'sin aprobación'}; aprueba la subida desde la bandeja`,
    );
  }
  if (video.outputDir === null) {
    throw new PermanentPublishError('El vídeo no tiene carpeta de salida; repite el render');
  }
  const outDir = video.outputDir;
  const filePath = path.join(outDir, 'video.mp4');
  try {
    await fsp.access(filePath);
  } catch {
    throw new PermanentPublishError('Falta video.mp4 en la carpeta de salida; repite el render');
  }

  // entregables escritos por el render (description.txt ya lleva capítulos)
  const title = (await readDeliverable(outDir, 'title.txt')).trim();
  const description = (await readDeliverable(outDir, 'description.txt')).replace(/\n$/, '');
  const tags = (await readDeliverable(outDir, 'tags.txt'))
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => t !== '');

  const [channel] = await ctx.db
    .select()
    .from(channels)
    .where(eq(channels.id, video.channelId))
    .limit(1);
  if (!channel) throw new Error(`Canal no encontrado: ${video.channelId}`);
  const settings = channelSettingsSchema.parse(channel.settings ?? {});
  const containsSyntheticMedia = channel.profile?.flags.ai_disclosure === true;

  const provider = selectProvider(ctx, settings.youtube?.refresh_token ?? null);

  // revalidar el hueco: la aprobación pudo quedar en cola (concurrencia 1,
  // backoff) y un publishAt en el pasado tumba videos.insert con 400
  let publishAt = publication.publish_at;
  const PUBLISH_AT_MARGIN_MS = 5 * 60_000;
  if (publishAt !== null && new Date(publishAt).getTime() <= Date.now() + PUBLISH_AT_MARGIN_MS) {
    publishAt =
      settings.publish_schedule !== null
        ? nextPublishSlot(settings.publish_schedule, new Date()).toISOString()
        : null;
    await saveYoutube(ctx, videoId, { ...publication, publish_at: publishAt });
    log.info({ publishAt }, 'publish_at quedó en el pasado; recalculado al siguiente hueco');
  }

  await ctx.publishEvent({
    type: 'job_progress',
    video_id: videoId,
    queue: QUEUES.publish,
    progress: 0,
    detail: 'Preparando la subida a YouTube',
  });

  // ledger ANTES de la llamada. Cuota real: videos.insert consume 1 unidad
  // del bucket propio de subidas (no del pool general de 10 000/día).
  const uploadCost = await openCost(ctx.db, {
    videoId,
    channelId: video.channelId,
    provider: 'youtube',
    operation: 'api',
    meta: {
      endpoint: 'videos.insert',
      quota_bucket: 'uploads',
      quota_units: 1,
      provider_impl: provider.name,
    },
  });
  let result;
  try {
    let lastEmit = 0;
    result = await provider.upload({
      videoId,
      filePath,
      title,
      description,
      tags,
      publishAt,
      containsSyntheticMedia,
      // reanudación tras crash: la sesión resumable se persiste en BD antes
      // de subir bytes y se limpia al terminar (saveYoutube sin session)
      session: publication.session ?? null,
      onSession: async (session) => {
        await saveYoutube(ctx, videoId, { ...publication, publish_at: publishAt, session });
      },
      onProgress: (progress) => {
        const now = Date.now();
        if (progress < 100 && now - lastEmit < 1_000) return;
        lastEmit = now;
        void ctx.publishEvent({
          type: 'job_progress',
          video_id: videoId,
          queue: QUEUES.publish,
          progress: Math.min(progress, 99),
          detail: 'Subiendo el vídeo a YouTube',
        });
      },
    });
    await closeCost(ctx.db, uploadCost, { units: 1, unitCost: 0, cost: 0 });
  } catch (err) {
    await failCost(ctx.db, uploadCost, errorMessage(err));
    throw err;
  }

  // miniatura oficial (thumbnails.set: 50 unidades del pool general). Gana la
  // subida por el humano (thumb_custom.*, generada a partir del brief); si no,
  // la auto-generada thumb_a.jpg. Un fallo aquí no re-sube el vídeo.
  const custom = (await fsp.readdir(outDir).catch(() => [])).find((e) =>
    /^thumb_custom\.(png|jpg|jpeg|webp)$/i.test(e),
  );
  const thumbPath = path.join(outDir, custom ?? 'thumb_a.jpg');
  let thumbOk = false;
  try {
    await fsp.access(thumbPath);
    thumbOk = true;
  } catch {
    log.warn(
      'No hay miniatura (thumb_custom/thumb_a); el vídeo queda con la automática de YouTube',
    );
  }
  if (thumbOk) {
    const thumbCost = await openCost(ctx.db, {
      videoId,
      channelId: video.channelId,
      provider: 'youtube',
      operation: 'api',
      meta: {
        endpoint: 'thumbnails.set',
        quota_bucket: 'general',
        quota_units: 50,
        provider_impl: provider.name,
      },
    });
    try {
      await provider.setThumbnail(result.youtubeId, thumbPath);
      await closeCost(ctx.db, thumbCost, { units: 50, unitCost: 0, cost: 0 });
    } catch (err) {
      await failCost(ctx.db, thumbCost, errorMessage(err));
      log.warn({ err }, 'thumbnails.set falló; la subida sigue siendo válida');
    }
  }

  await saveYoutube(ctx, videoId, {
    status: 'subido',
    origin: 'api',
    youtube_id: result.youtubeId,
    url: result.url,
    privacy_status: 'private',
    publish_at: publishAt,
    uploaded_at: new Date().toISOString(),
    error: null,
  });
  await ctx.publishEvent({
    type: 'job_progress',
    video_id: videoId,
    queue: QUEUES.publish,
    progress: 100,
    detail: 'Subida completada',
  });
  await ctx.publishEvent({ type: 'inbox_changed' });
  log.info({ youtubeId: result.youtubeId, publishAt }, 'Vídeo subido a YouTube en privado');
}

// Concurrencia 1: una sola subida a la vez (ancho de banda y cuota bajo control).
export async function registerPublishWorkers(ctx: WorkerContext): Promise<Worker[]> {
  const worker = new Worker<PublishUploadJob>(
    QUEUES.publish,
    async (job) => {
      if (job.name !== JOBS.publish.upload) {
        ctx.logger.warn({ job: job.name }, 'Job desconocido en la cola de publicación');
        return;
      }
      try {
        await handlePublishUpload(ctx, job);
      } catch (err) {
        const permanent =
          err instanceof PermanentPublishError || err instanceof PermanentUploadError;
        // attemptsMade cuenta los intentos ANTERIORES dentro del procesador
        const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        const message = `Fallo en la subida a YouTube: ${errorMessage(err)}`;
        if (permanent || isFinal) {
          try {
            await markUploadFailed(ctx, job.data.videoId, permanent ? errorMessage(err) : message);
          } catch (markErr) {
            ctx.logger.error({ err: markErr }, 'No se pudo marcar la publicación como fallida');
          }
        }
        // los errores permanentes no se reintentan solos: el humano corrige y
        // vuelve a aprobar desde Entrega (otro POST /publish)
        if (permanent) {
          ctx.logger.error({ videoId: job.data.videoId, err: errorMessage(err) }, message);
          return;
        }
        throw err;
      }
    },
    { connection: ctx.connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => {
    ctx.logger.error({ job: job?.id, err: err.message }, 'Job de publicación fallido');
  });
  return [worker];
}
