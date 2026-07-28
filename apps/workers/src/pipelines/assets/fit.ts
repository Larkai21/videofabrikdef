// Encaje (fit) calculado, nunca manual (docs/assets-y-biblioteca.md §4).
// `loops` cuenta reproducciones totales del clip; con crossfade de
// LOOP_CROSSFADE_MS entre repeticiones, n reproducciones cubren
// n·len − (n−1)·crossfade ms. Lógica pura.

import { LOOP_CROSSFADE_MS, MAX_LOOPS, MIN_PLAYBACK_RATE, type Fit } from '@fabrica/shared';

export interface FitInput {
  kind: 'clip' | 'image';
  assetDurationMs: number | null;
  beatDurationMs: number;
}

export interface FitResult {
  fit: Fit;
}

// null = el candidato no cubre el beat ni con MAX_LOOPS loops → se descarta.
// clampLoops=true (ingesta): nunca descartar, dejar el máximo de loops.
export function computeFit(input: FitInput, opts: { clampLoops?: boolean } = {}): FitResult | null {
  if (input.kind === 'image') {
    return { fit: { mode: 'kenburns' } };
  }

  const len = input.assetDurationMs ?? 0;
  const beat = input.beatDurationMs;

  if (len <= 0) {
    return opts.clampLoops ? { fit: { mode: 'kenburns' } } : null;
  }

  if (len >= beat) {
    return { fit: { mode: 'trim', offset_ms: Math.floor((len - beat) / 2) } };
  }

  // Clip algo más corto que el beat: una sola pasada ralentizada lo llena sin
  // reiniciar, mientras la ralentización no baje de MIN_PLAYBACK_RATE (si no,
  // se notaría como cámara lenta). playback_rate = len/beat < 1.
  const rate = len / beat;
  if (rate >= MIN_PLAYBACK_RATE) {
    return { fit: { mode: 'stretch', playback_rate: rate, offset_ms: 0 } };
  }

  // Demasiado corto para estirar: bucle con crossfade (último recurso).
  for (let n = 2; n <= MAX_LOOPS; n++) {
    const covered = n * len - (n - 1) * LOOP_CROSSFADE_MS;
    if (covered >= beat) {
      return { fit: { mode: 'loop', loops: n } };
    }
  }

  return opts.clampLoops ? { fit: { mode: 'loop', loops: MAX_LOOPS } } : null;
}

// Dirección de Ken Burns derivada de la semilla: reproducible entre renders.
const KENBURNS_DIRECTIONS = [
  'kenburns-in-left',
  'kenburns-in-right',
  'kenburns-out-left',
  'kenburns-out-right',
] as const;

export function kenburnsEffect(seed: number): string {
  return KENBURNS_DIRECTIONS[seed % KENBURNS_DIRECTIONS.length] ?? 'kenburns-in-left';
}
