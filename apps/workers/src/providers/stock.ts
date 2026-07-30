import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type pino from 'pino';
import { captionCache, stockCache, type Db } from '@fabrica/db';
import { MAX_QUERY_CHARS, STOCK_CACHE_TTL_H, stockRef } from '@fabrica/shared';
import { closeCost, failCost, openCost } from '../lib/ledger.js';

// Búsqueda de stock (docs/assets-y-biblioteca.md §3): Pexels (vídeos y fotos)
// y Pixabay (vídeos), normalizadas a candidatos. La caché en stock_cache es
// OBLIGATORIA y se consulta ANTES de golpear la API; sin clave → [] sin error.

export interface StockMeta {
  download_url: string;
  width: number;
  height: number;
  duration_ms: number;
  title: string;
  kind: 'clip' | 'image';
  caption?: string;
}

export interface StockResult {
  ref: string;
  provider: 'pexels' | 'pixabay';
  thumb_url: string;
  meta: StockMeta;
}

export interface StockSearchIds {
  videoId?: string | null;
  channelId?: string | null;
}

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function readCache(
  db: Db,
  queryNorm: string,
  provider: string,
): Promise<StockResult[] | null> {
  const [row] = await db
    .select()
    .from(stockCache)
    .where(and(eq(stockCache.queryNorm, queryNorm), eq(stockCache.provider, provider)));
  if (!row) return null;
  const ageMs = Date.now() - row.fetchedAt.getTime();
  if (ageMs > STOCK_CACHE_TTL_H * 3_600_000) return null;
  return row.results as StockResult[];
}

async function writeCache(
  db: Db,
  queryNorm: string,
  provider: string,
  results: StockResult[],
): Promise<void> {
  await db
    .insert(stockCache)
    .values({ id: nanoid(), queryNorm, provider, results, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: [stockCache.queryNorm, stockCache.provider],
      set: { results, fetchedAt: new Date() },
    });
}

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${new URL(url).host}`);
  return res.json();
}

interface PexelsVideoFile {
  width?: number;
  height?: number;
  quality?: string;
  link?: string;
}

function bestPexelsFile(files: PexelsVideoFile[]): PexelsVideoFile | undefined {
  // el archivo más pequeño con altura ≥1080; si no hay, el mayor disponible
  const sorted = [...files].sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
  return sorted.find((f) => (f.height ?? 0) >= 1080) ?? sorted[sorted.length - 1];
}

/**
 * Texto descriptivo de un clip de Pexels.
 *
 * La API de vídeo NO devuelve `alt` ni `tags`: lo único descriptivo es el slug
 * de la URL de la ficha
 * (`.../video/a-person-using-a-magnifying-glass-on-a-bible-6970650/`).
 * Antes se usaba `user.name` —el NOMBRE DEL FOTÓGRAFO— como título, y con él se
 * hacía la preselección de a cuáles pagar una descripción VLM: el 80 % de los
 * candidatos de Pexels se ordenaba por un nombre de persona, así que los cuatro
 * que acababan descritos salían prácticamente al azar y el stock competía en
 * desventaja frente a la biblioteca, que siempre tiene descripción.
 */
export function tituloDesdeUrlPexels(url: string, fallback: string): string {
  const m = /\/video\/([a-z0-9-]+?)-\d+\/?$/i.exec(url);
  const slug = m?.[1];
  if (slug === undefined || slug === '') return fallback;
  return slug.replace(/-/g, ' ').trim();
}

function parsePexels(videosJson: unknown, photosJson: unknown): StockResult[] {
  const out: StockResult[] = [];
  const videos = (videosJson as { videos?: Record<string, unknown>[] })?.videos ?? [];
  for (const v of videos) {
    const files = (v.video_files as PexelsVideoFile[]) ?? [];
    const file = bestPexelsFile(files);
    if (!file?.link) continue;
    out.push({
      ref: stockRef('pexels', 'clip', String(v.id)),
      provider: 'pexels',
      thumb_url: String(v.image ?? ''),
      meta: {
        download_url: file.link,
        width: Number(file.width ?? v.width ?? 0),
        height: Number(file.height ?? v.height ?? 0),
        duration_ms: Math.round(Number(v.duration ?? 0) * 1000),
        title: tituloDesdeUrlPexels(
          String(v.url ?? ''),
          String((v.user as { name?: string } | undefined)?.name ?? ''),
        ),
        kind: 'clip',
      },
    });
  }
  const photos = (photosJson as { photos?: Record<string, unknown>[] })?.photos ?? [];
  for (const p of photos) {
    const src = (p.src as Record<string, string> | undefined) ?? {};
    const download = src.large2x ?? src.original;
    if (!download) continue;
    out.push({
      ref: stockRef('pexels', 'image', String(p.id)),
      provider: 'pexels',
      thumb_url: src.medium ?? download,
      meta: {
        download_url: download,
        width: Number(p.width ?? 0),
        height: Number(p.height ?? 0),
        duration_ms: 0,
        title: String(p.alt ?? ''),
        kind: 'image',
      },
    });
  }
  return out;
}

function parsePixabay(json: unknown): StockResult[] {
  const out: StockResult[] = [];
  const hits = (json as { hits?: Record<string, unknown>[] })?.hits ?? [];
  for (const hit of hits) {
    const variants =
      (hit.videos as
        | Record<string, { url?: string; width?: number; height?: number; thumbnail?: string }>
        | undefined) ?? {};
    const preferred = variants.large ?? variants.medium ?? variants.small ?? variants.tiny;
    if (!preferred?.url) continue;
    const thumb =
      variants.medium?.thumbnail ?? variants.small?.thumbnail ?? preferred.thumbnail ?? '';
    out.push({
      ref: stockRef('pixabay', 'clip', String(hit.id)),
      provider: 'pixabay',
      thumb_url: thumb,
      meta: {
        download_url: preferred.url,
        width: Number(preferred.width ?? 0),
        height: Number(preferred.height ?? 0),
        duration_ms: Math.round(Number(hit.duration ?? 0) * 1000),
        title: String(hit.tags ?? ''),
        kind: 'clip',
      },
    });
  }
  return out;
}

async function searchPexels(
  db: Db,
  logger: pino.Logger,
  query: string,
  ids: StockSearchIds,
): Promise<StockResult[]> {
  const queryNorm = normalizeQuery(query);
  const cached = await readCache(db, queryNorm, 'pexels');
  if (cached) return cached;

  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];

  const handle = await openCost(db, {
    videoId: ids.videoId ?? null,
    channelId: ids.channelId ?? null,
    provider: 'pexels',
    operation: 'search',
    meta: { query: queryNorm },
  });
  try {
    const headers = { Authorization: key };
    const params = new URLSearchParams({
      query: queryNorm,
      orientation: 'landscape',
      per_page: '15',
    });
    const [videosJson, photosJson] = await Promise.all([
      fetchJson(`https://api.pexels.com/videos/search?${params.toString()}&size=medium`, headers),
      fetchJson(`https://api.pexels.com/v1/search?${params.toString()}`, headers),
    ]);
    const results = parsePexels(videosJson, photosJson);
    await closeCost(db, handle, { units: 2, unitCost: 0 });
    await writeCache(db, queryNorm, 'pexels', results);
    return results;
  } catch (err) {
    await failCost(db, handle, err instanceof Error ? err.message : String(err));
    logger.warn({ err, query: queryNorm }, 'Fallo en la búsqueda de Pexels; se continúa sin stock');
    return [];
  }
}

async function searchPixabay(
  db: Db,
  logger: pino.Logger,
  query: string,
  ids: StockSearchIds,
): Promise<StockResult[]> {
  const queryNorm = normalizeQuery(query);
  const cached = await readCache(db, queryNorm, 'pixabay');
  if (cached) return cached;

  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];

  const handle = await openCost(db, {
    videoId: ids.videoId ?? null,
    channelId: ids.channelId ?? null,
    provider: 'pixabay',
    operation: 'search',
    meta: { query: queryNorm },
  });
  try {
    // Pixabay responde 400 si `q` pasa de MAX_QUERY_CHARS y no dice por qué:
    // el recorte aquí es la última red, para que ninguna consulta larga tumbe
    // la fuente entera desde otro punto de entrada
    const q = queryNorm.slice(0, MAX_QUERY_CHARS);
    const params = new URLSearchParams({ key, q, per_page: '15' });
    const json = await fetchJson(`https://pixabay.com/api/videos/?${params.toString()}`, {});
    const results = parsePixabay(json);
    await closeCost(db, handle, { units: 1, unitCost: 0 });
    await writeCache(db, queryNorm, 'pixabay', results);
    return results;
  } catch (err) {
    await failCost(db, handle, err instanceof Error ? err.message : String(err));
    logger.warn(
      { err, query: queryNorm },
      'Fallo en la búsqueda de Pixabay; se continúa sin stock',
    );
    return [];
  }
}

export async function searchStock(
  db: Db,
  logger: pino.Logger,
  query: string,
  ids: StockSearchIds,
): Promise<StockResult[]> {
  const [pexels, pixabay] = await Promise.all([
    searchPexels(db, logger, query, ids),
    searchPixabay(db, logger, query, ids),
  ]);
  return [...pexels, ...pixabay];
}

/**
 * Descripciones ya pagadas de estas miniaturas, indexadas POR IMAGEN.
 *
 * La descripción es de la imagen, no de la consulta que la encontró: cachearla
 * por consulta hacía que la misma miniatura se describiera otra vez al salir en
 * otra búsqueda. Medido antes del cambio: 1208 descripciones para 850 imágenes.
 */
export async function captionsByRef(db: Db, refs: string[]): Promise<Map<string, string>> {
  if (refs.length === 0) return new Map();
  const rows = await db
    .select({ ref: captionCache.ref, caption: captionCache.caption })
    .from(captionCache)
    .where(inArray(captionCache.ref, refs));
  return new Map(rows.map((r) => [r.ref, r.caption]));
}

// Persiste el caption VLM: en caption_cache por imagen (la fuente de verdad) y
// dentro del resultado cacheado de esta consulta, que es de donde lo lee el
// scoring sin volver a consultar.
export async function cacheCaption(
  db: Db,
  query: string,
  ref: string,
  caption: string,
): Promise<void> {
  await db.insert(captionCache).values({ ref, caption }).onConflictDoNothing();
  const provider = ref.startsWith('pixabay:') ? 'pixabay' : 'pexels';
  const queryNorm = normalizeQuery(query);
  const [row] = await db
    .select()
    .from(stockCache)
    .where(and(eq(stockCache.queryNorm, queryNorm), eq(stockCache.provider, provider)));
  if (!row) return;
  const results = (row.results as StockResult[]).map((r) =>
    r.ref === ref ? { ...r, meta: { ...r.meta, caption } } : r,
  );
  await db
    .update(stockCache)
    .set({ results })
    .where(and(eq(stockCache.queryNorm, queryNorm), eq(stockCache.provider, provider)));
}
