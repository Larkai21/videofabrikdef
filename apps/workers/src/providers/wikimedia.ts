import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type pino from 'pino';
import { stockCache, type Db } from '@fabrica/db';
import { STOCK_CACHE_TTL_H } from '@fabrica/shared';
import { normalizeQuery } from './stock.js';

// Wikimedia Commons: la fuente de los INSERTOS de referencia (imagen real de
// una entidad con nombre — producto, empresa, modelo). El stock genérico no
// tiene material de entidades («llama open source model» → llamas de los
// Andes); Commons sí, con licencia explícita por imagen.
//
// Sin clave de API. La única cortesía obligatoria es un User-Agent
// identificable. Caché en stock_cache bajo provider 'wikimedia' (misma tabla y
// TTL que el stock: la columna provider es texto libre).
//
// Solo licencias que permiten uso comercial con o sin atribución: PD/CC0/
// CC BY/CC BY-SA. Las NC/ND se descartan aunque la imagen fuera perfecta.
// La atribución («Autor, licencia, via Wikimedia Commons») viaja con el
// resultado y acaba en el edit y en description.txt.

export interface WikimediaImage {
  ref: string; // wikimedia:image:<pageid>
  provider: 'wikimedia';
  thumb_url: string;
  meta: {
    download_url: string;
    width: number;
    height: number;
    duration_ms: 0;
    title: string;
    kind: 'image';
    caption?: string;
    /** nombre corto de la licencia (CC BY-SA 4.0, CC0…) */
    license: string;
    /** atribución lista para pegar; '' si la licencia no la exige (PD/CC0) */
    credit: string;
  };
}

const UA = 'videofabric/0.1 (self-hosted video tool; contacto en el repo)';
const API = 'https://commons.wikimedia.org/w/api.php';

// nombres cortos tal como llegan en extmetadata.LicenseShortName
const LICENSE_OK = /^(public domain|pd|cc0|cc[ -]by(?:[ -]sa)?[ -]?\d(?:\.\d)?)/i;
const SIN_ATRIBUCION = /^(public domain|pd|cc0)/i;

function stripHtml(s: string): string {
  return (
    s
      .replace(/<[^>]*>/g, ' ')
      // entidades comunes de los metadatos de Commons: sin decodificarlas,
      // «Smith &amp; Jones» acababa tal cual en pantalla y en description.txt
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

interface ImageInfoRaw {
  url?: string;
  thumburl?: string;
  width?: number;
  height?: number;
  mime?: string;
  extmetadata?: Record<string, { value?: string } | undefined>;
}

interface PageRaw {
  pageid?: number;
  title?: string;
  imageinfo?: ImageInfoRaw[];
}

// exportada solo para tests: el filtro de licencias es lo que protege al canal
export function parsePage(page: PageRaw): WikimediaImage | null {
  const info = page.imageinfo?.[0];
  if (!info || page.pageid === undefined) return null;
  if (info.mime !== 'image/jpeg' && info.mime !== 'image/png') return null;
  if ((info.width ?? 0) < 640) return null;
  const ext = info.extmetadata ?? {};
  const license = stripHtml(ext['LicenseShortName']?.value ?? '');
  if (!LICENSE_OK.test(license)) return null;
  const artist = stripHtml(ext['Artist']?.value ?? '');
  const credit = SIN_ATRIBUCION.test(license)
    ? ''
    : `${artist !== '' ? artist : 'Wikimedia Commons'}, ${license}, via Wikimedia Commons`;
  // el thumb a 1280 es el download: el original puede ser un TIFF de 80 MB y
  // para un recuadro de 560 px no aporta nada
  const download = info.thumburl ?? info.url ?? '';
  if (download === '') return null;
  const title = (page.title ?? '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '');
  const caption = stripHtml(ext['ImageDescription']?.value ?? '');
  return {
    ref: `wikimedia:image:${page.pageid}`,
    provider: 'wikimedia',
    thumb_url: info.thumburl ?? download,
    meta: {
      download_url: download,
      width: info.width ?? 0,
      height: info.height ?? 0,
      duration_ms: 0,
      title,
      kind: 'image',
      ...(caption !== '' ? { caption: caption.slice(0, 300) } : {}),
      license,
      credit,
    },
  };
}

/** Busca imágenes con licencia utilizable en Commons; [] ante cualquier fallo. */
export async function searchWikimedia(
  db: Db,
  logger: pino.Logger,
  query: string,
): Promise<WikimediaImage[]> {
  const queryNorm = normalizeQuery(query);
  const [row] = await db
    .select()
    .from(stockCache)
    .where(and(eq(stockCache.queryNorm, queryNorm), eq(stockCache.provider, 'wikimedia')));
  if (row && Date.now() - row.fetchedAt.getTime() <= STOCK_CACHE_TTL_H * 3_600_000) {
    return row.results as unknown as WikimediaImage[];
  }

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: queryNorm,
    gsrnamespace: '6', // File:
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1280',
    origin: '*',
  });
  let results: WikimediaImage[] = [];
  try {
    const res = await fetch(`${API}?${params.toString()}`, {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} en commons.wikimedia.org`);
    const body = (await res.json()) as { query?: { pages?: Record<string, PageRaw> } };
    results = Object.values(body.query?.pages ?? {})
      .map(parsePage)
      .filter((r): r is WikimediaImage => r !== null);
  } catch (err) {
    logger.warn({ query: queryNorm, err: String(err) }, 'Wikimedia Commons no respondió');
    return [];
  }

  await db
    .insert(stockCache)
    .values({
      id: nanoid(),
      queryNorm,
      provider: 'wikimedia',
      results: results as unknown as Record<string, unknown>[],
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [stockCache.queryNorm, stockCache.provider],
      set: { results: results as unknown as Record<string, unknown>[], fetchedAt: new Date() },
    });
  return results;
}
