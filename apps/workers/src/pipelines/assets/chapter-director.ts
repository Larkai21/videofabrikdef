import { z } from 'zod';
import type { Segment } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { ledgeredLlmJson } from '../ideas/llm-call.js';

// Director de capítulos: agrupa los beats del vídeo en 4-6 segmentos temáticos
// con un título corto de subtema. Alimenta la tarjeta de sección centrada y los
// capítulos de la descripción de YouTube. Una sola llamada LLM por vídeo.

export interface DirectorBeatLite {
  idx: number;
  from_ms: number;
  text: string;
}

const MIN_SEGMENTS = 3;
const MAX_SEGMENTS = 6;

export const chapterResultSchema = z.object({
  segments: z
    .array(
      z.object({
        title: z.string().min(1).max(48),
        start_beat_idx: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

export interface ChapterParams {
  videoId: string;
  channelId: string;
  lang: 'en' | 'es';
  beats: DirectorBeatLite[];
}

export function buildChapterPrompt(params: ChapterParams): { system: string; user: string } {
  const langName = params.lang === 'en' ? 'inglés' : 'español';
  const system = [
    'Eres editor de un canal de YouTube tipo "faceless".',
    'Recibes la narración de un vídeo dividida en beats numerados.',
    `Agrupa los beats en ${MIN_SEGMENTS}-${MAX_SEGMENTS} segmentos temáticos consecutivos.`,
    'Reglas:',
    `- Un título corto por segmento (2-5 palabras), en ${langName}, que resuma su subtema.`,
    '- El primer segmento empieza en el beat 0. Los segmentos no se solapan y van en orden.',
    '- start_beat_idx es el índice del primer beat de cada segmento (creciente, sin repetir).',
    '- Títulos concretos del contenido (no "Introducción/Parte 1"): p. ej. "Arquitectura", "Cómo usarlo".',
    'Devuelve JSON: { "segments": [ { "title": string, "start_beat_idx": number } ] }.',
  ].join('\n');

  const user = [
    'Beats (idx · narración):',
    ...params.beats.map(
      (b) => `${b.idx} · ${b.text.replace(/\s+/g, ' ').trim().slice(0, 160)}`,
    ),
  ].join('\n');

  return { system, user };
}

// Normaliza la salida del LLM a Segment[] usable: ordena por beat, descarta
// índices fuera de rango o repetidos, fuerza que el primero arranque en 0 y
// resuelve from_ms desde el beat. Ante fallo devuelve un único segmento.
function toSegments(
  raw: { title: string; start_beat_idx: number }[],
  beats: DirectorBeatLite[],
): Segment[] {
  const byIdx = new Map(beats.map((b) => [b.idx, b]));
  const seen = new Set<number>();
  const clean = raw
    .filter((s) => byIdx.has(s.start_beat_idx) && !seen.has(s.start_beat_idx) && seen.add(s.start_beat_idx))
    .sort((a, b) => a.start_beat_idx - b.start_beat_idx)
    .slice(0, MAX_SEGMENTS);
  const segments: Segment[] = clean.map((s) => ({
    title: s.title.trim(),
    beat_idx: s.start_beat_idx,
    from_ms: byIdx.get(s.start_beat_idx)!.from_ms,
  }));
  // el primer segmento SIEMPRE arranca en el beat 0 / 0 ms (la sección de apertura)
  const first = beats[0];
  if (first && (segments.length === 0 || segments[0]!.beat_idx !== first.idx)) {
    segments.unshift({ title: segments[0]?.title ?? 'Introducción', beat_idx: first.idx, from_ms: 0 });
    if (segments.length > MAX_SEGMENTS) segments.length = MAX_SEGMENTS;
  } else if (segments[0]) {
    segments[0] = { ...segments[0], from_ms: 0 };
  }
  return segments;
}

// Fallback sin LLM: un único segmento de apertura (el render cae entonces a
// computeChapters para los capítulos de YouTube).
function fallbackSegments(beats: DirectorBeatLite[]): Segment[] {
  const first = beats[0];
  return first ? [{ title: 'Introducción', beat_idx: first.idx, from_ms: 0 }] : [];
}

export async function directChapters(
  ctx: WorkerContext,
  params: ChapterParams,
): Promise<Segment[]> {
  if (params.beats.length === 0) return [];
  const { system, user } = buildChapterPrompt(params);
  try {
    const data = await ledgeredLlmJson(ctx, {
      videoId: params.videoId,
      channelId: params.channelId,
      op: 'chapter_director',
      system,
      user,
      schema: chapterResultSchema,
      mockContext: { beats: params.beats },
    });
    return toSegments(data.segments, params.beats);
  } catch (err) {
    ctx.logger.warn(
      { err, videoId: params.videoId },
      'Director de capítulos falló; se usa un segmento de apertura',
    );
    return fallbackSegments(params.beats);
  }
}
