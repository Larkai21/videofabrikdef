import { XMLParser } from 'fast-xml-parser';
import type { FetchedItem } from '../normalize.js';

// Feed Atom de arXiv. El rate se respeta por diseño: un poll = una única petición HTTP.

interface ArxivAuthor {
  name?: string;
}

interface ArxivEntry {
  id?: string | number;
  title?: string | number;
  summary?: string | number;
  published?: string;
  author?: ArxivAuthor | ArxivAuthor[];
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseArxiv(xml: string): FetchedItem[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml) as { feed?: { entry?: ArxivEntry | ArxivEntry[] } };
  const entries = toArray(parsed.feed?.entry);
  const items: FetchedItem[] = [];
  for (const entry of entries) {
    if (!entry.id || !entry.title) continue;
    items.push({
      url: String(entry.id),
      title: String(entry.title).replace(/\s+/g, ' ').trim(),
      excerpt: entry.summary !== undefined ? String(entry.summary) : null,
      publishedAt: entry.published ? new Date(entry.published) : null,
      metrics: { authors: toArray(entry.author).length },
    });
  }
  return items;
}
