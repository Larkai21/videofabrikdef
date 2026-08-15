import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type pino from 'pino';
import { captionCache, stockCache, type Db } from '@fabrica/db';
import { MAX_QUERY_CHARS, STOCK_CACHE_TTL_H, stockRef } from '@fabrica/shared';
import { consultaDeBuscador } from '../pipelines/assets/broll-director.js';
import { STOCK_FINALISTS } from '../pipelines/assets/pool.js';
import { searchOpenverse } from './openverse.js';
import { searchWikimedia } from './wikimedia.js';
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
  // licencia por ITEM cuando el proveedor la trae (NASA: dominio público;
  // Wikimedia la trae en su propio tipo); la ingesta la prefiere al nombre
  // del proveedor
  license?: string;
  // atribución exigida por esa licencia; la ingesta la guarda en la fila del
  // asset y la congelación la lleva al maestro y a description.txt
  credit?: string;
}

export interface StockResult {
  ref: string;
  // 'wikimedia' y 'nasa' solo aparecen cuando el stock comercial se queda
  // corto: la red de dominio público (NASA = clips, Commons = imágenes PD/CC0),
  // nunca fuente principal (ver searchStock)
  provider: 'pexels' | 'pixabay' | 'nasa' | 'openverse' | 'wikimedia';
  thumb_url: string;
  meta: StockMeta;
}

export interface StockSearchIds {
  videoId?: string | null;
  channelId?: string | null;
  /**
   * Colector de fuentes muertas: si una búsqueda no puede ejecutarse (API key
   * ausente, error de red tras el reintento), se anota provider → motivo en
   * vez de morir SOLO con un warn. El matching lo vuelca a broll_telemetry
   * para que el informe de calidad lo enseñe — un .env roto degradaba toda la
   * variedad a biblioteca+reserva sin que nadie lo viera.
   */
  muertes?: Map<string, string>;
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
  // Un 429 se reintenta UNA vez respetando Retry-After. Antes se trataba como
  // cualquier error: se tragaba con un warn y la fuente moría para ese beat en
  // silencio. Con 2 requests por consulta y ~40 consultas por vídeo, el límite
  // de 200/h de Pexels se roza en cuanto se producen dos vídeos seguidos.
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? '2');
    const esperaMs = Math.min(30_000, Math.max(1_000, retryAfter * 1_000));
    await new Promise((r) => setTimeout(r, esperaMs));
    const otra = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!otra.ok) throw new Error(`HTTP ${otra.status} en ${new URL(url).host} (tras 429)`);
    return otra.json();
  }
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

// exportada para el resolutor de insertos, que solo quiere las FOTOS del
// resultado combinado (filtra meta.kind === 'image' y reutiliza esta caché)
export async function searchPexels(
  db: Db,
  logger: pino.Logger,
  query: string,
  ids: StockSearchIds,
): Promise<StockResult[]> {
  const queryNorm = normalizeQuery(query);
  const cached = await readCache(db, queryNorm, 'pexels');
  if (cached) return cached;

  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    ids.muertes?.set('pexels', 'falta PEXELS_API_KEY en el entorno');
    return [];
  }

  const handle = await openCost(db, {
    videoId: ids.videoId ?? null,
    channelId: ids.channelId ?? null,
    provider: 'pexels',
    operation: 'search',
    meta: { query: queryNorm },
  });
  try {
    const headers = { Authorization: key };
    // 80 es el máximo de Pexels y SPEC.md ya lo contemplaba; estaba en 15.
    // Mismo número de requests, solo respuestas más anchas — y cacheadas 24 h.
    // El pool ancho es el insumo del juez de planos, que es la única señal con
    // precisión medida (24/25): darle 6 candidatos de 15 resultados era
    // estrecharle la vista dos veces.
    const params = new URLSearchParams({
      query: queryNorm,
      orientation: 'landscape',
      per_page: '80',
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
    const motivo = err instanceof Error ? err.message : String(err);
    await failCost(db, handle, motivo);
    ids.muertes?.set('pexels', motivo);
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
  if (!key) {
    ids.muertes?.set('pixabay', 'falta PIXABAY_API_KEY en el entorno');
    return [];
  }

  const handle = await openCost(db, {
    videoId: ids.videoId ?? null,
    channelId: ids.channelId ?? null,
    provider: 'pixabay',
    operation: 'search',
    meta: { query: queryNorm },
  });
  try {
    // Pixabay hace OR PURO entre palabras: medido, 'server'=48 resultados,
    // 'server room'=803, '+corridor'=989, '+empty'=1281. Cada palabra ENSANCHA
    // el pool con otro tema («small team…» devolvía perros pequeños por
    // «small»), así que aquí la consulta se recorta a DOS palabras — el resto
    // del matiz lo pone el juez mirando los candidatos, no el buscador.
    const q = consultaDeBuscador(queryNorm, 2).slice(0, MAX_QUERY_CHARS);
    // 200 (el máximo) en la MISMA petición: no cuesta cuota y el pool se
    // reordena luego por relevancia local, así que traer más ya no significa
    // «más ruido primero». video_type=film deja fuera las animaciones de banco.
    const params = new URLSearchParams({
      key,
      q,
      per_page: '200',
      safesearch: 'true',
      video_type: 'film',
    });
    const json = await fetchJson(`https://pixabay.com/api/videos/?${params.toString()}`, {});
    const results = parsePixabay(json);
    await closeCost(db, handle, { units: 1, unitCost: 0 });
    await writeCache(db, queryNorm, 'pixabay', results);
    return results;
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    await failCost(db, handle, motivo);
    ids.muertes?.set('pixabay', motivo);
    logger.warn(
      { err, query: queryNorm },
      'Fallo en la búsqueda de Pixabay; se continúa sin stock',
    );
    return [];
  }
}

// ---- NASA Image and Video Library: red de CLIPS de dominio público ----
// Sin API key y sin rate limit publicado. La búsqueda no trae ni URL de mp4 ni
// duración, así que por cada candidato se pagan 2 requests más (collection.json
// para las variantes de fichero y metadata.json para duración/dimensiones) —
// por eso el tope de candidatos es corto y la fuente solo entra como red.
const NASA_CANDIDATOS = 5;

/** «0:03:39», «03:39» o segundos a pelo → ms; null si no se entiende. */
export function parseNasaDuration(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.round(raw * 1000);
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const t = raw.trim();
  // «12.34 s» del exiftool también aparece
  const soloSegundos = /^(\d+(?:\.\d+)?)(?:\s*s)?$/.exec(t);
  if (soloSegundos) return Math.round(Number(soloSegundos[1]) * 1000);
  const partes = t.split(':').map((p) => Number(p));
  if (partes.some((p) => !Number.isFinite(p))) return null;
  const [s = 0, m = 0, h = 0] = partes.reverse();
  const ms = Math.round((h * 3600 + m * 60 + s) * 1000);
  return ms > 0 ? ms : null;
}

/** La variante razonable para render 1080p: large > medium > orig. */
export function pickNasaFile(files: string[]): string | null {
  const mp4s = files.filter((f) => f.toLowerCase().endsWith('.mp4'));
  const porVariante = (suf: string): string | undefined =>
    mp4s.find((f) => f.toLowerCase().includes(`~${suf}.mp4`));
  const elegido = porVariante('large') ?? porVariante('medium') ?? porVariante('orig') ?? mp4s[0];
  // los ficheros llegan con http:// pelado; el download va por https
  return elegido !== undefined ? elegido.replace(/^http:\/\//, 'https://') : null;
}

// exportada para poder probarla suelta (scripts), como searchPexels
export async function searchNasa(
  db: Db,
  logger: pino.Logger,
  query: string,
  ids: StockSearchIds,
): Promise<StockResult[]> {
  const queryNorm = normalizeQuery(query);
  const cached = await readCache(db, queryNorm, 'nasa');
  if (cached) return cached;

  const handle = await openCost(db, {
    videoId: ids.videoId ?? null,
    channelId: ids.channelId ?? null,
    provider: 'nasa',
    operation: 'search',
    meta: { query: queryNorm },
  });
  try {
    const params = new URLSearchParams({ q: queryNorm, media_type: 'video', page_size: '10' });
    const json = (await fetchJson(
      `https://images-api.nasa.gov/search?${params.toString()}`,
      {},
    )) as {
      collection?: {
        items?: {
          href?: string;
          data?: { nasa_id?: string; title?: string; description?: string }[];
          links?: { href?: string; render?: string }[];
        }[];
      };
    };
    const items = (json.collection?.items ?? []).slice(0, NASA_CANDIDATOS);
    const out: StockResult[] = [];
    let requests = 1;
    for (const item of items) {
      const data = item.data?.[0];
      const nasaId = data?.nasa_id;
      const collectionHref = item.href;
      if (!nasaId || !collectionHref) continue;
      const base = collectionHref.replace(/\/collection\.json$/, '');
      try {
        const [filesJson, metaJson] = await Promise.all([
          fetchJson(collectionHref, {}),
          fetchJson(`${base}/metadata.json`, {}),
        ]);
        requests += 2;
        const files = Array.isArray(filesJson) ? (filesJson as string[]) : [];
        const downloadUrl = pickNasaFile(files);
        const metaMap = metaJson as Record<string, unknown>;
        const durationMs =
          parseNasaDuration(metaMap['QuickTime:Duration']) ??
          parseNasaDuration(metaMap['Composite:Duration']);
        // sin mp4 o sin duración el candidato no puede competir (computeFit
        // descarta clips sin duración): mejor fuera aquí que un finalista roto
        if (downloadUrl === null || durationMs === null) continue;
        const thumb = item.links?.find((l) => l.render === 'image')?.href ?? '';
        const descripcion = (data.description ?? '').replace(/\s+/g, ' ').trim();
        out.push({
          ref: stockRef('nasa', 'clip', nasaId),
          provider: 'nasa',
          thumb_url: thumb.replace(/^http:\/\//, 'https://'),
          meta: {
            download_url: downloadUrl,
            width: Number(metaMap['QuickTime:ImageWidth'] ?? 0),
            height: Number(metaMap['QuickTime:ImageHeight'] ?? 0),
            duration_ms: durationMs,
            title: String(data.title ?? nasaId),
            // la descripción oficial de NASA como caption: describe el
            // contenido real y ahorra el caption VLM de pago
            ...(descripcion !== ''
              ? { caption: descripcion.slice(0, 240) }
              : {}),
            kind: 'clip',
            license: 'Dominio público (NASA)',
          },
        });
      } catch (itemErr) {
        logger.warn({ err: itemErr, nasaId }, 'Candidato de NASA sin resolver; se salta');
      }
    }
    await closeCost(db, handle, { units: requests, unitCost: 0 });
    await writeCache(db, queryNorm, 'nasa', out);
    return out;
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    await failCost(db, handle, motivo);
    ids.muertes?.set('nasa', motivo);
    logger.warn({ err, query: queryNorm }, 'Fallo en la búsqueda de NASA; se continúa sin ella');
    return [];
  }
}

/**
 * La red de licencia libre, por separado: NASA (clips de dominio público),
 * Openverse (Flickr + Commons + museos, la única con material específico de
 * tecnología) y Commons. Existe suelta porque la puerta de «cuándo hace falta
 * la red» es de CALIDAD, no de cantidad, y esa señal vive en el matching (que
 * tiene los embeddings), no aquí. La puerta por cantidad de searchStock nunca
 * se abría: con Pexels y Pixabay devolviendo 200+, el pool comercial SIEMPRE
 * llega a diez, aunque los diez sean de otro tema.
 */
export async function searchRedLibre(
  db: Db,
  logger: pino.Logger,
  query: string,
  ids: StockSearchIds,
): Promise<StockResult[]> {
  const red: StockResult[] = [];
  try {
    red.push(...(await searchNasa(db, logger, query, ids)));
  } catch (err) {
    logger.warn({ err, query }, 'NASA en la red libre falló; se sigue');
  }
  try {
    red.push(...(await searchOpenverse(logger, query)));
  } catch (err) {
    const motivo = err instanceof Error ? err.message : String(err);
    ids.muertes?.set('openverse', motivo);
    logger.warn({ err, query }, 'Openverse en la red libre falló; se sigue');
  }
  try {
    red.push(...(await searchWikimedia(db, logger, query)));
  } catch (err) {
    logger.warn({ err, query }, 'Commons en la red libre falló; se sigue');
  }
  return red;
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
  const comercial = [...pexels, ...pixabay];
  // Red de licencia libre, no fuente principal: solo cuando el stock comercial
  // no llena el pool de finalistas — consultas de nicho (hardware concreto,
  // hechos históricos, diagramas) donde Pexels devuelve genérico o nada.
  if (comercial.length >= STOCK_FINALISTS) return comercial;
  // Tres pasos: NASA primero (da CLIPS, que es lo que el b-roll prefiere;
  // ideal en espacio/robótica/ciencia), luego Openverse (agregador de Flickr +
  // Commons + museos: es la única fuente con material REAL y específico de
  // tecnología — medido, «data center» y «semiconductor wafer» devuelven ahí
  // centros de datos y obleas de verdad, mientras el stock comercial devuelve
  // oficinas genéricas) y Commons al final. Todos entran con su licencia y su
  // atribución por item: desde que assets guarda `credit` y la congelación lo
  // lleva a description.txt («Metraje: …»), el filtro a PD/CC0 sobra.
  const red: StockResult[] = [];
  const nasa = await searchNasa(db, logger, query, ids);
  red.push(...nasa);
  if (comercial.length + red.length < STOCK_FINALISTS) {
    try {
      red.push(...(await searchOpenverse(logger, query)));
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      ids.muertes?.set('openverse', motivo);
      logger.warn({ err, query }, 'Openverse como red de b-roll falló; se sigue sin él');
    }
  }
  if (comercial.length + red.length < STOCK_FINALISTS) {
    try {
      const commons = await searchWikimedia(db, logger, query);
      red.push(...commons);
    } catch (err) {
      logger.warn({ err, query }, 'Commons como red de b-roll falló; se sigue sin él');
    }
  }
  return [...comercial, ...red];
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
  // el proveedor sale del prefijo del ref (formato provider:kind:id): el
  // ternario binario pexels/pixabay de antes habría escrito los captions de
  // cualquier proveedor nuevo en la fila de caché de Pexels (inexistente)
  const sep = ref.indexOf(':');
  const provider = sep > 0 ? ref.slice(0, sep) : 'pexels';
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
