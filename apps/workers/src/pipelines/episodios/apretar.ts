import type { BeatToken } from '../tts/beats.js';

// Apretado del clip: fuera los silencios muertos. Es lo que hace el editor de
// referencia a mano (está narrado en el tutorial diseccionado) y la mitad de
// por qué sus clips se sienten dinámicos: nadie espera a que el hablante
// respire dos segundos.
//
// Receta del proyecto hermano (clean_transcript.py), con su lección de RELOJ
// aprendida a sangre: los `keeps` son el ÚNICO registro de la traducción
// origen→salida. Todo lo demás (tokens, cues, beats) vive en el reloj de
// ORIGEN hasta que remapear() lo traduce; guardar las dos representaciones
// del mismo hecho fue la causa raíz de gráficos derivando 8 s en el hermano.
//
// Solo silencios en v1. Las tomas falsas por Levenshtein (la otra pasada del
// hermano) casi no existen en entrevistas — son de grabación en solitario —
// y quedan anotadas como v2.

export interface Keep {
  src_from_ms: number;
  src_to_ms: number;
  out_from_ms: number;
  out_to_ms: number;
}

/** Hueco entre palabras a partir del cual se rebana. */
export const APRETAR_SILENCIO_MS = 480;
/** Colchón a cada lado del corte: ni la respiración ni el ataque de sílaba. */
export const APRETAR_COLCHON_MS = 120;

/**
 * Tramos que SE QUEDAN dentro de la ventana [fromMs, toMs] del reloj de
 * origen, con su posición en el reloj de salida. Puro y determinista.
 */
export function calcularKeeps(
  tokens: readonly BeatToken[],
  fromMs: number,
  toMs: number,
  opts: { silencioMs?: number; colchonMs?: number } = {},
): Keep[] {
  const silencio = opts.silencioMs ?? APRETAR_SILENCIO_MS;
  const colchon = opts.colchonMs ?? APRETAR_COLCHON_MS;
  const dentro = tokens
    .filter((t) => t.from_ms >= fromMs && t.to_ms <= toMs)
    .sort((a, b) => a.from_ms - b.from_ms);
  if (dentro.length === 0) {
    return [{ src_from_ms: fromMs, src_to_ms: toMs, out_from_ms: 0, out_to_ms: toMs - fromMs }];
  }

  // cortes de silencio: huecos entre palabras consecutivas mayores que el
  // umbral; el keep termina colchón después de la palabra y el siguiente
  // empieza colchón antes de la próxima
  const bordes: { from: number; to: number }[] = [];
  let ini = Math.max(fromMs, dentro[0]!.from_ms - colchon);
  for (let i = 0; i < dentro.length - 1; i += 1) {
    const gap = dentro[i + 1]!.from_ms - dentro[i]!.to_ms;
    if (gap > silencio + 2 * colchon) {
      bordes.push({ from: ini, to: dentro[i]!.to_ms + colchon });
      ini = dentro[i + 1]!.from_ms - colchon;
    }
  }
  bordes.push({ from: ini, to: Math.min(toMs, dentro[dentro.length - 1]!.to_ms + colchon) });

  let out = 0;
  return bordes.map((b) => {
    const keep: Keep = {
      src_from_ms: b.from,
      src_to_ms: b.to,
      out_from_ms: out,
      out_to_ms: out + (b.to - b.from),
    };
    out = keep.out_to_ms;
    return keep;
  });
}

/** Traduce un instante del reloj de ORIGEN al de salida; null si se cortó. */
export function remapear(ms: number, keeps: readonly Keep[]): number | null {
  for (const k of keeps) {
    if (ms >= k.src_from_ms && ms <= k.src_to_ms) {
      return k.out_from_ms + (ms - k.src_from_ms);
    }
  }
  return null;
}

/** Tokens de la ventana traducidos al reloj de salida (los cortados se caen). */
export function remapearTokens(tokens: readonly BeatToken[], keeps: readonly Keep[]): BeatToken[] {
  const out: BeatToken[] = [];
  for (const t of tokens) {
    const from = remapear(t.from_ms, keeps);
    const to = remapear(t.to_ms, keeps);
    if (from === null || to === null) continue;
    out.push({ ...t, from_ms: from, to_ms: to });
  }
  return out;
}
