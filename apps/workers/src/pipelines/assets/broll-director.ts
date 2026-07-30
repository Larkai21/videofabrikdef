import { z } from 'zod';
import { MAX_QUERY_CHARS, MAX_VISUALS_PER_BEAT } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { ledgeredLlmJson } from '../ideas/llm-call.js';
import { expandQuery } from './score.js';

// Director de b-roll: en una sola llamada LLM produce, POR BEAT, entre 1 y 3
// "cortes" visuales. Un corte si el beat es una sola idea visual; varios,
// anclados a palabras concretas de la narración (keyword), cuando el texto salta
// entre sujetos filmables distintos (p. ej. «bibliotecas» → «industria»). Así el
// b-roll cambia dentro del beat sin tocar los cortes de audio (principio 1).

export interface DirectorBeat {
  idx: number;
  // narración de ese hueco de 8-15 s: la señal principal de relevancia
  text: string;
  // consulta de la escena, como pista temática de respaldo
  sceneQuery: string;
}

// Un corte visual dentro de un beat. `keyword` (opcional) es la palabra de la
// narración donde debe entrar el plano; sin ella, el corte va por idea.
export interface DirectorCut {
  keyword?: string;
  visual_query: string;
}

export const brollResultSchema = z.object({
  beats: z.array(
    z.object({
      idx: z.number().int().nonnegative(),
      visuals: z
        .array(
          z.object({
            keyword: z.string().optional(),
            visual_query: z.string().min(1),
          }),
        )
        .min(1),
    }),
  ),
});

export interface DirectorParams {
  videoId: string;
  channelId: string;
  lang: 'en' | 'es';
  beats: DirectorBeat[];
}

export function buildDirectorPrompt(params: DirectorParams): { system: string; user: string } {
  const langName = params.lang === 'en' ? 'inglés' : 'español';
  const system = [
    'Eres director de b-roll de un canal de YouTube tipo "faceless".',
    'Recibes la narración de un vídeo dividida en beats (trozos de 8-15 s).',
    'Para CADA beat decides cuántos PLANOS mostrar, de 1 a ' + MAX_VISUALS_PER_BEAT + ':',
    '- 1 plano si el beat trata de una sola idea visual.',
    '- 2 o 3 planos si la narración salta entre sujetos filmables DISTINTOS; cada',
    '  plano se ancla a la palabra exacta de la narración donde debe entrar (keyword).',
    'Sé conservador: menos es más; no trocees una sola idea.',
    'Cada plano: una consulta de archivo (stock) que ilustre lo que se DICE ahí.',
    'Reglas de la consulta:',
    `- 3-6 palabras concretas y filmables, en ${langName}; nunca más de ${MAX_QUERY_CHARS} caracteres.`,
    '- Escenas y objetos concretos, nunca conceptos abstractos ni texto en pantalla.',
    '- Planos consecutivos (dentro y entre beats) VISUALMENTE DISTINTOS.',
    '- keyword: una palabra EXACTA tal cual aparece en la narración del beat (o vacío).',
    'Devuelve JSON: { "beats": [ { "idx": number, "visuals": [ { "keyword"?: string,',
    '"visual_query": string } ] } ] }, un objeto por beat recibido con el mismo idx.',
  ].join('\n');

  const user = [
    'Beats (idx · tema de escena · narración):',
    ...params.beats.map(
      (b) => `${b.idx} · ${b.sceneQuery} · ${b.text.replace(/\s+/g, ' ').trim().slice(0, 240)}`,
    ),
  ].join('\n');

  return { system, user };
}

/**
 * El prompt pide consultas cortas; esto lo garantiza. Pixabay devuelve 400 por
 * encima de MAX_QUERY_CHARS y su error no dice por qué, así que un modelo algo
 * hablador tumbaba en silencio una de las dos fuentes de stock. Se corta por
 * palabra entera para no partir un término por la mitad.
 */
export function recortarConsulta(q: string): string {
  const limpia = q.trim().replace(/\s+/g, ' ');
  if (limpia.length <= MAX_QUERY_CHARS) return limpia;
  const cortada = limpia.slice(0, MAX_QUERY_CHARS);
  const ultimo = cortada.lastIndexOf(' ');
  return (ultimo > 0 ? cortada.slice(0, ultimo) : cortada).trim();
}

// Devuelve idx→cortes[]. Ante cualquier fallo del LLM se cae con gracia a un
// único corte con la consulta de escena (expandida) para no bloquear el pipeline.
export async function directBroll(
  ctx: WorkerContext,
  params: DirectorParams,
): Promise<Map<number, DirectorCut[]>> {
  const fallback = new Map<number, DirectorCut[]>(
    params.beats.map((b) => [b.idx, [{ visual_query: recortarConsulta(expandQuery(b.sceneQuery, b.text)) }]]),
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
    if (!out.has(b.idx)) continue;
    const cuts: DirectorCut[] = b.visuals
      .map((v) => ({
        ...(v.keyword && v.keyword.trim() !== '' ? { keyword: v.keyword.trim() } : {}),
        visual_query: recortarConsulta(v.visual_query),
      }))
      .filter((v) => v.visual_query !== '')
      .slice(0, MAX_VISUALS_PER_BEAT);
    if (cuts.length > 0) out.set(b.idx, cuts);
  }
  return out;
}
