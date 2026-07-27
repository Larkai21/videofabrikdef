import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { Redis } from 'ioredis';
import { z } from 'zod';
import { channels, videos } from '@fabrica/db';
import {
  channelSettingsSchema,
  JOBS,
  nextPublishSlot,
  QUEUES,
  type ChannelSettings,
  type PublishUploadJob,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { closeCost, failCost, openCost } from '../lib/ledger.js';

// Publicación en YouTube (SPEC §12 y §14 S3). OAuth por canal: instalación
// monousuario en VPS propio, el refresh token vive en channels.settings.youtube.
// La subida SIEMPRE la aprueba el humano (POST /videos/:id/publish); el estado
// de la publicación vive en videos.youtube y NUNCA toca la máquina de estados.

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CHANNELS_LIST_URL = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

function oauthClient(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.YT_OAUTH_CLIENT_ID ?? '';
  const clientSecret = process.env.YT_OAUTH_CLIENT_SECRET ?? '';
  if (clientId === '' || clientSecret === '') return null;
  return { clientId, clientSecret };
}

function redirectUri(): string {
  return env('YT_OAUTH_REDIRECT_URL', `http://localhost:${env('API_PORT', '3001')}/youtube/callback`);
}

// ---- programación de publicación ----

export interface PublishSchedule {
  weekday: number; // 0=domingo … 6=sábado
  hour: number; // 0–23, hora local del servidor
}

/**
 * Siguiente hueco de publicación ESTRICTAMENTE posterior a `from`, en hora
 * local del servidor. Pura y testeada: el worker no la recalcula, usa el
 * publish_at que fija la aprobación.
 */
// re-export: la implementación vive en @fabrica/shared (el worker de subida
// la reutiliza para revalidar huecos pasados)
export { nextPublishSlot };

// ---- state firmado del OAuth (HMAC con el client_secret; sin tabla extra) ----

export function signState(channelId: string, secret: string): string {
  return createHmac('sha256', secret).update(channelId).digest('hex');
}

export function verifyState(state: string, secret: string): string | null {
  const dot = state.lastIndexOf('.');
  if (dot <= 0) return null;
  const channelId = state.slice(0, dot);
  const signature = state.slice(dot + 1);
  const expected = signState(channelId, secret);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return channelId;
}

// ---- helpers de canal ----

type ChannelRow = typeof channels.$inferSelect;

async function loadChannel(ctx: ApiContext, id: string): Promise<ChannelRow> {
  const [row] = await ctx.db.select().from(channels).where(eq(channels.id, id)).limit(1);
  if (!row) throw notFound(`El canal ${id} no existe`);
  return row;
}

async function saveSettings(
  ctx: ApiContext,
  channel: ChannelRow,
  patch: Partial<ChannelSettings>,
): Promise<ChannelSettings> {
  const current = channelSettingsSchema.parse(channel.settings ?? {});
  const merged = channelSettingsSchema.parse({ ...current, ...patch });
  await ctx.db.update(channels).set({ settings: merged }).where(eq(channels.id, channel.id));
  return merged;
}

function channelIdFromQuery(query: unknown): string {
  const { channel } = (query ?? {}) as { channel?: string };
  if (channel === undefined || channel === '') {
    throw badRequest('Falta el parámetro channel');
  }
  return channel;
}

// ---- cola de publicación con jobId propio ----
// El Enqueuer compartido no admite jobId custom (dedupe por vídeo) ni limpiar
// el job fallido anterior antes de reencolar; esta cola perezosa vive solo en
// las rutas de publicación y se cierra con la app.

const publishQueues = new WeakMap<ApiContext, { queue: Queue; connection: Redis }>();

function publishQueueFor(ctx: ApiContext): Queue {
  const existing = publishQueues.get(ctx);
  if (existing) return existing.queue;
  const connection = new Redis(env('REDIS_URL', 'redis://localhost:56379'), {
    maxRetriesPerRequest: null,
  });
  const queue = new Queue(QUEUES.publish, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 500 },
    },
  });
  publishQueues.set(ctx, { queue, connection });
  return queue;
}

async function closePublishQueue(ctx: ApiContext): Promise<void> {
  const entry = publishQueues.get(ctx);
  if (!entry) return;
  publishQueues.delete(ctx);
  await entry.queue.close();
  entry.connection.disconnect();
}

// ---- aprobación de la subida (la llama POST /videos/:id/publish) ----

export async function publishVideo(
  ctx: ApiContext,
  videoId: string,
): Promise<{ ok: true; publish_at: string | null }> {
  const [video] = await ctx.db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!video) throw notFound(`Vídeo ${videoId} no existe`);
  if (video.state !== 'hecho') {
    throw conflict(`Solo se publica un vídeo en hecho (estado actual: ${video.state})`);
  }
  const current = video.youtube;
  if (current?.status === 'subiendo') {
    throw conflict('La subida ya está en marcha');
  }
  if (current?.status === 'subido') {
    throw conflict('El vídeo ya está subido a YouTube');
  }
  if (video.outputDir === null) {
    throw conflict('El vídeo no tiene carpeta de salida; renderízalo primero');
  }
  if (!fs.existsSync(path.join(video.outputDir, 'video.mp4'))) {
    throw conflict('Falta video.mp4 en la carpeta de salida; repite el render');
  }

  const channel = await loadChannel(ctx, video.channelId);
  const settings = channelSettingsSchema.parse(channel.settings ?? {});
  const provider = env('PUBLISH_PROVIDER', 'mock');
  if (provider === 'youtube' && settings.youtube === null) {
    throw conflict('El canal no está conectado a YouTube; conéctalo en Ajustes antes de publicar');
  }

  const publishAt =
    settings.publish_schedule !== null
      ? nextPublishSlot(settings.publish_schedule, new Date()).toISOString()
      : null;

  // el job fallido anterior se limpia ANTES de escribir 'subiendo': si aún
  // está bloqueado (activo), es un conflicto explícito, nunca un ok silencioso
  const queue = publishQueueFor(ctx);
  const jobId = `publish-${videoId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState().catch(() => 'unknown');
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      throw conflict('La subida ya está en marcha');
    }
    const removed = await queue.remove(jobId);
    if (removed === 0) {
      throw conflict('La subida anterior aún se está liberando; reintenta en unos segundos');
    }
  }

  await ctx.db
    .update(videos)
    .set({
      youtube: {
        status: 'subiendo',
        youtube_id: null,
        url: null,
        privacy_status: null,
        publish_at: publishAt,
        uploaded_at: null,
        error: null,
      },
      updatedAt: new Date(),
    })
    .where(eq(videos.id, videoId));

  try {
    const payload: PublishUploadJob = { videoId };
    await queue.add(JOBS.publish.upload, payload, { jobId });
  } catch (err) {
    // sin job no puede quedar 'subiendo' para siempre: se revierte a fallido
    // reintentable con el motivo visible
    const message = err instanceof Error ? err.message : String(err);
    await ctx.db
      .update(videos)
      .set({
        youtube: {
          status: 'fallido',
          youtube_id: null,
          url: null,
          privacy_status: null,
          publish_at: publishAt,
          uploaded_at: null,
          error: `No se pudo encolar la subida: ${message}`,
        },
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId))
      .catch(() => {});
    throw err;
  }

  await ctx.events.publish({ type: 'inbox_changed' });
  return { ok: true as const, publish_at: publishAt };
}

// ---- respuestas HTML del callback (el navegador aterriza aquí) ----

function htmlPage(reply: FastifyReply, title: string, body: string, status = 200): FastifyReply {
  const html = `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 520px; margin: 80px auto; padding: 0 20px; line-height: 1.5;">
<h1 style="font-size: 18px;">${title}</h1>
<p style="color: #555;">${body}</p>
</body>
</html>`;
  return reply.code(status).type('text/html; charset=utf-8').send(html);
}

const scheduleBodySchema = z.object({
  channel: z.string().min(1),
  schedule: z
    .object({
      weekday: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
    })
    .nullable(),
});

export function registerYoutubeRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.addHook('onClose', async () => {
    await closePublishQueue(ctx);
  });

  // estado de la conexión para Ajustes y Entrega
  app.get('/youtube/status', async (req) => {
    const channelId = channelIdFromQuery(req.query);
    const channel = await loadChannel(ctx, channelId);
    const settings = channelSettingsSchema.parse(channel.settings ?? {});
    return {
      connected: settings.youtube !== null,
      ...(settings.youtube?.channel_title !== undefined
        ? { channel_title: settings.youtube.channel_title }
        : {}),
      ...(settings.youtube !== null ? { connected_at: settings.youtube.connected_at } : {}),
      oauth_configured: oauthClient() !== null,
      provider: env('PUBLISH_PROVIDER', 'mock'),
      publish_schedule: settings.publish_schedule,
    };
  });

  // URL de consentimiento de Google (se abre en pestaña nueva desde Ajustes)
  app.get('/youtube/auth-url', async (req) => {
    const channelId = channelIdFromQuery(req.query);
    await loadChannel(ctx, channelId);
    const client = oauthClient();
    if (client === null) {
      throw conflict(
        'Faltan YT_OAUTH_CLIENT_ID y YT_OAUTH_CLIENT_SECRET en el .env; añade las credenciales OAuth de Google Cloud para conectar el canal',
      );
    }
    const params = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: OAUTH_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state: `${channelId}.${signState(channelId, client.clientSecret)}`,
    });
    return { url: `${GOOGLE_AUTH_URL}?${params.toString()}` };
  });

  // aterrizaje del consentimiento: intercambia el code, guarda el refresh
  // token en channels.settings.youtube y responde un HTML mínimo
  app.get('/youtube/callback', async (req, reply) => {
    const query = (req.query ?? {}) as { code?: string; state?: string; error?: string };
    const client = oauthClient();
    if (client === null) {
      return htmlPage(
        reply,
        'Conexión no disponible',
        'Faltan las credenciales OAuth en el servidor. Revisa el .env y vuelve a intentarlo.',
        409,
      );
    }
    if (query.error !== undefined) {
      return htmlPage(
        reply,
        'Conexión cancelada',
        `Google devolvió: ${query.error}. Vuelve al dashboard e inténtalo de nuevo.`,
        400,
      );
    }
    if (query.code === undefined || query.state === undefined) {
      return htmlPage(reply, 'Petición incompleta', 'Faltan code o state en el retorno de Google.', 400);
    }
    const channelId = verifyState(query.state, client.clientSecret);
    if (channelId === null) {
      return htmlPage(reply, 'Estado inválido', 'El state no pasó la verificación; repite la conexión desde Ajustes.', 400);
    }
    const channel = await loadChannel(ctx, channelId);

    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: query.code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      const detail = await tokenRes.text().catch(() => '');
      req.log.error({ status: tokenRes.status, detail }, 'Intercambio de code fallido');
      return htmlPage(
        reply,
        'Conexión fallida',
        `El intercambio del código falló (${tokenRes.status}). Repite la conexión desde Ajustes.`,
        502,
      );
    }
    const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string };
    if (tokens.refresh_token === undefined) {
      return htmlPage(
        reply,
        'Conexión incompleta',
        'Google no devolvió un refresh token. Retira el acceso de la app en myaccount.google.com/permissions y vuelve a conectar.',
        502,
      );
    }

    // título del canal con channels.list mine=true (1 unidad del pool general),
    // best-effort: sin título la conexión sigue siendo válida
    let channelTitle: string | undefined;
    if (tokens.access_token !== undefined) {
      const cost = await openCost(ctx.db, {
        channelId,
        provider: 'youtube',
        operation: 'api',
        meta: { endpoint: 'channels.list', quota_bucket: 'general', quota_units: 1 },
      });
      try {
        const listRes = await fetch(CHANNELS_LIST_URL, {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        });
        if (!listRes.ok) throw new Error(`channels.list devolvió ${listRes.status}`);
        const list = (await listRes.json()) as { items?: { snippet?: { title?: string } }[] };
        channelTitle = list.items?.[0]?.snippet?.title;
        await closeCost(ctx.db, cost, { units: 1, unitCost: 0, cost: 0 });
      } catch (err) {
        await failCost(ctx.db, cost, err instanceof Error ? err.message : String(err));
        req.log.warn({ err }, 'No se pudo leer el título del canal de YouTube');
      }
    }

    await saveSettings(ctx, channel, {
      youtube: {
        refresh_token: tokens.refresh_token,
        ...(channelTitle !== undefined ? { channel_title: channelTitle } : {}),
        connected_at: new Date().toISOString(),
      },
    });

    return htmlPage(reply, 'Conexión completada', 'Vuelve al dashboard; el canal ya puede subir vídeos en privado.');
  });

  // desconexión: revoca el token best-effort y borra la conexión del canal
  app.delete('/youtube/connection', async (req) => {
    const channelId = channelIdFromQuery(req.query);
    const channel = await loadChannel(ctx, channelId);
    const settings = channelSettingsSchema.parse(channel.settings ?? {});
    if (settings.youtube !== null) {
      try {
        await fetch(GOOGLE_REVOKE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: settings.youtube.refresh_token }),
        });
      } catch (err) {
        req.log.warn({ err }, 'La revocación del token falló; la conexión se borra igualmente');
      }
    }
    await saveSettings(ctx, channel, { youtube: null });
    return { ok: true as const };
  });

  // programación de publicación. channelSettingsUpdateSchema (PUT settings)
  // no incluye publish_schedule y packages/shared no se toca desde este
  // módulo: la edición entra por aquí con el mismo merge validado.
  app.put('/youtube/schedule', async (req) => {
    const body = scheduleBodySchema.parse(req.body);
    const channel = await loadChannel(ctx, body.channel);
    const merged = await saveSettings(ctx, channel, { publish_schedule: body.schedule });
    return { ok: true as const, publish_schedule: merged.publish_schedule };
  });
}
