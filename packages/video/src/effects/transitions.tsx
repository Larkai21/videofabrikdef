import React from 'react';
import { AbsoluteFill } from 'remotion';
import type {
  TransitionPresentation,
  TransitionPresentationComponentProps,
} from '@remotion/transitions';
import { Ease } from './motion';

// Transiciones de sección propias por clip-path (adaptadas de editor-youtube
// transicion.html:54-117). Puras: solo dependen de presentationProgress, que
// deriva del frame → deterministas. Se aplica el recorte a la escena ENTRANTE
// (revelándola sobre la saliente); la saliente se deja intacta debajo.

type Empty = Record<string, never>;

function makePresentation(
  clipEntering: (p: number) => string,
): () => TransitionPresentation<Empty> {
  const Component: React.FC<TransitionPresentationComponentProps<Empty>> = ({
    children,
    presentationProgress,
    presentationDirection,
  }) => {
    if (presentationDirection === 'exiting') {
      return <AbsoluteFill>{children}</AbsoluteFill>;
    }
    const p = Ease.inOutCubic(presentationProgress);
    return <AbsoluteFill style={{ clipPath: clipEntering(p) }}>{children}</AbsoluteFill>;
  };
  return () => ({ component: Component, props: {} });
}

// iris: un círculo de acento que crece desde el centro y traga la escena nueva.
// 78% cubre las esquinas de un 16:9 con margen.
export const iris = makePresentation((p) => `circle(${(p * 78).toFixed(1)}% at 50% 50%)`);

// barrido: borde diagonal que barre de izquierda a derecha.
export const barrido = makePresentation(
  (p) => `polygon(0 0, ${(p * 140).toFixed(1)}% 0, ${(p * 140 - 40).toFixed(1)}% 100%, 0 100%)`,
);

// cortina: se abre desde el centro hacia los lados.
export const cortina = makePresentation((p) => `inset(0 ${((1 - p) * 50).toFixed(1)}% 0 ${((1 - p) * 50).toFixed(1)}%)`);

export const SECTION_TRANSITIONS = [iris, barrido, cortina] as const;
