import { describe, expect, it } from 'vitest';
import type { Cue } from '@fabrica/shared';
import { momentsToEdits, ruleEdits, type EditingParams } from './editing-director.js';

// Cue con una sola palabra en un instante dado (para anclar reglas al ms).
function cue(w: string, from_ms: number): Cue {
  return { from_ms, to_ms: from_ms + 400, text: w, words: [{ w, from_ms, to_ms: from_ms + 400 }] };
}

function params(over: Partial<EditingParams>): EditingParams {
  return {
    videoId: 'v1',
    channelId: 'c1',
    lang: 'es',
    beats: [],
    cues: [],
    scenes: [],
    segmentStartMs: [],
    seoTags: [],
    ...over,
  };
}

describe('ruleEdits', () => {
  it('el hook trae riser + zoom_punch en el primer beat', () => {
    const edits = ruleEdits(
      params({ beats: [{ idx: 0, from_ms: 0, to_ms: 10_000, text: 'hola mundo' }] }),
    );
    expect(edits.some((e) => e.type === 'sfx' && e.sfx === 'riser' && e.from_ms === 0)).toBe(true);
    expect(edits.some((e) => e.type === 'zoom_punch' && e.beat_idx === 0)).toBe(true);
  });

  it('cada inicio de sección (salvo el primero) dispara un whoosh', () => {
    const edits = ruleEdits(
      params({
        beats: [{ idx: 0, from_ms: 0, to_ms: 10_000, text: 'x' }],
        segmentStartMs: [0, 12_000, 24_000],
      }),
    );
    const whooshes = edits.filter((e) => e.type === 'sfx' && e.sfx === 'whoosh');
    expect(whooshes.map((e) => e.from_ms)).toEqual([12_000, 24_000]);
  });

  it('una cifra en la narración genera una tarjeta de dato + ding', () => {
    const edits = ruleEdits(
      params({
        beats: [{ idx: 0, from_ms: 0, to_ms: 12_000, text: 'el modelo mejora un 70% en la prueba' }],
      }),
    );
    const stat = edits.find((e) => e.type === 'stat_card');
    expect(stat?.value).toBe('70%');
    expect(edits.some((e) => e.type === 'sfx' && e.sfx === 'ding')).toBe(true);
  });

  it('el inicio de sección con beat dispara whoosh + zoom_punch', () => {
    const edits = ruleEdits(
      params({
        beats: [
          { idx: 0, from_ms: 0, to_ms: 12_000, text: 'a' },
          { idx: 1, from_ms: 12_000, to_ms: 24_000, text: 'b' },
        ],
        segmentStartMs: [0, 12_000],
      }),
    );
    expect(edits.some((e) => e.type === 'sfx' && e.sfx === 'whoosh' && e.from_ms === 12_000)).toBe(true);
    expect(edits.some((e) => e.type === 'zoom_punch' && e.beat_idx === 1)).toBe(true);
  });

  it('detecta cifras con unidad/multiplicador (2 millones, 10x) para el stat', () => {
    const a = ruleEdits(params({ beats: [{ idx: 0, from_ms: 0, to_ms: 12_000, text: 'ya son 2 millones de usuarios' }] }));
    expect(a.find((e) => e.type === 'stat_card')?.value).toBe('2 millones');
    const b = ruleEdits(params({ beats: [{ idx: 0, from_ms: 0, to_ms: 12_000, text: 'es 10x más rápido' }] }));
    expect(b.find((e) => e.type === 'stat_card')?.value).toBe('10x');
  });

  it('una cifra grande (3+ dígitos) se anima como odómetro, no tarjeta', () => {
    const edits = ruleEdits(
      params({ beats: [{ idx: 0, from_ms: 0, to_ms: 12_000, text: 'son 500 mil combinaciones' }] }),
    );
    expect(edits.find((e) => e.type === 'stat_odometer')?.value).toBe('500 mil');
    expect(edits.some((e) => e.type === 'stat_card')).toBe(false);
  });

  it('un tag del SEO pronunciado se resalta como keyword', () => {
    const edits = ruleEdits(
      params({
        beats: [{ idx: 0, from_ms: 0, to_ms: 12_000, text: 'hablamos de inferencia hoy' }],
        cues: [cue('inferencia', 3_000)],
        seoTags: ['inferencia'],
      }),
    );
    const kw = edits.find((e) => e.type === 'keyword_highlight');
    expect(kw?.keyword).toBe('inferencia');
    expect(kw?.from_ms).toBe(3_000);
  });
});

describe('momentsToEdits (capa IA)', () => {
  const beats = [
    { idx: 0, from_ms: 0, to_ms: 8_000, text: 'gancho' },
    { idx: 3, from_ms: 30_000, to_ms: 40_000, text: 'cifra' },
  ];

  it('un momento kinetic produce kinetic_text al inicio del beat del gancho', () => {
    const edits = momentsToEdits([{ beat_idx: 0, type: 'kinetic', text: 'se borra solo' }], beats, []);
    const k = edits.find((e) => e.type === 'kinetic_text');
    expect(k?.text).toBe('se borra solo');
    expect(k?.from_ms).toBe(0);
    expect(k?.beat_idx).toBe(0);
  });

  it('un stat grande va a odómetro y uno pequeño a tarjeta', () => {
    const big = momentsToEdits(
      [{ beat_idx: 3, type: 'stat', value: '1000000', label: 'combinaciones' }],
      beats,
      [],
    );
    expect(big.find((e) => e.type === 'stat_odometer')?.value).toBe('1000000');
    const small = momentsToEdits([{ beat_idx: 3, type: 'stat', value: '25%' }], beats, []);
    expect(small.find((e) => e.type === 'stat_card')?.value).toBe('25%');
  });
});
