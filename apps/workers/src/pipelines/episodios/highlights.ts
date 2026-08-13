import { z } from 'zod';
import { SHORT_MAX_S, SHORT_MIN_S, SHORT_TARGET_S, SHORTS_PER_VIDEO } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { ledgeredLlmJson } from '../ideas/llm-call.js';
import { toCandidatos, type Candidato, type ShortDirectorBeat } from '../shorts/director.js';

// Director de HIGHLIGHTS: qué ventanas de un episodio ajeno funcionan solas
// como clip vertical. Primo del director de shorts con dos diferencias que
// vienen del material:
//
//   - ESCALA: un episodio de 2 h son ~600 beats y no caben en un prompt. Se
//     hace map por bloques de ~80 beats (cada bloque devuelve sus mejores
//     candidatos con índices GLOBALES) y un reduce DETERMINISTA (score +
//     desolape); un reduce con LLM es v2, cuando haya banco que lo respalde.
//   - CRITERIO: aquí no hay «empieza en el beat 0» (el arranque de un podcast
//     es la presentación); lo que pesa es el momento autocontenido — la
//     anécdota cerrada, la opinión fuerte, el dato que sorprende.
//
// Los índices son de BEAT, nunca ms (mismo principio que el director de
// shorts: los beats del episodio ya están cortados en fronteras que se OYEN).

export const highlightCandidatesSchema = z.object({
  candidates: z
    .array(
      z.object({
        start_beat_idx: z.number().int().nonnegative(),
        end_beat_idx: z.number().int().nonnegative(),
        title: z.string().min(1).max(60),
        hook: z.string().min(1).max(140),
        reason: z.string().min(1).max(200),
        score: z.number().min(0).max(100),
      }),
    )
    .min(1)
    .max(6),
});

const BEATS_POR_BLOQUE = 80;

export interface HighlightsParams {
  episodeId: string;
  channelId: string;
  titulo: string;
  canal: string;
  beats: ShortDirectorBeat[];
  excluir?: { from_ms: number; to_ms: number; reason?: string }[];
  cuantos?: number;
}

export function buildHighlightsPrompt(
  params: Pick<HighlightsParams, 'titulo' | 'canal' | 'excluir'>,
  bloque: ShortDirectorBeat[],
  porBloque: number,
): { system: string; user: string } {
  const system = [
    'Eres editor de un canal de clips: recortas los mejores momentos de podcasts y directos ajenos.',
    'Recibes un tramo de la transcripción dividido en beats numerados con su duración.',
    `Elige hasta ${porBloque} fragmentos de beats CONSECUTIVOS y COMPLETOS que funcionen como clip vertical SUELTO.`,
    'Reglas:',
    `- Duración entre ${SHORT_MIN_S} y ${SHORT_MAX_S} s (orientación: ~${SHORT_TARGET_S} s), sumando los beats que incluyas. CORTAR EN EL REMATE manda sobre acercarse a la orientación.`,
    '- start_beat_idx <= end_beat_idx, y los fragmentos no se solapan entre sí.',
    'Qué hace bueno a un clip, por orden de importancia:',
    '1. Que se entienda SOLO, sin nada de lo anterior: una anécdota cerrada, una opinión fuerte, un dato que sorprende. Una historieta humana que acaba en carcajada vale tanto como una opinión o un dato.',
    '2. Que la PRIMERA frase enganche en frío: pregunta, afirmación contraintuitiva o arranque de historia.',
    // la lección de la certificación (13-ago-2026): la referencia corta en el
    // punchline y publica 23 s; el director se llevaba la anécdota entera
    '3. El clip TERMINA EN EL REMATE: end_beat_idx es el beat donde cae el golpe (la carcajada, la frase lapidaria), no donde se agota el tema. No arrastres la reacción posterior ni la historia siguiente. Un remate a los 22 s gana a la anécdota completa de 55 s; si la historia tiene dos golpes, elige el primero y deja el resto para otro clip.',
    '   Los beats marcados con CARCAJADA llevan risa REAL medida en el audio: son remates confirmados. Si tu fragmento contiene uno, termina exactamente en él.',
    '4. Descarta presentaciones, agradecimientos, transiciones y tramos que dependen de un ejemplo anterior.',
    'Campos:',
    '- title: el rótulo del clip, 6 palabras como mucho. En el idioma del episodio.',
    '- hook: por qué alguien dejaría de deslizar.',
    '- reason: para la persona que aprueba, en una frase.',
    '- score: 0-100, tu confianza en que funcione suelto.',
    'Sin exclamaciones. Sentence case.',
    'Devuelve JSON: { "candidates": [ { "start_beat_idx": number, "end_beat_idx": number, "title": string, "hook": string, "reason": string, "score": number } ] }.',
  ].join('\n');

  const excluidas = (params.excluir ?? []).map(
    (v) =>
      `${Math.round(v.from_ms / 1000)}-${Math.round(v.to_ms / 1000)} s` +
      (v.reason !== undefined && v.reason !== '' ? ` (${v.reason})` : ''),
  );
  const user = [
    `Episodio: ${params.titulo} — canal ${params.canal}`,
    ...(excluidas.length > 0
      ? ['Ventanas que NO debes proponer otra vez (motivo entre paréntesis):', ...excluidas.map((e) => `- ${e}`)]
      : []),
    '',
    'Beats (idx · duración · narración; CARCAJADA = risa medida en el audio al final del beat):',
    ...bloque.map(
      (b) =>
        `${b.idx} · ${Math.round((b.to_ms - b.from_ms) / 1000)} s · ` +
        b.text.replace(/\s+/g, ' ').trim().slice(0, 220) +
        (b.risa_despues_ms !== undefined
          ? ` [CARCAJADA ${(b.risa_despues_ms / 1000).toFixed(1)} s]`
          : ''),
    ),
  ].join('\n');
  return { system, user };
}

/**
 * Reserva sin LLM: la primera ventana que cabe SALTÁNDOSE el arranque (la
 * presentación). Nunca deja el job sin salida.
 */
export function fallbackHighlights(beats: ShortDirectorBeat[], titulo: string): Candidato[] {
  const orden = [...beats].sort((a, b) => a.idx - b.idx);
  const desde = Math.min(2, Math.max(0, orden.length - 3));
  const trozo: ShortDirectorBeat[] = [];
  let total = 0;
  for (const b of orden.slice(desde)) {
    if (total >= SHORT_TARGET_S * 1000 || total + (b.to_ms - b.from_ms) > SHORT_MAX_S * 1000) break;
    trozo.push(b);
    total += b.to_ms - b.from_ms;
  }
  if (trozo.length === 0 || total < SHORT_MIN_S * 1000) return [];
  return [
    {
      from_ms: trozo[0]!.from_ms,
      to_ms: trozo[trozo.length - 1]!.to_ms,
      start_beat_idx: trozo[0]!.idx,
      end_beat_idx: trozo[trozo.length - 1]!.idx,
      beat_idxs: trozo.map((b) => b.idx),
      title: titulo.slice(0, 60),
      hook: 'Tramo inicial del episodio, tras la presentación',
      reason: 'Propuesta de reserva: el director no pudo elegir',
      score: 40,
    },
  ];
}

export async function directHighlights(
  ctx: WorkerContext,
  params: HighlightsParams,
): Promise<{ candidatos: Candidato[]; source: 'llm' | 'fallback' }> {
  if (params.beats.length === 0) return { candidatos: [], source: 'fallback' };
  const cuantos = params.cuantos ?? SHORTS_PER_VIDEO;

  const bloques: ShortDirectorBeat[][] = [];
  for (let i = 0; i < params.beats.length; i += BEATS_POR_BLOQUE) {
    bloques.push(params.beats.slice(i, i + BEATS_POR_BLOQUE));
  }
  // con varios bloques, cada map devuelve pocos y el reduce determinista elige
  const porBloque = bloques.length > 1 ? 3 : cuantos * 2;

  const crudos: z.infer<typeof highlightCandidatesSchema>['candidates'] = [];
  let fallo = false;
  for (const bloque of bloques) {
    try {
      const { system, user } = buildHighlightsPrompt(params, bloque, porBloque);
      const data = await ledgeredLlmJson(ctx, {
        episodeId: params.episodeId,
        channelId: params.channelId,
        op: 'highlights_director',
        system,
        user,
        schema: highlightCandidatesSchema,
        mockContext: { beats: bloque },
      });
      crudos.push(...data.candidates);
    } catch (err) {
      fallo = true;
      ctx.logger.warn({ err, episodeId: params.episodeId }, 'Un bloque del director de highlights falló');
    }
  }

  if (crudos.length === 0) {
    return {
      candidatos: fallbackHighlights(params.beats, params.titulo),
      source: 'fallback',
    };
  }
  // reduce determinista: la normalización de shorts ya ordena por score,
  // estira/encoge por beats enteros y desolapa (>50 %) contra excluir y entre sí
  const candidatos = toCandidatos(crudos, params.beats, {
    fronteras: [],
    ...(params.excluir !== undefined ? { excluir: params.excluir } : {}),
    cuantos,
  });
  if (candidatos.length === 0) {
    return { candidatos: fallbackHighlights(params.beats, params.titulo), source: 'fallback' };
  }
  return { candidatos, source: fallo ? 'fallback' : 'llm' };
}
