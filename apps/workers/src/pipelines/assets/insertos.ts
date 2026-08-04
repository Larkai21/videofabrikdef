import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { assets } from '@fabrica/db';
import type { BeatCandidate } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { searchPexels } from '../../providers/stock.js';
import { searchWikimedia, type WikimediaImage } from '../../providers/wikimedia.js';
import { downloadWithCap } from './download.js';
import { claveDe, rerankBeats, type RerankPlano } from './rerank.js';

// Resolutor de INSERTOS: la intención `inserto` del guion («aquí se nombra una
// entidad concreta — enseña una imagen real de ella») llega como término +
// instante, y este módulo la convierte en un fichero congelado o en nada.
//
// Cascada: fotos de Pexels (el stock tiene poco material de entidades, pero es
// gratis de mirar porque la búsqueda ya está cacheada) → Wikimedia Commons
// (que sí tiene productos, empresas y modelos, con licencia por imagen). El
// JUEZ DE PLANOS veta con los mismos criterios que el b-roll — todos los
// insertos del vídeo en UNA llamada — y puede decir «ninguno pega»: mejor sin
// inserto que con el logo equivocado. Solo se descarga la imagen GANADORA (una
// por inserto), y se registra en `assets` con su licencia; la atribución viaja
// en el edit y acaba en description.txt.
//
// Sin generación de imagen: si no hay foto real con licencia, no hay inserto.

export interface InsertoPendiente {
  /** el término a ilustrar (card_text si el guion afinó la búsqueda, si no trigger_word) */
  term: string;
  beatIdx: number;
  /** lo que se oye en ese beat, para el juez */
  beatText: string;
  atMs: number;
  toMs: number;
}

export interface InsertoResuelto {
  imagePath: string;
  /** atribución si la licencia la exige; undefined si no (Pexels, PD/CC0) */
  credit?: string;
}

function candidatosDe(pexels: BeatCandidate[], wiki: WikimediaImage[]): BeatCandidate[] {
  // Wikimedia primero: para una entidad con nombre, Commons casi siempre tiene
  // LA imagen y Pexels tiene «una parecida». El juez decide con los pies de
  // foto; el orden solo importa como desempate implícito.
  const wikiCands: BeatCandidate[] = wiki.map((w) => ({
    ref: w.ref,
    provider: 'wikimedia',
    score: 0,
    thumb_url: w.thumb_url,
    meta: w.meta as unknown as Record<string, unknown>,
  }));
  return [...wikiCands, ...pexels].slice(0, 6);
}

async function buscarCandidatos(
  ctx: WorkerContext,
  video: { id: string; channelId: string },
  term: string,
): Promise<BeatCandidate[]> {
  const [stock, wiki] = await Promise.all([
    searchPexels(ctx.db, ctx.logger, term, { videoId: video.id, channelId: video.channelId }),
    searchWikimedia(ctx.db, ctx.logger, term),
  ]);
  const fotos: BeatCandidate[] = stock
    .filter((r) => r.meta.kind === 'image')
    .map((r) => ({
      ref: r.ref,
      provider: r.provider,
      score: 0,
      thumb_url: r.thumb_url,
      meta: r.meta as unknown as Record<string, unknown>,
    }));
  return candidatosDe(fotos, wiki);
}

async function congelarGanador(
  ctx: WorkerContext,
  video: { id: string; channelId: string },
  pendiente: InsertoPendiente,
  elegido: BeatCandidate,
): Promise<InsertoResuelto | null> {
  const log = ctx.logger.child({ videoId: video.id, inserto: pendiente.term });
  const meta = (elegido.meta ?? {}) as Record<string, unknown>;
  const credit = typeof meta.credit === 'string' && meta.credit !== '' ? meta.credit : undefined;

  // si ese recurso ya está en la biblioteca, se reutiliza sin descargar
  const [ya] = await ctx.db
    .select({ id: assets.id, path: assets.path })
    .from(assets)
    .where(eq(assets.sourceRef, elegido.ref))
    .limit(1);
  if (ya) {
    const absPath = path.isAbsolute(ya.path) ? ya.path : path.join(ctx.libraryDir, ya.path);
    return { imagePath: absPath, ...(credit !== undefined ? { credit } : {}) };
  }

  const downloadUrl = typeof meta.download_url === 'string' ? meta.download_url : '';
  if (downloadUrl === '') return null;
  const ext = /\.png(\?|$)/i.test(downloadUrl) ? '.png' : '.jpg';
  const destDir = path.join(ctx.libraryDir, 'assets', video.channelId, 'image');
  await fs.mkdir(destDir, { recursive: true });
  const destPath = path.join(destDir, `${nanoid()}${ext}`);
  try {
    await downloadWithCap(downloadUrl, destPath, elegido.ref);
  } catch (err) {
    log.warn({ err: String(err) }, 'No se pudo descargar el inserto; se descarta');
    return null;
  }
  const license =
    typeof meta.license === 'string' && meta.license !== ''
      ? meta.license
      : elegido.provider === 'pexels'
        ? 'Pexels'
        : 'Wikimedia Commons';
  await ctx.db.insert(assets).values({
    id: nanoid(),
    scope: 'channel',
    channelId: video.channelId,
    kind: 'image',
    path: destPath,
    source: elegido.provider,
    sourceRef: elegido.ref,
    license,
    width: typeof meta.width === 'number' ? meta.width : null,
    height: typeof meta.height === 'number' ? meta.height : null,
    tags: [],
    caption: typeof meta.caption === 'string' ? meta.caption : String(meta.title ?? ''),
    originQuery: pendiente.term,
    timesUsed: 1,
    lastVideoId: video.id,
  });
  return { imagePath: destPath, ...(credit !== undefined ? { credit } : {}) };
}

/**
 * Resuelve todos los insertos del vídeo. Devuelve un mapa índice→resuelto;
 * el que no aparece se descartó (sin candidatos, veto del juez o descarga
 * fallida) y es mejor así que mal.
 */
export async function resolverInsertos(
  ctx: WorkerContext,
  video: { id: string; channelId: string },
  pendientes: InsertoPendiente[],
): Promise<Map<number, InsertoResuelto>> {
  const out = new Map<number, InsertoResuelto>();
  if (pendientes.length === 0) return out;

  const listas = await Promise.all(
    pendientes.map((p) => buscarCandidatos(ctx, video, p.term)),
  );
  // vIdx sintético = posición del inserto: cada plano del juez necesita una
  // clave única y estos no compiten con los sub-planos del b-roll (llamada aparte)
  const planos: RerankPlano[] = pendientes.map((p, i) => ({
    beatIdx: p.beatIdx,
    vIdx: i,
    text: p.beatText,
    query: `imagen de referencia de ${p.term}`,
    candidates: listas[i] ?? [],
  }));
  const conCandidatos = planos.filter((p) => p.candidates.length > 0);
  if (conCandidatos.length === 0) return out;

  // minCandidatos: 1 — el juez también veta candidatos únicos; con el mínimo
  // por defecto (2), un inserto con una sola foto se saltaba el veto entero
  const veredicto = await rerankBeats(ctx, {
    videoId: video.id,
    channelId: video.channelId,
    planos: conCandidatos,
    minCandidatos: 1,
  });
  if (!veredicto.juzgado) {
    // el b-roll sin juez sigue con su orden (es mejora, no puerta); el
    // inserto sin juez NO pasa: su única garantía es el veto
    ctx.logger.warn(
      { videoId: video.id, insertos: pendientes.length },
      'El juez de planos no llegó a mirar los insertos; se descartan todos',
    );
    return out;
  }

  for (let i = 0; i < pendientes.length; i += 1) {
    const pendiente = pendientes[i]!;
    const plano = planos[i]!;
    if (plano.candidates.length === 0) continue;
    if (veredicto.sinPlano.has(claveDe(plano))) {
      ctx.logger.info(
        { videoId: video.id, inserto: pendiente.term },
        'El juez dice que ningún candidato ilustra el término; sin inserto',
      );
      continue;
    }
    const elegido = veredicto.orden.get(claveDe(plano))?.[0] ?? plano.candidates[0]!;
    const resuelto = await congelarGanador(ctx, video, pendiente, elegido);
    if (resuelto) out.set(i, resuelto);
  }
  return out;
}
