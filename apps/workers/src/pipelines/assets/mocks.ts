import { registerMockOp } from '../../providers/llm.js';
import type { DirectorBeat } from './broll-director.js';
import type { DirectorBeatLite } from './chapter-director.js';
import type { DirectorBeat as EditingBeat } from './editing-director.js';

// Mock determinista del director de b-roll: por cada beat devuelve la consulta
// de escena enriquecida con una palabra clave de su narración, de modo que
// beats consecutivos salen distintos (imita el comportamiento real sin claves).

const STOP = new Set([
  'para',
  'con',
  'los',
  'las',
  'del',
  'que',
  'una',
  'unos',
  'unas',
  'por',
  'como',
  'más',
  'pero',
  'sus',
  'este',
  'esta',
  'sin',
  'sobre',
  'entre',
  'the',
  'and',
  'with',
  'for',
]);

function firstKeyword(text: string, avoid: Set<string>): string | null {
  return keywordsOf(text, avoid, 1)[0] ?? null;
}

// Palabras originales (con su forma tal cual en el texto) útiles como keyword.
function keywordsOf(text: string, avoid: Set<string>, limit: number): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const norm = raw
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]/gu, '');
    const clean = raw.replace(/[^\p{L}\p{N}]/gu, '');
    if (norm.length >= 4 && !STOP.has(norm) && !avoid.has(norm)) {
      avoid.add(norm);
      out.push(clean);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function buildMockBroll(mockContext: Record<string, unknown>): {
  beats: { idx: number; visuals: { keyword?: string; visual_query: string }[] }[];
} {
  const beats = Array.isArray(mockContext.beats) ? (mockContext.beats as DirectorBeat[]) : [];
  const used = new Set<string>();
  return {
    beats: beats.map((b) => {
      const base = b.sceneQuery ?? 'b-roll';
      // hasta 2 keywords → hasta 2 sub-planos anclados; imita el corte por palabra
      const kws = keywordsOf(b.text ?? '', used, 2);
      if (kws.length === 0) return { idx: b.idx, visuals: [{ visual_query: `${base} ${b.idx}` }] };
      return {
        idx: b.idx,
        visuals: kws.map((kw) => ({ keyword: kw, visual_query: `${base} ${kw.toLowerCase()}` })),
      };
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
    segments.push({
      title: kw ? `Sección ${kw}` : `Sección ${beat.idx}`,
      start_beat_idx: beat.idx,
    });
  }
  return { segments };
}

// Mock del director de edición: propone un callout con la primera keyword útil
// de algunos beats (uno de cada tres) para imitar la selección de momentos.
export function buildMockEditing(mockContext: Record<string, unknown>): {
  moments: {
    beat_idx: number;
    type: 'callout' | 'stat' | 'quote';
    text?: string;
    keyword?: string;
  }[];
} {
  const beats = Array.isArray(mockContext.beats) ? (mockContext.beats as EditingBeat[]) : [];
  const moments: { beat_idx: number; type: 'callout'; text: string }[] = [];
  for (let i = 1; i < beats.length; i += 3) {
    const beat = beats[i]!;
    const kws = keywordsOf(beat.text ?? '', new Set(), 2);
    if (kws.length > 0) moments.push({ beat_idx: beat.idx, type: 'callout', text: kws.join(' ') });
    if (moments.length >= 4) break;
  }
  return { moments };
}

/**
 * El juez de planos, en mock: deja el orden como está (elegido = 1). Es el
 * comportamiento correcto sin proveedor, porque el mock no puede leer los pies
 * de foto y cualquier otra elección sería aleatoria disfrazada de criterio.
 */
export function buildMockRerank(mockContext: Record<string, unknown>): {
  beats: { idx: number; elegido: number }[];
} {
  const beats = Array.isArray(mockContext.beats) ? (mockContext.beats as { idx: number }[]) : [];
  return { beats: beats.map((b) => ({ idx: b.idx, elegido: 1 })) };
}

export function registerAssetsMocks(): void {
  registerMockOp('broll_director', ({ mockContext }) => buildMockBroll(mockContext));
  registerMockOp('broll_rerank', ({ mockContext }) => buildMockRerank(mockContext));
  registerMockOp('chapter_director', ({ mockContext }) => buildMockChapters(mockContext));
  registerMockOp('editing_director', ({ mockContext }) => buildMockEditing(mockContext));
}
