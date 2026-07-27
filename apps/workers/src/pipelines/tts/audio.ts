import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { LOUDNORM_LUFS, LOUDNORM_TRUE_PEAK } from '@fabrica/shared';

// Utilidades ffmpeg del pipeline de voz: conversión a WAV homogéneo,
// silencios, concatenación con demuxer concat, loudnorm y sondas.

export async function toWav(inputPath: string, outputPath: string): Promise<void> {
  await execa('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-ar',
    '44100',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    outputPath,
  ]);
}

export async function makeSilence(durationMs: number, outputPath: string): Promise<void> {
  await execa('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono',
    '-t',
    (durationMs / 1000).toFixed(3),
    '-c:a',
    'pcm_s16le',
    outputPath,
  ]);
}

export async function concatWavs(parts: string[], outputPath: string): Promise<void> {
  const listPath = path.join(path.dirname(outputPath), 'concat-list.txt');
  const lines = parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listPath, `${lines}\n`, 'utf8');
  await execa('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputPath]);
}

export async function loudnormToWav(inputPath: string, outputPath: string): Promise<void> {
  await execa('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-af',
    `loudnorm=I=${LOUDNORM_LUFS}:TP=${LOUDNORM_TRUE_PEAK}:LRA=11`,
    '-ar',
    '44100',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    outputPath,
  ]);
}

export async function toAacPreview(inputPath: string, outputPath: string): Promise<void> {
  await execa('ffmpeg', ['-y', '-i', inputPath, '-c:a', 'aac', '-b:a', '128k', outputPath]);
}

export async function probeDurationMs(filePath: string): Promise<number> {
  const { stdout } = await execa('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe no pudo medir la duración de ${filePath}`);
  return Math.round(seconds * 1000);
}

// Mide la sonoridad integrada real del archivo final (input_i del análisis).
// Si la medición no se puede parsear devuelve el objetivo como aproximación,
// dejándolo registrado: un maestro con lufs = objetivo exacto puede venir de aquí.
export async function measureLufs(
  filePath: string,
  logger?: { warn: (obj: object, msg: string) => void },
): Promise<number> {
  const { stderr } = await execa('ffmpeg', [
    '-hide_banner',
    '-i',
    filePath,
    '-af',
    `loudnorm=I=${LOUDNORM_LUFS}:TP=${LOUDNORM_TRUE_PEAK}:print_format=json`,
    '-f',
    'null',
    '-',
  ]);
  const fallback = () => {
    logger?.warn({ filePath }, 'No se pudo medir LUFS; se anota el objetivo como aproximación');
    return LOUDNORM_LUFS;
  };
  const jsonStart = stderr.lastIndexOf('{');
  if (jsonStart < 0) return fallback();
  try {
    const parsed = JSON.parse(stderr.slice(jsonStart)) as { input_i?: string };
    const lufs = Number.parseFloat(parsed.input_i ?? '');
    return Number.isFinite(lufs) ? lufs : fallback();
  } catch {
    return fallback();
  }
}
