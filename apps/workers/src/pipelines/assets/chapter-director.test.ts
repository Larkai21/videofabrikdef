import { describe, expect, it } from 'vitest';
import { buildChapterPrompt, chapterResultSchema } from './chapter-director.js';
import { buildMockChapters } from './mocks.js';

const BEATS = [
  { idx: 0, from_ms: 0, text: 'Kimi-K3 ya está disponible en HuggingFace.' },
  { idx: 1, from_ms: 10_000, text: 'Su arquitectura combina expertos y atención residual.' },
  { idx: 2, from_ms: 20_000, text: 'La cuantización reduce el coste de inferencia.' },
  { idx: 3, from_ms: 30_000, text: 'Cómo desplegarlo hoy desde la API.' },
];

describe('buildChapterPrompt', () => {
  it('incluye idioma y una línea por beat', () => {
    const { system, user } = buildChapterPrompt({
      videoId: 'v1',
      channelId: 'c1',
      lang: 'es',
      beats: BEATS,
    });
    expect(system).toContain('español');
    expect(user.split('\n').filter((l) => /^\d+ · /.test(l))).toHaveLength(4);
  });
});

describe('buildMockChapters', () => {
  it('produce segmentos válidos con start_beat_idx creciente', () => {
    const result = buildMockChapters({ beats: BEATS });
    expect(chapterResultSchema.parse(result)).toBeTruthy();
    const idxs = result.segments.map((s) => s.start_beat_idx);
    expect(idxs[0]).toBe(0);
    for (let i = 1; i < idxs.length; i++) expect(idxs[i]!).toBeGreaterThan(idxs[i - 1]!);
  });

  it('sin beats devuelve lista vacía', () => {
    expect(buildMockChapters({ beats: [] }).segments).toEqual([]);
  });
});
