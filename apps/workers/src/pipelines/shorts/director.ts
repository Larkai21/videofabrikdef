import { z } from 'zod';
import {
  SHORT_MAX_S,
  SHORT_MIN_S,
  SHORT_SNAP_MS,
  SHORT_TARGET_S,
  SHORTS_PER_VIDEO,
  type Beat,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { ledgeredLlmJson } from '../ideas/llm-call.js';

// Director de shorts: elige qué fragmentos del vídeo largo funcionan SOLOS como
// pieza vertical. Una sola llamada LLM por vídeo, patrón de chapter-director.
//
// Se le piden ÍNDICES DE BEAT, no milisegundos. Un modelo al que pides `from_ms`
// devuelve números plausibles que caen a mitad de palabra; con índices el corte
// es válido por construcción, porque los beats se cortan preferentemente en fin
// de frase. El ajuste fino a la frontera fuerte lo hace el normalizador.

export interface ShortDirectorBeat {
  idx: number;
  from_ms: number;
  to_ms: number;
  text: string;
  /** cuántos efectos de edición tiene el beat: donde ya hay material gráfico */
  edits: number;
}

export const shortCandidatesSchema = z.object({
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

export interface Ventana {
  from_ms: number;
  to_ms: number;
}

export interface Candidato extends Ventana {
  start_beat_idx: number;
  end_beat_idx: number;
  beat_idxs: number[];
  title: string;
  hook: string;
  reason: string;
  score: number;
}

export interface ShortParams {
  videoId: string;
  channelId: string;
  videoTitle: string;
  hookNotes?: string;
  beats: ShortDirectorBeat[];
  /** instantes donde se puede cortar sin partir una frase */
  fronteras: number[];
  /**
   * Ventanas que no deben volver: las descartadas por el humano CON SU MOTIVO
   * (la única señal humana disponible; se guardaba en discard_reason y nadie
   * la leía) y las ya vivas. El prompt las enseña con el motivo para que el
   * director aprenda del descarte, no solo lo evite.
   */
  excluir?: (Ventana & { reason?: string })[];
  cuantos?: number;
}

export function buildShortPrompt(params: ShortParams): { system: string; user: string } {
  const cuantos = params.cuantos ?? SHORTS_PER_VIDEO;
  const system = [
    'Eres editor de shorts verticales de un canal de YouTube tipo "faceless".',
    'Recibes la narración de un vídeo largo dividida en beats numerados, con la duración de cada uno y cuántos efectos de edición tiene.',
    `Elige ${cuantos} fragmentos formados por beats CONSECUTIVOS y COMPLETOS.`,
    'Reglas:',
    `- Duración objetivo ${SHORT_TARGET_S} s; nunca menos de ${SHORT_MIN_S} ni más de ${SHORT_MAX_S}. Suma las duraciones de los beats que incluyas.`,
    '- start_beat_idx <= end_beat_idx, y los fragmentos no se solapan entre sí.',
    'Qué hace bueno a un fragmento, por orden de importancia:',
    '1. Que empiece en el beat 0: el gancho del vídeo ya está escrito para enganchar.',
    '2. Que se entienda SOLO, sin lo que venía antes. Descarta los que empiezan por «por eso», «entonces», «además» o que dependen de un ejemplo anterior.',
    '3. Que contenga una cifra, una comparación o una afirmación contraintuitiva.',
    '4. Que caiga en beats con efectos de edición: ahí ya hay material gráfico.',
    'Campos:',
    '- title: el rótulo que se pinta arriba en el short, 6 palabras como mucho. No es el título del vídeo largo.',
    '- hook: por qué alguien dejaría de deslizar.',
    '- reason: para la persona que aprueba, en una frase.',
    '- score: 0-100, tu confianza en que funcione como pieza suelta.',
    'Sin exclamaciones. Sentence case.',
    'Devuelve JSON: { "candidates": [ { "start_beat_idx": number, "end_beat_idx": number, "title": string, "hook": string, "reason": string, "score": number } ] }.',
  ].join('\n');

  const excluidas = (params.excluir ?? []).map(
    (v) =>
      `${Math.round(v.from_ms / 1000)}-${Math.round(v.to_ms / 1000)} s` +
      (v.reason !== undefined && v.reason !== '' ? ` (${v.reason})` : ''),
  );

  const user = [
    `Título del vídeo: ${params.videoTitle}`,
    ...(params.hookNotes !== undefined && params.hookNotes !== ''
      ? [`Promesa del gancho: ${params.hookNotes}`]
      : []),
    ...(excluidas.length > 0
      ? [
          'Ventanas que NO debes proponer otra vez, con el motivo entre paréntesis',
          '(si el motivo señala un defecto, evita proponer otras con el mismo):',
          ...excluidas.map((e) => `- ${e}`),
        ]
      : []),
    '',
    'Beats (idx · duración · efectos · narración):',
    ...params.beats.map(
      (b) =>
        `${b.idx} · ${Math.round((b.to_ms - b.from_ms) / 1000)} s · ${b.edits} fx · ` +
        b.text.replace(/\s+/g, ' ').trim().slice(0, 200),
    ),
  ].join('\n');

  return { system, user };
}

const dur = (b: ShortDirectorBeat): number => b.to_ms - b.from_ms;

/** Lleva `t` a la frontera fuerte más cercana si hay alguna dentro de la tolerancia. */
function snap(t: number, fronteras: number[]): number {
  let mejor = t;
  let dist = SHORT_SNAP_MS + 1;
  for (const f of fronteras) {
    const d = Math.abs(f - t);
    if (d < dist) {
      dist = d;
      mejor = f;
    }
  }
  return dist <= SHORT_SNAP_MS ? mejor : t;
}

function solapan(a: Ventana, b: Ventana): number {
  const inicio = Math.max(a.from_ms, b.from_ms);
  const fin = Math.min(a.to_ms, b.to_ms);
  return Math.max(0, fin - inicio);
}

/**
 * Normaliza la salida del LLM a candidatos usables. Puro: se prueba sin LLM.
 *
 * Ajusta la duración estirando o encogiendo por beats enteros —nunca por
 * milisegundos sueltos, que es lo que rompería la garantía de frase—, descarta
 * lo que no cabe en la ventana permitida, ajusta los bordes a la frontera
 * fuerte más cercana y resuelve solapes por score.
 */
export function toCandidatos(
  raw: z.infer<typeof shortCandidatesSchema>['candidates'],
  beats: ShortDirectorBeat[],
  opts: { fronteras?: number[]; excluir?: Ventana[]; cuantos?: number } = {},
): Candidato[] {
  if (beats.length === 0) return [];
  const orden = [...beats].sort((a, b) => a.idx - b.idx);
  const posDe = new Map(orden.map((b, i) => [b.idx, i]));
  const fronteras = opts.fronteras ?? [];
  const cuantos = opts.cuantos ?? SHORTS_PER_VIDEO;
  const minMs = SHORT_MIN_S * 1000;
  const maxMs = SHORT_MAX_S * 1000;

  const vistos = new Set<number>();
  const candidatos: Candidato[] = [];

  for (const c of raw) {
    let ini = posDe.get(c.start_beat_idx);
    let fin = posDe.get(c.end_beat_idx);
    if (ini === undefined || fin === undefined) continue;
    if (fin < ini) continue;
    if (vistos.has(ini)) continue;

    let total = orden.slice(ini, fin + 1).reduce((acc, b) => acc + dur(b), 0);

    // corto: se estira por el final y, si no queda vídeo, por el principio
    while (total < minMs && (fin + 1 < orden.length || ini > 0)) {
      if (fin + 1 < orden.length && total + dur(orden[fin + 1]!) <= maxMs) {
        fin += 1;
        total += dur(orden[fin]!);
      } else if (ini > 0 && total + dur(orden[ini - 1]!) <= maxMs) {
        ini -= 1;
        total += dur(orden[ini]!);
      } else break;
    }
    // largo: se recorta por el final, que es donde menos duele
    while (total > maxMs && fin > ini) {
      total -= dur(orden[fin]!);
      fin -= 1;
    }
    if (total < minMs || total > maxMs) continue;

    const from = snap(orden[ini]!.from_ms, fronteras);
    const to = snap(orden[fin]!.to_ms, fronteras);
    if (to - from < minMs || to - from > maxMs) continue;

    const ventana = { from_ms: from, to_ms: to };
    // una ventana que el humano ya descartó no vuelve si la solapa a medias
    const yaDescartada = (opts.excluir ?? []).some(
      (v) => solapan(ventana, v) > 0.5 * (v.to_ms - v.from_ms),
    );
    if (yaDescartada) continue;

    vistos.add(ini);
    const trozo = orden.slice(ini, fin + 1);
    candidatos.push({
      ...ventana,
      start_beat_idx: trozo[0]!.idx,
      end_beat_idx: trozo[trozo.length - 1]!.idx,
      beat_idxs: trozo.map((b) => b.idx),
      title: c.title.trim(),
      hook: c.hook.trim(),
      reason: c.reason.trim(),
      score: c.score,
    });
  }

  // solapes entre candidatos: gana el de más score
  candidatos.sort((a, b) => b.score - a.score);
  const elegidos: Candidato[] = [];
  for (const c of candidatos) {
    const choca = elegidos.some(
      (e) => solapan(c, e) > 0.5 * Math.min(c.to_ms - c.from_ms, e.to_ms - e.from_ms),
    );
    if (!choca) elegidos.push(c);
    if (elegidos.length >= cuantos) break;
  }
  return elegidos;
}

/**
 * Sin LLM: un candidato desde el beat 0 hasta cubrir la duración objetivo. El
 * gancho del vídeo ya está escrito para enganchar, así que es la apuesta menos
 * mala. Nunca deja el job sin salida.
 */
export function fallbackShorts(beats: ShortDirectorBeat[], videoTitle: string): Candidato[] {
  const orden = [...beats].sort((a, b) => a.idx - b.idx);
  const objetivo = SHORT_TARGET_S * 1000;
  const maxMs = SHORT_MAX_S * 1000;
  const minMs = SHORT_MIN_S * 1000;

  let total = 0;
  const trozo: ShortDirectorBeat[] = [];
  for (const b of orden) {
    if (total >= objetivo || total + dur(b) > maxMs) break;
    trozo.push(b);
    total += dur(b);
  }
  if (trozo.length === 0 || total < minMs) return [];

  return [
    {
      from_ms: trozo[0]!.from_ms,
      to_ms: trozo[trozo.length - 1]!.to_ms,
      start_beat_idx: trozo[0]!.idx,
      end_beat_idx: trozo[trozo.length - 1]!.idx,
      beat_idxs: trozo.map((b) => b.idx),
      title: videoTitle.slice(0, 60),
      hook: 'El arranque del vídeo, que ya está escrito para enganchar',
      reason: 'Propuesta de reserva: el director no pudo elegir',
      score: 50,
    },
  ];
}

/** Cuenta los efectos de cada beat, para que el prompt sepa dónde hay material. */
export function efectosPorBeat(
  beats: Beat[],
  edits: { from_ms: number; to_ms: number }[],
): ShortDirectorBeat[] {
  return beats.map((b) => ({
    idx: b.idx,
    from_ms: b.from_ms,
    to_ms: b.to_ms,
    text: b.text,
    edits: edits.filter((e) => e.from_ms < b.to_ms && e.to_ms > b.from_ms).length,
  }));
}

export interface ResultadoDirector {
  candidatos: Candidato[];
  /**
   * Quién eligió de verdad. El fallback entraba en silencio por dos rutas
   * (fallo del LLM y normalización que no deja nada) y no había forma de saber
   * qué fracción de los shorts entregados eran la propuesta de reserva; ahora
   * se congela en `short_telemetry` del maestro.
   */
  source: 'llm' | 'fallback';
}

export async function directShorts(
  ctx: WorkerContext,
  params: ShortParams,
): Promise<ResultadoDirector> {
  if (params.beats.length === 0) return { candidatos: [], source: 'fallback' };
  const { system, user } = buildShortPrompt(params);
  try {
    const data = await ledgeredLlmJson(ctx, {
      videoId: params.videoId,
      channelId: params.channelId,
      op: 'shorts_director',
      system,
      user,
      schema: shortCandidatesSchema,
      mockContext: { beats: params.beats },
    });
    const candidatos = toCandidatos(data.candidates, params.beats, {
      fronteras: params.fronteras,
      ...(params.excluir !== undefined ? { excluir: params.excluir } : {}),
      ...(params.cuantos !== undefined ? { cuantos: params.cuantos } : {}),
    });
    // el modelo respondió pero nada sobrevivió a la normalización
    return candidatos.length > 0
      ? { candidatos, source: 'llm' }
      : { candidatos: fallbackShorts(params.beats, params.videoTitle), source: 'fallback' };
  } catch (err) {
    ctx.logger.warn(
      { err, videoId: params.videoId },
      'Director de shorts falló; se propone el arranque del vídeo',
    );
    return { candidatos: fallbackShorts(params.beats, params.videoTitle), source: 'fallback' };
  }
}
