import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { stockCache, type Db } from '@fabrica/db';
import { MAX_QUERY_CHARS, STOCK_CACHE_TTL_H, stockRef, type BeatCandidate } from '@fabrica/shared';
import { closeCost, failCost, openCost } from './ledger.js';

// Cliente de stock de la API (búsqueda libre desde la timeline). Los workers
// tienen su propio cliente: duplicación asumida en S1 (docs/contratos.md §4).
// Caché obligatoria en stock_cache con TTL 24 h y query normalizada.
//
// Los dos clientes COMPARTEN la tabla stock_cache (misma clave única), así que
// lo que escribe uno lo lee el otro. Por eso la fila tiene que satisfacer las
// dos formas a la vez: `ref` canónica de `stockRef`, `score` para el candidato
// de la timeline y `meta.title` para el coseno de la cascada. Escribir de menos
// aquí degradaba el b-roll en silencio del otro lado.

const TTL_MS = STOCK_CACHE_TTL_H * 3_600_000;
const FETCH_TIMEOUT_MS = 10_000;

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface PexelsVideoFile {
  link?: string;
  file_type?: string;
  width?: number;
  height?: number;
}

interface PexelsVideo {
  id?: number;
  image?: string;
  duration?: number;
  url?: string;
  video_files?: PexelsVideoFile[];
  user?: { name?: string };
}

/**
 * Lo único descriptivo que da la API de vídeo de Pexels es el slug de la URL:
 * ni `alt` ni `tags` vienen rellenos. El nombre del fotógrafo no describe nada.
 * (Misma función que en el cliente de los workers; la caché es compartida.)
 */
function tituloDesdeUrlPexels(url: string, fallback: string): string {
  const m = /\/video\/([a-z0-9-]+?)-\d+\/?$/i.exec(url);
  const slug = m?.[1];
  return slug === undefined || slug === '' ? fallback : slug.replace(/-/g, ' ').trim();
}

function mapPexels(payload: unknown): BeatCandidate[] {
  const videos = (payload as { videos?: PexelsVideo[] }).videos ?? [];
  const out: BeatCandidate[] = [];
  for (const video of videos) {
    if (video.id == null) continue;
    const files = (video.video_files ?? []).filter(
      (f) => typeof f.link === 'string' && (f.file_type ?? '').includes('mp4'),
    );
    // el archivo más grande que no pase de 1920 de ancho; si no hay, el menor
    files.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
    const file = files.find((f) => (f.width ?? 0) <= 1920) ?? files[files.length - 1];
    if (!file?.link) continue;
    out.push({
      ref: stockRef('pexels', 'clip', video.id),
      provider: 'pexels',
      // la búsqueda libre no pasa por embeddings: score neutro, decide el humano
      score: 0,
      ...(video.image ? { thumb_url: video.image } : {}),
      meta: {
        download_url: file.link,
        kind: 'clip',
        width: file.width ?? 0,
        height: file.height ?? 0,
        duration_ms: Math.round((video.duration ?? 0) * 1000),
        // lo lee la cascada para el coseno; sin él puntúa sobre cadena vacía
        title: tituloDesdeUrlPexels(video.url ?? '', video.user?.name ?? ''),
      },
    });
  }
  return out;
}

interface PixabayVideoVariant {
  url?: string;
  width?: number;
  height?: number;
  thumbnail?: string;
}

interface PixabayHit {
  id?: number;
  duration?: number;
  tags?: string;
  videos?: {
    large?: PixabayVideoVariant;
    medium?: PixabayVideoVariant;
    small?: PixabayVideoVariant;
    tiny?: PixabayVideoVariant;
  };
}

function mapPixabay(payload: unknown): BeatCandidate[] {
  const hits = (payload as { hits?: PixabayHit[] }).hits ?? [];
  const out: BeatCandidate[] = [];
  for (const hit of hits) {
    if (hit.id == null) continue;
    const variant = hit.videos?.large ?? hit.videos?.medium ?? hit.videos?.small;
    if (!variant?.url) continue;
    const thumb = variant.thumbnail ?? hit.videos?.tiny?.thumbnail;
    out.push({
      ref: stockRef('pixabay', 'clip', hit.id),
      provider: 'pixabay',
      score: 0,
      ...(thumb ? { thumb_url: thumb } : {}),
      meta: {
        download_url: variant.url,
        kind: 'clip',
        width: variant.width ?? 0,
        height: variant.height ?? 0,
        duration_ms: Math.round((hit.duration ?? 0) * 1000),
        title: hit.tags ?? '',
      },
    });
  }
  return out;
}

/**
 * La fila cacheada la pudo escribir el cliente de los workers, cuyo tipo no
 * lleva `score` (lo calcula después con embeddings). Sin este relleno la
 * timeline recibía candidatos con `score: undefined` y pintaba la barra vacía.
 */
function asCandidates(results: unknown): BeatCandidate[] {
  if (!Array.isArray(results)) return [];
  return results.map((r) => {
    const c = r as BeatCandidate;
    return typeof c.score === 'number' ? c : { ...c, score: 0 };
  });
}

async function cachedSearch(
  db: Db,
  provider: 'pexels' | 'pixabay',
  queryNorm: string,
  fetcher: () => Promise<BeatCandidate[]>,
): Promise<BeatCandidate[]> {
  const [cached] = await db
    .select()
    .from(stockCache)
    .where(and(eq(stockCache.queryNorm, queryNorm), eq(stockCache.provider, provider)))
    .limit(1);
  if (cached && Date.now() - cached.fetchedAt.getTime() < TTL_MS) {
    return asCandidates(cached.results);
  }

  const handle = await openCost(db, { provider, operation: 'search', meta: { query: queryNorm } });
  let results: BeatCandidate[];
  try {
    results = await fetcher();
    await closeCost(db, handle, { units: 1, unitCost: 0 });
  } catch (error) {
    await failCost(db, handle, error instanceof Error ? error.message : String(error));
    return cached ? asCandidates(cached.results) : [];
  }

  await db
    .insert(stockCache)
    .values({ id: nanoid(), queryNorm, provider, results, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: [stockCache.queryNorm, stockCache.provider],
      set: { results, fetchedAt: new Date() },
    });
  return results;
}

export async function searchStock(db: Db, query: string): Promise<BeatCandidate[]> {
  const queryNorm = normalizeQuery(query);
  const pexelsKey = process.env.PEXELS_API_KEY;
  const pixabayKey = process.env.PIXABAY_API_KEY;

  const tasks: Promise<BeatCandidate[]>[] = [];

  if (pexelsKey) {
    tasks.push(
      cachedSearch(db, 'pexels', queryNorm, async () => {
        const params = new URLSearchParams({
          query: queryNorm,
          orientation: 'landscape',
          size: 'medium',
          per_page: '15',
        });
        const res = await fetch(`https://api.pexels.com/videos/search?${params}`, {
          headers: { Authorization: pexelsKey },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Pexels respondió ${res.status}`);
        return mapPexels(await res.json());
      }),
    );
  }

  if (pixabayKey) {
    tasks.push(
      cachedSearch(db, 'pixabay', queryNorm, async () => {
        const params = new URLSearchParams({
          key: pixabayKey,
          // Pixabay devuelve 400 por encima de MAX_QUERY_CHARS (ver constants)
          q: queryNorm.slice(0, MAX_QUERY_CHARS),
          per_page: '15',
          safesearch: 'true',
        });
        const res = await fetch(`https://pixabay.com/api/videos/?${params}`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Pixabay respondió ${res.status}`);
        return mapPixabay(await res.json());
      }),
    );
  }

  // sin claves configuradas la búsqueda devuelve vacío (modo mock)
  if (!tasks.length) return [];
  const settled = await Promise.all(tasks);
  return settled.flat();
}
