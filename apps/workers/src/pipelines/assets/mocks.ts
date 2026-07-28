import { registerMockOp } from '../../providers/llm.js';
import type { DirectorBeat } from './broll-director.js';
import type { DirectorBeatLite } from './chapter-director.js';

// Mock determinista del director de b-roll: por cada beat devuelve la consulta
// de escena enriquecida con una palabra clave de su narración, de modo que
// beats consecutivos salen distintos (imita el comportamiento real sin claves).

const STOP = new Set([
  'para', 'con', 'los', 'las', 'del', 'que', 'una', 'unos', 'unas', 'por', 'como',
  'más', 'pero', 'sus', 'este', 'esta', 'sin', 'sobre', 'entre', 'the', 'and', 'with', 'for',
]);

function firstKeyword(text: string, avoid: Set<string>): string | null {
  for (const raw of text.split(/\s+/)) {
    const token = raw
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]/gu, '');
    if (token.length >= 4 && !STOP.has(token) && !avoid.has(token)) return token;
  }
  return null;
}

export function buildMockBroll(mockContext: Record<string, unknown>): {
  beats: { idx: number; visual_query: string }[];
} {
  const beats = Array.isArray(mockContext.beats) ? (mockContext.beats as DirectorBeat[]) : [];
  const used = new Set<string>();
  return {
    beats: beats.map((b) => {
      const kw = firstKeyword(b.text ?? '', used);
      if (kw) used.add(kw);
      const base = b.sceneQuery ?? 'b-roll';
      return { idx: b.idx, visual_query: kw ? `${base} ${kw}` : `${base} ${b.idx}` };
    }),
  };
}

// Mock del director de capítulos: parte los beats en ~4 segmentos iguales con
// un título derivado de la primera palabra útil de su beat inicial.
export function buildMockChapters(mockContext: Record<string, unknown>): {
  segments: { title: string; start_beat_idx: number }[];
} {
  const beats = Array.isArray(mockContext.beats) ? (mockContext.beats as DirectorBeatLite[]) : [];
  if (beats.length === 0) return { segments: [] };
  const n = Math.min(4, beats.length);
  const step = Math.ceil(beats.length / n);
  const segments: { title: string; start_beat_idx: number }[] = [];
  for (let i = 0; i < beats.length; i += step) {
    const beat = beats[i]!;
    const kw = firstKeyword(beat.text ?? '', new Set());
    segments.push({ title: kw ? `Sección ${kw}` : `Sección ${beat.idx}`, start_beat_idx: beat.idx });
  }
  return { segments };
}

export function registerAssetsMocks(): void {
  registerMockOp('broll_director', ({ mockContext }) => buildMockBroll(mockContext));
  registerMockOp('chapter_director', ({ mockContext }) => buildMockChapters(mockContext));
}
