import fs from 'node:fs/promises';
import path from 'node:path';
import { Worker, type Job } from 'bullmq';
import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm';
import { execa } from 'execa';
import { nanoid } from 'nanoid';
import {
  assets as assetsTable,
  beats as beatsTable,
  channels,
  markIncident,
  transitionVideo,
  videos,
  type Db,
} from '@fabrica/db';
import {
  ANTI_REPEAT_N,
  JOBS,
  MAX_LOOPS,
  PRICES,
  QUEUES,
  T_AUTO,
  T_REV,
  T_STOCK,
  masterVideoJsonV1,
  type AssetsIngestJob,
  type AssetsMatchJob,
  type Beat,
  type BeatCandidate,
  type Fit,
  type RenderVideoJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { buildAssetEmbedText } from '../../lib/embed-text.js';
import { closeCost, failCost, openCost } from '../../lib/ledger.js';
import { cosineSimilarity } from '../../providers/embeddings.js';
import { generateFluxImage } from '../../providers/flux.js';
import { mockHash } from '../../providers/llm.js';
import { cacheCaption, searchStock, type StockResult } from '../../providers/stock.js';
import { directBroll } from './broll-director.js';
import { computeFit, kenburnsEffect } from './fit.js';
import { registerAssetsMocks } from './mocks.js';
import { expandQuery, stockScore } from './score.js';

// Worker de assets (docs/assets-y-biblioteca.md): cascada biblioteca →
// stock → Flux por beat (match) y descarga + ingesta a biblioteca al
// aprobar la timeline (ingest).

const LIB_CANDIDATES = 6;
const STOCK_FINALISTS = 8;
const ALTERNATES = 4;
// margen de coseno dentro del cual se prefiere el clip que cubre el beat en una
// sola pasada (evita bucles) frente al de coseno ligeramente mayor
const PICK_COS_MARGIN = 0.04;
// coseno de contenido por encima del cual dos clips se consideran "el mismo
// plano" y no deben caer en beats contiguos aunque sean refs distintos
const ADJACENT_DEDUPE_COS = 0.9;

type BeatRow = typeof beatsTable.$inferSelect;

interface PoolEntry {
  cand: BeatCandidate;
  kind: 'clip' | 'image';
  durationMs: number | null;
  // similitud coseno pura query↔contenido: la que se compara con los umbrales
  cos: number;
  // compuesto 0,6·cos + calidad + novedad: solo para ordenar entre parecidos
  composite: number;
  // otras identidades del MISMO asset (library:<id> ↔ sourceRef de stock)
  altRefs: string[];
  // embedding del contenido (caption/tags): para no repetir el mismo plano en
  // beats contiguos. Vacío si no se conoce.
  vec: number[];
}

function identityRefs(entry: PoolEntry): string[] {
  return [entry.cand.ref, ...entry.altRefs];
}

function toBeatKind(assetKind: string): 'clip' | 'image' {
  return assetKind === 'clip' ? 'clip' : 'image';
}

function originLabel(cand: BeatCandidate): string {
  if (cand.provider === 'library') {
    const title = (cand.meta?.title as string | undefined) ?? '';
    return `Biblioteca · ${title || cand.ref.replace('library:', '')}`;
  }
  if (cand.provider === 'flux') return 'Generado · Flux';
  const id = cand.ref.split(':')[2] ?? cand.ref;
  const isPhoto = cand.ref.includes(':photo:');
  const label = cand.provider === 'pexels' ? 'Pexels' : 'Pixabay';
  return `${label} · ${isPhoto ? 'imagen' : 'clip'} ${id}`;
}

async function recentAssetIds(db: Db, channelId: string, videoId: string, n: number): Promise<Set<string>> {
  const recentVideos = await db
    .select({ id: videos.id })
    .from(videos)
    .where(and(eq(videos.channelId, channelId), ne(videos.id, videoId)))
    .orderBy(desc(videos.createdAt))
    .limit(n);
  if (recentVideos.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ assetId: beatsTable.assetId })
    .from(beatsTable)
    .where(
      and(
        inArray(
          beatsTable.videoId,
          recentVideos.map((v) => v.id),
        ),
        isNotNull(beatsTable.assetId),
      ),
    );
  return new Set(rows.map((r) => r.assetId).filter((id): id is string => id !== null));
}

async function libraryCandidates(
  db: Db,
  channelId: string,
  qVec: number[],
  excludeIds: Set<string>,
): Promise<{ entry: PoolEntry; assetId: string }[]> {
  const vecLit = `[${qVec.join(',')}]`;
  const similarity = sql<number>`1 - (${assetsTable.embedding} <=> ${vecLit}::vector)`;
  const rows = await db
    .select({ asset: assetsTable, score: similarity })
    .from(assetsTable)
    .where(
      and(
        or(eq(assetsTable.channelId, channelId), eq(assetsTable.scope, 'shared')),
        inArray(assetsTable.kind, ['clip', 'image', 'screenshot']),
        isNotNull(assetsTable.embedding),
      ),
    )
    .orderBy(sql`${assetsTable.embedding} <=> ${vecLit}::vector`)
    .limit(LIB_CANDIDATES + excludeIds.size);

  return rows
    .filter((r) => !excludeIds.has(r.asset.id))
    .slice(0, LIB_CANDIDATES)
    .map((r) => ({
      assetId: r.asset.id,
      entry: {
        cand: {
          ref: `library:${r.asset.id}`,
          provider: 'library' as const,
          score: Number(r.score),
          meta: {
            path: r.asset.path,
            kind: toBeatKind(r.asset.kind),
            duration_ms: r.asset.durationMs,
            width: r.asset.width,
            height: r.asset.height,
            title: r.asset.caption ?? r.asset.tags.slice(0, 3).join(' '),
          },
        },
        kind: toBeatKind(r.asset.kind),
        durationMs: r.asset.durationMs,
        cos: Number(r.score),
        composite: Number(r.score),
        altRefs: r.asset.sourceRef ? [r.asset.sourceRef] : [],
        vec: r.asset.embedding ?? [],
      },
    }));
}

interface MatchDeps {
  ctx: WorkerContext;
  videoId: string;
  channelId: string;
  styleSuffix: string;
  recentIds: Set<string>;
  // refs ya elegidas en este vídeo (otros beats): anti-repetición intra-vídeo
  usedRefs: Set<string>;
  // embedding del contenido elegido en el beat anterior (para no repetir plano
  // en beats contiguos); mutable, lo actualiza matchBeat tras cada elección
  prevVec: number[] | null;
}

// Penalización de encaje: 0 para una sola pasada (trim/stretch/kenburns),
// nº de repeticiones para loop. Menor es mejor.
function loopPenalty(fit: Fit): number {
  return fit.mode === 'loop' ? (fit.loops ?? MAX_LOOPS) : 0;
}

// Elige el candidato: entre los que están dentro de PICK_COS_MARGIN del mejor
// coseno disponible, prefiere el que no repite plano del beat anterior y el que
// cubre el beat sin bucle; fuera de esa banda manda el coseno. Nunca sacrifica
// relevancia más allá del margen.
function selectPick(
  fitted: { entry: PoolEntry; fit: Fit }[],
  usedRefs: Set<string>,
  prevVec: number[] | null,
): { entry: PoolEntry; fit: Fit } | undefined {
  if (fitted.length === 0) return undefined;
  const fresh = fitted.filter((f) => identityRefs(f.entry).every((r) => !usedRefs.has(r)));
  const base = fresh.length > 0 ? fresh : fitted;
  const bestCos = base[0]?.entry.cos ?? 0; // fitted ya viene ordenado por coseno
  const band = base.filter((f) => bestCos - f.entry.cos <= PICK_COS_MARGIN);
  const isAdjacent = (e: PoolEntry): boolean =>
    prevVec !== null && e.vec.length > 0 && cosineSimilarity(prevVec, e.vec) > ADJACENT_DEDUPE_COS;
  const notAdjacent = band.filter((f) => !isAdjacent(f.entry));
  const contenders = notAdjacent.length > 0 ? notAdjacent : band;
  // dentro de la banda: primero sin bucle, luego mayor coseno
  return [...contenders].sort(
    (a, b) => loopPenalty(a.fit) - loopPenalty(b.fit) || b.entry.cos - a.entry.cos,
  )[0];
}

// Intercalado por proveedor y tipo: sin esto los finalistas salen por orden
// de API y Pixabay o las fotos de Pexels casi nunca llegan a puntuarse.
function interleaveByProvider(results: StockResult[]): StockResult[] {
  const groups = new Map<string, StockResult[]>();
  for (const r of results) {
    const key = `${r.provider}:${r.meta.kind}`;
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
  }
  const lists = [...groups.values()];
  const out: StockResult[] = [];
  for (let i = 0; out.length < results.length; i++) {
    for (const list of lists) {
      const item = list[i];
      if (item) out.push(item);
    }
    if (lists.every((l) => i >= l.length)) break;
  }
  return out;
}

async function matchBeat(deps: MatchDeps, beat: BeatRow): Promise<void> {
  const { ctx, videoId, channelId } = deps;
  const { db, logger } = ctx;
  const beatMs = beat.toMs - beat.fromMs;
  const queryText = expandQuery(beat.visualQuery, beat.text);
  const [qVec] = await ctx.embeddings.embed([queryText]);
  if (!qVec) throw new Error('No se pudo calcular el embedding de la query');

  // el clip que el humano descartó con motivo no debe volver a proponerse
  const vetoedRefs = new Set<string>(
    beat.discardReason && beat.candidates?.length ? [beat.candidates[0]!.ref] : [],
  );

  // 1) biblioteca (canal + shared, anti-repeat)
  const lib = await libraryCandidates(db, channelId, qVec, deps.recentIds);
  const pool: PoolEntry[] = lib
    .map((l) => l.entry)
    .filter((e) => !vetoedRefs.has(e.cand.ref));
  const libAssetByRef = new Map(lib.map((l) => [l.entry.cand.ref, l.assetId]));
  const bestLib = pool[0]?.cos ?? 0;

  // 2) stock solo si la biblioteca no llega al umbral
  if (bestLib < T_STOCK) {
    const stockResults = await searchStock(db, logger, queryText, { videoId, channelId });
    const finalists = interleaveByProvider(stockResults)
      .filter((f) => !vetoedRefs.has(f.ref))
      .slice(0, STOCK_FINALISTS);

    if (finalists.length > 0) {
      // caption VLM de finalistas (con caché dentro de stock_cache)
      const toCaption = finalists.filter((f) => !f.meta.caption && f.thumb_url);
      const handle = await openCost(db, {
        videoId,
        channelId,
        provider: ctx.llm.ledgerProvider,
        operation: 'vlm_caption',
        meta: { query: queryText, finalists: toCaption.length },
      });
      try {
        for (const finalist of toCaption) {
          const { caption } = await ctx.llm.captionImage(
            finalist.thumb_url,
            'Describe en una frase corta el contenido visual de esta imagen para indexarla como b-roll.',
          );
          finalist.meta.caption = caption;
          await cacheCaption(db, queryText, finalist.ref, caption);
        }
        await closeCost(db, handle, {
          units: toCaption.length,
          unitCost: ctx.llm.name === 'mock' ? 0 : PRICES.openai.vlm_caption_per_image,
        });
      } catch (err) {
        await failCost(db, handle, err instanceof Error ? err.message : String(err));
        logger.warn({ err }, 'Fallo captionando finalistas; se puntúa sin caption');
      }

      // novedad: el clip no debe estar entre los usados recientemente; el
      // mapeo sourceRef→asset también da la identidad library:<id> para la
      // anti-repetición intra-vídeo (mismo asset con dos nombres)
      const refs = finalists.map((f) => f.ref);
      const known = refs.length
        ? await db
            .select({ id: assetsTable.id, sourceRef: assetsTable.sourceRef })
            .from(assetsTable)
            .where(inArray(assetsTable.sourceRef, refs))
        : [];
      const usedRecentlyByRef = new Set(
        known.filter((k) => deps.recentIds.has(k.id)).map((k) => k.sourceRef),
      );
      const libraryIdByRef = new Map(
        known.flatMap((k) => (k.sourceRef ? [[k.sourceRef, k.id] as const] : [])),
      );

      // el coseno mide caption↔query: incluir la query en el texto embebido
      // inflaría la similitud con sus propios términos
      const texts = finalists.map((f) => String(f.meta.caption ?? f.meta.title ?? ''));
      const vectors = await ctx.embeddings.embed(texts);
      finalists.forEach((finalist, i) => {
        const vec = vectors[i];
        const cosine = vec && texts[i] !== '' ? cosineSimilarity(qVec, vec) : 0;
        const composite = stockScore({
          cosine,
          width: finalist.meta.width,
          height: finalist.meta.height,
          durationMs: finalist.meta.kind === 'clip' ? finalist.meta.duration_ms : null,
          beatDurationMs: beatMs,
          isImage: finalist.meta.kind === 'image',
          usedRecently: usedRecentlyByRef.has(finalist.ref),
        });
        const libId = libraryIdByRef.get(finalist.ref);
        pool.push(
          stockToEntry(finalist, cosine, composite, libId ? [`library:${libId}`] : [], vec ?? []),
        );
      });
    }
  }

  // 3) decisión sobre el COSENO CRUDO (los umbrales están calibrados para
  // similitud pura; el compuesto 0,6·cos+calidad+novedad solo ordena entre
  // candidatos parecidos). Solo entran candidatos con fit válido, y un asset
  // ya elegido para OTRO beat del mismo vídeo solo repite si no hay
  // alternativa (anti-repetición intra-vídeo por identidad de asset).
  pool.sort((a, b) => b.cos - a.cos || b.composite - a.composite);
  const fitted: { entry: PoolEntry; fit: Fit }[] = [];
  for (const entry of pool) {
    const fit = computeFit({
      kind: entry.kind,
      assetDurationMs: entry.durationMs,
      beatDurationMs: beatMs,
    });
    if (!fit) {
      logger.info(
        { videoId, beatIdx: beat.idx, ref: entry.cand.ref },
        'Candidato descartado: no cubre el beat ni con el máximo de loops',
      );
      continue;
    }
    fitted.push({ entry, fit: fit.fit });
  }
  const pick = selectPick(fitted, deps.usedRefs, deps.prevVec);
  let chosen: PoolEntry | undefined = pick?.entry;
  let chosenFit: Fit | undefined = pick?.fit;
  const rest: PoolEntry[] = fitted.filter((f) => f !== pick).map((f) => f.entry);

  let status: 'auto_ok' | 'review';
  let candidates: BeatCandidate[];

  if (!chosen || chosen.cos < T_REV) {
    // 4) Flux como último recurso → candidato único en revisión. Si el humano
    // descartó justo la imagen Flux anterior, la semilla determinista daría
    // la MISMA imagen: se varía con el motivo del descarte
    const fluxRef = `flux:${videoId}:${beat.idx}`;
    const fluxVetoed = vetoedRefs.has(fluxRef);
    const basePrompt = deps.styleSuffix
      ? `${beat.visualQuery}, ${deps.styleSuffix}`
      : beat.visualQuery;
    const prompt =
      fluxVetoed && beat.discardReason
        ? `${basePrompt}. Variación distinta; evita: ${beat.discardReason}`
        : basePrompt;
    const flux = await generateFluxImage(db, logger, {
      videoId,
      channelId,
      beatIdx: beat.idx,
      prompt,
      ...(fluxVetoed ? { seedSalt: beat.discardReason ?? 'descartado' } : {}),
    });
    // el PNG vive bajo la biblioteca (no en tmp) para que la timeline pueda
    // mostrarlo vía /files y la ingesta lo reutilice tal cual se aprobó
    const fluxDir = path.join(deps.ctx.libraryDir, 'assets', channelId, 'flux');
    await fs.mkdir(fluxDir, { recursive: true });
    const fluxName = `${videoId}-${beat.idx}.png`;
    const fluxPath = path.join(fluxDir, fluxName);
    await fs.copyFile(flux.path, fluxPath);
    chosen = {
      cand: {
        ref: fluxRef,
        provider: 'flux',
        score: 0,
        thumb_url: `/files/library/assets/${channelId}/flux/${fluxName}`,
        meta: {
          path: fluxPath,
          width: 1280,
          height: 720,
          kind: 'image',
          seed: flux.seed,
          prompt,
        },
      },
      kind: 'image',
      durationMs: null,
      cos: 0,
      composite: 0,
      altRefs: [],
      vec: [],
    };
    chosenFit = { mode: 'kenburns' };
    status = 'review';
    candidates = [chosen.cand];
  } else if (chosen.cos >= T_AUTO) {
    status = 'auto_ok';
    candidates = [chosen.cand, ...rest.slice(0, ALTERNATES).map((e) => e.cand)];
  } else {
    status = 'review';
    candidates = [chosen.cand, ...rest.slice(0, ALTERNATES).map((e) => e.cand)];
  }

  // convención compartida con la API: el elegido va PRIMERO en candidates.
  // La escritura respeta el candado humano: si el beat pasó a locked mientras
  // el matching trabajaba, la elección de la máquina se descarta.
  const updated = await ctx.db
    .update(beatsTable)
    .set({
      status,
      candidates,
      fit: chosenFit,
      // similitud pura, coherente con la barra de la UI y los umbrales
      chosenScore: chosen.cos,
      chosenOrigin: originLabel(chosen.cand),
      assetId: chosen.cand.provider === 'library' ? (libAssetByRef.get(chosen.cand.ref) ?? null) : null,
      discardReason: null,
    })
    .where(and(eq(beatsTable.id, beat.id), ne(beatsTable.status, 'locked')))
    .returning({ id: beatsTable.id });
  if (updated.length === 0) {
    logger.info(
      { videoId, beatIdx: beat.idx },
      'Matching descartado: el humano bloqueó el beat durante el proceso',
    );
    return;
  }
  for (const ref of identityRefs(chosen)) deps.usedRefs.add(ref);
  // memoria para el beat siguiente: evita repetir el mismo plano en contiguos
  deps.prevVec = chosen.vec.length > 0 ? chosen.vec : null;
}

function stockToEntry(
  finalist: StockResult,
  cos: number,
  composite: number,
  altRefs: string[],
  vec: number[],
): PoolEntry {
  return {
    cand: {
      ref: finalist.ref,
      provider: finalist.provider,
      score: cos,
      thumb_url: finalist.thumb_url,
      meta: { ...finalist.meta },
    },
    kind: finalist.meta.kind,
    durationMs: finalist.meta.kind === 'clip' ? finalist.meta.duration_ms : null,
    cos,
    composite,
    altRefs,
    vec,
  };
}

async function runMatch(ctx: WorkerContext, job: Job<AssetsMatchJob>): Promise<void> {
  const { videoId, beatIdxs } = job.data;
  const { db, logger } = ctx;
  const fullRun = !beatIdxs || beatIdxs.length === 0;

  const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);
  // fullRun también se acepta en 'assets' (reintento desde incidencia): se
  // rehacen los beats sin bloquear y no se repite la transición
  if (video.state !== 'audio' && video.state !== 'assets') {
    logger.info({ videoId, state: video.state }, 'Estado no válido para matching; se omite');
    return;
  }

  const [channel] = await db.select().from(channels).where(eq(channels.id, video.channelId));
  const styleSuffix = channel?.profile?.style.visual_prompt_suffix ?? '';
  const antiN = channel?.settings?.anti_repeat_n ?? ANTI_REPEAT_N;
  const recentIds = await recentAssetIds(db, video.channelId, videoId, antiN);

  const allRows = await db
    .select()
    .from(beatsTable)
    .where(eq(beatsTable.videoId, videoId))
    .orderBy(asc(beatsTable.idx));
  const targetIdxs = new Set(beatIdxs ?? []);
  const beatRows = fullRun ? allRows : allRows.filter((b) => targetIdxs.has(b.idx));
  if (beatRows.length === 0) throw new Error('El vídeo no tiene beats que matchear');

  // Director de b-roll: en un run completo, una consulta visual concreta por
  // beat (pegada a su narración y distinta de la de sus vecinos) que sustituye
  // a la de escena repetida. En re-match parcial se conserva la ya diversificada
  // del beat. Los beats bloqueados por el humano no se tocan.
  if (fullRun) {
    const toDirect = beatRows.filter((b) => b.status !== 'locked');
    if (toDirect.length > 0) {
      const queries = await directBroll(ctx, {
        videoId,
        channelId: video.channelId,
        lang: channel?.profile?.style.stock_query_lang ?? 'en',
        styleSuffix,
        beats: toDirect.map((b) => ({ idx: b.idx, text: b.text, sceneQuery: b.visualQuery })),
      });
      for (const b of toDirect) {
        const q = queries.get(b.idx);
        if (q && q !== b.visualQuery) {
          b.visualQuery = q; // la fila en memoria alimenta matchBeat
          await db.update(beatsTable).set({ visualQuery: q }).where(eq(beatsTable.id, b.id));
        }
      }
    }
  }

  // anti-repetición intra-vídeo: cuentan como usados los elegidos de los
  // beats que NO se van a re-matchear (bloqueados siempre; y en un re-match
  // parcial, también el resto). En un run completo no se siembra con los
  // elegidos previos: rompería la idempotencia de la re-ejecución.
  const usedRefs = new Set<string>();
  for (const row of allRows) {
    const willRematch = row.status !== 'locked' && (fullRun || targetIdxs.has(row.idx));
    if (willRematch) continue;
    if (row.assetId) usedRefs.add(`library:${row.assetId}`);
    const chosenRef = row.candidates?.[0]?.ref;
    if (chosenRef) usedRefs.add(chosenRef);
  }

  const deps: MatchDeps = {
    ctx,
    videoId,
    channelId: video.channelId,
    styleSuffix,
    recentIds,
    usedRefs,
    prevVec: null,
  };
  for (let i = 0; i < beatRows.length; i++) {
    const beat = beatRows[i];
    if (!beat) continue;
    // lo que el humano ya bloqueó no se rehace
    if (beat.status === 'locked') continue;
    await matchBeat(deps, beat);
    await ctx.publishEvent({
      type: 'job_progress',
      video_id: videoId,
      queue: QUEUES.assets,
      progress: Math.round(((i + 1) / beatRows.length) * 100),
      detail: `Beat ${beat.idx + 1} de ${beatRows.length} con candidatos`,
    });
  }

  if (fullRun && video.state === 'audio') {
    await transitionVideo(db, videoId, 'assets', { expectFrom: 'audio' });
    await ctx.publishEvent({ type: 'video_state', video_id: videoId, state: 'assets' });
    await ctx.publishEvent({ type: 'inbox_changed' });
  }
  logger.info({ videoId, beats: beatRows.length, fullRun }, 'Matching de assets completado');
}

interface ProbedMedia {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
}

async function probeMedia(filePath: string): Promise<ProbedMedia> {
  const { stdout } = await execa('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=width,height,codec_name:format=duration',
    '-of',
    'json',
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number; codec_name?: string }[];
    format?: { duration?: string };
  };
  const stream = parsed.streams?.find((s) => s.width) ?? parsed.streams?.[0];
  const seconds = Number.parseFloat(parsed.format?.duration ?? '');
  return {
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
    width: stream?.width ?? null,
    height: stream?.height ?? null,
    codec: stream?.codec_name ?? null,
  };
}

function extFromUrl(url: string, kind: 'clip' | 'image'): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).replace('.', '').toLowerCase();
    if (ext && ext.length <= 4) return ext;
  } catch {
    // URL ilegible: extensión por defecto según el tipo
  }
  return kind === 'clip' ? 'mp4' : 'jpg';
}

function buildTags(query: string, caption: string): string[] {
  const tokens = `${query} ${caption}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
  return [...new Set(tokens)].slice(0, 12);
}

interface IngestedAsset {
  assetId: string;
  absPath: string;
  kind: 'clip' | 'image';
  durationMs: number | null;
}

async function ingestChosen(
  ctx: WorkerContext,
  video: { id: string; channelId: string },
  beat: BeatRow,
): Promise<IngestedAsset> {
  const { db, logger } = ctx;
  const chosen = beat.candidates?.[0];

  // biblioteca: contabilizar uso, sin descarga
  if (beat.assetId || chosen?.provider === 'library') {
    const assetId = beat.assetId ?? chosen?.ref.replace('library:', '');
    if (!assetId) throw new Error(`El beat ${beat.idx} no tiene asset de biblioteca resoluble`);
    const [row] = await db.select().from(assetsTable).where(eq(assetsTable.id, assetId));
    if (!row) throw new Error(`Asset de biblioteca no encontrado: ${assetId}`);
    if (row.lastVideoId !== video.id) {
      await db
        .update(assetsTable)
        .set({ timesUsed: sql`${assetsTable.timesUsed} + 1`, lastVideoId: video.id })
        .where(eq(assetsTable.id, assetId));
    }
    return {
      assetId,
      absPath: path.isAbsolute(row.path) ? row.path : path.join(ctx.libraryDir, row.path),
      kind: toBeatKind(row.kind),
      durationMs: row.durationMs,
    };
  }

  if (!chosen) throw new Error(`El beat ${beat.idx} no tiene candidato elegido`);
  const meta = (chosen.meta ?? {}) as Record<string, unknown>;
  const kind = (meta.kind as 'clip' | 'image' | undefined) ?? (chosen.provider === 'flux' ? 'image' : 'clip');

  // idempotencia: si el mismo source_ref ya está en biblioteca, reutilizarlo
  const [existing] = await db
    .select()
    .from(assetsTable)
    .where(and(eq(assetsTable.sourceRef, chosen.ref), eq(assetsTable.channelId, video.channelId)));
  if (existing) {
    if (existing.lastVideoId !== video.id) {
      await db
        .update(assetsTable)
        .set({ timesUsed: sql`${assetsTable.timesUsed} + 1`, lastVideoId: video.id })
        .where(eq(assetsTable.id, existing.id));
    }
    return {
      assetId: existing.id,
      absPath: path.isAbsolute(existing.path) ? existing.path : path.join(ctx.libraryDir, existing.path),
      kind: toBeatKind(existing.kind),
      durationMs: existing.durationMs,
    };
  }

  // obtener el archivo: descarga de stock o PNG de Flux (regenerable por semilla)
  const destDir = path.join(ctx.libraryDir, 'assets', video.channelId, kind);
  await fs.mkdir(destDir, { recursive: true });
  let destPath: string;
  let license: string;
  let source: string;

  if (chosen.provider === 'flux') {
    source = 'flux';
    license = 'CC0 Flux';
    let srcPath = meta.path as string | undefined;
    const exists = srcPath ? await fs.access(srcPath).then(() => true, () => false) : false;
    if (!srcPath || !exists) {
      // regeneración de emergencia con el MISMO prompt de la imagen aprobada
      // (la semilla ya es determinista); solo pasa si el PNG desapareció
      const regenerated = await generateFluxImage(db, logger, {
        videoId: video.id,
        channelId: video.channelId,
        beatIdx: beat.idx,
        prompt: (meta.prompt as string | undefined) ?? beat.visualQuery,
        // misma semilla que la imagen aprobada, aunque llevara sal de descarte
        ...(typeof meta.seed === 'number' ? { seed: meta.seed } : {}),
      });
      srcPath = regenerated.path;
    }
    destPath = path.join(destDir, `${nanoid()}.png`);
    await fs.copyFile(srcPath, destPath);
  } else {
    source = chosen.provider;
    license = chosen.provider === 'pexels' ? 'Pexels' : 'Pixabay';
    const downloadUrl = meta.download_url as string | undefined;
    if (!downloadUrl) throw new Error(`El candidato ${chosen.ref} no tiene download_url`);
    destPath = path.join(destDir, `${nanoid()}.${extFromUrl(downloadUrl, kind)}`);
    await downloadWithCap(downloadUrl, destPath, chosen.ref);
  }

  try {
    const probed = await probeMedia(destPath);
    return await insertIngestedAsset(ctx, video, beat, chosen, {
      kind,
      destPath,
      source,
      license,
      probed,
      meta,
    });
  } catch (err) {
    // sin archivo huérfano en la biblioteca si el probe o el insert fallan
    await fs.unlink(destPath).catch(() => {});
    throw err;
  }
}

const MAX_DOWNLOAD_BYTES =
  Number(process.env.STOCK_MAX_DOWNLOAD_MB ?? '200') * 1024 * 1024;

async function downloadWithCap(url: string, destPath: string, ref: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok || !res.body) throw new Error(`Descarga fallida (${ref}): HTTP ${res.status}`);
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Descarga rechazada (${ref}): ${declared} bytes supera el límite`);
  }
  const reader = res.body.getReader();
  const handle = await fs.open(destPath, 'w');
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) {
        throw new Error(`Descarga abortada (${ref}): supera el límite de tamaño`);
      }
      await handle.write(value);
    }
  } catch (err) {
    await handle.close();
    await fs.unlink(destPath).catch(() => {});
    throw err;
  }
  await handle.close();
}

interface IngestFileInfo {
  kind: 'clip' | 'image';
  destPath: string;
  source: string;
  license: string;
  probed: ProbedMedia;
  meta: Record<string, unknown>;
}

async function insertIngestedAsset(
  ctx: WorkerContext,
  video: { id: string; channelId: string },
  beat: BeatRow,
  chosen: BeatCandidate,
  info: IngestFileInfo,
): Promise<IngestedAsset> {
  const { db, logger } = ctx;
  const { kind, destPath, source, license, probed, meta } = info;
  const caption =
    (meta.caption as string | undefined) ??
    (chosen.provider === 'flux' ? `Imagen generada para: ${beat.visualQuery}` : String(meta.title ?? ''));
  const tags = buildTags(beat.visualQuery, caption);
  // texto canónico compartido con backfill y reembed (lib/embed-text.ts)
  const [embedding] = await ctx.embeddings.embed([
    buildAssetEmbedText(caption, beat.visualQuery, tags),
  ]);

  const assetId = nanoid();
  await db.insert(assetsTable).values({
    id: assetId,
    scope: 'channel',
    channelId: video.channelId,
    kind,
    path: destPath,
    source,
    sourceRef: chosen.ref,
    license,
    durationMs: kind === 'clip' ? probed.durationMs : null,
    width: probed.width,
    height: probed.height,
    tags,
    caption: caption || null,
    originQuery: beat.visualQuery,
    embedding: embedding ?? null,
    timesUsed: 1,
    lastVideoId: video.id,
  });
  logger.info({ videoId: video.id, beatIdx: beat.idx, assetId, source, codec: probed.codec }, 'Asset ingerido en biblioteca');

  return {
    assetId,
    absPath: destPath,
    kind,
    durationMs: kind === 'clip' ? probed.durationMs : null,
  };
}

async function runIngest(ctx: WorkerContext, job: Job<AssetsIngestJob>): Promise<void> {
  const { videoId } = job.data;
  const { db, logger } = ctx;

  const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);
  if (video.state !== 'timeline_ok') {
    logger.info({ videoId, state: video.state }, 'El vídeo no está en timeline_ok; se omite la ingesta');
    return;
  }

  const beatRows = await db
    .select()
    .from(beatsTable)
    .where(eq(beatsTable.videoId, videoId))
    .orderBy(asc(beatsTable.idx));
  if (beatRows.length === 0) throw new Error('El vídeo no tiene beats que ingerir');

  const frozenBeats: Beat[] = [];
  for (let i = 0; i < beatRows.length; i++) {
    const beat = beatRows[i];
    if (!beat) continue;

    const ingested = await ingestChosen(ctx, { id: videoId, channelId: video.channelId }, beat);

    // el fit se recalcula SIEMPRE con la duración real del archivo
    const seed = mockHash(videoId + beat.idx);
    const fitResult = computeFit(
      { kind: ingested.kind, assetDurationMs: ingested.durationMs, beatDurationMs: beat.toMs - beat.fromMs },
      { clampLoops: true },
    );
    const fit: Fit = fitResult?.fit ?? { mode: 'kenburns' };
    const effect = fit.mode === 'kenburns' ? kenburnsEffect(seed) : undefined;

    await db
      .update(beatsTable)
      .set({ status: 'locked', assetId: ingested.assetId, fit, candidates: null })
      .where(eq(beatsTable.id, beat.id));

    frozenBeats.push({
      idx: beat.idx,
      from_ms: beat.fromMs,
      to_ms: beat.toMs,
      text: beat.text,
      visual_query: beat.visualQuery,
      status: 'locked',
      asset: {
        id: ingested.assetId,
        path: ingested.absPath,
        kind: ingested.kind,
        fit,
        ...(effect ? { effect } : {}),
      },
    });

    await ctx.publishEvent({
      type: 'job_progress',
      video_id: videoId,
      queue: QUEUES.assets,
      progress: Math.round(((i + 1) / beatRows.length) * 90),
      detail: `Asset del beat ${beat.idx + 1} de ${beatRows.length} descargado`,
    });
  }

  // congelar master.beats: status locked, asset resuelto, sin candidates
  const newMaster = masterVideoJsonV1.parse({ ...video.master, beats: frozenBeats });
  await db
    .update(videos)
    .set({ master: newMaster, updatedAt: new Date() })
    .where(eq(videos.id, videoId));

  // jobId determinista: una re-ejecución de la ingesta no duplica el render
  await ctx.queues.render.add(JOBS.render.video, { videoId } satisfies RenderVideoJob, {
    jobId: `render-${videoId}`,
  });
  await ctx.publishEvent({
    type: 'job_progress',
    video_id: videoId,
    queue: QUEUES.assets,
    progress: 100,
    detail: 'Assets ingeridos; render encolado',
  });
  logger.info({ videoId, beats: frozenBeats.length }, 'Ingesta completada y render encolado');
}

export async function registerAssetsWorkers(ctx: WorkerContext): Promise<Worker[]> {
  registerAssetsMocks();
  const worker = new Worker<AssetsMatchJob | AssetsIngestJob>(
    QUEUES.assets,
    async (job) => {
      try {
        if (job.name === JOBS.assets.match) {
          await runMatch(ctx, job as Job<AssetsMatchJob>);
        } else if (job.name === JOBS.assets.ingest) {
          await runIngest(ctx, job as Job<AssetsIngestJob>);
        } else {
          ctx.logger.warn({ job: job.name }, 'Job desconocido en la cola assets');
        }
      } catch (err) {
        const attempts = job.opts.attempts ?? 1;
        const isFinal = job.attemptsMade + 1 >= attempts;
        const message = err instanceof Error ? err.message : String(err);
        const label = job.name === JOBS.assets.ingest ? 'La ingesta de assets' : 'El matching de assets';
        ctx.logger.error({ err, videoId: job.data.videoId, isFinal }, 'Fallo en la cola assets');
        if (isFinal) {
          try {
            await markIncident(ctx.db, job.data.videoId, {
              message: `${label} falló: ${message}`,
              suggested_action: 'reintentar',
              queue: QUEUES.assets,
            });
            await ctx.publishEvent({
              type: 'incident',
              video_id: job.data.videoId,
              queue: QUEUES.assets,
              message: `${label} falló: ${message}`,
              suggested_action: 'reintentar',
            });
          } catch (incidentErr) {
            ctx.logger.error({ err: incidentErr }, 'No se pudo registrar la incidencia de assets');
          }
        }
        throw err;
      }
    },
    { connection: ctx.connection, concurrency: 1 },
  );

  return [worker];
}
