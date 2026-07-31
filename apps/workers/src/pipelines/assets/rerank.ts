import { z } from 'zod';
import type { BeatCandidate } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { ledgeredLlmJson } from '../ideas/llm-call.js';

/**
 * Juez de planos: relee los finalistas de cada beat y los reordena.
 *
 * Por qué hace falta uno que LEA, medido sobre 25 beats curados a mano
 * (`calibracion/planos-etiquetados.jsonl`, `pnpm rerank`):
 *
 *   regla                 sin disparate
 *   pipeline (hoy)          17/25  (68 %)
 *   coseno crudo            18/25  (72 %)
 *   penalizar lo genérico   18/25  (72 %)
 *   contra la narración     19/25  (76 %)
 *   juez que lee            24/25  (96 %)  ← tres corridas, mismo resultado
 *
 * Ninguna combinación de los números del embedding despega, y no es por falta
 * de ingenio: los seis candidatos de un beat caben en 0,037 de coseno y el
 * suelo de e5 para pares NO relacionados es 0,72-0,78, así que el pool entero
 * aterriza justo encima del ruido. La información para distinguir «informe
 * legal» de «estudio de radio con el cartel ON AIR» no está en esos vectores.
 *
 * Lo que se mide NO es coincidir con la elección humana (ahí el juez saca
 * menos que el pipeline: 12/24 contra 13/24). Con cinco planos casi iguales,
 * elegir el tercero en vez del cuarto no es un error. Lo que se nota en
 * pantalla es el plano que no pega, y eso es lo que baja de 8 a 1.
 *
 * Una llamada por vídeo, ~7.500 tokens para 25 beats.
 */

export const rerankSchema = z.object({
  beats: z.array(
    z.object({
      idx: z.number().int().nonnegative(),
      // 1..n = ese candidato; 0 = ninguno sirve
      elegido: z.number().int().nonnegative(),
    }),
  ),
});

export interface RerankBeat {
  idx: number;
  /** lo que se oye en ese hueco */
  text: string;
  candidates: BeatCandidate[];
}

export interface RerankResult {
  /** candidatos reordenados por beat; solo los beats que el juez tocó */
  orden: Map<number, BeatCandidate[]>;
  /** beats en los que el juez dice que NINGÚN candidato pega */
  sinPlano: Set<number>;
}

/** Cuántos finalistas se le enseñan al juez. Más allá el prompt crece sin dar. */
const MAX_CANDIDATOS = 6;

function pieDeFoto(c: BeatCandidate): string {
  const meta = (c.meta ?? {}) as Record<string, unknown>;
  const cap = (meta.caption ?? meta.title ?? '') as string;
  const kind = (meta.kind ?? 'clip') as string;
  return `[${kind}] ${cap.replace(/\s+/g, ' ').slice(0, 140)}`;
}

export function buildRerankPrompt(beats: RerankBeat[]): { system: string; user: string } {
  const system = [
    'Eres montador de un canal de YouTube. Para cada beat te doy lo que se OYE',
    'y los pies de foto de los planos de archivo disponibles.',
    'Elige el plano que un espectador aceptaría como ilustración de esa frase.',
    'Criterio: que el plano muestre el SUJETO del que se habla, o una escena en',
    'la que eso ocurriría. No basta con que comparta el tema general: un teclado',
    'no ilustra «una multa», ni una sala de reuniones ilustra «un contrato».',
    'Si ninguno lo cumple, responde 0. Vale la pena responder 0: un plano que no',
    'pega se nota más que la falta de un plano concreto.',
    'Responde SOLO JSON: {"beats":[{"idx":number,"elegido":number}]}, con elegido',
    'entre 1 y el número de candidatos de ese beat, o 0 si ninguno sirve.',
  ].join('\n');

  const user = beats
    .map((b) => {
      const opciones = b.candidates
        .slice(0, MAX_CANDIDATOS)
        .map((c, i) => `    ${i + 1}. ${pieDeFoto(c)}`)
        .join('\n');
      return `BEAT ${b.idx}\n  se oye: ${b.text.replace(/\s+/g, ' ').slice(0, 220)}\n  candidatos:\n${opciones}`;
    })
    .join('\n\n');

  return { system, user };
}

/**
 * Aplica el veredicto sobre las listas originales. Función pura y separada de
 * la llamada para poder probarla: mueve el elegido al frente y CONSERVA el
 * resto en su orden, porque el juez opina sobre el primero y los siguientes
 * siguen siendo las alternativas que ve el humano en la ficha.
 */
export function aplicarVeredicto(
  beats: RerankBeat[],
  veredicto: { idx: number; elegido: number }[],
): RerankResult {
  const orden = new Map<number, BeatCandidate[]>();
  const sinPlano = new Set<number>();
  const porIdx = new Map(beats.map((b) => [b.idx, b]));
  for (const v of veredicto) {
    const beat = porIdx.get(v.idx);
    if (!beat || beat.candidates.length === 0) continue;
    if (v.elegido === 0) {
      sinPlano.add(v.idx);
      continue;
    }
    const elegido = beat.candidates[v.elegido - 1];
    // fuera de rango: el juez se inventó un número. No se toca ese beat.
    if (!elegido) continue;
    if (elegido === beat.candidates[0]) continue; // ya estaba primero
    orden.set(v.idx, [elegido, ...beat.candidates.filter((c) => c !== elegido)]);
  }
  return { orden, sinPlano };
}

/**
 * Reordena los finalistas de todos los beats en una llamada. Ante cualquier
 * fallo devuelve un resultado vacío: el pipeline sigue con su orden, que es
 * peor pero funciona. Este paso mejora el b-roll; no puede impedirlo.
 */
export async function rerankBeats(
  ctx: WorkerContext,
  params: { videoId: string; channelId: string; beats: RerankBeat[] },
): Promise<RerankResult> {
  const vacio: RerankResult = { orden: new Map(), sinPlano: new Set() };
  const conCandidatos = params.beats.filter((b) => b.candidates.length >= 2);
  if (conCandidatos.length === 0) return vacio;

  const { system, user } = buildRerankPrompt(conCandidatos);
  try {
    const data = await ledgeredLlmJson(ctx, {
      videoId: params.videoId,
      channelId: params.channelId,
      op: 'broll_rerank',
      system,
      user,
      schema: rerankSchema,
      mockContext: { beats: conCandidatos.map((b) => ({ idx: b.idx })) },
    });
    return aplicarVeredicto(conCandidatos, data.beats);
  } catch (err) {
    ctx.logger.warn(
      { err, videoId: params.videoId },
      'El juez de planos falló; se conserva el orden del matching',
    );
    return vacio;
  }
}
