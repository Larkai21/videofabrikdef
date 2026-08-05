import type React from 'react';
import type { Lienzo } from './lienzo';

// Cómo cabe un plano APAISADO en un lienzo vertical.
//
// La biblioteca guarda material a 1920 de ancho, así que en 1080×1920 hay que
// decidir. Un 16:9 con `cover` en 9:16 conserva (9/16)/(16/9) = 81/256 del
// área: se tira el 68,4 % del encuadre, y sin saber qué se tira. El sujeto de
// un plano de stock está encuadrado para 16:9 y el centro geométrico casi
// nunca es el centro de interés.
//
// La norma es recortar ANCLADO a un punto de foco. El defecto no es inventado:
// es el que usa el compositor del proyecto hermano, medido —«un 16:9 llevado a
// 9:16 por el centro geométrico corta media cara en cuanto el presentador no
// está clavado en el eje»—.
//
// Se rechaza el relleno desenfocado (el plano entero en una banda central con
// el mismo plano borroso de fondo): obliga a montar cada clip DOS veces, y este
// repositorio ya mató un render por decodificación —«Timeout (30000ms) exceeded
// rendering the component at frame 2597»— con un solo clip 4K.

/** Centro de interés por defecto, en fracciones del plano. */
export const FOCO_POR_DEFECTO = { x: 0.5, y: 0.42 } as const;

export type Encuadre = 'recorte' | 'cover' | 'entero';

export interface Foco {
  x: number;
  y: number;
}

export interface PlanEncuadre {
  /** estilo del elemento de medio */
  estilo: React.CSSProperties;
  /**
   * El plano no llena el lienzo y hay que vestir el hueco con la marca, en vez
   * de dejar barras negras o papilla desenfocada.
   */
  conLosa: boolean;
}

export function planDeEncuadre(
  encuadre: Encuadre | undefined,
  lienzo: Lienzo,
  foco: Foco = FOCO_POR_DEFECTO,
): PlanEncuadre {
  const base: React.CSSProperties = { width: '100%', height: '100%' };

  // en apaisado no hay nada que decidir: es el cover de siempre
  if (!lienzo.vertical) {
    return { estilo: { ...base, objectFit: 'cover' }, conLosa: false };
  }

  if (encuadre === 'entero') {
    // capturas y gráficos con texto: recortarlos los deja ilegibles, así que se
    // ven enteros en una banda y el hueco pasa a ser marca
    return { estilo: { ...base, objectFit: 'contain' }, conLosa: true };
  }

  if (encuadre === 'cover') {
    // el asset ya es vertical: gana el material
    return { estilo: { ...base, objectFit: 'cover' }, conLosa: false };
  }

  return {
    estilo: {
      ...base,
      objectFit: 'cover',
      objectPosition: `${(foco.x * 100).toFixed(1)}% ${(foco.y * 100).toFixed(1)}%`,
    },
    conLosa: false,
  };
}

export interface MovimientoKenBurns {
  /** ejes por los que se permite panear */
  direcciones: ReadonlyArray<readonly [number, number]>;
  /** amplitud del paneo, en % del elemento */
  paneo: number;
  /** cuánto zoom hace falta para tapar el paneo */
  zoom: number;
  /** deriva lateral de los CLIPS, que no llevan Ken Burns sino zoom lento */
  deriva: number;
}

/**
 * El Ken Burns cambia de eje en vertical, y es lo mejor que le pasa al formato.
 *
 * En apaisado el elemento se renderiza al tamaño del lienzo, así que panear
 * descubre bordes: por eso el paneo es del 2 % y va atado a un zoom de 1,08 que
 * lo tapa. En vertical, un 16:9 a `cover` sobre 1080×1920 se renderiza a
 * 3413×1920: sobran ±1166 px en horizontal —el 108 % del ancho de la ventana— y
 * cero en vertical.
 *
 * O sea: el paneo vertical desaparece, el horizontal puede ser un travelling de
 * verdad sin descubrir nada, y el zoom ya no hace falta para taparlo. Baja a
 * 1,04 porque a 1,08 sobre un recorte que ya amplía 1,78x empieza a verse el
 * pixelado del origen 1080p.
 */
export function movimientoDe(lienzo: Lienzo, conLosa: boolean): MovimientoKenBurns {
  if (!lienzo.vertical || conLosa) {
    return {
      direcciones: [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ],
      paneo: 2,
      zoom: 0.08,
      // en apaisado un clip no tiene holgura lateral: derivar descubriría borde
      deriva: 0,
    };
  }
  return {
    // solo horizontal: en vertical no hay holgura por arriba ni por abajo
    direcciones: [
      [1, 0],
      [-1, 0],
    ],
    paneo: 12,
    zoom: 0.04,
    deriva: 6,
  };
}
