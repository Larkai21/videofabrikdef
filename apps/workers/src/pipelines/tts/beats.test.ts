import { describe, expect, it } from 'vitest';
import { computeBeats, type BeatSceneSpan, type BeatToken } from './beats.js';

// Fixtures sintéticas: palabras de duración fija con finales de frase y
// cláusula controlados, para verificar el greedy de 8–15 s.

interface TokenSpec {
  count: number;
  wordMs: number;
  sentenceEndEvery?: number;
  clauseEndAt?: number[];
  sceneIdx?: number;
  startMs?: number;
}

function makeTokens(spec: TokenSpec): BeatToken[] {
  const tokens: BeatToken[] = [];
  const start = spec.startMs ?? 0;
  for (let i = 0; i < spec.count; i++) {
    const from = start + i * spec.wordMs;
    const isSentenceEnd =
      (spec.sentenceEndEvery !== undefined && (i + 1) % spec.sentenceEndEvery === 0) ||
      i === spec.count - 1;
    tokens.push({
      from_ms: from,
      to_ms: from + spec.wordMs,
      raw: isSentenceEnd ? `p${i}.` : spec.clauseEndAt?.includes(i) ? `p${i},` : `p${i}`,
      sentenceEnd: isSentenceEnd,
      clauseEnd: spec.clauseEndAt?.includes(i) ?? false,
      sceneIdx: spec.sceneIdx ?? 0,
    });
  }
  return tokens;
}

const sameVec = async (texts: string[]) => texts.map(() => [1, 0, 0]);

const orthogonalVecs = async (texts: string[]) =>
  texts.map((_, i) => {
    const v = [0, 0, 0];
    v[i % 3] = 1;
    return v;
  });

function singleScene(totalMs: number): BeatSceneSpan[] {
  return [{ idx: 0, visual_query: 'server room blue lights', from_ms: 0, to_ms: totalMs }];
}

describe('computeBeats', () => {
  it('frases regulares: corta en finales de frase dentro de la ventana 8-15 s', async () => {
    // frases de 4 s (10 palabras de 400 ms); total 40 s
    const tokens = makeTokens({ count: 100, wordMs: 400, sentenceEndEvery: 10 });
    const beats = await computeBeats(tokens, singleScene(40_000), 40_000, sameVec);

    expect(beats.length).toBe(3);
    expect(beats.map((b) => b.to_ms)).toEqual([12_000, 24_000, 40_000]);
    for (const beat of beats.slice(0, -1)) {
      const len = beat.to_ms - beat.from_ms;
      expect(len).toBeGreaterThanOrEqual(8_000);
      expect(len).toBeLessThanOrEqual(15_000);
    }
    const last = beats[beats.length - 1];
    expect(last).toBeDefined();
    const lastLen = (last?.to_ms ?? 0) - (last?.from_ms ?? 0);
    expect(lastLen).toBeGreaterThanOrEqual(5_000);
    expect(lastLen).toBeLessThanOrEqual(18_000);
    // los índices son consecutivos desde 0
    expect(beats.map((b) => b.idx)).toEqual([0, 1, 2]);
  });

  it('sin frase en ventana: corta en coma', async () => {
    // una sola frase de 30 s con una coma en 11 s (palabra 21 termina en 11000)
    const tokens = makeTokens({ count: 60, wordMs: 500, clauseEndAt: [21] });
    const beats = await computeBeats(tokens, singleScene(30_000), 30_000, sameVec);

    expect(beats[0]?.to_ms).toBe(11_000);
  });

  it('sin puntuación alguna: corta en final de palabra cercano al objetivo', async () => {
    const tokens = makeTokens({ count: 60, wordMs: 500 });
    const beats = await computeBeats(tokens, singleScene(30_000), 30_000, sameVec);

    // el final de palabra más cercano a 11,5 s es exactamente 11500
    expect(beats[0]?.to_ms).toBe(11_500);
  });

  it('nunca deja un último beat huérfano de menos de 5 s', async () => {
    // total 19 s con final de frase tentador en 15 s (dejaría huérfano de 4 s)
    const tokens = makeTokens({ count: 38, wordMs: 500, sentenceEndEvery: 30 });
    const beats = await computeBeats(tokens, singleScene(19_000), 19_000, sameVec);

    for (const beat of beats) {
      expect(beat.to_ms - beat.from_ms).toBeGreaterThanOrEqual(5_000);
    }
    expect(beats.map((b) => b.to_ms)).not.toContain(15_000);
    const last = beats[beats.length - 1];
    expect(last?.to_ms).toBe(19_000);
  });

  it('audio corto: un solo beat con todo el contenido', async () => {
    const tokens = makeTokens({ count: 20, wordMs: 500 });
    const beats = await computeBeats(tokens, singleScene(10_000), 10_000, sameVec);

    expect(beats.length).toBe(1);
    expect(beats[0]?.from_ms).toBe(0);
    expect(beats[0]?.to_ms).toBe(10_000);
    expect(beats[0]?.text).toContain('p0');
  });

  it('hereda la visual_query de la escena dominante cuando las queries se parecen', async () => {
    const scenes: BeatSceneSpan[] = [
      { idx: 0, visual_query: 'server room', from_ms: 0, to_ms: 5_000 },
      { idx: 1, visual_query: 'city night', from_ms: 5_000, to_ms: 30_000 },
    ];
    // frase que termina en 12 s → beat 0 abarca A (5 s) y B (7 s): domina B
    const tokens = makeTokens({ count: 60, wordMs: 500, sentenceEndEvery: 24 });
    const beats = await computeBeats(tokens, scenes, 30_000, sameVec);

    expect(beats[0]?.to_ms).toBe(12_000);
    expect(beats[0]?.visual_query).toBe('city night');
    expect(beats[0]?.multiScene).toBe(false);
  });

  it('marca multi_scene y prioriza la primera escena cuando las queries divergen', async () => {
    const scenes: BeatSceneSpan[] = [
      { idx: 0, visual_query: 'server room', from_ms: 0, to_ms: 5_000 },
      { idx: 1, visual_query: 'city night', from_ms: 5_000, to_ms: 30_000 },
    ];
    const tokens = makeTokens({ count: 60, wordMs: 500, sentenceEndEvery: 24 });
    const beats = await computeBeats(tokens, scenes, 30_000, orthogonalVecs);

    expect(beats[0]?.multiScene).toBe(true);
    expect(beats[0]?.visual_query).toBe('server room');
  });

  it('el texto del beat concatena solo sus palabras', async () => {
    const tokens = makeTokens({ count: 100, wordMs: 400, sentenceEndEvery: 10 });
    const beats = await computeBeats(tokens, singleScene(40_000), 40_000, sameVec);

    expect(beats[0]?.text.startsWith('p0')).toBe(true);
    expect(beats[0]?.text).toContain('p29.');
    expect(beats[0]?.text).not.toContain('p30');
    expect(beats[1]?.text.startsWith('p30')).toBe(true);
  });
});
