import type { FetchedItem } from '../normalize.js';

// API pública de Algolia para Hacker News (docs/scraper.md §2). Señales: points y comments.

export interface HnHit {
  objectID: string;
  title?: string | null;
  url?: string | null;
  story_text?: string | null;
  points?: number | null;
  num_comments?: number | null;
  created_at?: string | null;
}

export function parseHn(json: unknown): FetchedItem[] {
  const hits = (json as { hits?: HnHit[] } | null)?.hits ?? [];
  const items: FetchedItem[] = [];
  for (const hit of hits) {
    if (!hit.title) continue;
    items.push({
      url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
      title: hit.title,
      excerpt: hit.story_text ?? null,
      publishedAt: hit.created_at ? new Date(hit.created_at) : null,
      metrics: { points: hit.points ?? 0, comments: hit.num_comments ?? 0 },
    });
  }
  return items;
}
