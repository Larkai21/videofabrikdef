import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign, type DesignTokens } from '@fabrica/shared';
import { FONT_FAMILY } from '../fonts';
import { glassSurface } from '../effects';
import { Ease, mix, span } from '../effects/motion';
import { WordsReveal, overlayWindows } from './shared';

// Tarjeta de sección integrada 'titulo-seccion@0.1.0' (contrato
// titleCardPropsSchema). SUPERPOSICIÓN centrada sobre el b-roll al entrar cada
// segmento; sin fondo opaco, deja ver el vídeo debajo.
//
// REESCRITA EN SITIO (mismo ref).
//
// Dos detalles que la separan de una tarjeta genérica: la SALIDA en espejo del
// wipe de entrada (antes se cortaba en seco al acabar la Sequence, que es lo
// que más se nota) y una micro-deriva de ±2 px durante el sostenimiento — una
// tarjeta perfectamente quieta sobre b-roll en movimiento canta mucho.
//
// brand-kit.ts recorta esta tarjeta a min(90, hueco, fin del cuerpo) y puede
// dejarla en 20 frames: overlayWindows escala entrada y salida para que no se
// solapen y la pieza siempre llegue a opacidad plena.

export type TitleCardProps = {
  title: string;
  fromFrame: number;
  design?: DesignTokens;
};

export const TituloSeccion: React.FC<TitleCardProps> = ({ title, design }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const d = design ?? defaultDesign();
  const { enterF, exitF } = overlayWindows(durationInFrames, 12, 14);

  const entra = span(frame, 0, enterF, Ease.outExpo);
  const sale = span(frame, durationInFrames - exitF, exitF, Ease.inOutCubic);
  // wipe de revelado izquierda→derecha; al salir barre hacia la derecha
  const clip = sale > 0 ? `inset(0 0 0 ${sale * 100}%)` : `inset(0 ${(1 - entra) * 100}% 0 0)`;

  const espina = span(frame, 2, 12, Ease.outCubic);
  const regla = span(frame, 6, 16, Ease.outBack);
  const deriva = Math.sin(frame / 34) * 2;

  if (title.trim() === '') return null;

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: FONT_FAMILY,
        pointerEvents: 'none',
        // no pisar los subtítulos, anclados abajo
        paddingBottom: 160,
      }}
    >
      <div
        style={{
          opacity: 1 - sale,
          clipPath: clip,
          transform: `translateY(${deriva - sale * 14}px) scaleY(${mix(0.88, 1, entra)})`,
          display: 'flex',
          alignItems: 'stretch',
          borderRadius: 16,
          overflow: 'hidden',
          maxWidth: 1200,
          ...glassSurface(d),
        }}
      >
        {/* espina de acento que crece desde arriba */}
        <div
          style={{
            width: 5,
            flex: 'none',
            background: d.accent,
            transformOrigin: 'top',
            transform: `scaleY(${espina})`,
          }}
        />
        <div
          style={{
            padding: '28px 48px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 14,
          }}
        >
          <div
            style={{
              width: mix(0, 260, Math.min(regla, 1.15)),
              height: 4,
              borderRadius: 2,
              background: d.accent,
            }}
          />
          <WordsReveal
            text={title}
            from={8}
            stagger={3}
            fontSize={68}
            weight={800}
            color={d.foreground}
            align="left"
            shadow
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
