import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame } from 'remotion';
import { hexToRgba, type DesignTokens } from '@fabrica/shared';
import { displayText } from '../fonts';
import { Ease, clamp, mix, span } from '../effects/motion';

// Vocabulario visual del canal, sacado de sus DOS piezas de marca reales (el
// avatar y la cabecera de YouTube) y no de un moodboard inventado. Lo que se
// midió en las imágenes, con el cuentagotas:
//
//   fondo de pizarra   #18181A – #30353B   (casi negro con matiz azul frío)
//   metal cepillado    #272A31 sombra · #5F666E medio · #8E999F brillo
//   núcleo y nodos     tono 182-188°, constante en todo el degradado del glow
//
// De ahí salen los tokens del canal. Aquí vive la FORMA, que es lo que no cabe
// en un token: la losa, el entramado de nodos y el metal cepillado del logotipo.
//
// Determinismo (docs/render.md §4): todo sale de useCurrentFrame() y de
// matemática pura. Sin relojes, sin aleatoriedad sin semilla, sin animaciones
// CSS —que van contra reloj de pared y romperían el render frame a frame—.

/**
 * La losa. Un fondo plano se ve barato en un plano fijo de tres segundos, y la
 * cabecera del canal no es negra: es piedra iluminada desde arriba a la
 * izquierda, con vetas.
 *
 * Se compone con degradados y no con una textura de fichero porque el render no
 * puede ir a buscar nada (principio 6) y porque una imagen de losa a 1080p
 * pesaría más que todo el brand kit junto.
 */
export const Losa: React.FC<{ design: DesignTokens; luz?: number }> = ({ design: d, luz = 1 }) => {
  const claro = hexToRgba(d.surface, 0.9 * luz);
  const veta = hexToRgba(d.foreground, 0.03 * luz);
  return (
    <AbsoluteFill
      style={{
        background: [
          // el foco alto a la izquierda, como en la cabecera
          `radial-gradient(ellipse 120% 90% at 22% 8%, ${claro}, transparent 62%)`,
          // vetas: dos familias de rayas en ángulos distintos, muy tenues
          `repeating-linear-gradient(112deg, ${veta} 0px, ${veta} 1px, transparent 1px, transparent 37px)`,
          `repeating-linear-gradient(69deg, ${veta} 0px, ${veta} 1px, transparent 1px, transparent 83px)`,
          d.background,
        ].join(', '),
      }}
    />
  );
};

/** Un nodo del entramado: el punto que se enciende en las uniones. */
const Nodo: React.FC<{ x: number; y: number; p: number; color: string; r?: number }> = ({
  x,
  y,
  p,
  color,
  r = 5,
}) => {
  if (p <= 0.001) return null;
  return (
    <g opacity={clamp(p, 0, 1)}>
      <circle cx={x} cy={y} r={r * 3.4 * p} fill={color} opacity={0.16} />
      <circle cx={x} cy={y} r={r * 1.8 * p} fill={color} opacity={0.3} />
      <circle cx={x} cy={y} r={r * mix(0.5, 1, p)} fill={color} />
    </g>
  );
};

/** Un puntal metálico que se dibuja desde su origen. */
const Puntal: React.FC<{
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  p: number;
  color: string;
  grosor?: number;
}> = ({ x1, y1, x2, y2, p, color, grosor = 3 }) => {
  if (p <= 0.001) return null;
  return (
    <line
      x1={x1}
      y1={y1}
      x2={mix(x1, x2, p)}
      y2={mix(y1, y2, p)}
      stroke={color}
      strokeWidth={grosor}
      strokeLinecap="round"
    />
  );
};

const HEX = Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 3) * i - Math.PI / 6;
  return [Math.cos(a), Math.sin(a)] as const;
});

/**
 * El entramado: puntales metálicos rectos que forman celdas hexagonales, con
 * nodos que prenden en las uniones. Es el motivo que flanquea el logotipo en la
 * cabecera del canal, y aquí se DIBUJA en vez de aparecer.
 *
 * Simetría de seis, como el original. Los brazos crecen desde el centro y los
 * nodos se encienden escalonados hacia fuera: el gesto es «esto se está
 * encendiendo», no «esto ha aparecido».
 */
export const Entramado: React.FC<{
  design: DesignTokens;
  from: number;
  /** ancho del motivo en px */
  size?: number;
  /** 0 = invisible, 1 = a plena luz */
  intensidad?: number;
  /** giro lento en grados por frame; 0 lo deja quieto */
  giro?: number;
  /**
   * Radio (0-1) del hueco que se abre en el centro del motivo. Sirve para
   * montarlo DETRÁS de un texto: sin él los puntales cruzan las letras y el
   * remate del canal se lee peor que el b-roll que lo precede.
   */
  hueco?: number;
}> = ({ design: d, from, size = 520, intensidad = 1, giro = 0.05, hueco = 0 }) => {
  const frame = useCurrentFrame();
  const c = size / 2;
  const metal = hexToRgba(d.muted, 0.55 * intensidad);
  const metalClaro = hexToRgba(d.foreground, 0.4 * intensidad);
  const nodo = d.accent;

  const rInterior = size * 0.13;
  const rCelda = size * 0.24;
  const rExterior = size * 0.46;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      style={{
        overflow: 'visible',
        transform: `rotate(${(frame - from) * giro}deg)`,
        pointerEvents: 'none',
        ...(hueco > 0
          ? {
              maskImage: `radial-gradient(circle at 50% 50%, transparent ${hueco * 100}%, #000 ${Math.min(99, hueco * 100 + 16)}%)`,
              WebkitMaskImage: `radial-gradient(circle at 50% 50%, transparent ${hueco * 100}%, #000 ${Math.min(99, hueco * 100 + 16)}%)`,
            }
          : {}),
      }}
    >
      {HEX.map(([ux, uy], i) => {
        // cada brazo entra un poco después que el anterior, en abanico
        const brazo = span(frame, from + i * 2, 22, Ease.outCubic);
        const fuera = span(frame, from + 10 + i * 2, 20, Ease.outCubic);
        const luz = span(frame, from + 18 + i * 3, 14, Ease.outExpo);
        const x0 = c + ux * rInterior;
        const y0 = c + uy * rInterior;
        const x1 = c + ux * rCelda;
        const y1 = c + uy * rCelda;
        const x2 = c + ux * rExterior;
        const y2 = c + uy * rExterior;
        // travesaño corto perpendicular, como en el motivo original
        const px = -uy;
        const py = ux;
        const tl = size * 0.075;
        return (
          <g key={i}>
            <Puntal x1={x0} y1={y0} x2={x1} y2={y1} p={brazo} color={metal} grosor={3.5} />
            <Puntal x1={x1} y1={y1} x2={x2} y2={y2} p={fuera} color={metal} grosor={2.5} />
            <Puntal
              x1={x1 - px * tl}
              y1={y1 - py * tl}
              x2={x1 + px * tl}
              y2={y1 + py * tl}
              p={fuera}
              color={metalClaro}
              grosor={2}
            />
            <Nodo x={x1} y={y1} p={luz} color={nodo} r={4.5} />
            <Nodo
              x={x2}
              y={y2}
              p={span(frame, from + 26 + i * 3, 12, Ease.outExpo)}
              color={nodo}
              r={3}
            />
          </g>
        );
      })}

      {/* la celda hexagonal del centro, que es lo que hace que se lea como retícula */}
      <polygon
        points={HEX.map(([ux, uy]) => `${c + ux * rInterior},${c + uy * rInterior}`).join(' ')}
        fill="none"
        stroke={metalClaro}
        strokeWidth={2.5}
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - span(frame, from + 4, 26, Ease.outCubic)}
      />
    </svg>
  );
};

// El degradado del logotipo de la cabecera, leído de arriba abajo sobre las
// letras: sombra, banda especular alta, corte oscuro y recuperación. Es lo que
// hace que el metal parezca metal y no gris.
const METAL =
  'linear-gradient(177deg, #98A3AA 0%, #E9F0F4 34%, #FBFDFE 41%, #6E777E 53%, #A7B2B9 78%, #D6DEE3 100%)';

/**
 * Tipografía de metal cepillado, con el barrido especular cruzando una vez.
 *
 * Va en caps y con tracking ancho porque así está el logotipo real: «KERNEL AI»
 * respira, no aprieta. El barrido es un gradiente que se desplaza, no un filtro:
 * se compone en el mismo pintado y no cuesta un pase extra por fotograma.
 */
export const TextoMetal: React.FC<{
  texto: string;
  from: number;
  fontSize: number;
  weight?: number;
  tracking?: number;
  /** frame en el que cruza el brillo; -1 lo desactiva */
  barrido?: number;
}> = ({ texto, from, fontSize, weight = 800, tracking = 0.08, barrido = -1 }) => {
  const frame = useCurrentFrame();
  const entra = span(frame, from, 20, Ease.outExpo);
  const b = barrido >= 0 ? span(frame, barrido, 26, Ease.inOutCubic) : -1;
  return (
    <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom' }}>
      <span
        style={{
          ...displayText(weight),
          display: 'inline-block',
          position: 'relative',
          fontSize,
          lineHeight: 1.06,
          textTransform: 'uppercase',
          letterSpacing: `${mix(tracking + 0.06, tracking, entra)}em`,
          // el relleno metálico se recorta contra las letras
          backgroundImage: METAL,
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          color: 'transparent',
          transform: `translateY(${(1 - entra) * 108}%)`,
        }}
      >
        {texto}
        {b >= 0 && b < 1 ? (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `linear-gradient(100deg, transparent ${mix(-30, 100, b)}%, rgba(255,255,255,0.85) ${mix(-15, 115, b)}%, transparent ${mix(0, 130, b)}%)`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            {texto}
          </span>
        ) : null}
      </span>
    </span>
  );
};

/**
 * El núcleo: el avatar del canal —un iris metálico con el corazón encendido—
 * montado en su aro, con el glow prendiendo.
 *
 * Se usa la imagen real del canal en vez de redibujar el iris en SVG. Es mejor
 * pieza que cualquier reconstrucción, y si el canal cambia de logotipo esto
 * sigue funcionando sin tocar código.
 */
export const Nucleo: React.FC<{
  logo?: string;
  design: DesignTokens;
  size?: number;
  from?: number;
  /**
   * Acercamiento sobre el avatar. Un logotipo cuadrado trae su propio margen
   * —y este además tiene viñeta—, así que a escala 1 el aro encierra sobre todo
   * fondo negro y la pieza se lee como una bola oscura en vez de como un iris.
   */
  zoom?: number;
}> = ({ logo, design: d, size = 260, from = 0, zoom = 1.3 }) => {
  const frame = useCurrentFrame();
  const t = frame - from;
  const entra = span(frame, from, 26, Ease.outBack6);
  // el encendido va DESPUÉS de que el disco se asiente: primero llega la pieza,
  // luego arranca. Al revés parece que ya estaba encendida y solo se acercó.
  const prende = span(frame, from + 14, 20, Ease.outExpo);
  const latido = 1 + 0.05 * Math.sin(t / 11);
  const r = size / 2;
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        flex: 'none',
        transform: `scale(${mix(0.7, 1, clamp(entra, 0, 1.06))})`,
        opacity: clamp(entra, 0, 1),
      }}
    >
      {/* halo del núcleo: crece al prender y luego respira */}
      <div
        style={{
          position: 'absolute',
          inset: -size * 0.22,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${hexToRgba(d.accent, 0.34 * prende)}, transparent 62%)`,
          transform: `scale(${mix(0.6, latido, prende)})`,
        }}
      />
      {/* aro de metal, con el borde brillante arriba como en la pieza real */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          padding: Math.max(3, size * 0.018),
          background: `linear-gradient(165deg, ${hexToRgba(d.foreground, 0.55)}, ${hexToRgba(d.muted, 0.18)} 42%, ${hexToRgba(d.background, 0.9)})`,
          boxShadow: `0 0 ${34 * prende}px ${hexToRgba(d.accent, 0.4 * prende)}`,
        }}
      >
        {logo !== undefined && logo !== '' ? (
          <div style={{ width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden' }}>
            <Img
              src={logo}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: `scale(${zoom})`,
              }}
            />
          </div>
        ) : (
          // sin avatar: el iris esquemático, para que la pieza no quede vacía
          <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', height: '100%' }}>
            <circle cx={r} cy={r} r={r * 0.94} fill={d.surface} />
            {HEX.map(([ux, uy], i) => (
              <line
                key={i}
                x1={r + ux * r * 0.28}
                y1={r + uy * r * 0.28}
                x2={r + ux * r * 0.82}
                y2={r + uy * r * 0.82}
                stroke={hexToRgba(d.muted, 0.5)}
                strokeWidth={size * 0.02}
                strokeLinecap="round"
              />
            ))}
            <circle cx={r} cy={r} r={r * 0.2 * mix(0.4, latido, prende)} fill={d.accent} />
          </svg>
        )}
      </div>
    </div>
  );
};

/**
 * Regla de acento con un nodo encendido en la punta: la firma corta que separa
 * el nombre del subtítulo, y el mismo gesto que remata el rótulo.
 */
export const ReglaNodo: React.FC<{
  design: DesignTokens;
  from: number;
  ancho: number;
  alto?: number;
}> = ({ design: d, from, ancho, alto = 4 }) => {
  const frame = useCurrentFrame();
  const p = span(frame, from, 22, Ease.outCubic);
  const luz = span(frame, from + 12, 12, Ease.outExpo);
  const w = mix(0, ancho, p);
  return (
    <div style={{ position: 'relative', width: w, height: alto }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: alto / 2,
          background: `linear-gradient(90deg, ${hexToRgba(d.muted, 0.25)}, ${d.accent})`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: -alto,
          top: -alto,
          width: alto * 3,
          height: alto * 3,
          borderRadius: '50%',
          background: d.accent,
          boxShadow: `0 0 ${16 * luz}px ${hexToRgba(d.accent, 0.95)}`,
          opacity: clamp(luz, 0, 1),
        }}
      />
    </div>
  );
};
