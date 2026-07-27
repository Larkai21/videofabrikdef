import { describe, expect, it } from 'vitest';
import { expandQuery, stockScore } from './score.js';

describe('stockScore', () => {
  const base = {
    cosine: 1,
    width: 1920,
    height: 1080,
    durationMs: 15_000,
    beatDurationMs: 10_000,
    isImage: false,
    usedRecently: false,
  };

  it('candidato perfecto: 0,6 + 0,2 + 0,2 = 1', () => {
    expect(stockScore(base)).toBeCloseTo(1, 5);
  });

  it('la similitud pesa 0,6', () => {
    expect(stockScore({ ...base, cosine: 0 })).toBeCloseTo(0.4, 5);
    expect(stockScore({ ...base, cosine: 0.5 })).toBeCloseTo(0.7, 5);
  });

  it('resolución por debajo de 1080p pierde la mitad de la calidad', () => {
    expect(stockScore({ ...base, height: 720 })).toBeCloseTo(0.9, 5);
  });

  it('clip más corto que el beat pierde la otra mitad de la calidad', () => {
    expect(stockScore({ ...base, durationMs: 5_000 })).toBeCloseTo(0.9, 5);
  });

  it('una imagen no penaliza por duración', () => {
    expect(stockScore({ ...base, isImage: true, durationMs: null })).toBeCloseTo(1, 5);
  });

  it('el uso reciente anula la novedad', () => {
    expect(stockScore({ ...base, usedRecently: true })).toBeCloseTo(0.8, 5);
  });
});

describe('expandQuery', () => {
  it('las queries largas no se tocan', () => {
    const q = 'server room aisle cold blue lights';
    expect(expandQuery(q, 'da igual el texto del beat')).toBe(q);
  });

  it('las queries cortas se enriquecen con palabras clave del texto', () => {
    const out = expandQuery('data chart', 'El precio por millón de tokens cayó un orden de magnitud');
    expect(out.startsWith('data chart')).toBe(true);
    expect(out.length).toBeGreaterThan('data chart'.length);
    expect(out).toContain('precio');
  });

  it('no repite tokens ya presentes en la query', () => {
    const out = expandQuery('precio tokens', 'El precio por millón de tokens cayó mucho');
    const words = out.split(' ');
    expect(new Set(words).size).toBe(words.length);
  });
});
