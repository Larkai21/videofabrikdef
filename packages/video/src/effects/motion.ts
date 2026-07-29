// Kit de movimiento — curvas de easing y helpers de tiempo, portados del motor
// determinista de editor-youtube (templates/_engine.js:23-70). Filosofía idéntica
// a la de este repo: el tiempo es un PARÁMETRO, no un reloj (mismo t → mismo
// píxel). Aquí `t` va en SEGUNDOS y se deriva de useCurrentFrame()/fps.
//
// Todo es matemática pura y determinista: `noise` usa un hash con Math.sin (no
// Math.random), así que cumple el eslint de determinismo del paquete.

export type EasingFn = (t: number) => number;

export function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

// Interpolación lineal a..b según p (0..1).
export function mix(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

// Curvas de interpolación. `outBack`/`outElastic` dan el rebote/overshoot que
// hace que las entradas se sientan "editadas" y no planas.
export const Ease: Record<
  'linear' | 'outCubic' | 'inOutCubic' | 'outExpo' | 'outBack' | 'outElastic',
  EasingFn
> = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  // rebote suave: entra pasándose y se asienta
  outBack: (t) => {
    const s = 1.70158;
    const p = t - 1;
    return p * p * ((s + 1) * p + s) + 1;
  },
  // golpe elástico corto, para los "pop" de entrada
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    const p = 0.38;
    return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1;
  },
};

// Progreso 0..1 de un tramo [inicio, inicio+dur] en el instante t, con easing.
// Fuera del tramo clampa a 0 (antes) o 1 (después).
export function span(t: number, inicio: number, dur: number, easing: EasingFn = Ease.linear): number {
  if (dur <= 0) return t >= inicio ? 1 : 0;
  const p = clamp((t - inicio) / dur, 0, 1);
  return easing(p);
}

// Entrada + salida en una sola llamada: 0..1..0 dentro de [inicio, fin], con
// rampas `subida` y `bajada`. Fuera del intervalo devuelve 0.
export function pulse(
  t: number,
  inicio: number,
  fin: number,
  subida: number,
  bajada: number,
  easing: EasingFn = Ease.outCubic,
): number {
  if (t < inicio || t > fin) return 0;
  const dIn = span(t, inicio, subida, easing);
  const dOut = 1 - span(t, fin - bajada, bajada, easing);
  return Math.min(dIn, dOut);
}

// Ruido determinista: mismo índice/semilla → mismo valor (0..1). Nada de
// Math.random, que rompería la reproducibilidad frame a frame.
export function noise(i: number, semilla = 0): number {
  const x = Math.sin((i + 1) * 127.1 + semilla * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Máquina de escribir: subcadena visible de `texto` en el instante t (cps =
// caracteres por segundo).
export function typed(texto: string, t: number, inicio: number, cps = 28): string {
  if (t < inicio) return '';
  const n = Math.floor((t - inicio) * cps);
  return texto.slice(0, clamp(n, 0, texto.length));
}
