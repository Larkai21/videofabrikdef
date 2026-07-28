import { z } from 'zod';
import type { WorkerContext } from '../../lib/context.js';
import { ledgeredLlmJson } from '../ideas/llm-call.js';
import { expandQuery } from './score.js';

// Director de b-roll: en una sola llamada LLM produce una consulta visual
// CONCRETA por beat, pegada a lo que se dice en ese beat (no al tema de la
// escena), y distinta de la de sus vecinos. Sustituye a la visual_query
// heredada de la escena, que se repetía en todos los beats de una misma
// escena → clips casi idénticos seguidos y poco relacionados con el diálogo.

export interface DirectorBeat {
  idx: number;
  // narración de ese hueco de 8-15 s: la señal principal de relevancia
  text: string;
  // consulta de la escena, como pista temática de respaldo
  sceneQuery: string;
}

export const brollResultSchema = z.object({
  beats: z.array(
    z.object({
      idx: z.number().int().nonnegative(),
      visual_query: z.string().min(1),
    }),
  ),
});

export interface DirectorParams {
  videoId: string;
  channelId: string;
  lang: 'en' | 'es';
  // sufijo de estilo del canal (visual_prompt_suffix) para coherencia visual
  styleSuffix: string;
  beats: DirectorBeat[];
}

export function buildDirectorPrompt(params: DirectorParams): { system: string; user: string } {
  const langName = params.lang === 'en' ? 'inglés' : 'español';
  const styleLine =
    params.styleSuffix.trim() !== ''
      ? `\nEstilo del canal (añádelo al final de cada consulta cuando encaje): ${params.styleSuffix.trim()}.`
      : '';
  const system = [
    'Eres director de b-roll de un canal de YouTube tipo "faceless".',
    'Recibes la narración de un vídeo dividida en beats (trozos de 8-15 s).',
    'Para CADA beat devuelve una única consulta de archivo (stock) que ilustre',
    'visualmente lo que se DICE en ese beat concreto, no el tema general.',
    'Reglas:',
    `- 3-6 palabras concretas y filmables, en ${langName}.`,
    '- Escenas y objetos concretos, nunca conceptos abstractos ni texto en pantalla.',
    '- Beats consecutivos deben ser VISUALMENTE DISTINTOS entre sí (no repitas el',
    '  mismo sujeto o encuadre en beats seguidos; varía lugar, plano o acción).',
    '- Mantén coherencia con el tema del vídeo, pero prioriza el matiz de cada beat.',
    styleLine,
    'Devuelve JSON: { "beats": [ { "idx": number, "visual_query": string } ] },',
    'exactamente un objeto por beat recibido, con el mismo idx.',
  ].join('\n');

  const user = [
    'Beats (idx · tema de escena · narración):',
    ...params.beats.map(
      (b) => `${b.idx} · ${b.sceneQuery} · ${b.text.replace(/\s+/g, ' ').trim().slice(0, 240)}`,
    ),
  ].join('\n');

  return { system, user };
}

// Devuelve idx→visual_query. Ante cualquier fallo del LLM se cae con gracia a
// la consulta de escena (expandida) para no bloquear el pipeline.
export async function directBroll(
  ctx: WorkerContext,
  params: DirectorParams,
): Promise<Map<number, string>> {
  const fallback = new Map<number, string>(
    params.beats.map((b) => [b.idx, expandQuery(b.sceneQuery, b.text)]),
  );
  if (params.beats.length === 0) return fallback;

  const { system, user } = buildDirectorPrompt(params);
  let data: z.infer<typeof brollResultSchema>;
  try {
    data = await ledgeredLlmJson(ctx, {
      videoId: params.videoId,
      channelId: params.channelId,
      op: 'broll_director',
      system,
      user,
      schema: brollResultSchema,
      mockContext: { beats: params.beats },
    });
  } catch (err) {
    ctx.logger.warn(
      { err, videoId: params.videoId },
      'Director de b-roll falló; se usan las consultas de escena',
    );
    return fallback;
  }

  const out = new Map(fallback);
  for (const b of data.beats) {
    const q = b.visual_query.trim();
    if (out.has(b.idx) && q !== '') out.set(b.idx, q);
  }
  return out;
}
