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

  const appear = interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const exit = interpolate(frame, [Math.max(1, durationInFrames - 12), durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = Math.min(appear, exit);

  const scale = interpolate(frame, [0, 20], [0.96, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const vignetteOpacity = interpolate(frame, [0, 8, 20], [0, 0.18, 0.18], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: d.background, fontFamily: d.font_family, overflow: 'hidden' }}>
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div
          style={{
            width: 1280,
            height: 720,
            transform: `scale(${scale})`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          <div
            style={{
              width: 900,
              height: 500,
              borderRadius: 24,
              background: `linear-gradient(180deg, ${d.surface} 0%, rgba(11,15,25,0.6) 100%)`,
              boxShadow: `0 20px 60px rgba(0,0,0,0.6)` ,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity,
            }}
          >
            {logo ? (
              <Img
                src={logo}
                style={{
                  width: 240,
                  height: 240,
                  borderRadius: 24,
                  objectFit: 'cover',
                  border: `6px solid ${d.accent}`,
                  boxShadow: `0 8px 30px ${d.accent_fg}77`,
                }}
              />
            ) : (
              <div
                style={{
                  width: 240,
                  height: 240,
                  borderRadius: 24,
                  background: d.surface,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: `inset 0 1px 0 ${d.muted}22`,
                }}
              />
            )}
          </div>

          <div
            style={{
              position: 'absolute',
              bottom: -60,
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 16,
              opacity,
            }}
          >
            <div style={{ width: 260, height: 6, borderRadius: 3, background: d.accent }} />
            <div style={{ color: d.foreground, fontSize: 44, fontWeight: 700, textTransform: 'none' }}>{channel_name}</div>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            background: `radial-gradient(ellipse at center, rgba(255,255,255,0) 40%, rgba(0,0,0,${vignetteOpacity}) 100%)`,
            pointerEvents: 'none',
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export default Component;
