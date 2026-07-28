import { interpolate } from 'remotion';

// Zoom punch-in determinista para b-roll: sube rápido a 1+amount en ~8 frames y
// se asienta en un leve zoom sostenido. Se aplica DENTRO de BeatVisual como
// escala extra sobre el Ken Burns/ClipMotion del beat, en el frame local donde
// el director marcó el énfasis. Pura (solo aritmética de frames) → determinista.

export function punchScale(localFrame: number, amount = 0.12): number {
  if (localFrame < 0) return 1;
  const up = interpolate(localFrame, [0, 8], [1, 1 + amount], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const settle = interpolate(localFrame, [8, 22], [1 + amount, 1.03], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return localFrame < 8 ? up : settle;
}
