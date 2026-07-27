import { describe, expect, it } from 'vitest';
import { CUE_MAX_CHARS, CUE_MAX_LINES, CUE_MAX_S, CUE_MAX_WORDS, CUE_MIN_S } from '@fabrica/shared';
import { buildCues, type CueToken } from './cues.js';

function makeTokens(words: string[], wordMs = 400, gapMs = 0): CueToken[] {
  const tokens: CueToken[] = [];
  let t = 0;
  for (const raw of words) {
    tokens.push({ from_ms: t, to_ms: t + wordMs, raw });
    t += wordMs + gapMs;
  }
  return tokens;
}

function lines(text: string): string[] {
  return text.split('\n');
}

describe('buildCues', () => {
  it('respeta los límites de caracteres, palabras y líneas', () => {
    const tokens = makeTokens(Array.from({ length: 40 }, () => 'palabra'));
    const cues = buildCues(tokens);

    expect(cues.length).toBeGreaterThan(0);
    for (const cue of cues) {
      const cueLines = lines(cue.text);
      expect(cueLines.length).toBeLessThanOrEqual(CUE_MAX_LINES);
      for (const line of cueLines) {
        expect(line.length).toBeLessThanOrEqual(CUE_MAX_CHARS);
        expect(line.split(' ').length).toBeLessThanOrEqual(CUE_MAX_WORDS);
      }
    }
    // ninguna palabra se pierde
    const total = cues.reduce((acc, c) => acc + c.words.length, 0);
    expect(total).toBe(40);
  });

  it('limita palabras por línea aunque sean muy cortas', () => {
    const tokens = makeTokens(Array.from({ length: 30 }, () => 'ab'));
    const cues = buildCues(tokens);

    for (const cue of cues) {
      for (const line of lines(cue.text)) {
        expect(line.split(' ').length).toBeLessThanOrEqual(CUE_MAX_WORDS);
      }
    }
  });

  it('la puntuación fuerte cierra el cue', () => {
    const tokens = makeTokens(['Hola', 'mundo.', 'Segunda', 'frase', 'que', 'sigue.']);
    const cues = buildCues(tokens);

    expect(cues.length).toBe(2);
    expect(cues[0]?.text).toBe('Hola mundo.');
    expect(cues[1]?.text).toBe('Segunda frase que sigue.');
  });

  it('ningún cue supera la duración máxima', () => {
    // palabras separadas 1 s entre sí: fuerza cierres por duración
    const tokens = makeTokens(Array.from({ length: 20 }, () => 'toma'), 400, 600);
    const cues = buildCues(tokens);

    for (const cue of cues) {
      expect(cue.to_ms - cue.from_ms).toBeLessThanOrEqual(CUE_MAX_S * 1000);
    }
  });

  it('estira los cues demasiado cortos hasta el mínimo cuando hay hueco', () => {
    const tokens = makeTokens(['Final.', 'corto.']);
    const cues = buildCues(tokens, 60_000);

    for (const cue of cues.slice(-1)) {
      expect(cue.to_ms - cue.from_ms).toBeGreaterThanOrEqual(CUE_MIN_S * 1000);
    }
  });

  it('las palabras del cue conservan sus tiempos para el karaoke', () => {
    const tokens = makeTokens(['Una', 'frase', 'normal.']);
    const cues = buildCues(tokens);

    expect(cues[0]?.words).toEqual([
      { from_ms: 0, to_ms: 400, w: 'Una' },
      { from_ms: 400, to_ms: 800, w: 'frase' },
      { from_ms: 800, to_ms: 1200, w: 'normal.' },
    ]);
    expect(cues[0]?.from_ms).toBe(0);
  });
});
