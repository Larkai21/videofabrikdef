import Parser from 'rss-parser';
import type { FetchedItem } from '../normalize.js';

// Feeds RSS/Atom genéricos: Google News (kind news) y blogs del nicho (kind rss).

const parser = new Parser();

export async function parseRssFeed(xml: string): Promise<FetchedItem[]> {
  const feed = await parser.parseString(xml);
  const items: FetchedItem[] = [];
  for (const item of feed.items ?? []) {
    if (!item.link || !item.title) continue;
    const publishedRaw = item.isoDate ?? item.pubDate;
    items.push({
      url: item.link,
      title: item.title,
      excerpt: item.contentSnippet ?? item.content ?? null,
      publishedAt: publishedRaw ? new Date(publishedRaw) : null,
      metrics: {},
    });
  }
  return items;
}
