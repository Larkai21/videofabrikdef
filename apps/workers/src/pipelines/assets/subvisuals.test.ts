import { describe, expect, it } from 'vitest';
import { computeSubvisualSpans, wordsInSpan, type BeatWord } from './subvisuals.js';

// beat de 0 a 13000 ms con palabras clave "bibliotecas" (~4000) e "industria" (~8000)
const WORDS: BeatWord[] = [
  { w: 'destruyen', from_ms: 500, to_ms: 1200 },
  { w: 'datasets', from_ms: 1300, to_ms: 2000 },
  { w: 'bibliotecas', from_ms: 4000, to_ms: 4800 },
  { w: 'la', from_ms: 4900, to_ms: 5000 },
  { w: 'industria', from_ms: 8000, to_ms: 8900 },
];
const BEAT = { from_ms: 0, to_ms: 13_000 };

describe('computeSubvisualSpans', () => {
  it('un solo corte → un tramo que cubre todo el beat', () => {
    const spans = computeSubvisualSpans(BEAT, WORDS, [{ visual_query: 'libros antiguos' }]);
    expect(spans).toEqual([{ from_ms: 0, to_ms: 13_000, visual_query: 'libros antiguos' }]);
  });

  it('ancla cada corte a su keyword en la narración', () => {
    const spans = computeSubvisualSpans(BEAT, WORDS, [
      { visual_query: 'datasets en servidores' },
      { keyword: 'bibliotecas', visual_query: 'biblioteca antigua' },
      { keyword: 'industria', visual_query: 'nave industrial' },
    ]);
    expect(spans).toHaveLength(3);
    expect(spans[0]).toMatchObject({ from_ms: 0, to_ms: 4000 });
    expect(spans[1]).toMatchObject({ from_ms: 4000, to_ms: 8000, keyword: 'bibliotecas' });
    expect(spans[2]).toMatchObject({ from_ms: 8000, to_ms: 13_000, keyword: 'industria' });
  });

  it('keyword no encontrada → se ignora ese corte (no rompe el orden)', () => {
    const spans = computeSubvisualSpans(BEAT, WORDS, [
      { visual_query: 'apertura' },
      { keyword: 'inexistente', visual_query: 'x' },
      { keyword: 'industria', visual_query: 'nave industrial' },
    ]);
    expect(spans.map((s) => s.from_ms)).toEqual([0, 8000]);
  });

  it('sin keywords resolubles pero varios cortes → reparto uniforme', () => {
    const spans = computeSubvisualSpans(BEAT, [], [{ visual_query: 'a' }, { visual_query: 'b' }]);
    expect(spans).toHaveLength(2);
    expect(spans[0]!.from_ms).toBe(0);
    expect(spans[1]!.to_ms).toBe(13_000);
  });

  it('respeta el tramo mínimo (no crea planos-relámpago)', () => {
    // keyword a 900 ms: demasiado cerca del inicio → se descarta
    const spans = computeSubvisualSpans(
      BEAT,
      [{ w: 'ya', from_ms: 900, to_ms: 1000 }],
      [{ visual_query: 'a' }, { keyword: 'ya', visual_query: 'b' }],
    );
    expect(spans).toHaveLength(1);
  });
});

describe('wordsInSpan', () => {
  it('filtra las palabras de los cues dentro del beat, ordenadas', () => {
    const cues = [
      { words: [{ w: 'antes', from_ms: 0, to_ms: 100 }] },
      { words: [{ w: 'dentro', from_ms: 5000, to_ms: 5200 }] },
      { words: [{ w: 'fuera', from_ms: 20_000, to_ms: 20_200 }] },
    ];
    const out = wordsInSpan(cues, 1000, 10_000);
    expect(out.map((w) => w.w)).toEqual(['dentro']);
  });
});
