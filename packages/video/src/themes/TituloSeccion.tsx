import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign, hexToRgba, type DesignTokens } from '@fabrica/shared';
import { FONT_FAMILY } from '../fonts';

// Tarjeta de sección integrada 'titulo-seccion@0.1.0' (contrato
// titleCardPropsSchema en packages/shared/src/component-manifest.ts). Es una
// SUPERPOSICIÓN centrada: aparece unos segundos al entrar cada segmento con el
// título del subtema, sobre el b-roll. Determinismo (docs/render.md §4): solo
// useCurrentFrame, fuente empaquetada, sin fondo opaco (deja ver el vídeo).

export type TitleCardProps = {
  title: string;
  fromFrame: number;
  design?: DesignTokens;
};

export const TituloSeccion: React.FC<TitleCardProps> = ({ title, design }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const d = design ?? defaultDesign();
  if (title.trim() === '') return null;

  const appear = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const exit = interpolate(frame, [Math.max(1, durationInFrames - 14), durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(appear, exit);
  // entra subiendo y creciendo levemente
  const translateY = interpolate(appear, [0, 1], [18, 0]);
  const scale = interpolate(appear, [0, 1], [0.96, 1]);
  // la línea inferior crece con la aparición, como acento de marca
  const barWidth = interpolate(appear, [0, 1], [0, 180]);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: FONT_FAMILY,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px) scale(${scale})`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          padding: '28px 48px',
          borderRadius: 16,
          background: hexToRgba(d.background, 0.62),
          backdropFilter: 'blur(6px)',
          boxShadow: '0 18px 60px rgba(0, 0, 0, 0.45)',
          maxWidth: 1200,
        }}
      >
        <div
          style={{
            fontSize: 68,
            fontWeight: 700,
            color: d.foreground,
            letterSpacing: 0.3,
            textAlign: 'center',
            lineHeight: 1.1,
            textShadow: '0 3px 16px rgba(0, 0, 0, 0.6)',
          }}
        >
          {title}
        </div>
        <div style={{ width: barWidth, height: 5, borderRadius: 3, background: d.accent }} />
      </div>
    </AbsoluteFill>
  );
};
