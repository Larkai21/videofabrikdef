import { Ease, mix, span } from './motion';

// Zoom punch-in determinista para b-roll: entra con un leve overshoot (outBack)
// hasta 1+amount y se asienta en un zoom sostenido leve. Se aplica DENTRO de
// BeatVisual como escala extra sobre el Ken Burns/ClipMotion del beat, en el
// frame local donde el director marcó el énfasis. Pura (solo aritmética de
// frames y curvas del kit) → determinista. `span` es agnóstico de unidad, así
// que aquí `t` son frames locales.

export function punchScale(localFrame: number, amount = 0.12): number {
  if (localFrame < 0) return 1;
  const RISE = 10;
  const SETTLE = 16;
  if (localFrame <= RISE) {
    // outBack se pasa un poco de 1+amount a mitad de entrada: ese rebasar es el
    // "punch" que se nota; en RISE aterriza exactamente en 1+amount.
    return mix(1, 1 + amount, span(localFrame, 0, RISE, Ease.outBack));
  }
  return mix(1 + amount, 1.03, span(localFrame, RISE, SETTLE, Ease.outCubic));
}
