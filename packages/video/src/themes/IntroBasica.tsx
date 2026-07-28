import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { defaultDesign, hexToRgba, type DesignTokens } from '@fabrica/shared';
import { FONT_FAMILY } from '../fonts';

// Intro integrada 'intro-basica@0.1.0' (contrato introOutroPropsSchema).
// Duración fija: INTRO_BASICA_DURATION_FRAMES (registry-gen.ts); la Sequence que
// la monta mide eso y aquí se lee con useVideoConfig. Cinematográfica: glow de
// acento que respira, avatar con anillo giratorio + spring, nombre del canal en
// reveal escalonado por palabras y barra de acento. Determinismo (docs/render.md
// §4): solo useCurrentFrame/spring, fuente empaquetada, sin red ni relojes.

export type IntroOutroProps = {
  channel_name: string;
  logo?: string;
  design?: DesignTokens;
};

export const IntroBasica: React.FC<IntroOutroProps> = ({ channel_name, logo, design }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const d = design ?? defaultDesign();

  // salida global en los últimos 12 frames (fade + leve zoom-out)
  const exit = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const exitScale = interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 1.04], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // glow de acento que respira detrás del contenido
  const glowIn = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const breathe = 0.9 + 0.1 * Math.sin(frame / 9);

  // avatar: spring de escala + anillo de acento que gira
  const avatarSpring = spring({ frame, fps, config: { damping: 12, stiffness: 120, mass: 0.7 } });
  const ringAngle = frame * 3; // giro determinista del anillo cónico

  // barra de acento bajo el nombre
  const barWidth = interpolate(frame, [14, 34], [0, 240], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const words = channel_name.trim().split(/\s+/).filter((w) => w.length > 0);

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
      {/* glow de acento que respira */}
      <AbsoluteFill
        style={{
          opacity: glowIn * exit,
          background: `radial-gradient(circle at 50% 42%, ${hexToRgba(d.accent, 0.22 * breathe)}, transparent 60%)`,
        }}
      />

      <div
        style={{
          opacity: exit,
          transform: `scale(${exitScale})`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 26,
        }}
      >
        {logo ? (
          <div
            style={{
              position: 'relative',
              width: 200,
              height: 200,
              transform: `scale(${0.6 + 0.4 * avatarSpring})`,
            }}
          >
            {/* anillo cónico de acento que gira */}
            <div
              style={{
                position: 'absolute',
                inset: -8,
                borderRadius: '50%',
                background: `conic-gradient(from ${ringAngle}deg, ${d.accent}, ${hexToRgba(d.accent, 0)} 55%, ${d.accent})`,
                filter: 'blur(1px)',
              }}
            />
            <Img
              src={logo}
              style={{
                position: 'absolute',
                inset: 0,
                width: 200,
                height: 200,
                borderRadius: '50%',
                objectFit: 'cover',
                border: `4px solid ${d.background}`,
                boxShadow: `0 0 ${28 * breathe}px ${hexToRgba(d.accent, 0.55)}`,
              }}
            />
          </div>
        ) : null}

        {words.length > 0 ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
            {words.map((w, i) => {
              const wordSpring = spring({
                frame: frame - 8 - i * 4,
                fps,
                config: { damping: 14, stiffness: 140, mass: 0.6 },
              });
              return (
                <span
                  key={i}
                  style={{
                    display: 'inline-block',
                    fontSize: 68,
                    fontWeight: 800,
                    letterSpacing: '-0.02em',
                    color: d.foreground,
                    opacity: wordSpring,
                    transform: `translateY(${(1 - wordSpring) * 26}px)`,
                  }}
                >
                  {w}
                </span>
              );
            })}
          </div>
        ) : null}

        <div style={{ width: barWidth, height: 6, borderRadius: 3, background: d.accent }} />
      </div>
    </AbsoluteFill>
  );
};
