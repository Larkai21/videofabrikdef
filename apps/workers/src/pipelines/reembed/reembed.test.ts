import { describe, expect, it } from 'vitest';
import {
  assetEmbeddingText,
  ideaFallbackEmbeddingText,
  normalizeTables,
  rawItemEmbeddingText,
  resumePlan,
} from '../library/reembed.js';

describe('constructores de texto del re-embebido', () => {
  it('raw_items calca el texto de clusterNewItems (título + excerpt)', () => {
    expect(rawItemEmbeddingText({ title: 'GPT-5 llega', excerpt: 'OpenAI lanza' })).toBe(
      'GPT-5 llega OpenAI lanza',
    );
    expect(rawItemEmbeddingText({ title: 'Sin excerpt', excerpt: null })).toBe('Sin excerpt');
  });

  // El asset se embebe SOLO con su descripción, igual que el stock: meter la
  // consulta que lo encontró inflaba su similitud con sus propios términos y
  // hacía que la biblioteca ganara con planos de temas viejos.
  it('assets usa solo el caption, y la consulta únicamente si no hay descripción', () => {
    expect(
      assetEmbeddingText({ caption: 'Sala oscura', originQuery: 'server room', tags: [] }),
    ).toBe('Sala oscura');
    expect(
      assetEmbeddingText({ caption: 'Sala oscura', originQuery: null, tags: ['datacenter'] }),
    ).toBe('Sala oscura');
    expect(assetEmbeddingText({ caption: null, originQuery: 'server room', tags: [] })).toBe(
      'server room',
    );
    expect(assetEmbeddingText({ caption: null, originQuery: null, tags: [] })).toBe('');
  });

  it('el fallback de ideas junta título y resumen', () => {
    expect(ideaFallbackEmbeddingText({ title: 'La era post-GPU', summary: 'Chips nuevos.' })).toBe(
      'La era post-GPU. Chips nuevos.',
    );
  });
});

describe('normalizeTables', () => {
  it('sin payload procesa todo en orden canónico', () => {
    expect(normalizeTables()).toEqual(['raw_items', 'ideas', 'assets']);
    expect(normalizeTables([])).toEqual(['raw_items', 'ideas', 'assets']);
  });

  it('reordena al orden canónico y deduplica (ideas siempre tras raw_items)', () => {
    expect(normalizeTables(['assets', 'raw_items', 'assets'])).toEqual(['raw_items', 'assets']);
    expect(normalizeTables(['ideas', 'raw_items'])).toEqual(['raw_items', 'ideas']);
  });
});

describe('resumePlan (reanudable por cursor del progress)', () => {
  const all = ['raw_items', 'ideas', 'assets'] as const;

  it('sin cursor arranca todas las fases desde cero', () => {
    expect(resumePlan([...all], null)).toEqual([
      { table: 'raw_items', startAfterId: null },
      { table: 'ideas', startAfterId: null },
      { table: 'assets', startAfterId: null },
    ]);
  });

  it('con cursor salta fases completadas y retoma tras el último id', () => {
    expect(resumePlan([...all], { phase: 'ideas', lastId: 'idea-42' })).toEqual([
      { table: 'ideas', startAfterId: 'idea-42' },
      { table: 'assets', startAfterId: null },
    ]);
  });

  it('reprocesar una fase completa sigue siendo idempotente (overwrite)', () => {
    expect(resumePlan([...all], { phase: 'raw_items', lastId: null })).toEqual([
      { table: 'raw_items', startAfterId: null },
      { table: 'ideas', startAfterId: null },
      { table: 'assets', startAfterId: null },
    ]);
  });
});
