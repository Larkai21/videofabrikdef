import { createHash } from 'node:crypto';

export const USER_AGENT = 'FabricaBot/0.1 (+contacto en README)';
export const FETCH_TIMEOUT_MS = 15_000;
export const EXCERPT_MAX_CHARS = 500;

export interface FetchedItem {
  url: string;
  title: string;
  excerpt: string | null;
  publishedAt: Date | null;
  metrics: Record<string, number | string>;
}

export interface NormalizedItem {
  urlCanonical: string;
  hash: string;
  title: string;
  excerpt: string | null;
  publishedAt: Date | null;
  metrics: Record<string, number | string>;
  lang: 'es' | 'en';
}

// URL canónica: sin utm_*, sin fragmento, sin trailing slash, host en minúsculas.
export function canonicalUrl(raw: string): string {
  const u = new URL(raw.trim());
  u.hash = '';
  const drop: string[] = [];
  for (const key of u.searchParams.keys()) {
    if (/^utm_/i.test(key)) drop.push(key);
  }
  for (const key of drop) u.searchParams.delete(key);
  const pathname = u.pathname.replace(/\/+$/, '');
  const qs = u.searchParams.toString();
  return `${u.protocol}//${u.host.toLowerCase()}${pathname}${qs ? `?${qs}` : ''}`;
}

export function hashUrl(urlCanonical: string): string {
  return createHash('sha256').update(urlCanonical).digest('hex');
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ES_MARKERS = [' el ', ' la ', ' los ', ' las ', ' de ', ' que ', ' una ', ' para ', ' con ', ' por '];
const EN_MARKERS = [' the ', ' of ', ' and ', ' to ', ' in ', ' is ', ' for ', ' with ', ' on ', ' this '];

function countMarkers(text: string, markers: string[]): number {
  let n = 0;
  for (const marker of markers) {
    let i = text.indexOf(marker);
    while (i !== -1) {
      n += 1;
      i = text.indexOf(marker, i + 1);
    }
  }
  return n;
}

export function detectLang(text: string): 'es' | 'en' {
  const t = ` ${text.toLowerCase()} `;
  if (/[áéíóúñ¡¿]/.test(t)) return 'es';
  return countMarkers(t, ES_MARKERS) > countMarkers(t, EN_MARKERS) ? 'es' : 'en';
}

export function normalizeItem(item: FetchedItem): NormalizedItem | null {
  let urlCanonical: string;
  try {
    urlCanonical = canonicalUrl(item.url);
  } catch {
    return null;
  }
  const title = item.title.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!title) return null;
  const excerptClean = item.excerpt ? stripHtml(item.excerpt).slice(0, EXCERPT_MAX_CHARS) : '';
  const excerpt = excerptClean.length > 0 ? excerptClean : null;
  const publishedAt =
    item.publishedAt && !Number.isNaN(item.publishedAt.getTime()) ? item.publishedAt : null;
  return {
    urlCanonical,
    hash: hashUrl(urlCanonical),
    title,
    excerpt,
    publishedAt,
    metrics: item.metrics,
    lang: detectLang(`${title} ${excerpt ?? ''}`),
  };
}
