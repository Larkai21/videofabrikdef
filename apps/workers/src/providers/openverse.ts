import type pino from 'pino';
import { stockRef } from '@fabrica/shared';
import type { StockResult } from './stock.js';

// Openverse (openverse.org, de WordPress): AGREGADOR de imágenes con licencia
// libre — Flickr (536 M), Wikimedia Commons (88 M), Rawpixel, StockSnap, NASA,
// museos. Entra en la cascada porque resuelve el hueco que Pexels y Pixabay no
// cubren: material REAL y específico de tecnología. Medido el 15-ago-2026 con
// las consultas que devolvían basura en el stock comercial: «data center»,
// «humanoid robot» y «semiconductor wafer» devuelven aquí fotos de centros de
// datos, robots humanoides reales y obleas de silicio; en Pexels, «liquid
// cooling pipes inside rack» devolvía tarta de helado y alcachofas de ducha.
//
// Sin clave y sin coste. Dos cosas que lo hacen especialmente barato de
// integrar: el filtro de licencia es NATIVO (license_type=commercial,
// modification excluye NC y ND) y la atribución llega YA REDACTADA en el campo
// `attribution`, que es justo lo que assets.credit necesita.
//
// Solo IMÁGENES: Openverse no indexa vídeo (su web delega el vídeo a búsquedas
// externas). Por eso entra como red junto a Commons, después de NASA, que sí
// da clips.

const BASE = 'https://api.openverse.org/v1/images/';
// cortesía con un servicio gratuito y sin clave (20 req/min anónimo)
const TIMEOUT_MS = 15_000;
const POR_CONSULTA = 12;
const MIN_LADO = 640;

/**
 * BY-SA se queda FUERA a propósito aunque permita uso comercial: es vírica y
 * discutir si un vídeo con un plano CC BY-SA arrastra el vídeo entero a esa
 * licencia no es una conversación que este canal quiera tener. Con CC0, dominio
 * público y CC BY hay material de sobra.
 */
const LICENCIAS_OK = new Set(['cc0', 'pdm', 'by']);

interface OpenverseItem {
  id?: string;
  title?: string;
  url?: string;
  thumbnail?: string;
  license?: string;
  license_version?: string;
  attribution?: string;
  source?: string;
  width?: number;
  height?: number;
}

export function mapOpenverse(json: unknown): StockResult[] {
  const items = (json as { results?: OpenverseItem[] })?.results ?? [];
  const out: StockResult[] = [];
  for (const it of items) {
    const id = it.id;
    const url = it.url;
    if (!id || !url) continue;
    const licencia = (it.license ?? '').toLowerCase();
    if (!LICENCIAS_OK.has(licencia)) continue;
    // el render sale a 1920 de ancho: por debajo de 640 la imagen se ve blanda
    if ((it.width ?? 0) < MIN_LADO && (it.height ?? 0) < MIN_LADO) continue;
    const credito = (it.attribution ?? '').replace(/\s+/g, ' ').trim();
    out.push({
      ref: stockRef('openverse', 'image', id),
      provider: 'openverse',
      thumb_url: it.thumbnail ?? url,
      meta: {
        download_url: url,
        width: Number(it.width ?? 0),
        height: Number(it.height ?? 0),
        duration_ms: 0,
        title: String(it.title ?? ''),
        kind: 'image',
        license: `${licencia.toUpperCase()}${it.license_version ? ` ${it.license_version}` : ''} · ${it.source ?? 'openverse'}`,
        // CC BY EXIGE crédito; CC0 y dominio público no, pero se guarda igual:
        // cuesta nada y la ingesta ya sabe llevarlo hasta description.txt
        ...(credito !== '' && licencia === 'by' ? { credit: credito } : {}),
      },
    });
  }
  return out;
}

export async function searchOpenverse(
  logger: pino.Logger,
  query: string,
): Promise<StockResult[]> {
  const params = new URLSearchParams({
    q: query,
    // el filtro de licencia es nativo: excluye NC (no comercial) y ND (sin
    // derivadas) en el propio servidor, no después
    license_type: 'commercial,modification',
    page_size: String(POR_CONSULTA),
  });
  const res = await fetch(`${BASE}?${params.toString()}`, {
    // la etiqueta identifica al cliente, como pide su documentación
    headers: { 'user-agent': 'videofabric/1.0 (fabrica de video self-hosted)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Openverse respondió ${res.status}`);
  const results = mapOpenverse(await res.json());
  logger.debug({ query, resultados: results.length }, 'Openverse consultado');
  return results;
}
