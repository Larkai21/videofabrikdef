import { XMLParser } from 'fast-xml-parser';
import type { FetchedItem } from '../normalize.js';

// Feed videos.xml de canal: monitorización de competidores sin cuota. Las vistas
// vienen en media:community → media:statistics (docs/scraper.md §2, notas).

interface YtLink {
  '@_rel'?: string;
  '@_href'?: string;
}

interface YtEntry {
  'yt:videoId'?: string | number;
  title?: string | number;
  link?: YtLink | YtLink[];
  published?: string;
  'media:group'?: {
    'media:description'?: string | number;
    'media:community'?: {
      'media:statistics'?: { '@_views'?: string | number };
      'media:starRating'?: { '@_count'?: string | number };
    };
  };
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseYoutubeFeed(xml: string): FetchedItem[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml) as { feed?: { entry?: YtEntry | YtEntry[] } };
  const entries = toArray(parsed.feed?.entry);
  const items: FetchedItem[] = [];
  for (const entry of entries) {
    const videoId = entry['yt:videoId'] !== undefined ? String(entry['yt:videoId']) : null;
    if (!videoId || entry.title === undefined) continue;
    const alternate = toArray(entry.link).find((l) => l['@_rel'] === 'alternate');
    const group = entry['media:group'];
    const community = group?.['media:community'];
    const views = Number(community?.['media:statistics']?.['@_views'] ?? 0);
    const ratings = Number(community?.['media:starRating']?.['@_count'] ?? 0);
    items.push({
      url: alternate?.['@_href'] ?? `https://www.youtube.com/watch?v=${videoId}`,
      title: String(entry.title),
      excerpt: group?.['media:description'] !== undefined ? String(group['media:description']) : null,
      publishedAt: entry.published ? new Date(entry.published) : null,
      metrics: { views: Number.isFinite(views) ? views : 0, ratings: Number.isFinite(ratings) ? ratings : 0 },
    });
  }
  return items;
}
