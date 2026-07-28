import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign, type DesignTokens } from '@fabrica/shared';
import { FONT_FAMILY } from '../fonts';

// Intro integrada 'intro-basica@0.1.0' (contrato introOutroPropsSchema en
// packages/shared/src/component-manifest.ts). Duración fija: la Sequence que
// la monta mide INTRO_BASICA_DURATION_FRAMES (registry-gen.ts); aquí se lee
// con useVideoConfig para que la salida encaje con cualquier duración.
// Determinismo (docs/render.md §4): solo useCurrentFrame, fuente empaquetada.

export type IntroOutroProps = {
  channel_name: string;
  logo?: string;
  design?: DesignTokens;
};

export const IntroBasica: React.FC<IntroOutroProps> = ({ channel_name, logo, design }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const d = design ?? defaultDesign();
  const appear = interpolate(frame, [0, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const exit = interpolate(frame, [Math.max(1, durationInFrames - 12), durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opacity = Math.min(appear, exit);
  const barWidth = interpolate(frame, [0, 22], [0, 220], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: d.background,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: FONT_FAMILY,
      }}
    >
      <div style={{ opacity, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
        {logo ? (
          <Img
            src={logo}
            style={{
              width: 180,
              height: 180,
              borderRadius: '50%',
              objectFit: 'cover',
              border: `4px solid ${d.accent}`,
            }}
          />
        ) : null}
        <div style={{ width: barWidth, height: 6, borderRadius: 3, background: d.accent }} />
        {channel_name.length > 0 ? (
          <div style={{ fontSize: 64, fontWeight: 700, color: d.foreground, letterSpacing: 0.5 }}>
            {channel_name}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
