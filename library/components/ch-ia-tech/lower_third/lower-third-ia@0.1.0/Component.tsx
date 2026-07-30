import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';

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

type Props = { title: string; subtitle?: string; fromFrame: number; design?: Design };

const Component: React.FC<Props> = ({ title, subtitle, fromFrame, design }) => {
  const d = { ...FALLBACK, ...(design ?? {}) };
  const frame = useCurrentFrame();
  const localFrame = frame - Math.max(0, Math.floor(fromFrame));

  const appear = interpolate(localFrame, [0, 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const slide = interpolate(appear, [0, 1], [-48, 0]);
  const bg = toRgba(d.surface as string, 0.92);

  return (
    <AbsoluteFill style={{ fontFamily: d.font_family, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: 90,
          bottom: 130,
          opacity: appear,
          transform: 'translateX(' + slide + 'px)',
          background: bg,
          borderLeft: '6px solid ' + d.accent,
          padding: '14px 24px',
          borderRadius: 10,
          boxShadow: '0 8px 24px ' + toRgba(d.accent_fg as string, 0.12),
        }}
      >
        <div style={{ fontSize: 40, fontWeight: 700, color: d.foreground }}>{title}</div>
        {subtitle ? <div style={{ fontSize: 22, color: d.muted, marginTop: 4 }}>{subtitle}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

export default Component;
