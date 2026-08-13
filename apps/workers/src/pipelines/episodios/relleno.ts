import { z } from 'zod';
import type { WorkerContext } from '../../lib/context.js';
import { registerMockOp } from '../../providers/llm.js';
import type { BeatToken } from '../tts/beats.js';
import { ledgeredLlmJson } from '../ideas/llm-call.js';

// Corte SEMÁNTICO de relleno: el apretado acústico quita silencios, pero el
// editor de la referencia también corta FRASES — muletillas largas, falsos
// comienzos, digresiones que no aportan. Aquí lo marca un LLM y lo corta el
// mismo mecanismo de keeps (silencio sintético, apretar.ts).
//
// El LLM devuelve ÍNDICES de frase, nunca tiempos: los tiempos salen de los
// tokens por construcción y una alucinación de milisegundos no puede partir
// una palabra. Guardas deterministas encima: ni la primera ni la última
// frase (el gancho y el cierre no se tocan), y un techo de recorte — esto es
// un pulido, no un segundo director.

export interface Frase {
  idx: number;
  from_ms: number;
  to_ms: number;
  texto: string;
}

/** Techo de recorte semántico sobre la duración de la ventana. */
export const RELLENO_MAX_PCT = 0.25;
/** Con menos frases que esto no hay relleno que valga: ni se llama al LLM. */
export const RELLENO_MIN_FRASES = 5;

export const rellenoSchema = z.object({
  /** índices de las frases prescindibles (0-based, los del listado) */
  quitar: z.array(z.number().int().nonnegative()).max(12),
});

// en mock el corte semántico es un no-op limpio (sin warn): el pipeline
// entero corre sin claves, mismo criterio que el resto de generadores
registerMockOp('clips_relleno', () => ({ quitar: [] }));

/** Tokens → frases usando las fronteras que el STT ya marcó (sentenceEnd). */
export function frasesDe(tokens: readonly BeatToken[]): Frase[] {
  const frases: Frase[] = [];
  let actual: BeatToken[] = [];
  for (const t of tokens) {
    actual.push(t);
    if (t.sentenceEnd) {
      frases.push({
        idx: frases.length,
        from_ms: actual[0]!.from_ms,
        to_ms: t.to_ms,
        texto: actual.map((x) => x.raw).join(' '),
      });
      actual = [];
    }
  }
  if (actual.length > 0) {
    frases.push({
      idx: frases.length,
      from_ms: actual[0]!.from_ms,
      to_ms: actual[actual.length - 1]!.to_ms,
      texto: actual.map((x) => x.raw).join(' '),
    });
  }
  return frases;
}

/**
 * Guardas deterministas sobre lo que el LLM pidió quitar: fuera índices
 * inválidos, la primera y la última frase, y lo que exceda el techo (se
 * respetan las peticiones en orden de llegada hasta llenarlo).
 */
export function filtrarQuitar(
  frases: readonly Frase[],
  idxs: readonly number[],
  maxPct: number = RELLENO_MAX_PCT,
): Frase[] {
  const durVentana = frases.length
    ? frases[frases.length - 1]!.to_ms - frases[0]!.from_ms
    : 0;
  const tope = durVentana * maxPct;
  const vistas = new Set<number>();
  const salida: Frase[] = [];
  let quitado = 0;
  for (const idx of idxs) {
    if (idx <= 0 || idx >= frases.length - 1 || vistas.has(idx)) continue;
    const f = frases[idx]!;
    if (quitado + (f.to_ms - f.from_ms) > tope) continue;
    vistas.add(idx);
    salida.push(f);
    quitado += f.to_ms - f.from_ms;
  }
  return salida.sort((a, b) => a.from_ms - b.from_ms);
}

function buildPrompt(frases: readonly Frase[]): { system: string; user: string } {
  const system = [
    'Eres el editor de un canal de clips de podcast. Te doy las frases de un',
    'clip numeradas. Marca SOLO las prescindibles: muletillas largas, falsos',
    'comienzos, digresiones que no aportan al argumento del clip. Quitar una',
    'frase no puede romper la gramática del discurso: si la siguiente frase',
    'depende de ella, no la marques. La primera y la última frase NUNCA se',
    'marcan (son el gancho y el cierre). Si no hay relleno claro, devuelve la',
    'lista vacía: cortar de menos es gratis, cortar de más rompe el clip.',
  ].join(' ');
  const user = frases
    .map((f) => `${f.idx}. [${(f.from_ms / 1000).toFixed(1)}s] ${f.texto}`)
    .join('\n');
  return { system, user };
}

/**
 * Rangos de relleno a quitar de la ventana [fromMs, toMs]. Ante cualquier
 * fallo devuelve [] — el clip sale igual, solo menos apretado, y el plan de
 * keeps lo delata (mismo criterio de degradación que el plan de encuadre).
 */
export async function marcarRelleno(
  ctx: WorkerContext,
  params: {
    episodeId: string;
    channelId: string;
    shortId: string;
    tokens: readonly BeatToken[];
  },
): Promise<{ from_ms: number; to_ms: number }[]> {
  const frases = frasesDe(params.tokens);
  if (frases.length < RELLENO_MIN_FRASES) return [];
  try {
    const { system, user } = buildPrompt(frases);
    const data = await ledgeredLlmJson(ctx, {
      episodeId: params.episodeId,
      channelId: params.channelId,
      op: 'clips_relleno',
      system,
      user,
      schema: rellenoSchema,
      // el mock no marca nada: en tests el corte semántico es un no-op
      mockContext: { frases: frases.length },
      meta: { short_id: params.shortId },
    });
    return filtrarQuitar(frases, data.quitar).map((f) => ({
      from_ms: f.from_ms,
      to_ms: f.to_ms,
    }));
  } catch (err) {
    ctx.logger.warn(
      { err, episodeId: params.episodeId },
      'El director de relleno falló; el clip sale sin corte semántico',
    );
    return [];
  }
}
