import { describe, expect, it } from 'vitest';
import { canonicalUrl, detectLang, hashUrl, normalizeItem } from './normalize.js';

describe('canonicalUrl', () => {
  it('elimina utm_*, fragmento y trailing slash y baja el host a minúsculas', () => {
    expect(
      canonicalUrl('https://Example.com/blog/compiler/?utm_source=hn&utm_medium=social&id=5#top'),
    ).toBe('https://example.com/blog/compiler?id=5');
  });

  it('reduce la raíz a origen sin barra final', () => {
    expect(canonicalUrl('https://example.com/')).toBe('https://example.com');
  });

  it('conserva los parámetros que no son utm', () => {
    expect(canonicalUrl('https://example.com/a?b=1&utm_campaign=x')).toBe(
      'https://example.com/a?b=1',
    );
  });
});

describe('hashUrl', () => {
  it('es sha256 estable en hexadecimal', () => {
    const h1 = hashUrl('https://example.com/a');
    const h2 = hashUrl('https://example.com/a');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUrl('https://example.com/b')).not.toBe(h1);
  });
});

describe('detectLang', () => {
  it('detecta español por caracteres y marcadores', () => {
    expect(detectLang('El modelo de lenguaje que lo cambia todo')).toBe('es');
    expect(detectLang('La computacion cuantica llega a los bancos y a las empresas')).toBe('es');
  });

  it('detecta inglés', () => {
    expect(detectLang('The new model is changing the industry for good')).toBe('en');
  });
});

describe('normalizeItem', () => {
  it('normaliza url, corta excerpt a 500 y calcula hash', () => {
    const item = normalizeItem({
      url: 'https://example.com/post/?utm_source=x',
      title: '  Un   título  con   espacios ',
      excerpt: `<p>${'palabra '.repeat(200)}</p>`,
      publishedAt: new Date('2026-07-20T10:00:00Z'),
      metrics: { points: 3 },
    });
    expect(item).not.toBeNull();
    expect(item?.urlCanonical).toBe('https://example.com/post');
    expect(item?.title).toBe('Un título con espacios');
    expect(item?.excerpt?.length).toBeLessThanOrEqual(500);
    expect(item?.hash).toBe(hashUrl('https://example.com/post'));
  });

  it('devuelve null con URL inválida o título vacío', () => {
    expect(
      normalizeItem({ url: 'no-es-url', title: 'x', excerpt: null, publishedAt: null, metrics: {} }),
    ).toBeNull();
    expect(
      normalizeItem({
        url: 'https://example.com',
        title: '   ',
        excerpt: null,
        publishedAt: null,
        metrics: {},
      }),
    ).toBeNull();
  });
});
