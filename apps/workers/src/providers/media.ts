import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type pino from 'pino';

const ejec = promisify(execFile);

// Proveedor de MEDIA externo (episodios de clipping): descarga el vídeo de
// YouTube/Twitch con el binario yt-dlp del sistema, en dos pasos (metadatos →
// fichero). Binario y no wrapper npm a propósito: los wrappers van por detrás
// de un binario que se actualiza cada vez que las plataformas rompen
// extractores, y `brew upgrade yt-dlp` no exige release del repo.
//
// Mismo contrato que el resto de proveedores: interfaz limpia + mock que no
// sale a red (la suite nunca depende de yt-dlp ni de la conexión). Sin binario
// instalado, el error es una incidencia visible con acción sugerida, nunca un
// silencio.

export interface EpisodeMeta {
  /** id del vídeo en la plataforma (el de 11 caracteres en YouTube) */
  sourceVideoId: string | null;
  title: string;
  channelName: string | null;
  channelUrl: string | null;
  durationS: number;
  publishedAt: Date | null;
  isLive: boolean;
}

export interface DownloadResult {
  mediaPath: string;
  audioPath: string;
  width: number | null;
  height: number | null;
  bytes: number;
}

export interface MediaProvider {
  readonly name: 'yt-dlp' | 'mock';
  probe(url: string): Promise<EpisodeMeta>;
  /** Descarga el mp4 (≤1080p) y extrae el wav 16 kHz mono para el STT. */
  download(url: string, destDir: string): Promise<DownloadResult>;
}

/** Tope duro de duración: un episodio de más de 4 h no es material de clips. */
export const EPISODE_MAX_S = 4 * 3600;
/** Tope de bytes del mp4 (un 2 h 1080p ronda 2-6 GB; esto corta lo absurdo). */
const MAX_FILESIZE = '6G';

async function extraerWav(mediaPath: string, destDir: string): Promise<string> {
  // utilidad de ingesta (precedente reducirA1080): el cuerpo sigue siendo
  // Remotion; esto solo prepara el audio que whisper pide (16 kHz mono)
  const wav = path.join(destDir, 'audio.wav');
  await ejec('ffmpeg', [
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    mediaPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-y',
    wav,
  ]);
  return wav;
}

async function probeDims(mediaPath: string): Promise<{ width: number | null; height: number | null }> {
  try {
    const r = await ejec('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0',
      mediaPath,
    ]);
    const [w, h] = r.stdout.trim().split(',').map(Number);
    return { width: Number.isFinite(w) ? w! : null, height: Number.isFinite(h) ? h! : null };
  } catch {
    return { width: null, height: null };
  }
}

class YtDlpProvider implements MediaProvider {
  readonly name = 'yt-dlp' as const;

  async probe(url: string): Promise<EpisodeMeta> {
    const r = await ejec('yt-dlp', ['-J', '--no-playlist', url], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const info = JSON.parse(r.stdout) as {
      id?: string;
      title?: string;
      channel?: string;
      uploader?: string;
      channel_url?: string;
      uploader_url?: string;
      duration?: number;
      upload_date?: string;
      is_live?: boolean;
      live_status?: string;
    };
    const fecha =
      info.upload_date !== undefined && /^\d{8}$/.test(info.upload_date)
        ? new Date(
            `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}T00:00:00Z`,
          )
        : null;
    return {
      sourceVideoId: info.id ?? null,
      title: info.title ?? url,
      channelName: info.channel ?? info.uploader ?? null,
      channelUrl: info.channel_url ?? info.uploader_url ?? null,
      durationS: info.duration ?? 0,
      publishedAt: fecha,
      isLive: info.is_live === true || info.live_status === 'is_live',
    };
  }

  async download(url: string, destDir: string): Promise<DownloadResult> {
    fs.mkdirSync(destDir, { recursive: true });
    const plantilla = path.join(destDir, 'episode.%(ext)s');
    await ejec(
      'yt-dlp',
      [
        '--no-playlist',
        // ≤1080p: el corte a 9:16 no gana nada por encima y un 4K ya mató un
        // render por timeout de decodificación (reescala-biblioteca.ts)
        '-f',
        'bv*[height<=1080]+ba/b[height<=1080]/b',
        '--merge-output-format',
        'mp4',
        '--max-filesize',
        MAX_FILESIZE,
        '-o',
        plantilla,
        url,
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const fichero = fs.readdirSync(destDir).find((f) => f.startsWith('episode.'));
    if (fichero === undefined) {
      throw new Error('yt-dlp terminó sin dejar fichero (¿--max-filesize lo cortó?)');
    }
    const mediaPath = path.join(destDir, fichero);
    const audioPath = await extraerWav(mediaPath, destDir);
    const dims = await probeDims(mediaPath);
    return { mediaPath, audioPath, ...dims, bytes: fs.statSync(mediaPath).size };
  }
}

/**
 * Mock determinista: no sale a red. `probe` inventa metadatos estables desde
 * la URL y `download` sintetiza 30 s de vídeo de color plano + tono con
 * ffmpeg, suficiente para que el flujo entero (descarga → wav → beats →
 * candidatos) corra en tests y sin claves.
 */
class MockMediaProvider implements MediaProvider {
  readonly name = 'mock' as const;

  async probe(url: string): Promise<EpisodeMeta> {
    return {
      sourceVideoId: `mock-${Math.abs(hash(url)) % 100000}`,
      title: `Episodio de prueba (${new URL(url).hostname})`,
      channelName: 'Canal de prueba',
      channelUrl: 'https://example.com/canal',
      durationS: 30,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      isLive: false,
    };
  }

  async download(_url: string, destDir: string): Promise<DownloadResult> {
    fs.mkdirSync(destDir, { recursive: true });
    const mediaPath = path.join(destDir, 'episode.mp4');
    await ejec('ffmpeg', [
      '-nostdin',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x12151A:s=1280x720:d=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=220:duration=30',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      '-shortest',
      '-y',
      mediaPath,
    ]);
    const audioPath = await extraerWav(mediaPath, destDir);
    return { mediaPath, audioPath, width: 1280, height: 720, bytes: fs.statSync(mediaPath).size };
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/**
 * Factoría con la degradación del repo: MEDIA_PROVIDER=mock fuerza el mock;
 * sin binario yt-dlp en el PATH el error sale como incidencia (quien llama
 * decide), no aquí en silencio.
 */
export function createMedia(logger: pino.Logger): MediaProvider {
  const provider = process.env.MEDIA_PROVIDER ?? 'yt-dlp';
  if (provider === 'mock') {
    logger.info('Proveedor de media en modo mock: no se sale a red');
    return new MockMediaProvider();
  }
  return new YtDlpProvider();
}
