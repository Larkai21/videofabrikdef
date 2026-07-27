import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHn } from './fetchers/hn.js';
import { parseYoutubeFeed } from './fetchers/youtube.js';

const hnFixture = JSON.parse(
  readFileSync(new URL('./fixtures/hn.json', import.meta.url), 'utf8'),
) as unknown;
const ytFixture = readFileSync(new URL('./fixtures/youtube.xml', import.meta.url), 'utf8');

describe('parseHn', () => {
  it('extrae items con métricas y descarta los que no tienen título', () => {
    const items = parseHn(hnFixture);
    expect(items).toHaveLength(2);
    const first = items[0];
    expect(first?.title).toBe('Show HN: An incremental compiler for data pipelines');
    expect(first?.metrics).toEqual({ points: 321, comments: 120 });
    expect(first?.publishedAt?.toISOString()).toBe('2026-07-20T10:00:00.000Z');
  });

  it('usa la URL del item de HN cuando la historia no tiene enlace', () => {
    const items = parseHn(hnFixture);
    expect(items[1]?.url).toBe('https://news.ycombinator.com/item?id=41000002');
    expect(items[1]?.excerpt).toContain('Testing is');
  });
});

describe('parseYoutubeFeed', () => {
  it('extrae vídeos con vistas del bloque media:community', () => {
    const items = parseYoutubeFeed(ytFixture);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe('La GPU que lo cambió todo');
    expect(items[0]?.url).toBe('https://www.youtube.com/watch?v=abc123DEF45');
    expect(items[0]?.metrics.views).toBe(45210);
    expect(items[1]?.metrics.views).toBe(999);
    expect(items[0]?.publishedAt?.toISOString()).toBe('2026-07-19T12:00:00.000Z');
  });
});
