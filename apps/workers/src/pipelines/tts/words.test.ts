import { describe, expect, it } from 'vitest';
import { alignSceneTokens, type TimedWord } from './words.js';

function w(text: string, offset: number, dur = 300): TimedWord {
  return { offset_ms: offset, duration_ms: dur, text };
}

describe('alignSceneTokens', () => {
  it('alinea 1:1 y detecta puntuación', () => {
    const tokens = alignSceneTokens(
      'Hola mundo, adiós.',
      [w('Hola', 0), w('mundo', 400), w('adiós', 800)],
      0,
      0,
    );
    expect(tokens.map((t) => t.raw)).toEqual(['Hola', 'mundo,', 'adiós.']);
    expect(tokens[1]?.clauseEnd).toBe(true);
    expect(tokens[2]?.sentenceEnd).toBe(true);
  });

  it('un token partido por el TTS se emite UNA sola vez y sin duplicar texto', () => {
    const tokens = alignSceneTokens(
      'Cuesta veinticinco euros.',
      [w('Cuesta', 0), w('veinti', 400), w('cinco', 700), w('euros', 1000)],
      0,
      0,
    );
    expect(tokens.map((t) => t.raw)).toEqual(['Cuesta', 'veinticinco', 'euros.']);
    // el token partido abarca sus dos fragmentos
    expect(tokens[1]?.from_ms).toBe(400);
    expect(tokens[1]?.to_ms).toBe(1000);
    const joined = tokens.map((t) => t.raw).join(' ');
    expect(joined).not.toContain('cinco cinco');
    expect(joined.match(/veinticinco/g)).toHaveLength(1);
  });

  it('un token partido en tres fragmentos tampoco duplica', () => {
    const tokens = alignSceneTokens(
      'Es extraordinariamente caro.',
      [w('Es', 0), w('extra', 300), w('ordinaria', 600), w('mente', 900), w('caro', 1200)],
      0,
      0,
    );
    expect(tokens.map((t) => t.raw)).toEqual(['Es', 'extraordinariamente', 'caro.']);
  });

  it('el TTS puede unir varios tokens en una palabra', () => {
    const tokens = alignSceneTokens('de los datos', [w('delos', 0), w('datos', 400)], 0, 0);
    expect(tokens.map((t) => t.raw)).toEqual(['de los', 'datos']);
  });

  it('la última palabra de la escena siempre cierra frase', () => {
    const tokens = alignSceneTokens('sin punto final', [w('sin', 0), w('punto', 300), w('final', 600)], 0, 0);
    expect(tokens.at(-1)?.sentenceEnd).toBe(true);
  });

  it('re-basa los tiempos con el offset global', () => {
    const tokens = alignSceneTokens('Hola', [w('Hola', 100, 200)], 2, 10_000);
    expect(tokens[0]?.from_ms).toBe(10_100);
    expect(tokens[0]?.to_ms).toBe(10_300);
    expect(tokens[0]?.sceneIdx).toBe(2);
  });
});
