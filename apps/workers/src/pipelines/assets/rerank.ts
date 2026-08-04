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
  planos: z.array(
    z.object({
      // posición en la lista que se le dio, no el idx del beat: un beat puede
      // traer varios planos y el modelo confundía los dos números
      idx: z.number().int().nonnegative(),
      // 1..n = ese candidato; 0 = ninguno sirve
      elegido: z.number().int().nonnegative(),
    }),
  ),
});

/**
 * La unidad que se juzga es el SUB-PLANO, no el beat.
 *
 * Un beat de 10 s puede llevar hasta tres planos con consultas distintas, y
 * cada uno tiene su propia lista de candidatos. Juzgar a nivel de beat y
 * aplicar el veredicto al primero sería la misma clase de fallo que la puerta
 * de curación rota: decidir sobre una estructura y escribir en otra.
 */
export interface RerankPlano {
  beatIdx: number;
  vIdx: number;
  /** lo que se oye en ese hueco */
  text: string;
  /** el plano que pidió el director de b-roll, como contexto de lo buscado */
  query: string;
  candidates: BeatCandidate[];
}

export interface RerankResult {
  /** candidatos reordenados, por `${beatIdx}:${vIdx}`; solo los que el juez tocó */
  orden: Map<string, BeatCandidate[]>;
  /** sub-planos en los que el juez dice que NINGÚN candidato pega */
  sinPlano: Set<string>;
  /**
   * false si la llamada LLM falló o no había nada que juzgar: «el juez no
   * vetó nada» y «el juez no llegó a mirar» son cosas distintas — el b-roll
   * sigue con su orden en ambos casos, pero un inserto SIN juez no debe
   * colarse por la puerta de atrás.
   */
  juzgado: boolean;
}

export function claveDe(p: { beatIdx: number; vIdx: number }): string {
  return `${p.beatIdx}:${p.vIdx}`;
}

/** Cuántos finalistas se le enseñan al juez. Más allá el prompt crece sin dar. */
const MAX_CANDIDATOS = 6;

function pieDeFoto(c: BeatCandidate): string {
  const meta = (c.meta ?? {}) as Record<string, unknown>;
  const cap = (meta.caption ?? meta.title ?? '') as string;
  const kind = (meta.kind ?? 'clip') as string;
  return `[${kind}] ${cap.replace(/\s+/g, ' ').slice(0, 140)}`;
}

export function buildRerankPrompt(planos: RerankPlano[]): { system: string; user: string } {
  const system = [
    'Eres montador de un canal de YouTube. Para cada beat te doy lo que se OYE',
    'y los pies de foto de los planos de archivo disponibles.',
    'Elige el plano que un espectador aceptaría como ilustración de esa frase.',
    'Criterio: que el plano muestre el SUJETO del que se habla, o una escena en',
    'la que eso ocurriría. No basta con que comparta el tema general: un teclado',
    'no ilustra «una multa», ni una sala de reuniones ilustra «un contrato».',
    'Si ninguno lo cumple, responde 0. Vale la pena responder 0: un plano que no',
    'pega se nota más que la falta de un plano concreto.',
    'Responde SOLO JSON: {"planos":[{"idx":number,"elegido":number}]}, con idx el',
    'número de PLANO tal cual te lo doy y elegido entre 1 y el número de',
    'candidatos de ese plano, o 0 si ninguno sirve.',
  ].join('\n');

  const user = planos
    .map((p, i) => {
      const opciones = p.candidates
        .slice(0, MAX_CANDIDATOS)
        .map((c, k) => `    ${k + 1}. ${pieDeFoto(c)}`)
        .join('\n');
      return [
        `PLANO ${i}`,
        `  se oye: ${p.text.replace(/\s+/g, ' ').slice(0, 220)}`,
        `  se buscaba: ${p.query}`,
        `  candidatos:\n${opciones}`,
      ].join('\n');
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
  planos: RerankPlano[],
  veredicto: { idx: number; elegido: number }[],
): RerankResult {
  const orden = new Map<string, BeatCandidate[]>();
  const sinPlano = new Set<string>();
  for (const v of veredicto) {
    const plano = planos[v.idx];
    if (!plano || plano.candidates.length === 0) continue;
    const clave = claveDe(plano);
    if (v.elegido === 0) {
      sinPlano.add(clave);
      continue;
    }
    const elegido = plano.candidates[v.elegido - 1];
    // fuera de rango: el juez se inventó un número. No se toca ese plano.
    if (!elegido) continue;
    if (elegido === plano.candidates[0]) continue; // ya estaba primero
    orden.set(clave, [elegido, ...plano.candidates.filter((c) => c !== elegido)]);
  }
  return { orden, sinPlano, juzgado: true };
}

/**
 * Reordena los finalistas de todos los beats en una llamada. Ante cualquier
 * fallo devuelve un resultado vacío: el pipeline sigue con su orden, que es
 * peor pero funciona. Este paso mejora el b-roll; no puede impedirlo.
 */
export async function rerankBeats(
  ctx: WorkerContext,
  params: {
    videoId: string;
    channelId: string;
    planos: RerankPlano[];
    /**
     * Con 2+ candidatos el juez elige; con el mínimo en 1 (insertos) además
     * VETA candidatos únicos — sin esto, un inserto con una sola foto se
     * saltaba el veto entero, que es justo la garantía que lo sostiene.
     */
    minCandidatos?: number;
  },
): Promise<RerankResult> {
  const vacio: RerankResult = { orden: new Map(), sinPlano: new Set(), juzgado: false };
  const conCandidatos = params.planos.filter(
    (p) => p.candidates.length >= (params.minCandidatos ?? 2),
  );
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
      mockContext: { planos: conCandidatos.map((_, i) => ({ idx: i })) },
    });
    return aplicarVeredicto(conCandidatos, data.planos);
  } catch (err) {
    ctx.logger.warn(
      { err, videoId: params.videoId },
      'El juez de planos falló; se conserva el orden del matching',
    );
    return vacio;
  }
}
