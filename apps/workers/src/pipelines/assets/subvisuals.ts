import type { DirectorCut } from './broll-director.js';

// Convierte los cortes del director (1..N, con keyword opcional) en tramos
// temporales DENTRO del beat. Cada corte con keyword se ancla al instante en
// que se pronuncia esa palabra (de master.cues); sin keyword resoluble, se
// reparte el tramo de forma uniforme. Nunca cambia [from_ms, to_ms] del beat
// (principio 1): solo lo subdivide internamente.

export interface BeatWord {
  w: string;
  from_ms: number;
  to_ms: number;
}

export interface SubvisualSpan {
  from_ms: number;
  to_ms: number;
  visual_query: string;
  keyword?: string;
}

// tramo mínimo de un sub-plano: por debajo se fusiona con el anterior (evita
// planos-relámpago que se notan como parpadeo)
const MIN_SUBVISUAL_MS = 2200;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// instante de la primera palabra (a partir de `fromIdx`) que casa con `keyword`
function findKeywordMs(
  words: BeatWord[],
  keyword: string,
  fromIdx: number,
): { ms: number; idx: number } | null {
  const norm = normalize(keyword);
  if (norm === '') return null;
  for (let j = fromIdx; j < words.length; j++) {
    const wn = normalize(words[j]!.w);
    if (wn === norm || wn.startsWith(norm) || norm.startsWith(wn)) {
      return { ms: words[j]!.from_ms, idx: j };
    }
  }
  return null;
}

export function computeSubvisualSpans(
  beat: { from_ms: number; to_ms: number },
  words: BeatWord[],
  cuts: DirectorCut[],
): SubvisualSpan[] {
  const full = beat.to_ms - beat.from_ms;
  const first = cuts[0];
  if (cuts.length <= 1 || full < 2 * MIN_SUBVISUAL_MS) {
    return [{ from_ms: beat.from_ms, to_ms: beat.to_ms, visual_query: first?.visual_query ?? '' }];
  }

  // anclar cada corte (el primero siempre arranca en beat.from_ms)
  const anchors: { ms: number; cut: DirectorCut }[] = [{ ms: beat.from_ms, cut: first! }];
  let wordCursor = 0;
  let lastMs = beat.from_ms;
  for (let i = 1; i < cuts.length; i++) {
    const cut = cuts[i]!;
    if (cut.keyword === undefined) continue;
    const hit = findKeywordMs(words, cut.keyword, wordCursor);
    if (!hit) continue;
    // exige tramo mínimo respecto al anterior y hasta el final del beat
    if (hit.ms - lastMs >= MIN_SUBVISUAL_MS && beat.to_ms - hit.ms >= MIN_SUBVISUAL_MS) {
      anchors.push({ ms: hit.ms, cut });
      lastMs = hit.ms;
      wordCursor = hit.idx + 1;
    }
  }

  // reparto uniforme SOLO si los cortes extra no traían keyword (el director
  // quiso varios planos "por idea"); si traían keyword pero no se pudo anclar,
  // se respeta un único plano (no inventamos cortes arbitrarios).
  const extrasHaveKeyword = cuts.slice(1).some((c) => c.keyword !== undefined);
  if (anchors.length === 1 && cuts.length > 1 && !extrasHaveKeyword) {
    const n = Math.min(cuts.length, Math.max(1, Math.floor(full / MIN_SUBVISUAL_MS)));
    if (n <= 1)
      return [{ from_ms: beat.from_ms, to_ms: beat.to_ms, visual_query: first!.visual_query }];
    const step = Math.round(full / n);
    return Array.from({ length: n }, (_, i) => ({
      from_ms: beat.from_ms + i * step,
      to_ms: i === n - 1 ? beat.to_ms : beat.from_ms + (i + 1) * step,
      visual_query: cuts[i]!.visual_query,
      ...(cuts[i]!.keyword ? { keyword: cuts[i]!.keyword } : {}),
    }));
  }

  return anchors.map((a, i) => ({
    from_ms: a.ms,
    to_ms: i === anchors.length - 1 ? beat.to_ms : anchors[i + 1]!.ms,
    visual_query: a.cut.visual_query,
    ...(a.cut.keyword ? { keyword: a.cut.keyword } : {}),
  }));
}

// Palabras del máster que caen dentro de un beat (para anclar keywords).
export function wordsInSpan(
  cues: { words?: BeatWord[] }[] | undefined,
  fromMs: number,
  toMs: number,
): BeatWord[] {
  if (!cues) return [];
  const out: BeatWord[] = [];
  for (const cue of cues) {
    for (const w of cue.words ?? []) {
      if (w.from_ms >= fromMs && w.from_ms < toMs) out.push(w);
    }
  }
  return out.sort((a, b) => a.from_ms - b.from_ms);
}
