import { describe, expect, it } from 'vitest';
import type { BeatToken } from '../tts/beats.js';
import { detectarRisas, risaTrasBeat } from './risas.js';

const tok = (
  from: number,
  to: number,
  extra: Partial<BeatToken> = {},
): BeatToken => ({
  from_ms: from,
  to_ms: to,
  raw: 'palabra',
  sentenceEnd: false,
  clauseEnd: false,
  sceneIdx: 0,
  ...extra,
});

describe('detectarRisas', () => {
  it('el estirón de un fin de frase SIN silencio es una risa', () => {
    // palabra que "dura" 2 s: 400 ms de voz + 1,6 s de estirón sobre risas
    const tokens = [tok(0, 2000, { sentenceEnd: true }), tok(2100, 2400)];
    const risas = detectarRisas(tokens, []);
    expect(risas).toHaveLength(1);
    expect(risas[0]!.at_ms).toBe(400);
    expect(risas[0]!.dur_ms).toBe(1600);
  });

  it('el mismo estirón cubierto por silencio es pausa callada, no risa', () => {
    const tokens = [tok(0, 2000, { sentenceEnd: true }), tok(2100, 2400)];
    const risas = detectarRisas(tokens, [[400, 2000]]);
    expect(risas).toHaveLength(0);
  });

  it('una palabra larga a mitad de frase no es reacción', () => {
    // sin sentenceEnd/clauseEnd el estirón no se evalúa
    const tokens = [tok(0, 2000), tok(2050, 2400)];
    const risas = detectarRisas(tokens, []);
    expect(risas).toHaveLength(0);
  });

  it('un hueco entre palabras sin silencio también cuenta', () => {
    const tokens = [tok(0, 300), tok(1500, 1800)];
    const risas = detectarRisas(tokens, []);
    expect(risas).toHaveLength(1);
    expect(risas[0]!.at_ms).toBe(300);
    expect(risas[0]!.dur_ms).toBe(1200);
  });

  it('el mismo hueco con silencio detrás no cuenta', () => {
    const tokens = [tok(0, 300), tok(1500, 1800)];
    expect(detectarRisas(tokens, [[300, 1400]])).toHaveLength(0);
  });

  it('eventos contiguos se fusionan en una carcajada', () => {
    // estirón del fin de frase + hueco hasta la siguiente palabra, pegados
    const tokens = [tok(0, 1200, { sentenceEnd: true }), tok(2200, 2500)];
    const risas = detectarRisas(tokens, []);
    expect(risas).toHaveLength(1);
    expect(risas[0]!.at_ms).toBe(400);
    // 400→1200 (estirón) fusionado con 1200→2200 (hueco)
    expect(risas[0]!.dur_ms).toBe(1800);
  });

  it('es determinista: mismos insumos, mismos eventos', () => {
    const tokens = [tok(0, 1500, { sentenceEnd: true }), tok(1600, 3400, { clauseEnd: true })];
    const a = detectarRisas(tokens, [[100, 200]]);
    const b = detectarRisas(tokens, [[100, 200]]);
    expect(a).toEqual(b);
  });
});

describe('risaTrasBeat', () => {
  const risas = [
    { at_ms: 10_000, dur_ms: 900 },
    { at_ms: 20_000, dur_ms: 1500 },
  ];

  it('devuelve la risa que arranca cerca del fin del beat', () => {
    expect(risaTrasBeat(19_500, risas)).toBe(1500);
  });

  it('sin risa cerca devuelve undefined', () => {
    expect(risaTrasBeat(15_000, risas)).toBeUndefined();
  });

  it('una risa demasiado anterior no cuenta', () => {
    expect(risaTrasBeat(12_500, risas)).toBeUndefined();
  });
});
