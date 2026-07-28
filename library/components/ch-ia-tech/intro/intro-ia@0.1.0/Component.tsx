import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

type Design = {
  background?: string;
  surface?: string;
  foreground?: string;
  muted?: string;
  accent?: string;
  accent_fg?: string;
  font_family?: string;
};

const FALLBACK = {
  background: '#0b0f19',
  surface: '#111a2e',
  foreground: '#f4f6fb',
  muted: '#aab6cc',
  accent: '#7aa2ff',
  accent_fg: '#0b0f19',
  font_family: 'Inter',
} as const;

type Props = { channel_name: string; logo?: string; design?: Design };

const Component: React.FC<Props> = ({ channel_name, logo, design }) => {
  const d = { ...FALLBACK, ...(design ?? {}) };
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const fadeOut = interpolate(frame, [Math.max(1, durationInFrames - 12), durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = Math.min(fadeIn, fadeOut);

  // subtle vertical slide for a cinematic reveal
  const translateY = interpolate(frame, [0, 18], [24, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        background: d.background,
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
        fontFamily: d.font_family,
      }}
    >
      {/* soft cinematic vignette + glow */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at 50% 35%, rgba(122,162,255,0.08), transparent 25%), radial-gradient(circle at 50% 70%, rgba(255,255,255,0.02), transparent 20%)`,
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          transform: `translateY(${translateY}px)` ,
          opacity,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 28,
        }}
      >
        {logo ? (
          <Img
            src={logo}
            alt={channel_name}
            style={{
              width: 220,
              height: 220,
              borderRadius: 28,
              objectFit: 'cover',
              boxShadow: `0 30px 80px rgba(11,15,25,0.7), 0 6px 20px rgba(122,162,255,0.08)` ,
              border: `6px solid ${d.surface}` ,
            }}
          />
        ) : (
          <div
            aria-label={channel_name}
            style={{
              width: 220,
              height: 220,
              borderRadius: 32,
              background: `linear-gradient(135deg, ${d.surface}, rgba(255,255,255,0.02))`,
              boxShadow: `0 30px 80px rgba(11,15,25,0.7), inset 0 1px 0 rgba(255,255,255,0.02)` ,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* central tech mark: concentric rings using borders */}
            <div
              style={{
                width: 120,
                height: 120,
                borderRadius: '50%',
                background: 'transparent',
                border: `6px solid ${d.accent}` ,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  background: d.accent_fg,
                  boxShadow: `0 12px 30px rgba(122,162,255,0.18)` ,
                }}
              />
            </div>
          </div>
        )}

        {/* subtle accent bar to the right as a cinematic light sliver */}
        <div
          style={{
            width: 4,
            height: 160,
            borderRadius: 3,
            background: `linear-gradient(180deg, ${d.accent}, ${d.muted})`,
            opacity: 0.9,
            boxShadow: `0 10px 30px ${d.accent}33, 0 2px 8px rgba(0,0,0,0.45)`,
          }}
        />
      </div>

      {/* bottom subtle separator band to ground the header */}
      <div
        style={{
          position: 'absolute',
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 640,
          height: 4,
          borderRadius: 2,
          background: `linear-gradient(90deg, transparent, ${d.accent}, transparent)`,
          opacity: opacity * 0.9,
        }}
      />
    </AbsoluteFill>
  );
};

export default Component;
