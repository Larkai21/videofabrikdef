import type { Lienzo } from './lienzo';

// Las diferencias entre el vídeo largo y el short vertical, en una TABLA.
//
// No van como `if (lienzo.vertical)` repartidos por la composición: dos ramas
// dispersas por un árbol de once capas divergen a la segunda revisión, que es
// exactamente el motivo por el que aquí hay un solo componente y no dos. La
// regla de revisión es sencilla: cualquier comprobación de orientación fuera de
// `perfilDe` es un fallo.

export interface Perfil {
  /** tema de subtítulos cuando la marca no declara ninguno */
  temaSubtitulosPorDefecto: string;
  /**
   * Reparto de transiciones entre planos, en décimas. En el largo el corte es
   * el lenguaje y la transición el acento; en vertical hay cinco veces más
   * cortes, así que el acento tiene que ser aún más raro o se lee a plantilla.
   */
  transiciones: { dura: number; fundido: number; slide: number };
  /**
   * La plataforma pinta su propio scrubber sobre el short: dos barras de
   * progreso son peor que ninguna.
   */
  progreso: boolean;
}

const LARGO: Perfil = {
  temaSubtitulosPorDefecto: 'subtitulos-basicos@0.1.0',
  // el reparto que computeBrollTrack ya venía aplicando
  transiciones: { dura: 6, fundido: 3, slide: 1 },
  progreso: true,
};

const VERTICAL: Perfil = {
  temaSubtitulosPorDefecto: 'subtitulos-cineticos@0.1.0',
  // a 1,2-2,5 s por plano, un crossfade de 6 frames se come el 15 % del plano
  transiciones: { dura: 9, fundido: 1, slide: 0 },
  progreso: false,
};

export function perfilDe(lienzo: Lienzo): Perfil {
  return lienzo.vertical ? VERTICAL : LARGO;
}
