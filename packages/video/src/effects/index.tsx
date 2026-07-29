import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign, hexToRgba, type DesignTokens } from '@fabrica/shared';
import { displayText, FONT_FAMILY } from '../fonts';
import { hashSeed } from '../seed';
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

// Los 4 gestos de entrada de la tipografía cinética (adaptados de
// editor-youtube kinetic-type.html:78-87). `e` es el progreso de entrada 0..1;
// devuelven escala/desplazamiento/rotación/opacidad de la palabra.
const GESTOS: Array<(e: number) => { s: number; x: number; y: number; r: number; o: number }> = [
  // aterrizaje desde muy grande
  (e) => ({ s: 2.6 - 1.6 * e, x: 0, y: 0, r: 0, o: e }),
  // entra desde el lateral con rotación
  (e) => ({ s: 0.86 + 0.14 * e, x: (1 - e) * 620, y: 0, r: (1 - e) * 9, o: e }),
  // sube desde abajo, sobrepasando
  (e) => ({ s: 0.92 + 0.08 * e, x: 0, y: (1 - e) * 380, r: 0, o: e }),
  // crece desde cero con giro corto
  (e) => ({ s: e * 1.04, x: 0, y: 0, r: (1 - e) * -7, o: e }),
];

// Tipografía cinética: la frase se muestra palabra a palabra, en grande y
// centrada, cada una con un gesto de entrada distinto (rotan por índice, con
// desempate determinista por hashSeed). Para el gancho. Adaptado de
// editor-youtube kinetic-type.html:134-157. Solo useCurrentFrame + kit → puro.
export const KineticText: React.FC<{ text: string; seed?: number; design?: DesignTokens }> = ({
  text,
  seed = 0,
  design,
}) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  // fade global de cierre en los últimos ~0.35 s
  const closeF = Math.min(Math.round(0.35 * fps), Math.round(durationInFrames * 0.2));
  const cierre = 1 - span(frame, durationInFrames - closeF, closeF, Ease.outCubic);
  // cada palabra ocupa un tramo; se solapan un poco para que fluya
  const step = (durationInFrames - closeF) / words.length;

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', fontFamily: FONT_FAMILY }}>
      <div style={{ position: 'relative', width: '100%', height: 320 }}>
        {words.map((w, i) => {
          const at = i * step;
          const dur = step * 1.3;
          const e = span(frame, at, dur * 0.25, Ease.outExpo);
          const sale = span(frame, at + dur * 0.82, dur * 0.18, Ease.outCubic);
          const g = GESTOS[hashSeed(`${seed}:${i}`) % GESTOS.length]!(e);
          const drift = Math.sin(((frame - at) / fps) * 2.2) * 5;
          const y = g.y + drift - sale * 90;
          const visible = frame >= at && frame < at + dur;
          // la última palabra es el remate → color de acento
          const isLast = i === words.length - 1;
          const size = clamp(1500 / Math.max(3, w.length), 90, 220);
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                opacity: visible ? g.o * (1 - sale) * cierre : 0,
                transform: `translate(-50%, -50%) translate(${g.x}px, ${y}px) scale(${g.s * (1 - sale * 0.12)}) rotate(${g.r}deg)`,
                ...displayText(900),
                fontSize: size,
                lineHeight: 1,
                letterSpacing: '-0.03em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
                color: isLast ? d.accent : d.foreground,
                textShadow: `0 8px 30px ${hexToRgba('#000000', 0.45)}`,
              }}
            >
              {w}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Count-up de rodillo mecánico: cada dígito es una columna continua que rueda;
// la `rigidez` concentra el giro en el tramo final para que el acarreo se sienta
// mecánico (adaptado de editor-youtube odometro.html:210-241). Para cifras.
export const StatOdometer: React.FC<{ value: string; label?: string; design?: DesignTokens }> = ({
  value,
  label,
  design,
}) => {
  const d = design ?? defaultDesign();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { opacity, enter } = useInOut();

  const match = value.match(/-?\d[\d.,]*/);
  const raw = match?.[0] ?? '';
  const idx = match?.index ?? 0;
  const prefix = match ? value.slice(0, idx) : value;
  const suffix = match ? value.slice(idx + raw.length) : '';
  const target = Number.parseInt(raw.replace(/[.,\s]/g, ''), 10);
  const valid = raw !== '' && Number.isFinite(target);

  // el conteo corre sobre el tramo central del efecto
  const startF = Math.round(durationInFrames * 0.12);
  const countF = Math.max(1, Math.round(durationInFrames * 0.5));
  const p = span(frame, startF, countF, Ease.outCubic);
  const current = valid ? target * p : 0;
  const numDigits = valid ? Math.max(1, String(target).length) : 0;
  const RIGIDEZ = 0.7;

  const columns: React.ReactNode[] = [];
  for (let peso = numDigits - 1; peso >= 0; peso--) {
    const pos = (current / Math.pow(10, peso)) % 10;
    const dg = Math.floor(pos);
    const u = clamp((pos - dg - RIGIDEZ) / (1 - RIGIDEZ), 0, 1);
    const ty = -(dg + Ease.inOutCubic(u));
    columns.push(
      <div key={`c${peso}`} style={{ height: '1em', width: '0.62em', overflow: 'hidden' }}>
        <div style={{ transform: `translateY(${ty}em)` }}>
          {Array.from({ length: 11 }, (_, n) => (
            <div key={n} style={{ height: '1em', lineHeight: '1em', textAlign: 'center' }}>
              {n % 10}
            </div>
          ))}
        </div>
      </div>,
    );
    // separador de millar
    if (peso > 0 && peso % 3 === 0) {
      columns.push(
        <div key={`s${peso}`} style={{ width: '0.24em', textAlign: 'center' }}>
          .
        </div>,
      );
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
        <div
          style={{
            ...displayText(800),
            fontSize: 130,
            lineHeight: 1,
            color: d.accent,
            letterSpacing: '-0.03em',
            display: 'flex',
            alignItems: 'baseline',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {prefix ? <span>{prefix}</span> : null}
          {valid ? (
            <div style={{ display: 'flex', height: '1em', alignItems: 'flex-start' }}>{columns}</div>
          ) : (
            <span>{raw}</span>
          )}
          {suffix ? <span>{suffix}</span> : null}
        </div>
        {label !== undefined && label.trim() !== '' ? (
          <div style={{ fontSize: 30, fontWeight: 500, color: d.foreground }}>{label}</div>
        ) : null}
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
