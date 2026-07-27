import { channelSettingsSchema, demoProfile } from '@fabrica/shared';
import { createDb } from './index.js';
import { channels, sources } from './schema.js';

// Seed idempotente: canal 1 (IA/tecnología, SPEC §13) y catálogo de fuentes
// del modo continuo (docs/scraper.md §2). Solo fuentes sin cuota ni login.

const CHANNEL_ID = 'ch-ia-tech';

const SEED_SOURCES: Array<{
  id: string;
  kind: string;
  url: string;
  label: string;
  cadenceMinutes: number;
  config?: Record<string, unknown>;
}> = [
  {
    id: 'src-hn-top',
    kind: 'hn',
    url: 'https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points>50',
    label: 'Hacker News · historias con tracción',
    cadenceMinutes: 45,
  },
  {
    id: 'src-hn-front',
    kind: 'hn',
    url: 'https://hn.algolia.com/api/v1/search?tags=front_page',
    label: 'Hacker News · portada',
    cadenceMinutes: 45,
  },
  {
    id: 'src-arxiv-ai',
    kind: 'arxiv',
    url: 'http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.LG&sortBy=submittedDate&max_results=100',
    label: 'arXiv · cs.AI y cs.LG',
    cadenceMinutes: 720,
  },
  {
    id: 'src-gnews-ia',
    kind: 'news',
    url: 'https://news.google.com/rss/search?q=inteligencia%20artificial&hl=es&gl=ES&ceid=ES:es',
    label: 'Google News · inteligencia artificial',
    cadenceMinutes: 120,
  },
  {
    id: 'src-gnews-ai-tools',
    kind: 'news',
    url: 'https://news.google.com/rss/search?q=AI%20tools%20launch&hl=en-US&gl=US&ceid=US:en',
    label: 'Google News · lanzamientos de herramientas IA',
    cadenceMinutes: 120,
  },
  {
    id: 'src-blog-simonw',
    kind: 'rss',
    url: 'https://simonwillison.net/atom/everything/',
    label: 'Blog · Simon Willison',
    cadenceMinutes: 180,
  },
  {
    id: 'src-blog-hf',
    kind: 'rss',
    url: 'https://huggingface.co/blog/feed.xml',
    label: 'Blog · Hugging Face',
    cadenceMinutes: 180,
  },
];

async function main() {
  const { db, client } = createDb();

  await db
    .insert(channels)
    .values({
      id: CHANNEL_ID,
      name: demoProfile.identity.name,
      profile: demoProfile,
      profileApproved: false,
      settings: channelSettingsSchema.parse({}),
    })
    .onConflictDoNothing();

  for (const s of SEED_SOURCES) {
    await db
      .insert(sources)
      .values({
        id: s.id,
        channelId: CHANNEL_ID,
        kind: s.kind,
        url: s.url,
        label: s.label,
        cadenceMinutes: s.cadenceMinutes,
        config: s.config ?? {},
      })
      .onConflictDoNothing();
  }

  console.log(`Seed aplicado: canal ${CHANNEL_ID} con ${SEED_SOURCES.length} fuentes`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
