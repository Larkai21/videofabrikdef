import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign, hexToRgba, type DesignTokens } from '@fabrica/shared';
import { FONT_FAMILY } from '../fonts';

// Tarjeta de sección integrada 'titulo-seccion@0.1.0' (contrato
// titleCardPropsSchema). SUPERPOSICIÓN centrada sobre el b-roll al entrar cada
// segmento. Entrada con WIPE de izquierda a derecha + spring; barra de acento
// que crece; salida limpia. Determinismo: solo useCurrentFrame/spring, sin fondo
// opaco (deja ver el vídeo debajo).

export type TitleCardProps = {
  title: string;
  fromFrame: number;
  design?: DesignTokens;
};

export const TituloSeccion: React.FC<TitleCardProps> = ({ title, design }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const d = design ?? defaultDesign();
  if (title.trim() === '') return null;

  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 130, mass: 0.6 } });
  const exit = interpolate(frame, [durationInFrames - 14, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(enter, exit);
  const rise = (1 - enter) * 16;
  // wipe de revelado izquierda→derecha (inset por la derecha que se abre)
  const wipe = interpolate(enter, [0, 1], [100, 0]);
  const barWidth = interpolate(enter, [0, 1], [0, 200]);

  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', alignItems: 'center', fontFamily: FONT_FAMILY, pointerEvents: 'none' }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${rise}px)`,
          clipPath: `inset(0 ${wipe}% 0 0)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          padding: '28px 48px',
          borderRadius: 16,
          background: hexToRgba(d.background, 0.66),
          backdropFilter: 'blur(6px)',
          boxShadow: `0 18px 60px rgba(0, 0, 0, 0.45)`,
          borderLeft: `5px solid ${d.accent}`,
          maxWidth: 1200,
        }}
      >
        <div
          style={{
            fontSize: 68,
            fontWeight: 800,
            color: d.foreground,
            letterSpacing: '-0.01em',
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
