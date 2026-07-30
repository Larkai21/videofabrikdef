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

  // Use channel_name length deterministically to vary animation timing slightly
  const nameLen = channel_name.length;
  const delay = Math.min(12, Math.floor(nameLen / 2));

  const appear = interpolate(frame, [0 + delay, 16 + delay], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const exit = interpolate(frame, [Math.max(1, durationInFrames - 18), durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = Math.min(appear, exit);

  const pulse = interpolate(frame, [0, 15, 30], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const logoScale = 0.92 + 0.08 * pulse;

  return (
    <AbsoluteFill style={{ backgroundColor: d.background, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', fontFamily: d.font_family }}>
      {/* cinematic vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,0.55) 100%)`,
          pointerEvents: 'none',
          opacity: 0.6 * (1 - (1 - opacity)),
        }}
      />

      <div style={{ width: 960, height: 540, borderRadius: 24, background: d.surface, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 20px 60px rgba(0,0,0,0.6)`, transform: `scale(${0.99 + 0.01 * pulse})`, opacity }}>
        {logo ? (
          <Img
            src={logo}
            style={{ width: 272 * logoScale, height: 272 * logoScale, borderRadius: 24, objectFit: 'cover', boxShadow: `0 12px 40px ${d.accent}`, border: `4px solid ${d.accent}` }}
          />
        ) : (
          <div style={{ width: 272 * logoScale, height: 272 * logoScale, borderRadius: 24, background: d.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 12px 40px ${d.accent_fg}`, opacity }} />
        )}
      </div>

      {/* subtle accent bar at bottom */}
      <div style={{ position: 'absolute', bottom: 80, width: 420, height: 8, borderRadius: 6, background: `linear-gradient(90deg, ${d.accent} 0%, ${d.muted} 100%)`, opacity }} />
    </AbsoluteFill>
  );
};

export default Component;
