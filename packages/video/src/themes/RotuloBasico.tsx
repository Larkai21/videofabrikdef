import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign, hexToRgba, type DesignTokens } from '@fabrica/shared';
import { FONT_FAMILY } from '../fonts';

// Rótulo inferior integrado 'rotulo-basico@0.1.0' (contrato lowerThirdPropsSchema).
// Banda inferior-izquierda que entra deslizando desde la izquierda con acento;
// muestra el título y, opcional, un subtítulo (nombre del canal). Determinismo:
// solo useCurrentFrame/spring, sin fondo a pantalla completa (pointerEvents none).

export type LowerThirdProps = {
  title: string;
  subtitle?: string;
  fromFrame: number;
  design?: DesignTokens;
};

export const RotuloBasico: React.FC<LowerThirdProps> = ({ title, subtitle, design }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const d = design ?? defaultDesign();
  if (title.trim() === '') return null;

  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 130, mass: 0.7 } });
  const exit = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(enter, exit);
  const slide = (1 - enter) * -60;

  return (
    <AbsoluteFill style={{ fontFamily: FONT_FAMILY, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: 90,
          bottom: 150,
          opacity,
          transform: `translateX(${slide}px)`,
          display: 'flex',
          alignItems: 'stretch',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: `0 12px 34px ${hexToRgba('#000000', 0.4)}`,
        }}
      >
        {/* bloque de acento a la izquierda */}
        <div style={{ width: 8, background: d.accent }} />
        <div style={{ background: hexToRgba(d.surface, 0.94), padding: '14px 26px 16px 22px' }}>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.01em', color: d.foreground }}>
            {title}
          </div>
          {subtitle !== undefined && subtitle.length > 0 ? (
            <div style={{ fontSize: 22, fontWeight: 500, color: d.muted, marginTop: 2 }}>{subtitle}</div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};
