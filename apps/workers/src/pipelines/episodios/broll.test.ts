import { describe, expect, it } from 'vitest';
import type { BeatToken } from '../tts/beats.js';
import { filtrarInsertos, BROLL_MAX_INSERTOS } from './broll.js';
import { frasesDe } from './relleno.js';

// 6 frases de 2 s (5 palabras de 400 ms), fin de frase en la quinta palabra
function tokens(): BeatToken[] {
  const out: BeatToken[] = [];
  for (let f = 0; f < 6; f += 1) {
    for (let p = 0; p < 5; p += 1) {
      const from = (f * 5 + p) * 400;
      out.push({
        from_ms: from,
        to_ms: from + 350,
        raw: `p${f}-${p}`,
        sentenceEnd: p === 4,
        clauseEnd: false,
        sceneIdx: 0,
      });
    }
  }
  return out;
}

describe('filtrarInsertos', () => {
  const frases = frasesDe(tokens());

  it('ni la primera ni la última frase llevan inserto', () => {
    const out = filtrarInsertos(frases, [
      { indice: 0, query: 'a' },
      { indice: 5, query: 'b' },
      { indice: 2, query: 'driving car' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.frase.idx).toBe(2);
  });

  it('respeta el tope de insertos', () => {
    const out = filtrarInsertos(frases, [
      { indice: 1, query: 'a' },
      { indice: 2, query: 'b' },
      { indice: 3, query: 'c' },
      { indice: 4, query: 'd' },
    ]);
    expect(out).toHaveLength(BROLL_MAX_INSERTOS);
  });

  it('índices duplicados o fuera de rango se ignoran', () => {
    const out = filtrarInsertos(frases, [
      { indice: 2, query: 'a' },
      { indice: 2, query: 'b' },
      { indice: 99, query: 'c' },
    ]);
    expect(out).toHaveLength(1);
  });

  it('una frase demasiado corta no aguanta un inserto', () => {
    // frase de 1 s: por debajo de BROLL_MIN_MS
    const cortos: BeatToken[] = [
      { from_ms: 0, to_ms: 2000, raw: 'a.', sentenceEnd: true, clauseEnd: false, sceneIdx: 0 },
      { from_ms: 2100, to_ms: 3000, raw: 'b.', sentenceEnd: true, clauseEnd: false, sceneIdx: 0 },
      { from_ms: 3100, to_ms: 6000, raw: 'c.', sentenceEnd: true, clauseEnd: false, sceneIdx: 0 },
    ];
    const fr = frasesDe(cortos);
    expect(filtrarInsertos(fr, [{ indice: 1, query: 'x' }])).toHaveLength(0);
  });
});
