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
export const cortina = makePresentation(
  (p) => `inset(0 ${((1 - p) * 50).toFixed(1)}% 0 ${((1 - p) * 50).toFixed(1)}%)`,
);

export const SECTION_TRANSITIONS = [iris, barrido, cortina] as const;

/**
 * Whip-pan: las dos escenas barren lateralmente y el desenfoque de movimiento
 * tapa el cambio. Es la transición marcada del formato vertical.
 *
 * Portada de `whip-pan` de HyperFrames, pero NO su implementación: la suya
 * reconstruye el DOM en un canvas 2D dibujando cajas y texto elemento a
 * elemento para poder texturizarlo con WebGL, y por el camino pierde radios,
 * sombras, imágenes y máscaras. Aquí se hace con `translateX` y `blur`, que es
 * la misma coreografía y no pierde nada.
 *
 * El desenfoque va ligado a la VELOCIDAD, no al progreso: acelera al arrancar,
 * llega a su máximo a mitad del barrido y se apaga al aterrizar, que es lo que
 * lo hace leer como un latigazo y no como un deslizamiento borroso. La derivada
 * de inOutCubic es una parábola, así que basta con `4·p·(1-p)`.
 *
 * `inset` de 1,5·blur en la capa desenfocada: sin ese desbordamiento el blur
 * descubre un canto translúcido en el borde del lienzo. Es el mismo detalle que
 * el catálogo de origen documenta en su relleno vertical.
 */
const WHIP_BLUR_MAX = 26;

export function whip(
  direccion: 'izquierda' | 'derecha' = 'izquierda',
): TransitionPresentation<Empty> {
  const signo = direccion === 'izquierda' ? -1 : 1;
  const Component: React.FC<TransitionPresentationComponentProps<Empty>> = ({
    children,
    presentationProgress,
    presentationDirection,
  }) => {
    const p = Ease.inOutCubic(presentationProgress);
    // velocidad normalizada: 0 en los extremos, 1 en el centro del barrido
    const velocidad = 4 * p * (1 - p);
    const blur = WHIP_BLUR_MAX * velocidad;
    const desbordamiento = -Math.ceil(blur * 1.5) - 2;
    const x = presentationDirection === 'exiting' ? p * 100 * signo : (p - 1) * 100 * signo;
    return (
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <AbsoluteFill
          style={{
            inset: desbordamiento,
            transform: `translateX(${x.toFixed(2)}%)`,
            filter: blur > 0.2 ? `blur(${blur.toFixed(1)}px)` : undefined,
          }}
        >
          {children}
        </AbsoluteFill>
      </AbsoluteFill>
    );
  };
  return { component: Component, props: {} };
}
