import { and, eq, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { assets, stockCache, type Db } from '@fabrica/db';
import { MAX_QUERY_CHARS, STOCK_CACHE_TTL_H, stockRef, type BeatCandidate } from '@fabrica/shared';
import { closeCost, failCost, openCost } from './ledger.js';

// Cliente de stock de la API (búsqueda libre desde la timeline). Los workers
// tienen su propio cliente: duplicación asumida en S1 (docs/contratos.md §4).
// Caché obligatoria en stock_cache con TTL 24 h y query normalizada.
//
// Los dos clientes COMPARTEN la tabla stock_cache (misma clave única), así que
// lo que escribe uno lo lee el otro — y por eso este cliente pide EXACTAMENTE
// lo mismo que la cascada (Pexels vídeos+fotos per_page 80, Pixabay 50): antes
// pedía 15 solo-vídeo y su fila POBRE pisaba la fila rica de 80 que la cascada
// había pagado para la misma consulta, degradando el b-roll en silencio.
//
// La búsqueda libre además mira PRIMERO la biblioteca propia (que el buscador
// viejo ignoraba por completo: el humano no podía elegir un plano que YA era
// suyo) y añade los clips de NASA que la cascada dejó cacheados.

const TTL_MS = STOCK_CACHE_TTL_H * 3_600_000;
const FETCH_TIMEOUT_MS = 10_000;
const LIBRARY_LIMIT = 12;
// tope de candidatos de stock que se devuelven a la UI (la caché guarda todo)
const STOCK_UI_MAX = 96;

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface PexelsVideoFile {
  link?: string;
  width?: number;
  height?: number;
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

// el archivo más pequeño con altura ≥1080; si no hay, el mayor (espejo del
// cliente de los workers, para que las filas cacheadas sean equivalentes)
function bestPexelsFile(files: PexelsVideoFile[]): PexelsVideoFile | undefined {
  const sorted = [...files].sort((a, b) => (a.height ?? 0) - (b.height ?? 0));
  return sorted.find((f) => (f.height ?? 0) >= 1080) ?? sorted[sorted.length - 1];
}

function mapPexels(videosJson: unknown, photosJson: unknown): BeatCandidate[] {
  const clips: BeatCandidate[] = [];
  const fotos: BeatCandidate[] = [];
  const videos = (videosJson as { videos?: Record<string, unknown>[] })?.videos ?? [];
  for (const v of videos) {
    if (v.id == null) continue;
    const files = ((v.video_files as PexelsVideoFile[]) ?? []).filter(
      (f) => typeof f.link === 'string',
    );
    const file = bestPexelsFile(files);
    if (!file?.link) continue;
    clips.push({
      ref: stockRef('pexels', 'clip', String(v.id)),
      provider: 'pexels',
      score: 0,
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
    if (p.id == null) continue;
    const src = (p.src as Record<string, string> | undefined) ?? {};
    const download = src.large2x ?? src.original;
    if (!download) continue;
    fotos.push({
      ref: stockRef('pexels', 'image', String(p.id)),
      provider: 'pexels',
      score: 0,
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
  // clips y fotos entretejidos 2:1: si van las fotos al final, cualquier tope
  // aguas abajo se las come enteras (misma razón que interleaveByProvider en
  // los finalistas de la cascada)
  const tejido: BeatCandidate[] = [];
  let f = 0;
  for (let c = 0; c < clips.length || f < fotos.length; c += 2) {
    tejido.push(...clips.slice(c, c + 2));
    const foto = fotos[f];
    if (foto !== undefined) {
      tejido.push(foto);
      f += 1;
    }
  }
  return tejido;
}

function mapPixabay(payload: unknown): BeatCandidate[] {
  const hits = (payload as { hits?: Record<string, unknown>[] })?.hits ?? [];
  const out: BeatCandidate[] = [];
  for (const hit of hits) {
    if (hit.id == null) continue;
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
      score: 0,
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

/**
 * La biblioteca propia, PRIMERO: es absurdo que la búsqueda libre ofrezca
 * stock nuevo y esconda los planos que ya son del canal (pagados, etiquetados
 * y con licencia resuelta). Texto contra caption+tags+consulta de origen:
 * todos los tokens deben aparecer (AND) — simple, sin embeddings, porque la
 * API no carga el modelo; para «no encuentro nada» ya está el stock de abajo.
 */
export async function searchLibrary(
  db: Db,
  query: string,
  channelId: string | null,
): Promise<BeatCandidate[]> {
  const tokens = normalizeQuery(query).split(' ').filter((t) => t.length > 1);
  if (tokens.length === 0) return [];
  const haystack = sql`lower(coalesce(${assets.caption}, '') || ' ' || array_to_string(${assets.tags}, ' ') || ' ' || coalesce(${assets.originQuery}, ''))`;
  const tokenConds = tokens.map((t) => sql`${haystack} like ${'%' + t + '%'}`);
  const rows = await db
    .select({
      id: assets.id,
      kind: assets.kind,
      path: assets.path,
      caption: assets.caption,
      durationMs: assets.durationMs,
      width: assets.width,
      height: assets.height,
      timesUsed: assets.timesUsed,
    })
    .from(assets)
    .where(
      and(
        sql`${assets.kind} in ('clip', 'image')`,
        channelId === null
          ? eq(assets.scope, 'shared')
          : or(eq(assets.channelId, channelId), eq(assets.scope, 'shared')),
        ...tokenConds,
      ),
    )
    .orderBy(sql`${assets.timesUsed} desc`)
    .limit(LIBRARY_LIMIT);
  return rows.map((r) => ({
    ref: `library:${r.id}`,
    provider: 'library' as const,
    score: 0,
    meta: {
      asset_id: r.id,
      // candidateForDto deriva preview_url de meta.path (misma vía que los
      // candidatos de biblioteca de la cascada)
      path: r.path,
      kind: r.kind === 'image' ? 'image' : 'clip',
      duration_ms: r.durationMs ?? 0,
      width: r.width ?? 0,
      height: r.height ?? 0,
      title: r.caption ?? '',
    },
  }));
}

/** Clips de NASA que la cascada dejó cacheados para esta consulta (sin fetch
 * en vivo: resolver duración+mp4 son 2 requests por candidato y la búsqueda
 * libre tiene que ser instantánea). */
async function cachedNasa(db: Db, queryNorm: string): Promise<BeatCandidate[]> {
  const [row] = await db
    .select()
    .from(stockCache)
    .where(and(eq(stockCache.queryNorm, queryNorm), eq(stockCache.provider, 'nasa')))
    .limit(1);
  if (!row || Date.now() - row.fetchedAt.getTime() >= TTL_MS) return [];
  return asCandidates(row.results);
}

export async function searchStock(
  db: Db,
  query: string,
  channelId: string | null = null,
): Promise<BeatCandidate[]> {
  const queryNorm = normalizeQuery(query);
  const pexelsKey = process.env.PEXELS_API_KEY;
  const pixabayKey = process.env.PIXABAY_API_KEY;

  const tasks: Promise<BeatCandidate[]>[] = [searchLibrary(db, query, channelId)];

  if (pexelsKey) {
    tasks.push(
      cachedSearch(db, 'pexels', queryNorm, async () => {
        // espejo EXACTO de la cascada (per_page 80, vídeos + fotos): misma
        // petición → misma fila cacheada → nadie pisa a nadie
        const params = new URLSearchParams({
          query: queryNorm,
          orientation: 'landscape',
          per_page: '80',
        });
        const [videosRes, photosRes] = await Promise.all([
          fetch(`https://api.pexels.com/videos/search?${params.toString()}&size=medium`, {
            headers: { Authorization: pexelsKey },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          }),
          fetch(`https://api.pexels.com/v1/search?${params.toString()}`, {
            headers: { Authorization: pexelsKey },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          }),
        ]);
        if (!videosRes.ok) throw new Error(`Pexels respondió ${videosRes.status}`);
        if (!photosRes.ok) throw new Error(`Pexels fotos respondió ${photosRes.status}`);
        return mapPexels(await videosRes.json(), await photosRes.json());
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
          per_page: '50',
          safesearch: 'true',
        });
        const res = await fetch(`https://pixabay.com/api/videos/?${params.toString()}`, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`Pixabay respondió ${res.status}`);
        return mapPixabay(await res.json());
      }),
    );
  }

  tasks.push(cachedNasa(db, queryNorm));

  const [biblioteca, ...stock] = await Promise.all(tasks);
  // tope de cortesía con la UI: la biblioteca entra entera (es poca y es
  // tuya); el stock se recorta intercalado por proveedor para que Pixabay y
  // NASA no queden enterrados bajo los 160 de Pexels
  const porProveedor = stock.filter((lista) => lista.length > 0);
  const intercalado: BeatCandidate[] = [];
  for (let i = 0; intercalado.length < STOCK_UI_MAX; i++) {
    let alguno = false;
    for (const lista of porProveedor) {
      const item = lista[i];
      if (item === undefined) continue;
      intercalado.push(item);
      alguno = true;
      if (intercalado.length >= STOCK_UI_MAX) break;
    }
    if (!alguno) break;
  }
  return [...(biblioteca ?? []), ...intercalado];
}
