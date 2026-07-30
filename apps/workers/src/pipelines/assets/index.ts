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
  IMAGE_HANDICAP,
  IMAGE_MAX_S,
  JOBS,
  MAX_VISUALS_PER_BEAT,
  PRICES,
  QUEUES,
  RATIO_IMAGENES_MAX,
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
  type StoredSubvisual,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { buildAssetEmbedText } from '../../lib/embed-text.js';
import { closeCost, failCost, openCost } from '../../lib/ledger.js';
import { cosineSimilarity } from '../../providers/embeddings.js';
import { mockHash } from '../../providers/llm.js';
import {
  cacheCaption,
  captionsByRef,
  searchStock,
  type StockResult,
} from '../../providers/stock.js';
import { directBroll } from './broll-director.js';
import { directChapters } from './chapter-director.js';
import { directEdits } from './editing-director.js';
import { pickFinalists, repartirPlazas } from './finalists.js';
import { computeFit, kenburnsEffect } from './fit.js';
import { cosEfectivo, identityRefs, selectPick, type PoolEntry } from './pick.js';
import { registerAssetsMocks } from './mocks.js';
import { expandQuery, stockScore } from './score.js';
import { computeSubvisualSpans, wordsInSpan } from './subvisuals.js';
import { extractCaptionJpeg } from '../library/media.js';

// Worker de assets (docs/assets-y-biblioteca.md): cascada biblioteca →
// stock por beat (match) y descarga + ingesta a biblioteca al aprobar la
// timeline (ingest). No hay tier de generación de imagen: el cuerpo del vídeo
// no lleva imágenes hechas por IA.

const LIB_CANDIDATES = 6;
// Cuántos resultados de stock entran a puntuar. Bajarlo estrecha la elección;
// lo que de verdad ahorra es CAPTION_TOP_K, que no la estrecha.
const STOCK_FINALISTS = 6;
// Cuántos de esos finalistas se describen con el modelo de visión. El resto se
// puntúa con el título del proveedor: siguen compitiendo, solo que con un texto
// peor. Es donde estaba el 77 % del coste de un vídeo.
const CAPTION_TOP_K = 4;

/**
 * Los `k` candidatos que más se parecen a la query según su TÍTULO, para
 * decidir a cuáles vale la pena pagarles una descripción de visión.
 *
 * Los embeddings son locales y no cuestan, así que esta criba es gratis. Un
 * candidato sin título puntúa 0: si aun así entra, es porque no había mejores.
 * Determinista: los empates se rompen por el orden de llegada.
 */
export function topByTitleCosine<T extends { meta: { title?: unknown } }>(
  items: readonly T[],
  vectors: readonly (number[] | undefined)[],
  qVec: number[],
  k: number,
): T[] {
  return items
    .map((item, i) => {
      const v = vectors[i];
      const titulo = String(item.meta.title ?? '');
      return { item, i, cos: v && titulo !== '' ? cosineSimilarity(qVec, v) : 0 };
    })
    .sort((a, b) => b.cos - a.cos || a.i - b.i)
    .slice(0, k)
    .map((x) => x.item);
}
// De las CAPTION_TOP_K descripciones, cuántas se reservan a imágenes fijas. El
// resto va a clips, y si no hay imágenes que describir los clips se las quedan.
const CAPTION_IMAGENES = 1;

/**
 * A qué finalistas se les paga una descripción de visión, repartiendo el
 * presupuesto entre clips e imágenes para que el desequilibrio de los títulos
 * de los proveedores no decida por sí solo quién compite con texto bueno.
 */
async function presupuestarCaptions(
  sinDescribir: readonly StockResult[],
  qVec: number[],
  embed: (textos: string[]) => Promise<(number[] | undefined)[]>,
): Promise<StockResult[]> {
  if (sinDescribir.length <= CAPTION_TOP_K) return [...sinDescribir];
  const vectores = await embed(sinDescribir.map((f) => String(f.meta.title ?? '')));
  const conVec = sinDescribir.map((f, i) => ({ f, v: vectores[i] }));
  const clips = conVec.filter((x) => x.f.meta.kind === 'clip');
  const imagenes = conVec.filter((x) => x.f.meta.kind !== 'clip');
  const plazas = repartirPlazas(
    clips.length,
    imagenes.length,
    CAPTION_TOP_K,
    Math.min(CAPTION_IMAGENES, CAPTION_TOP_K),
  );
  const top = (xs: typeof conVec, k: number): StockResult[] =>
    topByTitleCosine(
      xs.map((x) => x.f),
      xs.map((x) => x.v),
      qVec,
      k,
    );
  return [...top(clips, plazas.clips), ...top(imagenes, plazas.imagenes)];
}

const ALTERNATES = 4;
// coseno de contenido por encima del cual dos clips se consideran "el mismo
// plano" y no deben caer en beats contiguos aunque sean refs distintos
const ADJACENT_DEDUPE_COS = 0.9;

type BeatRow = typeof beatsTable.$inferSelect;

function toBeatKind(assetKind: string): 'clip' | 'image' {
  return assetKind === 'clip' ? 'clip' : 'image';
}

function originLabel(cand: BeatCandidate): string {
  if (cand.provider === 'library') {
    const title = (cand.meta?.title as string | undefined) ?? '';
    return `Biblioteca · ${title || cand.ref.replace('library:', '')}`;
  }
  // legado: ya no se generan imágenes, pero hay beats y maestros antiguos que
  // guardan candidatos con este proveedor y hay que saber etiquetarlos
  if (cand.provider === 'flux') return 'Generado · Flux';
  const id = cand.ref.split(':')[2] ?? cand.ref;
  const isPhoto = cand.ref.includes(':photo:');
  const label = cand.provider === 'pexels' ? 'Pexels' : 'Pixabay';
  return `${label} · ${isPhoto ? 'imagen' : 'clip'} ${id}`;
}

async function recentAssetIds(
  db: Db,
  channelId: string,
  videoId: string,
  n: number,
): Promise<Set<string>> {
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
  // cuántas de las STOCK_FINALISTS plazas pueden ir a imágenes fijas, y cuánto
  // tiene que ganar una imagen para llevarse el plano. Los dos salen del mismo
  // ajuste del canal (`broll_imagenes_max_pct`) y se congelan en el maestro.
  imagenesPorPool: number;
  imagenHandicap: number;
}

/**
 * Traduce el techo de imágenes del canal a las dos palancas de la cascada.
 *
 * La plaza de reserva es innegociable incluso con el techo a cero, y ahora más
 * que antes: sin generación de imagen al final de la cascada, un tramo cuyos
 * clips no encajan se queda SIN RED. Antes esto se justificaba en no comprar un
 * Flux; ahora se justifica en que el beat necesita un plano sí o sí. No la
 * quites: el techo a cero es una preferencia fuerte, nunca una prohibición.
 */
export function palancasImagen(pct: number): { imagenesPorPool: number; imagenHandicap: number } {
  return {
    imagenesPorPool: Math.max(1, Math.round(STOCK_FINALISTS * pct)),
    // techo 0 = «quiero todo vídeo»: preferencia fuerte, nunca prohibición
    imagenHandicap: pct === 0 ? 0.05 : IMAGE_HANDICAP,
  };
}

interface ResolvedVisual {
  chosen: PoolEntry;
  fit: Fit;
  status: 'auto_ok' | 'review';
  candidates: BeatCandidate[];
  libAssetId: string | null;
}

// Resuelve UNA consulta (un sub-plano) por la cascada biblioteca→stock y
// devuelve el elegido con su fit/estado. Muta usedRefs/prevVec (anti-repetición
// intra-vídeo y anti-parecido contiguo, ahora entre sub-planos). No escribe BD.
async function resolveOneVisual(
  deps: MatchDeps,
  args: {
    beatIdx: number;
    vIdx: number;
    query: string;
    spanMs: number;
    vetoedRefs: Set<string>;
    // el tramo pide movimiento sí o sí (partes 2ª..n de una imagen troceada):
    // deja a las imágenes de stock sin plaza reservada
    exigeClip?: boolean;
  },
): Promise<ResolvedVisual> {
  const { ctx, videoId, channelId } = deps;
  const { db, logger } = ctx;
  const beatMs = args.spanMs;
  const queryText = args.query;
  const vetoedRefs = args.vetoedRefs;
  const [qVec] = await ctx.embeddings.embed([queryText]);
  if (!qVec) throw new Error('No se pudo calcular el embedding de la query');

  // 1) biblioteca (canal + shared, anti-repeat)
  const lib = await libraryCandidates(db, channelId, qVec, deps.recentIds);
  const pool: PoolEntry[] = lib.map((l) => l.entry).filter((e) => !vetoedRefs.has(e.cand.ref));
  // Los vetados se apartan, no se tiran: son la red del último recurso. El veto
  // a nivel de pool existe para que la cascada SIGA buscando en vez de
  // conformarse con un repetido, pero si al final no aparece nada, un plano
  // repetido es infinitamente mejor que un beat sin plano — y sin generación de
  // imagen detrás, esta es la única red que queda.
  const reserva: PoolEntry[] = lib.map((l) => l.entry).filter((e) => vetoedRefs.has(e.cand.ref));
  const libAssetByRef = new Map(lib.map((l) => [l.entry.cand.ref, l.assetId]));
  // Solo un CLIP de biblioteca puede ahorrarse la búsqueda de stock. Antes esto
  // miraba el mejor de cualquier tipo, así que una imagen de biblioteca a 0,88
  // apagaba la búsqueda entera y el plano salía fijo por decreto — y como la
  // biblioteca se alimenta de lo que produce, era un lazo que se realimentaba:
  // cada vídeo con muchas imágenes hacía más probable el siguiente.
  const bestLibClip = pool.find((e) => e.kind === 'clip')?.cos ?? 0;

  // 2) stock solo si la biblioteca no llega al umbral
  if (bestLibClip < T_STOCK) {
    const stockResults = await searchStock(db, logger, queryText, { videoId, channelId });
    const finalists = pickFinalists(stockResults, {
      total: STOCK_FINALISTS,
      imagenesMax: args.exigeClip === true ? 0 : deps.imagenesPorPool,
      spanMs: beatMs,
      vetoedRefs,
    });
    // Reserva de stock: los que el veto dejó fuera, puntuados solo con su
    // TÍTULO. No se les paga descripción de visión porque son repeticiones y
    // solo entran si no queda absolutamente nada más; el embedding es local y
    // no cuesta. Sin esto, un tramo cuyos seis finalistas estén todos usados
    // se quedaría sin plano, que es justo lo que Flux tapaba antes.
    const vetadosStock = stockResults.filter((r) => vetoedRefs.has(r.ref));
    if (vetadosStock.length > 0) {
      const vecs = await ctx.embeddings.embed(
        vetadosStock.map((r) => String(r.meta.caption ?? r.meta.title ?? '')),
      );
      vetadosStock.forEach((r, i) => {
        const vec = vecs[i];
        reserva.push(stockToEntry(r, vec ? cosineSimilarity(qVec, vec) : 0, 0, [], vec ?? []));
      });
    }

    if (finalists.length > 0) {
      // Descripciones ya pagadas de estas imágenes, vengan de la búsqueda que
      // vengan: la caché es por imagen, no por consulta.
      const yaDescritas = await captionsByRef(
        db,
        finalists.map((f) => f.ref),
      );
      for (const f of finalists) {
        const previa = yaDescritas.get(f.ref);
        if (previa !== undefined && !f.meta.caption) f.meta.caption = previa;
      }

      // Preselección GRATIS: se puntúa con el título del proveedor (los
      // embeddings son locales y no cuestan) y solo se describe a los que
      // pueden ganar. Describir el octavo finalista es pagar por un candidato
      // que ya iba último con su propio texto.
      //
      // El presupuesto se reparte POR TIPO, y no es un detalle: los dos textos
      // de partida no son comparables. El título de una foto de Pexels es el
      // `alt` que escribió una persona (13,7 palabras de media, medido); el de
      // un clip es el slug de la URL (2,0 palabras). Repartir por cosénica de
      // título con esa desigualdad le regala las descripciones caras a las
      // fotos, y con ellas el coseno: circular, y exactamente el mecanismo que
      // ya movió el ratio del 83 % al 42 % cuando se arregló el título del clip.
      const sinDescribir = finalists.filter((f) => !f.meta.caption && f.thumb_url);
      const toCaption = await presupuestarCaptions(sinDescribir, qVec, (textos) =>
        ctx.embeddings.embed(textos),
      );

      const handle = await openCost(db, {
        videoId,
        channelId,
        provider: ctx.llm.ledgerProvider,
        operation: 'vlm_caption',
        meta: {
          query: queryText,
          finalists: toCaption.length,
          reusados: finalists.length - sinDescribir.length,
          descartados_por_preseleccion: sinDescribir.length - toCaption.length,
        },
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
  const cosOrden = (e: PoolEntry): number => cosEfectivo(e, deps.imagenHandicap);
  const encajar = (entries: PoolEntry[]): { entry: PoolEntry; fit: Fit }[] => {
    const out: { entry: PoolEntry; fit: Fit }[] = [];
    for (const entry of [...entries].sort(
      (a, b) => cosOrden(b) - cosOrden(a) || b.composite - a.composite,
    )) {
      const fit = computeFit({
        kind: entry.kind,
        assetDurationMs: entry.durationMs,
        beatDurationMs: beatMs,
      });
      if (!fit) {
        logger.info(
          { videoId, beatIdx: args.beatIdx, ref: entry.cand.ref },
          'Candidato descartado: no cubre el beat ni con el máximo de loops',
        );
        continue;
      }
      out.push({ entry, fit: fit.fit });
    }
    return out;
  };
  let fitted = encajar(pool);
  // 4) Último recurso: NO se genera una imagen con IA. Antes, cuando ningún
  // candidato llegaba a T_REV, el beat se resolvía con una imagen de Flux; ese
  // camino se retiró por decisión de producto (nada de imágenes generadas en el
  // cuerpo del vídeo) y porque nunca llegó a producir un plano publicado: cero
  // filas en beats.candidates, en chosen_origin, en los maestros y en assets, y
  // las únicas tres llamadas a fal.ai del ledger están en `failed` con coste 0.
  //
  // La política nueva es proponer siempre algo y marcarlo ámbar: un plano flojo
  // con su coseno y su origen a la vista es una PROPUESTA que el humano puede
  // cambiar en la curación; un hueco es una tarea que no puede resolver desde
  // la timeline. Es el principio 2 del proyecto (el humano selecciona y aprueba).
  if (fitted.length === 0 && reserva.length > 0) {
    // Todo lo que había estaba vetado por repetido. Pasa en los beats finales
    // de un vídeo, que arrastran muchos refs usados, y sobre todo si la
    // consulta devuelve poco. Antes Flux rescataba este caso; ahora la red es
    // repetir un plano del propio vídeo, que es peor que no repetirlo pero
    // muchísimo mejor que quedarse sin plano.
    fitted = encajar(reserva);
    logger.warn(
      { videoId, beatIdx: args.beatIdx, vIdx: args.vIdx, query: queryText },
      'Sin candidatos nuevos: se reutiliza un plano ya usado en este vídeo',
    );
  }
  const pick = selectPick(fitted, deps.usedRefs, deps.prevVec, deps.imagenHandicap);
  if (!pick) {
    // Pool vacío de verdad: ni biblioteca ni stock. Fallar aquí, con un mensaje
    // accionable, es mejor que escribir un beat sin asset y reventar tres pasos
    // más tarde en la ingesta o en el render. El worker lo convierte en
    // incidencia y el vídeo se puede reintentar.
    throw new Error(
      `El beat ${args.beatIdx} (plano ${args.vIdx}) se quedó sin ningún candidato para «${queryText}»: ` +
        'la biblioteca no tiene nada y la búsqueda de stock no devolvió resultados. ' +
        'Comprueba PEXELS_API_KEY y PIXABAY_API_KEY.',
    );
  }
  const chosen: PoolEntry = pick.entry;
  const chosenFit: Fit = pick.fit;
  const rest: PoolEntry[] = fitted.filter((f) => f !== pick).map((f) => f.entry);

  // Ámbar salvo que la máquina vaya sobrada. Un candidato por debajo de T_REV
  // llega aquí igual y se propone marcado para revisión.
  const status: 'auto_ok' | 'review' = chosen.cos >= T_AUTO ? 'auto_ok' : 'review';
  const candidates: BeatCandidate[] = [
    chosen.cand,
    ...rest.slice(0, ALTERNATES).map((e) => e.cand),
  ];

  for (const ref of identityRefs(chosen)) deps.usedRefs.add(ref);
  // memoria para el sub-plano siguiente: evita repetir el mismo plano seguido
  deps.prevVec = chosen.vec.length > 0 ? chosen.vec : null;

  return {
    chosen,
    fit: chosenFit,
    status,
    candidates,
    libAssetId:
      chosen.cand.provider === 'library' ? (libAssetByRef.get(chosen.cand.ref) ?? null) : null,
  };
}

// Matchea un beat: resuelve sus sub-planos (1..N), aplica el tope de imágenes
// (una imagen fija no supera IMAGE_MAX_S; los clips llenan su tramo) y persiste.
// El plano principal (visuals[0]) también rellena assetId/fit/candidates para
// que la timeline (curación a nivel de beat) siga funcionando igual.
async function matchBeat(deps: MatchDeps, beat: BeatRow): Promise<void> {
  const { ctx, videoId } = deps;
  const { db, logger } = ctx;

  // tramos de sub-plano: de beat.visuals (director) o uno solo (todo el beat)
  const spans =
    beat.visuals && beat.visuals.length > 0
      ? beat.visuals.map((v) => ({
          from_ms: v.from_ms,
          to_ms: v.to_ms,
          visual_query: v.visual_query,
          ...(v.keyword ? { keyword: v.keyword } : {}),
        }))
      : [
          {
            from_ms: beat.fromMs,
            to_ms: beat.toMs,
            visual_query: expandQuery(beat.visualQuery, beat.text),
          },
        ];

  // veto de descarte: solo aplica al plano principal (el que el humano descartó)
  const vetoedRefs = new Set<string>(
    beat.discardReason && beat.candidates?.length ? [beat.candidates[0]!.ref] : [],
  );

  const resolved: { span: (typeof spans)[number]; res: ResolvedVisual }[] = [];
  for (let vIdx = 0; vIdx < spans.length; vIdx++) {
    const span = spans[vIdx]!;
    const res = await resolveOneVisual(deps, {
      beatIdx: beat.idx,
      vIdx,
      query: span.visual_query,
      spanMs: span.to_ms - span.from_ms,
      // Los planos ya usados en este vídeo se vetan al ARMAR el pool, no solo
      // al elegir: así el candidato repetido ni siquiera compite y la cascada
      // sigue buscando en el stock en vez de conformarse con el repetido.
      vetoedRefs: new Set([...deps.usedRefs, ...(vIdx === 0 ? vetoedRefs : [])]),
    });
    resolved.push({ span, res });
  }

  // tope de imágenes: una imagen fija cuyo tramo supere IMAGE_MAX_S se parte en
  // varias imágenes distintas de ≤IMAGE_MAX_S (sin pasar de MAX_VISUALS_PER_BEAT).
  // Los clips (dinámicos) quedan exentos y llenan su tramo.
  const imageMaxMs = IMAGE_MAX_S * 1000;
  const capped: { span: (typeof spans)[number]; res: ResolvedVisual }[] = [];
  // Contador MONÓTONO de sub-plano dentro del beat. No puede ser capped.length:
  // los tramos de la primera pasada ya gastaron 0..spans.length-1, así que un
  // troceo devolvía a reusar un índice vivo. Con dos sub-planos y el primero
  // partido, la parte k=1 y el span 1 compartían `flux:<video>:<beat>:1` y el
  // fichero `<video>-<beat>-1.png`: si los dos caían a Flux, el segundo
  // copyFile pisaba al primero y los dos sub-planos mostraban LA MISMA imagen.
  let vIdxLibre = spans.length;
  for (const rv of resolved) {
    const durMs = rv.span.to_ms - rv.span.from_ms;
    const budget = MAX_VISUALS_PER_BEAT - capped.length;
    if (rv.res.chosen.kind === 'image' && durMs > imageMaxMs && budget > 1) {
      const parts = Math.min(Math.ceil(durMs / imageMaxMs), budget);
      const step = Math.round(durMs / parts);
      for (let k = 0; k < parts; k++) {
        const from_ms = rv.span.from_ms + k * step;
        const to_ms = k === parts - 1 ? rv.span.to_ms : rv.span.from_ms + (k + 1) * step;
        if (k === 0) {
          capped.push({ span: { ...rv.span, from_ms, to_ms }, res: rv.res });
        } else {
          const extra = await resolveOneVisual(deps, {
            beatIdx: beat.idx,
            vIdx: vIdxLibre++,
            query: rv.span.visual_query,
            spanMs: to_ms - from_ms,
            // El veto iba VACÍO aquí, y con él se caía la anti-repetición justo
            // en los tramos troceados: el pool volvía a incluir los planos ya
            // usados en el vídeo en vez de seguir buscando.
            vetoedRefs: new Set(deps.usedRefs),
            // Estos tramos son cortos (≤IMAGE_MAX_S) y vienen de haber elegido
            // ya una imagen: es el amplificador que convierte una decisión
            // «imagen» en dos o tres planos-imagen. Medido sobre las consultas
            // reales, a 5 s el 98 % de los clips encaja con un corte limpio,
            // así que aquí el material sobra y se pide movimiento.
            exigeClip: true,
          });
          capped.push({ span: { ...rv.span, from_ms, to_ms }, res: extra });
        }
      }
    } else {
      capped.push(rv);
    }
    if (capped.length >= MAX_VISUALS_PER_BEAT) break;
  }

  const storedVisuals: StoredSubvisual[] = capped.map(({ span, res }) => ({
    from_ms: span.from_ms,
    to_ms: span.to_ms,
    visual_query: span.visual_query,
    ...(span.keyword ? { keyword: span.keyword } : {}),
    status: res.status,
    candidates: res.candidates,
    fit: res.fit,
    chosen_origin: originLabel(res.candidates[0]!),
    chosen_score: res.chosen.cos,
    asset_id: res.libAssetId,
  }));

  // el beat necesita revisión humana si CUALQUIER sub-plano no es auto_ok
  const primary = capped[0]!.res;
  const beatStatus: 'auto_ok' | 'review' = capped.every((c) => c.res.status === 'auto_ok')
    ? 'auto_ok'
    : 'review';

  // convención compartida con la API: el elegido del plano principal va PRIMERO
  // en candidates. La escritura respeta el candado humano.
  const updated = await ctx.db
    .update(beatsTable)
    .set({
      status: beatStatus,
      candidates: primary.candidates,
      fit: primary.fit,
      chosenScore: primary.chosen.cos,
      chosenOrigin: originLabel(primary.candidates[0]!),
      assetId: primary.libAssetId,
      visuals: storedVisuals,
      discardReason: null,
    })
    .where(and(eq(beatsTable.id, beat.id), ne(beatsTable.status, 'locked')))
    .returning({ id: beatsTable.id });
  if (updated.length === 0) {
    logger.info(
      { videoId, beatIdx: beat.idx },
      'Matching descartado: el humano bloqueó el beat durante el proceso',
    );
  }
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

  // El techo de imágenes en vigor se congela en el maestro ANTES de matchear:
  // el informe de calidad tiene que auditar contra lo que se pidió al producir.
  const imagenesMaxPct = channel?.profile?.style.broll_imagenes_max_pct ?? RATIO_IMAGENES_MAX;
  const palancas = palancasImagen(imagenesMaxPct);
  if (video.master.broll_telemetry?.imagenes_max_pct !== imagenesMaxPct) {
    await db
      .update(videos)
      .set({
        master: masterVideoJsonV1.parse({
          ...video.master,
          broll_telemetry: { imagenes_max_pct: imagenesMaxPct },
        }),
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId));
    video.master = { ...video.master, broll_telemetry: { imagenes_max_pct: imagenesMaxPct } };
  }

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
      const cutsByIdx = await directBroll(ctx, {
        videoId,
        channelId: video.channelId,
        lang: channel?.profile?.style.stock_query_lang ?? 'en',
        beats: toDirect.map((b) => ({ idx: b.idx, text: b.text, sceneQuery: b.visualQuery })),
      });
      const cues = video.master.cues;
      for (const b of toDirect) {
        const cuts = cutsByIdx.get(b.idx);
        if (!cuts || cuts.length === 0) continue;
        // sub-planos: anclar cada corte a la palabra de la narración (cues)
        const words = wordsInSpan(cues, b.fromMs, b.toMs);
        const spans = computeSubvisualSpans({ from_ms: b.fromMs, to_ms: b.toMs }, words, cuts);
        // se persisten SIN resolver (candidates:[], fit:null); matchBeat resuelve
        const stored: StoredSubvisual[] = spans.map((s) => ({
          from_ms: s.from_ms,
          to_ms: s.to_ms,
          visual_query: s.visual_query,
          ...(s.keyword ? { keyword: s.keyword } : {}),
          status: 'pending' as const,
          candidates: [],
          fit: null,
          chosen_origin: null,
          chosen_score: null,
          asset_id: null,
        }));
        b.visuals = stored; // la fila en memoria alimenta matchBeat
        b.visualQuery = spans[0]!.visual_query; // principal, para compat/timeline
        await db
          .update(beatsTable)
          .set({ visuals: stored, visualQuery: b.visualQuery })
          .where(eq(beatsTable.id, b.id));
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
    ...palancas,
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

  // Directores de capítulos y de EDICIÓN: sobre los beats (timings de la ley del
  // audio) + cues + guion calculan segmentos y la línea de efectos ANTES de la
  // curación, para que la timeline del dashboard los muestre y el humano pueda
  // revisarlos/ajustar antes de aprobar. No dependen de los assets (se anclan a
  // ms) → estables aunque se cambie el clip de un beat. Solo en run completo.
  if (fullRun) {
    const lang = channel?.profile?.language === 'en' ? 'en' : 'es';
    const segments = await directChapters(ctx, {
      videoId,
      channelId: video.channelId,
      lang,
      beats: allRows.map((b) => ({ idx: b.idx, from_ms: b.fromMs, text: b.text })),
    });
    const edits = await directEdits(ctx, {
      videoId,
      channelId: video.channelId,
      lang,
      beats: allRows.map((b) => ({ idx: b.idx, from_ms: b.fromMs, to_ms: b.toMs, text: b.text })),
      cues: video.master.cues ?? [],
      scenes: video.master.script?.scenes ?? [],
      segmentStartMs: segments.map((s) => s.from_ms),
      seoTags: video.master.seo?.tags ?? [],
      ...(video.master.script?.hook_notes ? { hookNotes: video.master.script.hook_notes } : {}),
      ...(video.master.seo
        ? { title: video.master.seo.titles[video.master.seo.chosen_idx ?? 0] }
        : {}),
      // el índice escena→audio permite anclar la palabra disparadora en SU
      // ventana; los claims son la única fuente de cifras admitida en pantalla
      ...(video.master.scene_spans ? { sceneSpans: video.master.scene_spans } : {}),
      ...(video.master.research ? { claims: video.master.research.claims } : {}),
    });
    await db
      .update(videos)
      .set({
        master: masterVideoJsonV1.parse({ ...video.master, segments, edits }),
        updatedAt: new Date(),
      })
      .where(eq(videos.id, videoId));
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

/**
 * Etiquetas de la biblioteca, para la búsqueda de texto libre del navegador de
 * assets. Salen SOLO de la descripción: derivarlas también de la consulta hacía
 * que el asset se etiquetara con la búsqueda que lo encontró en vez de con lo
 * que se ve en él.
 */
function buildTags(caption: string): string[] {
  const tokens = caption
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

// Objetivo de ingesta: un plano concreto (beat o sub-plano) con su candidato
// elegido. Reemplaza al BeatRow completo para poder ingerir varios por beat.
interface IngestTarget {
  beatIdx: number;
  visualQuery: string;
  candidates: BeatCandidate[] | null;
  assetId: string | null;
}

async function ingestChosen(
  ctx: WorkerContext,
  video: { id: string; channelId: string },
  target: IngestTarget,
): Promise<IngestedAsset> {
  const { db, logger } = ctx;
  const chosen = target.candidates?.[0];

  // biblioteca: contabilizar uso, sin descarga
  if (target.assetId || chosen?.provider === 'library') {
    const assetId = target.assetId ?? chosen?.ref.replace('library:', '');
    if (!assetId)
      throw new Error(`El beat ${target.beatIdx} no tiene asset de biblioteca resoluble`);
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

  if (!chosen) throw new Error(`El beat ${target.beatIdx} no tiene candidato elegido`);
  const meta = (chosen.meta ?? {}) as Record<string, unknown>;
  const kind = (meta.kind as 'clip' | 'image' | undefined) ?? 'clip';

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
      absPath: path.isAbsolute(existing.path)
        ? existing.path
        : path.join(ctx.libraryDir, existing.path),
      kind: toBeatKind(existing.kind),
      durationMs: existing.durationMs,
    };
  }

  // obtener el archivo: descarga de stock. Aquí había una rama para el PNG de
  // Flux, con regeneración de emergencia por semilla; sin generación de imagen
  // en la cascada, ningún candidato puede llegar ya con provider 'flux'.
  const destDir = path.join(ctx.libraryDir, 'assets', video.channelId, kind);
  await fs.mkdir(destDir, { recursive: true });
  const source = chosen.provider;
  const license = chosen.provider === 'pexels' ? 'Pexels' : 'Pixabay';
  const downloadUrl = meta.download_url as string | undefined;
  if (!downloadUrl) throw new Error(`El candidato ${chosen.ref} no tiene download_url`);
  const destPath = path.join(destDir, `${nanoid()}.${extFromUrl(downloadUrl, kind)}`);
  await downloadWithCap(downloadUrl, destPath, chosen.ref);

  try {
    const probed = await probeMedia(destPath);
    return await insertIngestedAsset(ctx, video, target, chosen, {
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

const MAX_DOWNLOAD_BYTES = Number(process.env.STOCK_MAX_DOWNLOAD_MB ?? '200') * 1024 * 1024;

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
  target: { beatIdx: number; visualQuery: string },
  chosen: BeatCandidate,
  info: IngestFileInfo,
): Promise<IngestedAsset> {
  const { db, logger } = ctx;
  const { kind, destPath, source, license, probed, meta } = info;
  const caption = (meta.caption as string | undefined) ?? String(meta.title ?? '');
  const tags = buildTags(caption);
  // texto canónico compartido con backfill y reembed (lib/embed-text.ts)
  const [embedding] = await ctx.embeddings.embed([
    buildAssetEmbedText(caption, target.visualQuery),
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
    originQuery: target.visualQuery,
    embedding: embedding ?? null,
    timesUsed: 1,
    lastVideoId: video.id,
  });
  logger.info(
    { videoId: video.id, beatIdx: target.beatIdx, assetId, source, codec: probed.codec },
    'Asset ingerido en biblioteca',
  );

  return {
    assetId,
    absPath: destPath,
    kind,
    durationMs: kind === 'clip' ? probed.durationMs : null,
  };
}

// Póster de un clip en library/assets/<canal>/thumbs/<id>.jpg (misma convención
// que thumbUrlFor en la API y el backfill). Solo clips; las imágenes ya son su
// propio thumb. Best-effort: si ffmpeg falta o falla, la biblioteca cae al
// placeholder, nunca rompe la ingesta.
async function ensureClipThumb(
  ctx: WorkerContext,
  channelId: string,
  ingested: IngestedAsset,
): Promise<void> {
  if (ingested.kind !== 'clip') return;
  const thumb = path.join(ctx.libraryDir, 'assets', channelId, 'thumbs', `${ingested.assetId}.jpg`);
  const exists = await fs.access(thumb).then(
    () => true,
    () => false,
  );
  if (exists) return;
  await fs.mkdir(path.dirname(thumb), { recursive: true });
  await extractCaptionJpeg(
    { filePath: ingested.absPath, visual: 'video', durationMs: ingested.durationMs },
    thumb,
    ctx.logger,
  );
}

async function runIngest(ctx: WorkerContext, job: Job<AssetsIngestJob>): Promise<void> {
  const { videoId } = job.data;
  const { db, logger } = ctx;

  const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);
  if (video.state !== 'timeline_ok') {
    logger.info(
      { videoId, state: video.state },
      'El vídeo no está en timeline_ok; se omite la ingesta',
    );
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

    // planos a ingerir: los sub-planos resueltos, o uno solo (compat) desde
    // los campos principales del beat si no hay `visuals`.
    const planos: StoredSubvisual[] =
      beat.visuals && beat.visuals.length > 0
        ? beat.visuals
        : [
            {
              from_ms: beat.fromMs,
              to_ms: beat.toMs,
              visual_query: beat.visualQuery,
              status: 'locked',
              candidates: beat.candidates ?? [],
              fit: beat.fit ?? null,
              chosen_origin: beat.chosenOrigin ?? null,
              chosen_score: beat.chosenScore ?? null,
              asset_id: beat.assetId ?? null,
            },
          ];

    const frozenVisuals: NonNullable<Beat['visuals']> = [];
    for (let vIdx = 0; vIdx < planos.length; vIdx++) {
      const sv = planos[vIdx]!;
      const ingested = await ingestChosen(
        ctx,
        { id: videoId, channelId: video.channelId },
        {
          beatIdx: beat.idx,
          visualQuery: sv.visual_query,
          candidates: sv.candidates,
          assetId: sv.asset_id,
        },
      );
      // póster para la biblioteca: sin esto los clips de producción salen sin
      // preview (thumbUrlFor busca thumbs/<id>.jpg). Best-effort, no bloquea.
      await ensureClipThumb(ctx, video.channelId, ingested);
      // el fit se recalcula SIEMPRE con la duración real del archivo, contra el
      // tramo del SUB-PLANO (no todo el beat)
      const seed = mockHash(`${videoId}${beat.idx}:${vIdx}`);
      const fitResult = computeFit(
        {
          kind: ingested.kind,
          assetDurationMs: ingested.durationMs,
          beatDurationMs: sv.to_ms - sv.from_ms,
        },
        { clampLoops: true },
      );
      const fit: Fit = fitResult?.fit ?? { mode: 'kenburns' };
      const effect = fit.mode === 'kenburns' ? kenburnsEffect(seed) : undefined;
      frozenVisuals.push({
        from_ms: sv.from_ms,
        to_ms: sv.to_ms,
        visual_query: sv.visual_query,
        ...(sv.keyword ? { keyword: sv.keyword } : {}),
        asset: {
          id: ingested.assetId,
          path: ingested.absPath,
          kind: ingested.kind,
          fit,
          ...(effect ? { effect } : {}),
        },
      });
    }

    const primary = frozenVisuals[0]!;
    await db
      .update(beatsTable)
      .set({
        status: 'locked',
        assetId: primary.asset!.id,
        fit: primary.asset!.fit,
        candidates: null,
      })
      .where(eq(beatsTable.id, beat.id));

    frozenBeats.push({
      idx: beat.idx,
      from_ms: beat.fromMs,
      to_ms: beat.toMs,
      text: beat.text,
      visual_query: beat.visualQuery,
      status: 'locked',
      asset: primary.asset,
      // solo se persiste `visuals` si hay más de un plano (compat: 1 plano = como antes)
      ...(frozenVisuals.length > 1 ? { visuals: frozenVisuals } : {}),
    });

    await ctx.publishEvent({
      type: 'job_progress',
      video_id: videoId,
      queue: QUEUES.assets,
      progress: Math.round(((i + 1) / beatRows.length) * 90),
      detail: `Asset del beat ${beat.idx + 1} de ${beatRows.length} descargado`,
    });
  }

  // segmentos y edits ya los calcularon los directores en runMatch (para que
  // la timeline del dashboard los muestre durante la curación); aquí se
  // conservan tal cual al congelar. Fallback [] por si el maestro es antiguo.
  const segments = video.master.segments ?? [];
  const edits = video.master.edits ?? [];

  // congelar master.beats: status locked, asset resuelto, sin candidates
  const newMaster = masterVideoJsonV1.parse({
    ...video.master,
    beats: frozenBeats,
    segments,
    edits,
  });
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
        const label =
          job.name === JOBS.assets.ingest ? 'La ingesta de assets' : 'El matching de assets';
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
