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

// Nº de segmentos proporcional a la longitud: ~1 cada 4 beats, acotado [2, 6].
// Un vídeo corto (p. ej. 2 min ≈ 10 beats) no debe llenarse de tarjetas.
function segmentRange(beatCount: number): { min: number; max: number } {
  const max = Math.max(2, Math.min(6, Math.round(beatCount / 4)));
  const min = Math.max(2, max - 2);
  return { min, max };
}

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
  const { min, max } = segmentRange(params.beats.length);
  const system = [
    'Eres editor de un canal de YouTube tipo "faceless".',
    'Recibes la narración de un vídeo dividida en beats numerados.',
    `Agrupa los beats en ${min}-${max} segmentos temáticos consecutivos.`,
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
  const max = segmentRange(beats.length).max;
  const clean = raw
    .filter((s) => byIdx.has(s.start_beat_idx) && !seen.has(s.start_beat_idx) && seen.add(s.start_beat_idx))
    .sort((a, b) => a.start_beat_idx - b.start_beat_idx)
    .slice(0, max);
  const segments: Segment[] = clean.map((s) => ({
    title: s.title.trim(),
    beat_idx: s.start_beat_idx,
    from_ms: byIdx.get(s.start_beat_idx)!.from_ms,
  }));
  // el primer segmento SIEMPRE arranca en el beat 0 / 0 ms (la sección de apertura)
  const first = beats[0];
  if (first && (segments.length === 0 || segments[0]!.beat_idx !== first.idx)) {
    segments.unshift({ title: segments[0]?.title ?? 'Introducción', beat_idx: first.idx, from_ms: 0 });
    if (segments.length > max) segments.length = max;
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
