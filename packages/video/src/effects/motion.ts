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

function outBackCon(t: number, s: number): number {
  const p = t - 1;
  return p * p * ((s + 1) * p + s) + 1;
}

// Curvas de interpolación. `outBack`/`outElastic` dan el rebote/overshoot que
// hace que las entradas se sientan "editadas" y no planas.
export const Ease: Record<
  | 'linear'
  | 'inCubic'
  | 'outCubic'
  | 'inOutCubic'
  | 'outExpo'
  | 'outBack'
  | 'outBack6'
  | 'outElastic',
  EasingFn
> = {
  linear: (t) => t,
  // Arranca quieto y acelera. FALTABA, y es el mismo agujero que el repo de
  // origen documenta: como `span` cae a LINEAL cuando la curva es undefined,
  // dos de sus plantillas decían en su comentario que aceleraban mientras no
  // aceleraban nada. El código decía una cosa y el vídeo hacía otra.
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  // Rebote suave: entra pasándose y se asienta. OJO: con el `s` clásico se pasa
  // un 10 %, y la guía de marca del catálogo de origen fija el tope en el 6 %.
  // Se conserva porque hay temas del brand kit que ya la usan, pero para
  // efectos nuevos va `outBack6`.
  outBack: (t) => outBackCon(t, 1.70158),
  /**
   * `outBack` con el sobrepaso CALIBRADO al 6 %.
   *
   * El valor sale de resolver max(f(t)) = 1,06 numéricamente, no de probar a
   * ojo, y `motion.test.ts` lo vuelve a resolver en cada pasada para que no se
   * quede viejo si alguien toca la fórmula.
   */
  outBack6: (t) => outBackCon(t, 1.2827),
  /**
   * @deprecated Golpe elástico. El catálogo de origen lo PROHÍBE en su primera
   * regla («nada de rebotes elásticos») y su propia prueba falla si alguna
   * plantilla lo invoca. Aquí no lo usa nadie —comprobado— y se conserva sin
   * borrarlo para no romper un tema de terceros que lo importara.
   */
  outElastic: (t) => {
    if (t === 0 || t === 1) return t;
    const p = 0.38;
    return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1;
  },
};

// Progreso 0..1 de un tramo [inicio, inicio+dur] en el instante t, con easing.
// Fuera del tramo clampa a 0 (antes) o 1 (después).
export function span(
  t: number,
  inicio: number,
  dur: number,
  easing: EasingFn = Ease.linear,
): number {
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

export interface Ciclo {
  /** progreso de entrada, 0..1 */
  e: number;
  /** progreso de salida, 0..1 */
  s: number;
  /** visibilidad combinada: e · (1 − s) */
  v: number;
}

/**
 * El ciclo de vida de un overlay en una llamada: entra, se queda, sale.
 *
 * Portado de `Engine.ciclo` del catálogo de motion graphics. Aquí lo hacía a
 * mano cada efecto —un `span` de entrada y otro de salida en cada componente—,
 * que es de donde salen las divergencias: cada uno con su duración y su curva,
 * y ninguna forma de cambiar el ritmo de todos a la vez.
 */
export function ciclo(
  t: number,
  dur: number,
  entrada: number,
  salida: number,
  opts: { entra?: EasingFn; sale?: EasingFn } = {},
): Ciclo {
  const e = span(t, 0, entrada, opts.entra ?? Ease.outCubic);
  const s = salida > 0 ? span(t, dur - salida, salida, opts.sale ?? Ease.inCubic) : 0;
  return { e, s, v: e * (1 - s) };
}

/**
 * Deriva lenta entre la entrada y la salida: el movimiento que mantiene vivo un
 * overlay quieto sin pedir atención. Portado de `Engine.reposo`.
 */
export function reposo(
  t: number,
  entrada: number,
  fin: number,
  salida: number,
  easing: EasingFn = Ease.inOutCubic,
): number {
  const largo = Math.max(0.05, fin - salida - entrada);
  return span(t, entrada, largo, easing);
}
