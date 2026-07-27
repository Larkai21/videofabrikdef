import fsp from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import type pino from 'pino';

// Proveedor de publicación en YouTube (SPEC §12 y §14 S3): subida RESUMABLE
// por REST (sin googleapis, fetch nativo) + thumbnails.set. El MockProvider
// simula la subida para dejar el flujo E2E verificable sin cuota ni OAuth.

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_INIT_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const THUMBNAIL_SET_URL = 'https://www.googleapis.com/upload/youtube/v3/thumbnails/set';

export const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB, múltiplo de 256 KiB
export const MAX_TITLE_LENGTH = 100;
const MAX_CHUNK_RETRIES = 5;

export interface PublishUploadParams {
  videoId: string;
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  // ISO 8601 o null: sin hueco programado el vídeo queda en privado sin fecha
  publishAt: string | null;
  containsSyntheticMedia: boolean;
  // 0–100 sobre los bytes subidos
  onProgress?: (progress: number) => void;
}

export interface PublishResult {
  youtubeId: string;
  url: string;
}

export interface PublishProvider {
  name: string;
  upload(params: PublishUploadParams): Promise<PublishResult>;
  setThumbnail(youtubeId: string, thumbPath: string): Promise<void>;
}

// ---- lógica pura (testeada sin red) ----

export interface UploadBody {
  snippet: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
  };
  status: {
    privacyStatus: 'private';
    selfDeclaredMadeForKids: false;
    containsSyntheticMedia?: true;
    publishAt?: string;
  };
}

/** Cuerpo de videos.insert: título ≤100 caracteres, categoría 28 (Science & Technology). */
export function buildUploadBody(params: {
  title: string;
  description: string;
  tags: string[];
  publishAt: string | null;
  containsSyntheticMedia: boolean;
}): UploadBody {
  // Array.from evita partir un par sustituto (emoji) al truncar
  const chars = Array.from(params.title);
  const title = chars.length > MAX_TITLE_LENGTH ? chars.slice(0, MAX_TITLE_LENGTH).join('') : params.title;
  return {
    snippet: {
      title,
      description: params.description,
      tags: params.tags,
      categoryId: '28',
    },
    status: {
      privacyStatus: 'private',
      selfDeclaredMadeForKids: false,
      ...(params.containsSyntheticMedia ? { containsSyntheticMedia: true as const } : {}),
      ...(params.publishAt !== null ? { publishAt: params.publishAt } : {}),
    },
  };
}

/**
 * Offset de reanudación de un 308: la cabecera Range 'bytes=0-N' indica que el
 * servidor tiene N+1 bytes. Sin cabecera (o ilegible), no hay nada recibido.
 */
export function parseResumeOffset(rangeHeader: string | null): number {
  const match = /bytes\s*=?\s*\d+\s*-\s*(\d+)/i.exec(rangeHeader ?? '');
  const last = match?.[1];
  if (last === undefined) return 0;
  const parsed = Number.parseInt(last, 10);
  return Number.isFinite(parsed) ? parsed + 1 : 0;
}

// ---- proveedor real ----

export interface YoutubeAuth {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

async function bodyText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

export function createYoutubeProvider(auth: YoutubeAuth, logger?: pino.Logger): PublishProvider {
  let cached: { token: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached !== null && Date.now() < cached.expiresAt - 60_000) return cached.token;
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        refresh_token: auth.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      throw new Error(`No se pudo refrescar el token de acceso (${res.status}): ${await bodyText(res)}`);
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (data.access_token === undefined) {
      throw new Error('La respuesta del refresh no incluye access_token');
    }
    cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return cached.token;
  }

  // sonda de reanudación tras un fallo transitorio: PUT con 'bytes */total'
  async function probe(
    location: string,
    total: number,
  ): Promise<{ kind: 'offset'; offset: number } | { kind: 'done'; result: PublishResult }> {
    const res = await fetch(location, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        'content-range': `bytes */${total}`,
      },
    });
    if (res.status === 308) {
      return { kind: 'offset', offset: parseResumeOffset(res.headers.get('range')) };
    }
    if (res.ok) {
      const data = (await res.json()) as { id?: string };
      if (data.id === undefined) throw new Error('La subida terminó sin id de vídeo');
      return { kind: 'done', result: { youtubeId: data.id, url: `https://youtu.be/${data.id}` } };
    }
    throw new Error(`La sonda de reanudación falló (${res.status}): ${await bodyText(res)}`);
  }

  return {
    name: 'youtube',

    async upload(params: PublishUploadParams): Promise<PublishResult> {
      const size = (await fsp.stat(params.filePath)).size;
      if (size === 0) throw new Error(`El archivo está vacío: ${params.filePath}`);

      const initRes = await fetch(UPLOAD_INIT_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          'content-type': 'application/json; charset=utf-8',
          'x-upload-content-length': String(size),
          'x-upload-content-type': 'video/mp4',
        },
        body: JSON.stringify(
          buildUploadBody({
            title: params.title,
            description: params.description,
            tags: params.tags,
            publishAt: params.publishAt,
            containsSyntheticMedia: params.containsSyntheticMedia,
          }),
        ),
      });
      if (!initRes.ok) {
        throw new Error(`videos.insert rechazó la subida (${initRes.status}): ${await bodyText(initRes)}`);
      }
      const location = initRes.headers.get('location');
      if (location === null) throw new Error('videos.insert no devolvió la URL de subida (Location)');

      const handle = await fsp.open(params.filePath, 'r');
      try {
        let offset = 0;
        let retries = 0;
        for (;;) {
          const end = Math.min(offset + UPLOAD_CHUNK_SIZE, size);
          const length = end - offset;
          const chunk = new Uint8Array(length);
          await handle.read(chunk, 0, length, offset);

          let res: Response;
          try {
            res = await fetch(location, {
              method: 'PUT',
              headers: {
                authorization: `Bearer ${await accessToken()}`,
                'content-range': `bytes ${offset}-${end - 1}/${size}`,
                'content-type': 'video/mp4',
              },
              body: chunk,
            });
          } catch (err) {
            retries += 1;
            if (retries > MAX_CHUNK_RETRIES) throw err;
            logger?.warn({ err, offset }, 'Fallo de red subiendo un chunk; reintentando');
            await sleep(1_000 * retries);
            const state = await probe(location, size);
            if (state.kind === 'done') return state.result;
            offset = state.offset;
            continue;
          }

          if (res.status === 308) {
            retries = 0;
            offset = parseResumeOffset(res.headers.get('range'));
            params.onProgress?.(Math.round((offset / size) * 100));
            continue;
          }
          if (res.ok) {
            const data = (await res.json()) as { id?: string };
            if (data.id === undefined) throw new Error('La subida terminó sin id de vídeo');
            params.onProgress?.(100);
            return { youtubeId: data.id, url: `https://youtu.be/${data.id}` };
          }
          if (res.status >= 500 || res.status === 429) {
            retries += 1;
            if (retries > MAX_CHUNK_RETRIES) {
              throw new Error(`La subida falló tras ${MAX_CHUNK_RETRIES} reintentos (${res.status}): ${await bodyText(res)}`);
            }
            logger?.warn({ status: res.status, offset }, 'Chunk rechazado; resincronizando offset');
            await sleep(1_000 * retries);
            const state = await probe(location, size);
            if (state.kind === 'done') return state.result;
            offset = state.offset;
            continue;
          }
          throw new Error(`La subida falló (${res.status}): ${await bodyText(res)}`);
        }
      } finally {
        await handle.close();
      }
    },

    async setThumbnail(youtubeId: string, thumbPath: string): Promise<void> {
      const image = await fsp.readFile(thumbPath);
      const res = await fetch(`${THUMBNAIL_SET_URL}?videoId=${encodeURIComponent(youtubeId)}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          'content-type': 'image/jpeg',
        },
        body: new Uint8Array(image),
      });
      if (!res.ok) {
        throw new Error(`thumbnails.set falló (${res.status}): ${await bodyText(res)}`);
      }
    },
  };
}

// ---- proveedor simulado ----

/**
 * PUBLISH_PROVIDER=mock (o sin credenciales): simula la subida en ~2 s con
 * progreso, sin red. Deja el flujo bandeja → subido verificable sin cuota.
 */
export function createMockProvider(logger?: pino.Logger, delayMs = 2_000): PublishProvider {
  return {
    name: 'mock',

    async upload(params: PublishUploadParams): Promise<PublishResult> {
      logger?.info({ videoId: params.videoId }, 'MockProvider: simulando la subida a YouTube');
      const steps = 4;
      for (let i = 1; i <= steps; i += 1) {
        await sleep(delayMs / steps);
        params.onProgress?.(Math.round((i / steps) * 100));
      }
      const youtubeId = `mock-${params.videoId}`;
      return { youtubeId, url: `https://youtu.be/${youtubeId}` };
    },

    async setThumbnail(): Promise<void> {
      // sin efecto: no hay vídeo real al que ponerle miniatura
    },
  };
}
