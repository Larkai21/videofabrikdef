import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame } from 'remotion';
import { hexToRgba, type DesignTokens } from '@fabrica/shared';
import { displayText } from '../fonts';
import { Ease, clamp, mix, span } from '../effects/motion';

// Gramática de movimiento compartida por las cuatro piezas integradas del brand
// kit (intro, outro, tarjeta de sección y rótulo). Sin esto cada pieza duplica
// sus gestos y dejan de parecer del mismo canal al segundo retoque.
//
// Es un MÓDULO, no un componente del registry: no aparece en BUILTINS ni en
// BUILTIN_KIT_COMPONENTS.
//
// Unidades: a span/pulse se les pasan FRAMES (no segundos). Son agnósticos de
// unidad mientras t, inicio y dur compartan la misma; effects/index.tsx hace
// lo mismo.
//
// Determinismo (docs/render.md §4): todo sale de useCurrentFrame(), sin relojes,
// sin aleatoriedad sin semilla y sin animaciones CSS (que van contra reloj de
// pared y romperían la reproducibilidad frame a frame).

/**
 * «Señal y ruido» → «SR», «Canal de ejemplo» → «CE». Una sola palabra → sus dos
 * primeras letras.
 *
 * Se descartan los conectores (y, de, la, el, en…): sin ese filtro «Señal y
 * ruido» daría «SY», que no es el monograma de nadie. La regla es estructural,
 * no una lista de palabras: una palabra de una o dos letras en minúscula es un
 * conector; en mayúscula puede ser una sigla y se conserva.
 */
export function initials(name: string): string {
  const all = name
    .trim()
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w));
  const significant = all.filter((w) => w.length > 2 || /^\p{Lu}/u.test(w));
  const words = significant.length > 0 ? significant : all;
  if (words.length === 0) return '·';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w.slice(0, 1))
    .join('')
    .toUpperCase();
}

/**
 * Ventanas de entrada y salida para overlays de duración variable.
 *
 * brand-kit.ts recorta la tarjeta de sección a min(90, hueco, fin del cuerpo) y
 * puede dejarla en 20 frames: si entrada + salida superan la duración, la pieza
 * nunca llega a opacidad plena y se ve como un parpadeo.
 */
export function overlayWindows(
  dur: number,
  enter = 12,
  exit = 14,
): { enterF: number; exitF: number } {
  if (dur <= 0) return { enterF: 1, exitF: 1 };
  const total = enter + exit;
  if (total <= dur * 0.8) return { enterF: enter, exitF: exit };
  const escala = (dur * 0.8) / total;
  return {
    enterF: Math.max(1, Math.round(enter * escala)),
    exitF: Math.max(1, Math.round(exit * escala)),
  };
}

/**
 * Cama de fondo: retícula de puntos con parallax lento y máscara radial.
 *
 * Es la capa que impide que la intro se vea vacía cuando el canal no tiene
 * avatar. Un solo nodo con background repetido, no cientos de divs.
 */
export const MeshBackdrop: React.FC<{
  design: DesignTokens;
  seed: number;
  from?: number;
  intensity?: number;
}> = ({ design: d, seed, from = 0, intensity = 0.55 }) => {
  const frame = useCurrentFrame();
  const p = span(frame, from, 18, Ease.outExpo);
  // deriva continua: la fase depende de la semilla, así cada canal tiene su malla
  const dx = Math.sin((frame + (seed % 60)) / 40) * 10;
  const dy = Math.cos((frame + (seed % 90)) / 55) * 8;
  return (
    <AbsoluteFill
      style={{
        opacity: p * intensity,
        transform: `scale(${mix(1.12, 1, p)})`,
        backgroundImage: `radial-gradient(circle, ${hexToRgba(d.foreground, 0.1)} 1.6px, transparent 1.7px)`,
        backgroundSize: '46px 46px',
        backgroundPosition: `${dx}px ${dy}px`,
        maskImage: 'radial-gradient(ellipse at 50% 45%, #000 30%, transparent 78%)',
        WebkitMaskImage: 'radial-gradient(ellipse at 50% 45%, #000 30%, transparent 78%)',
        pointerEvents: 'none',
      }}
    />
  );
};

/** Barrido de luz de acento que cruza el encuadre una sola vez. */
export const AccentSweep: React.FC<{ design: DesignTokens; from: number; dur: number }> = ({
  design: d,
  from,
  dur,
}) => {
  const frame = useCurrentFrame();
  const p = span(frame, from, dur, Ease.inOutCubic);
  // se apaga en los extremos para que no aparezca ni desaparezca de golpe
  const vis = Math.sin(clamp(p, 0, 1) * Math.PI);
  if (vis <= 0.001) return null;
  return (
    <AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top: '-20%',
          bottom: '-20%',
          left: `${mix(-40, 140, p)}%`,
          width: '22%',
          transform: 'skewX(-18deg)',
          background: `linear-gradient(90deg, transparent, ${hexToRgba(d.accent, 0.5)}, transparent)`,
          filter: 'blur(14px)',
          opacity: vis * 0.7,
          mixBlendMode: 'screen',
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Disco de marca. Con logo lo pinta; sin logo cae al monograma del canal, que
 * es el caso real de los canales sin avatar. Anillo cónico que gira y arco que
 * se dibuja: movimiento legible, no solo un degradado dando vueltas.
 */
export const BrandMark: React.FC<{
  channelName: string;
  logo?: string;
  design: DesignTokens;
  size?: number;
  from?: number;
}> = ({ channelName, logo, design: d, size = 200, from = 0 }) => {
  const frame = useCurrentFrame();
  const t = frame - from;
  const appear = span(frame, from, 22, Ease.outBack);
  const draw = span(frame, from + 8, 44, Ease.outCubic);
  const breathe = 0.9 + 0.1 * Math.sin(t / 9);
  const ring = t * 2.4;
  const r = size / 2;
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flex: 'none',
        transform: `scale(${mix(0.62, 1, clamp(appear, 0, 1.2))})`,
        opacity: clamp(appear, 0, 1),
      }}
    >
      {/* anillo cónico de acento girando */}
      <div
        style={{
          position: 'absolute',
          inset: -8,
          borderRadius: '50%',
          background: `conic-gradient(from ${ring}deg, ${d.accent}, ${hexToRgba(d.accent, 0)} 55%, ${d.accent})`,
          filter: 'blur(1px)',
          opacity: 0.9,
        }}
      />
      {/* arco de progreso que se DIBUJA alrededor del disco */}
      <svg
        viewBox={`0 0 ${size} ${size}`}
        style={{ position: 'absolute', inset: -14, width: size + 28, height: size + 28 }}
      >
        <circle
          cx={r}
          cy={r}
          r={r - 2}
          fill="none"
          stroke={hexToRgba(d.accent, 0.85)}
          strokeWidth={2}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - draw}
          transform={`rotate(-90 ${r} ${r})`}
        />
      </svg>
      {logo !== undefined && logo !== '' ? (
        <Img
          src={logo}
          style={{
            position: 'absolute',
            inset: 0,
            width: size,
            height: size,
            borderRadius: '50%',
            objectFit: 'cover',
            border: `4px solid ${d.background}`,
            boxShadow: `0 0 ${28 * breathe}px ${hexToRgba(d.accent, 0.55)}`,
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: hexToRgba(d.surface, 0.92),
            border: `4px solid ${d.background}`,
            boxShadow: `0 0 ${28 * breathe}px ${hexToRgba(d.accent, 0.4)}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              ...displayText(900),
              fontSize: size * 0.42,
              color: d.accent,
              lineHeight: 1,
            }}
          >
            {initials(channelName)}
          </span>
        </div>
      )}
    </div>
  );
};

/**
 * Revelado tipográfico con MÁSCARA: cada palabra sube desde debajo de su propia
 * caja con overflow oculto. Es lo que separa un texto «editado» de un fade
 * genérico, y el gesto común a las cuatro piezas.
 */
export const WordsReveal: React.FC<{
  text: string;
  from: number;
  stagger?: number;
  fontSize: number;
  weight?: number;
  color: string;
  align?: 'center' | 'left';
  shadow?: boolean;
}> = ({
  text,
  from,
  stagger = 4,
  fontSize,
  weight = 800,
  color,
  align = 'center',
  shadow = false,
}) => {
  const frame = useCurrentFrame();
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return null;
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: `${fontSize * 0.06}px ${fontSize * 0.24}px`,
        justifyContent: align === 'center' ? 'center' : 'flex-start',
      }}
    >
      {words.map((w, i) => {
        const e = span(frame, from + i * stagger, 16, Ease.outExpo);
        return (
          <span
            key={i}
            style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom' }}
          >
            <span
              style={{
                ...displayText(weight),
                display: 'inline-block',
                fontSize,
                lineHeight: 1.08,
                color,
                transform: `translateY(${(1 - e) * 110}%)`,
                // el tracking se asienta al entrar: detalle sutil que da oficio
                letterSpacing: `${mix(0.05, -0.02, e)}em`,
                ...(shadow ? { textShadow: '0 3px 16px rgba(0, 0, 0, 0.6)' } : {}),
              }}
            >
              {w}
            </span>
          </span>
        );
      })}
    </div>
  );
};

/**
 * Tamaño de titular que cabe: los nombres largos no pueden desbordar el
 * encuadre, y una intro no debe partir el nombre en tres líneas.
 */
export function fitTitleSize(text: string, max = 92, min = 44, budget = 1900): number {
  return clamp(budget / Math.max(8, text.trim().length), min, max);
}
