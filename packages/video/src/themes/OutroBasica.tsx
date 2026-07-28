import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { defaultDesign, hexToRgba } from '@fabrica/shared';
import { FONT_FAMILY } from '../fonts';
import type { IntroOutroProps } from './IntroBasica';

// Outro integrada 'outro-basica@0.1.0' (contrato introOutroPropsSchema).
// Duración fija OUTRO_BASICA_DURATION_FRAMES (registry-gen.ts); se monta tras el
// último beat. Cierre de marca: avatar con spring, "Gracias por ver", nombre del
// canal y una píldora "Suscríbete" que late. Determinismo: solo useCurrentFrame/
// spring, sin relojes ni red.

export const OutroBasica: React.FC<IntroOutroProps> = ({ channel_name, logo, design }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const d = design ?? defaultDesign();

  const appear = spring({ frame, fps, config: { damping: 14, stiffness: 120, mass: 0.7 } });
  const exit = interpolate(frame, [durationInFrames - 10, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // la píldora "Suscríbete" late (escala) para llamar la atención
  const pulse = 1 + 0.06 * Math.sin(frame / 6);
  const glow = 0.9 + 0.1 * Math.sin(frame / 9);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: d.background,
        justifyContent: 'center',
        alignItems: 'center',
        fontFamily: FONT_FAMILY,
        overflow: 'hidden',
      }}
    >
      <AbsoluteFill
        style={{
          opacity: exit,
          background: `radial-gradient(circle at 50% 55%, ${hexToRgba(d.accent, 0.18 * glow)}, transparent 62%)`,
        }}
      />
      <div
        style={{
          opacity: exit * appear,
          transform: `translateY(${(1 - appear) * 20}px)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          textAlign: 'center',
        }}
      >
        {logo ? (
          <Img
            src={logo}
            style={{
              width: 150,
              height: 150,
              borderRadius: '50%',
              objectFit: 'cover',
              border: `4px solid ${d.accent}`,
              boxShadow: `0 0 ${24 * glow}px ${hexToRgba(d.accent, 0.5)}`,
              marginBottom: 6,
            }}
          />
        ) : null}
        <div style={{ fontSize: 62, fontWeight: 800, letterSpacing: '-0.02em', color: d.foreground }}>
          Gracias por ver
        </div>
        {channel_name.length > 0 ? (
          <div style={{ fontSize: 30, fontWeight: 500, color: d.muted }}>{channel_name}</div>
        ) : null}
        <div
          style={{
            marginTop: 14,
            transform: `scale(${pulse})`,
            background: d.accent,
            color: d.accent_fg,
            fontSize: 26,
            fontWeight: 700,
            padding: '12px 30px',
            borderRadius: 999,
            boxShadow: `0 10px 30px ${hexToRgba(d.accent, 0.45)}`,
          }}
        >
          Suscríbete
        </div>
      </div>
    </AbsoluteFill>
  );
};
