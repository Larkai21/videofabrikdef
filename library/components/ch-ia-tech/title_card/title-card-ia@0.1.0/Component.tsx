import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

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

const toRgba = (hex: string, a: number): string => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
};

type Props = { title: string; fromFrame: number; design?: Design };

const Component: React.FC<Props> = ({ title, fromFrame, design }) => {
  const d = { ...FALLBACK, ...(design ?? {}) };
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // local frame relative to when the section starts
  const local = frame - fromFrame;

  if (title.trim() === '') return null;

  // appear in first 14 frames after fromFrame
  const appear = interpolate(local, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // exit during the last 14 frames of the composition
  const exit = interpolate(frame, [Math.max(1, durationInFrames - 14), durationInFrames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity = Math.min(appear, exit);
  const rise = interpolate(appear, [0, 1], [18, 0]);

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', fontFamily: d.font_family, pointerEvents: 'none' }}>
      <div
        style={{
          opacity,
          transform: 'translateY(' + rise + 'px)',
          padding: '26px 44px',
          borderRadius: 16,
          background: toRgba(d.background as string, 0.62),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          maxWidth: 1200,
        }}
      >
        <div style={{ fontSize: 66, fontWeight: 700, color: d.foreground, textAlign: 'center', lineHeight: 1.1 }}>{title}</div>
        <div style={{ width: 180, height: 5, borderRadius: 3, background: d.accent }} />
      </div>
    </AbsoluteFill>
  );
};

export default Component;
