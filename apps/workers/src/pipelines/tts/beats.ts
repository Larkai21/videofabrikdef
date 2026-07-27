// Algoritmo de beats (docs/voz-y-beats.md §4): huecos visuales de 8–15 s
// alineados con el sentido del texto. Greedy sobre finales de frase con
// fallback a coma/conjunción y, en último término, a final de palabra.
// Lógica pura: el embedder se inyecta para poder testear sin infraestructura.

import {
  BEAT_LAST_MAX_S,
  BEAT_LAST_MIN_S,
  BEAT_MAX_S,
  BEAT_MIN_S,
  BEAT_TARGET_S,
} from '@fabrica/shared';
import { cosineSimilarity } from '../../providers/embeddings.js';

export interface BeatToken {
  from_ms: number;
  to_ms: number;
  raw: string;
  sentenceEnd: boolean;
  clauseEnd: boolean;
  sceneIdx: number;
}

export interface BeatSceneSpan {
  idx: number;
  visual_query: string;
  from_ms: number;
  to_ms: number;
}

export interface ComputedBeat {
  idx: number;
  from_ms: number;
  to_ms: number;
  text: string;
  visual_query: string;
  // sin columna propia: el caller lo refleja en el log
  multiScene: boolean;
}

const MULTI_SCENE_COS = 0.5;

function closestTo(target: number, candidates: number[]): number | undefined {
  let best: number | undefined;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c - target);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

function pickCut(
  t: number,
  totalMs: number,
  strong: number[],
  weak: number[],
  wordEnds: number[],
): number | undefined {
  const lo = t + BEAT_MIN_S * 1000;
  // nunca dejar un último beat huérfano de menos de BEAT_LAST_MIN_S
  const hi = Math.min(t + BEAT_MAX_S * 1000, totalMs - BEAT_LAST_MIN_S * 1000);
  const target = t + BEAT_TARGET_S * 1000;
  if (hi < lo) return undefined;

  const inWindow = (xs: number[]) => xs.filter((x) => x >= lo && x <= hi);

  const fromStrong = closestTo(target, inWindow(strong));
  if (fromStrong !== undefined) return fromStrong;
  const fromWeak = closestTo(target, inWindow(weak));
  if (fromWeak !== undefined) return fromWeak;
  // nunca dentro de palabra: el último recurso es el final de palabra más cercano
  const fromWord = closestTo(target, inWindow(wordEnds));
  if (fromWord !== undefined) return fromWord;
  // sin final de palabra en la ventana (habla muy dispersa): el más cercano
  // fuera de ventana que no rompa el mínimo del último beat
  return closestTo(
    target,
    wordEnds.filter((x) => x > t + 1000 && x <= totalMs - BEAT_LAST_MIN_S * 1000),
  );
}

export async function computeBeats(
  tokens: BeatToken[],
  scenes: BeatSceneSpan[],
  totalMs: number,
  embed: (texts: string[]) => Promise<number[][]>,
): Promise<ComputedBeat[]> {
  const strong = tokens.filter((tk) => tk.sentenceEnd).map((tk) => tk.to_ms);
  const weak = tokens.filter((tk) => tk.clauseEnd && !tk.sentenceEnd).map((tk) => tk.to_ms);
  const wordEnds = tokens.map((tk) => tk.to_ms);

  // el final del audio siempre cierra el último beat; quitar el último final
  // de frase si coincide con el final para no duplicar cortes
  const cuts: number[] = [];
  let t = 0;
  while (totalMs - t > BEAT_LAST_MAX_S * 1000) {
    const cut = pickCut(t, totalMs, strong, weak, wordEnds);
    if (cut === undefined || cut <= t) break;
    cuts.push(cut);
    t = cut;
  }

  // último beat huérfano (< mínimo): fusionarlo con el beat anterior
  if (totalMs - t < BEAT_LAST_MIN_S * 1000 && cuts.length > 0) {
    cuts.pop();
  }

  const bounds = [0, ...cuts, totalMs];
  const spans: { from: number; to: number }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i];
    const to = bounds[i + 1];
    if (from === undefined || to === undefined || to <= from) continue;
    spans.push({ from, to });
  }

  // embeddings de queries únicas en una sola llamada
  const uniqueQueries = [...new Set(scenes.map((s) => s.visual_query))];
  const vectors = uniqueQueries.length > 0 ? await embed(uniqueQueries) : [];
  const vecByQuery = new Map(uniqueQueries.map((q, i) => [q, vectors[i] ?? []]));

  const beats: ComputedBeat[] = [];
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (!span) continue;
    const text = tokens
      .filter((tk) => tk.to_ms > span.from && tk.to_ms <= span.to)
      .map((tk) => tk.raw)
      .join(' ');

    // escenas solapadas por ms aportados, ordenadas por tiempo
    const overlaps = scenes
      .map((s) => ({
        scene: s,
        ms: Math.max(0, Math.min(span.to, s.to_ms) - Math.max(span.from, s.from_ms)),
      }))
      .filter((o) => o.ms > 0)
      .sort((a, b) => a.scene.from_ms - b.scene.from_ms);

    let visualQuery = overlaps[0]?.scene.visual_query ?? scenes[0]?.visual_query ?? '';
    let multiScene = false;

    if (overlaps.length >= 1) {
      const dominant = [...overlaps].sort((a, b) => b.ms - a.ms)[0];
      visualQuery = dominant?.scene.visual_query ?? visualQuery;
      if (overlaps.length >= 2) {
        const [a, b] = [...overlaps].sort((x, y) => y.ms - x.ms);
        if (a && b && a.scene.visual_query !== b.scene.visual_query) {
          const va = vecByQuery.get(a.scene.visual_query) ?? [];
          const vb = vecByQuery.get(b.scene.visual_query) ?? [];
          if (cosineSimilarity(va, vb) < MULTI_SCENE_COS) {
            multiScene = true;
            // queries muy distintas: prioriza la primera escena en el tiempo
            visualQuery = overlaps[0]?.scene.visual_query ?? visualQuery;
          }
        }
      }
    }

    beats.push({
      idx: i,
      from_ms: Math.round(span.from),
      to_ms: Math.round(span.to),
      text,
      visual_query: visualQuery,
      multiScene,
    });
  }

  return beats;
}
