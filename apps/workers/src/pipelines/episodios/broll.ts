import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { assets } from '@fabrica/db';
import type { WorkerContext } from '../../lib/context.js';
import { registerMockOp } from '../../providers/llm.js';
import type { BeatToken } from '../tts/beats.js';
import { ledgeredLlmJson } from '../ideas/llm-call.js';
import { frasesDe, type Frase } from './relleno.js';

// B-roll ilustrativo del clip: la referencia inserta metraje de película
// sobre la frase que lo pide («driving in a car» → coche); nuestra versión
// legal es la cascada de assets — biblioteca primero, y sin candidato digno
// NO hay inserto (principio 5: mejor el hablante que un plano que no pega).
//
// El director marca frases POR ÍNDICE (patrón C7: los tiempos salen de los
// tokens por construcción) con una consulta visual en inglés (los captions
// de la biblioteca están en inglés). Guardas deterministas: máximo
// BROLL_MAX_INSERTOS, nunca la primera ni la última frase (el gancho y el
// remate enseñan la cara), y un suelo de similitud para el matching.

export const BROLL_MAX_INSERTOS = 2;
/**
 * Similitud mínima contra la biblioteca; por debajo no hay inserto.
 * Calibración (13-ago-2026, un caso real): «couple driving car woman gives
 * scornful look» casó a 0,80 con una PAREJA EN UNA OFICINA — el coseno del
 * embedding regala 0,75-0,85 a cualquier cosa con un sustantivo en común.
 * 0,86 exige que el plano diga lo mismo que la frase; con una biblioteca
 * temática (IA/tech) eso significa «casi nunca», que es lo correcto: mejor
 * el hablante que un plano que no pega (principio 5). Falta un banco de
 * calibración como el de rerank cuando haya material variado.
 */
export const BROLL_SIMILITUD_MIN = 0.86;
/** Un inserto más corto que esto parpadea; más largo que esto esconde al hablante. */
export const BROLL_MIN_MS = 1_500;
export const BROLL_MAX_MS = 5_000;

export const brollSchema = z.object({
  /** frases ilustrables: índice del listado + consulta visual para stock */
  insertos: z
    .array(
      z.object({
        indice: z.number().int().nonnegative(),
        query: z.string().min(3).max(80),
      }),
    )
    .max(6),
});

registerMockOp('clips_broll', () => ({ insertos: [] }));

export interface BrollElegido {
  from_ms: number;
  to_ms: number;
  asset_path: string;
  asset_id: string;
  query: string;
  score: number;
}

function buildPrompt(frases: readonly Frase[]): { system: string; user: string } {
  const system = [
    'Eres el editor de un canal de clips de podcast. Te doy las frases de un',
    'clip numeradas. Marca las que MEJORAN con un plano ilustrativo encima',
    '(b-roll): acciones concretas (conducir, comer, correr), lugares y objetos',
    'que se nombran. NO marques opiniones abstractas, ni la primera frase, ni',
    'la última (el gancho y el remate enseñan la cara del que habla). Para',
    'cada una da una consulta visual corta EN INGLÉS para buscar metraje de',
    'stock (p. ej. "driving car night", "eating burger closeup"). Si ninguna',
    'frase lo pide, devuelve la lista vacía: el b-roll es sal, no plato.',
    'Devuelve JSON: { "insertos": [ { "indice": number, "query": string } ] }.',
  ].join(' ');
  const user = frases
    .map((f) => `${f.idx}. [${(f.from_ms / 1000).toFixed(1)}s] ${f.texto}`)
    .join('\n');
  return { system, user };
}

/** Guardas sobre lo pedido: índices válidos, ni gancho ni remate, tope. */
export function filtrarInsertos(
  frases: readonly Frase[],
  pedidos: readonly { indice: number; query: string }[],
): { frase: Frase; query: string }[] {
  const vistos = new Set<number>();
  const salida: { frase: Frase; query: string }[] = [];
  for (const p of pedidos) {
    if (p.indice <= 0 || p.indice >= frases.length - 1 || vistos.has(p.indice)) continue;
    const f = frases[p.indice]!;
    if (f.to_ms - f.from_ms < BROLL_MIN_MS) continue;
    vistos.add(p.indice);
    salida.push({ frase: f, query: p.query });
    if (salida.length >= BROLL_MAX_INSERTOS) break;
  }
  return salida;
}

/** El mejor clip de la biblioteca para la consulta; null bajo el suelo. */
async function mejorAsset(
  ctx: WorkerContext,
  channelId: string,
  query: string,
): Promise<{ id: string; path: string; score: number } | null> {
  const [vec] = await ctx.embeddings.embed([query], 'query');
  if (vec === undefined) return null;
  const vecLit = `[${vec.join(',')}]`;
  const similarity = sql<number>`1 - (${assets.embedding} <=> ${vecLit}::vector)`;
  const rows = await ctx.db
    .select({ id: assets.id, path: assets.path, score: similarity, durationMs: assets.durationMs })
    .from(assets)
    .where(
      and(
        or(eq(assets.channelId, channelId), eq(assets.scope, 'shared')),
        // solo clips: una imagen fija dentro de la tarjeta canta a relleno
        inArray(assets.kind, ['clip']),
        isNotNull(assets.embedding),
      ),
    )
    .orderBy(sql`${assets.embedding} <=> ${vecLit}::vector`)
    .limit(3);
  for (const r of rows) {
    if (Number(r.score) < BROLL_SIMILITUD_MIN) break;
    // el asset tiene que aguantar el inserto mínimo
    if (r.durationMs !== null && r.durationMs < BROLL_MIN_MS) continue;
    return { id: r.id, path: r.path, score: Number(r.score) };
  }
  return null;
}

/**
 * Insertos de b-roll de la ventana del clip, en el reloj DE LA VENTANA
 * (mismo reloj que los tokens de entrada; el llamador los remapea al reloj
 * de salida con el mapa del apretado). Degradación limpia: cualquier fallo
 * devuelve [] y el clip sale sin insertos.
 */
export async function marcarBroll(
  ctx: WorkerContext,
  params: {
    episodeId: string;
    channelId: string;
    shortId: string;
    tokens: readonly BeatToken[];
  },
): Promise<BrollElegido[]> {
  const frases = frasesDe(params.tokens);
  if (frases.length < 4) return [];
  try {
    const { system, user } = buildPrompt(frases);
    const data = await ledgeredLlmJson(ctx, {
      episodeId: params.episodeId,
      channelId: params.channelId,
      op: 'clips_broll',
      system,
      user,
      schema: brollSchema,
      mockContext: { frases: frases.length },
      meta: { short_id: params.shortId },
    });
    const elegidos: BrollElegido[] = [];
    for (const { frase, query } of filtrarInsertos(frases, data.insertos)) {
      const asset = await mejorAsset(ctx, params.channelId, query);
      if (asset === null) continue;
      elegidos.push({
        from_ms: frase.from_ms,
        to_ms: Math.min(frase.to_ms, frase.from_ms + BROLL_MAX_MS),
        asset_path: asset.path,
        asset_id: asset.id,
        query,
        score: asset.score,
      });
    }
    return elegidos;
  } catch (err) {
    ctx.logger.warn({ err, shortId: params.shortId }, 'B-roll del clip falló; sale sin insertos');
    return [];
  }
}
