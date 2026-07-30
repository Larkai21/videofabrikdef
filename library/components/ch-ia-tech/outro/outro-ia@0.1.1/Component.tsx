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
  const { durationInFrames, fps, width, height } = useVideoConfig();

  const appear = interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const exit = interpolate(frame, [Math.max(1, durationInFrames - 16), durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = Math.min(appear, exit);

  const floatY = interpolate(frame, [0, 30], [6, -6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const ringScale = interpolate(frame, [0, 20], [0.86, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: d.background, justifyContent: 'center', alignItems: 'center', fontFamily: d.font_family }}>
      {/* cinematic vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at center, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.55) 70%)`,
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          width: 720,
          height: 720,
          borderRadius: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `translateY(${floatY}px) scale(${ringScale})`,
          opacity,
          boxShadow: `0 30px 80px rgba(6,10,20,0.7), inset 0 1px 0 rgba(255,255,255,0.02)`,
          background: `linear-gradient(180deg, ${d.surface} 0%, rgba(255,255,255,0.02) 100%)`,
        }}
        aria-label={channel_name}
      >
        {logo ? (
          <Img
            src={logo}
            alt={channel_name}
            style={{
              width: 560,
              height: 560,
              borderRadius: 32,
              objectFit: 'cover',
              boxShadow: `0 18px 40px rgba(11,15,25,0.6)`,
              border: `6px solid ${d.accent}`,
            }}
          />
        ) : (
          <div
            style={{
              width: 420,
              height: 420,
              borderRadius: 28,
              background: `linear-gradient(135deg, ${d.accent} 0%, ${d.surface} 100%)`,
              boxShadow: `0 12px 36px rgba(7,10,20,0.6)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-hidden
          >
            <div
              style={{
                width: 220,
                height: 220,
                borderRadius: '50%',
                background: d.accent_fg,
                boxShadow: `inset 0 6px 18px rgba(255,255,255,0.02), 0 8px 24px rgba(0,0,0,0.5)`,
                opacity: 0.96,
              }}
            />
          </div>
        )}
      </div>

      {/* subtle accent bar below */}
      <div
        style={{
          position: 'absolute',
          bottom: 120,
          width: 420,
          height: 8,
          borderRadius: 8,
          background: `linear-gradient(90deg, ${d.accent} 0%, ${d.muted} 50%, ${d.accent} 100%)`,
          opacity,
          transform: `translateY(${Math.min(12, (1 - opacity) * 24)}px)`,
        }}
      />

      {/* tiny corner brand mark */}
      <div
        style={{
          position: 'absolute',
          right: 48,
          bottom: 48,
          width: 88,
          height: 28,
          borderRadius: 6,
          background: d.surface,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 6px 18px rgba(0,0,0,0.6)`,
          opacity: Math.min(0.9, opacity),
        }}
      >
        <div style={{ width: 56, height: 6, borderRadius: 6, background: d.accent }} />
      </div>
    </AbsoluteFill>
  );
};

export default Component;
