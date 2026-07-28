import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign } from '@fabrica/shared';
import { FONT_FAMILY } from '../fonts';
import type { IntroOutroProps } from './IntroBasica';

// Outro integrada 'outro-basica@0.1.0' (contrato introOutroPropsSchema).
// Duración fija OUTRO_BASICA_DURATION_FRAMES (registry-gen.ts); se monta tras
// el último beat. Determinismo: solo useCurrentFrame, sin relojes ni red.

export const OutroBasica: React.FC<IntroOutroProps> = ({ channel_name, logo, design }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const d = design ?? defaultDesign();
  const appear = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const rise = interpolate(frame, [0, 18], [14, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const exit = interpolate(frame, [Math.max(1, durationInFrames - 10), durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(appear, exit);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: d.background,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: FONT_FAMILY,
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${rise}px)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          textAlign: 'center',
        }}
      >
        {logo ? (
          <Img
            src={logo}
            style={{
              width: 140,
              height: 140,
              borderRadius: '50%',
              objectFit: 'cover',
              border: `4px solid ${d.accent}`,
              marginBottom: 6,
            }}
          />
        ) : null}
        <div style={{ fontSize: 58, fontWeight: 700, color: d.foreground }}>Gracias por ver</div>
        {channel_name.length > 0 ? (
          <div style={{ fontSize: 30, fontWeight: 400, color: d.muted }}>{channel_name}</div>
        ) : null}
        <div style={{ fontSize: 24, fontWeight: 400, color: d.accent }}>
          Suscríbete para el próximo vídeo
        </div>
      </div>
    </AbsoluteFill>
  );
};
