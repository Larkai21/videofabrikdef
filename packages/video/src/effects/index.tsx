import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign, hexToRgba, type DesignTokens } from '@fabrica/shared';
import { displayText, FONT_FAMILY } from '../fonts';
import { clamp, Ease, span } from './motion';

// Biblioteca de efectos de edición: overlays deterministas que el director de
// edición coloca en la línea de tiempo para que el vídeo se sienta editado. Cada
// uno se monta como <Sequence> propia en LongForm, así useCurrentFrame arranca en
// 0 al inicio del efecto. Solo useCurrentFrame + el kit de movimiento (matemática
// pura con easing), sin spring/red — mismo movimiento "editado" que editor-youtube.

// enter/exit estándar relativo a la Sequence del efecto. `opacity`: fade-in
// suave (outExpo) + fade-out al final. `enter`: 0..1 suave para desplazamientos.
// `pop`: entrada con overshoot (outBack, puede pasar de 1) para escalas con rebote.
function useInOut(opts?: { enterFrames?: number; exitFrames?: number }): {
  opacity: number;
  enter: number;
  pop: number;
} {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const enterFrames = opts?.enterFrames ?? 10;
  const exitFrames = opts?.exitFrames ?? 8;
  const fadeIn = span(frame, 0, enterFrames, Ease.outExpo);
  const fadeOut = 1 - span(frame, durationInFrames - exitFrames, exitFrames, Ease.outCubic);
  return {
    opacity: Math.min(clamp(fadeIn, 0, 1), fadeOut),
    enter: clamp(fadeIn, 0, 1),
    pop: span(frame, 0, enterFrames, Ease.outBack),
  };
}

// Rótulo/callout que entra con pop en la banda superior (no choca con los
// subtítulos, anclados abajo). Para resaltar un término o una idea.
export const TextCallout: React.FC<{ text: string; design?: DesignTokens }> = ({ text, design }) => {
  const d = design ?? defaultDesign();
  const { opacity, pop } = useInOut();
  if (text.trim() === '') return null;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-start', pointerEvents: 'none', fontFamily: FONT_FAMILY }}>
      <div
        style={{
          marginTop: 130,
          opacity,
          transform: `scale(${0.85 + 0.15 * pop})`,
          ...displayText(800),
          background: hexToRgba(d.surface, 0.95),
          color: d.foreground,
          border: `2px solid ${d.accent}`,
          fontSize: 46,
          padding: '12px 28px',
          borderRadius: 14,
          boxShadow: `0 12px 34px ${hexToRgba('#000000', 0.4)}`,
          maxWidth: 1400,
          textAlign: 'center',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

// Tarjeta de dato: cifra grande con count-up determinista + etiqueta. `value`
// puede traer sufijo/prefijo (p. ej. "70%", "$1.2B"); se anima la parte numérica.
export const StatCard: React.FC<{ value: string; label?: string; design?: DesignTokens }> = ({
  value,
  label,
  design,
}) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { opacity, enter } = useInOut();
  // parte numérica para el count-up; el resto (símbolos) se conserva. El conteo
  // corre sobre el primer ~55% del efecto con outExpo (rápido y luego frena),
  // más satisfactorio que el spring anterior.
  const match = value.match(/-?\d[\d.,]*/);
  let display = value;
  if (match) {
    const raw = match[0];
    const target = Number.parseFloat(raw.replace(/,/g, ''));
    if (Number.isFinite(target)) {
      const countFrames = Math.max(1, Math.round(durationInFrames * 0.55));
      const p = span(frame, 0, countFrames, Ease.outExpo);
      const decimals = raw.includes('.') ? (raw.split('.')[1]?.length ?? 0) : 0;
      const current = (target * p).toFixed(decimals);
      display = value.replace(raw, current);
    }
  }
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', fontFamily: FONT_FAMILY }}>
      <div
        style={{
          opacity,
          transform: `translateY(${(1 - enter) * 20}px)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          background: hexToRgba(d.background, 0.72),
          backdropFilter: 'blur(6px)',
          padding: '24px 46px',
          borderRadius: 20,
          border: `1px solid ${hexToRgba(d.accent, 0.5)}`,
          boxShadow: `0 20px 60px ${hexToRgba('#000000', 0.5)}`,
        }}
      >
        <div style={{ ...displayText(800), fontSize: 130, lineHeight: 1, color: d.accent, letterSpacing: '-0.03em' }}>
          {display}
        </div>
        {label !== undefined && label.trim() !== '' ? (
          <div style={{ fontSize: 30, fontWeight: 500, color: d.foreground }}>{label}</div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

// Tarjeta de cita centrada, con comillas de acento sobre un scrim.
export const QuoteCard: React.FC<{ text: string; design?: DesignTokens }> = ({ text, design }) => {
  const d = design ?? defaultDesign();
  const { opacity, pop } = useInOut();
  if (text.trim() === '') return null;
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', fontFamily: FONT_FAMILY }}>
      <div
        style={{
          opacity,
          transform: `scale(${0.94 + 0.06 * pop})`,
          maxWidth: 1300,
          padding: '40px 60px',
          borderRadius: 20,
          background: hexToRgba(d.background, 0.72),
          backdropFilter: 'blur(8px)',
          borderLeft: `6px solid ${d.accent}`,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 90, lineHeight: 0.6, color: d.accent, fontWeight: 800 }}>&ldquo;</div>
        <div style={{ fontSize: 54, fontWeight: 700, lineHeight: 1.25, color: d.foreground }}>{text}</div>
      </div>
    </AbsoluteFill>
  );
};

// Barra de progreso fina de acento abajo del todo; se llena en toda la duración
// de la composición (se monta como Sequence de 0 a totalFrames).
export const ProgressBar: React.FC<{ design?: DesignTokens }> = ({ design }) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const pct = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 100], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', justifyContent: 'flex-end' }}>
      <div style={{ height: 6, background: hexToRgba(d.foreground, 0.12) }}>
        <div style={{ width: `${pct}%`, height: '100%', background: d.accent }} />
      </div>
    </AbsoluteFill>
  );
};

// Ambiente: viñeta + grano de película sutil. El grano usa feTurbulence con la
// semilla derivada del frame → ruido que cambia cada fotograma, determinista.
export const Ambience: React.FC<{ design?: DesignTokens }> = ({ design }) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const seed = frame % 100;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* viñeta */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, transparent 55%, ${hexToRgba(d.background, 0.55)} 100%)`,
        }}
      />
      {/* grano de película */}
      <AbsoluteFill style={{ opacity: 0.05, mixBlendMode: 'overlay' }}>
        <svg width="100%" height="100%">
          <filter id={`grain-${seed}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} />
          </filter>
          <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
