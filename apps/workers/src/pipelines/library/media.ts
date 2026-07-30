import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import type pino from 'pino';

// Preparación de medios para el backfill: clasificar el archivo, sondar sus
// dimensiones y producir un JPEG pequeño para el caption VLM. FFmpeg/ffprobe
// son opcionales: si faltan, el backfill sigue en modo degradado (sin caption
// ni thumb) y lo deja claro en el log.

const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus']);

export type VisualKind = 'video' | 'image' | 'audio' | 'unknown';

export function visualKindOf(filePath: string): VisualKind {
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return 'unknown';
}

export interface ProbedMedia {
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

/** ffprobe tolerante: null en todo si la herramienta falta o el archivo no se deja leer. */
export async function probeMedia(filePath: string, logger: pino.Logger): Promise<ProbedMedia> {
  try {
    const { stdout } = await execa('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=width,height:format=duration',
      '-of',
      'json',
      filePath,
    ]);
    const parsed = JSON.parse(stdout) as {
      streams?: { width?: number; height?: number }[];
      format?: { duration?: string };
    };
    const stream = parsed.streams?.find((s) => s.width) ?? parsed.streams?.[0];
    const seconds = Number.parseFloat(parsed.format?.duration ?? '');
    return {
      durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
      width: stream?.width ?? null,
      height: stream?.height ?? null,
    };
  } catch (err) {
    logger.warn({ err, filePath }, 'ffprobe no disponible o falló; se indexa sin dimensiones');
    return { durationMs: null, width: null, height: null };
  }
}

/**
 * Produce un JPEG ≤640 px de ancho en outPath: para vídeos, el fotograma del
 * PUNTO MEDIO del clip; para imágenes, un reescalado.
 * Devuelve false si ffmpeg falta o falla (modo degradado, nunca lanza).
 *
 * El punto medio no es una elección estética: el encaje recorta el clip
 * CENTRADO en él (`fit.ts`: `offset_ms = (len − beat) / 2`), así que el punto
 * medio cae siempre dentro del tramo que verá el espectador. Antes se extraía
 * el segundo 1, que solo cae dentro si el desfase es menor de un segundo —
 * medido sobre vídeos reales, el 77 % de los clips empiezan más allá y con una
 * mediana de 5,9 s. Se describía y se puntuaba una imagen distinta de la que
 * sale en pantalla.
 */
export async function extractCaptionJpeg(
  input: { filePath: string; visual: 'video' | 'image'; durationMs: number | null },
  outPath: string,
  logger: pino.Logger,
): Promise<boolean> {
  const args: string[] = ['-v', 'error'];
  if (input.visual === 'video') {
    const seekMs = Math.max(0, Math.floor((input.durationMs ?? 2_000) / 2));
    args.push('-ss', (seekMs / 1000).toFixed(2));
  }
  args.push(
    '-i',
    input.filePath,
    '-frames:v',
    '1',
    '-vf',
    "scale='min(640,iw)':-2",
    '-q:v',
    '4',
    '-y',
    outPath,
  );
  try {
    await execa('ffmpeg', args);
    await fs.access(outPath);
    return true;
  } catch (err) {
    logger.warn(
      { err, filePath: input.filePath },
      'FFmpeg no disponible o falló; este asset queda sin caption VLM ni thumb',
    );
    return false;
  }
}

/**
 * El VLM real (OpenRouter) corre en la nube y no puede alcanzar
 * http://127.0.0.1:3001/files, así que el fotograma viaja como data: URL
 * base64 (el JPEG reescalado pesa decenas de KB). Documentado en el módulo.
 */
export async function toDataUrl(jpegPath: string): Promise<string> {
  const buf = await fs.readFile(jpegPath);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}
