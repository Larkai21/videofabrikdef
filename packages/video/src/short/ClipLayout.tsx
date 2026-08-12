import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Cue, DesignTokens } from '@fabrica/shared';
import type { PiezaMaster } from '../brand-kit';
import { defaultDesign, hexToRgba } from '@fabrica/shared';
import { clamp, Ease, span } from '../effects/motion';
import { displayText, FONT_FAMILY } from '../fonts';
import { isRenderableSrc, toSrc } from '../media-src';

// Layout de CLIP de episodio, calcado del formato de referencia (canal de
// clips medido fotograma a fotograma sobre editing.mp4, 12-ago-2026):
//
//   - fondo negro puro
//   - cabecera del canal: avatar redondo + nombre en bold + @handle en gris
//   - titular en 2 líneas, blanco con PALABRAS CLAVE a color (amarillo /
//     verde / cian rotando)
//   - tarjeta de vídeo ~cuadrada (90 % de ancho, 30→83 % de alto) con
//     esquinas redondeadas; dentro, el clip pre-cortado con el hablante
//     trackeado
//   - subtítulo de 1-2 palabras en amarillo con contorno negro, pisando el
//     tercio bajo de la tarjeta
//
// Medidas en fracción del lienzo para que 1080×1920 dé los px del original.

const AMARILLO = '#FFD348';
const VERDE = '#A8E063';
const CIAN = '#3EE0F0';
const ACENTOS = [AMARILLO, VERDE, CIAN];

/** Palabras con carga (>4 letras) a color, rotando la paleta del formato. */
export function coloresDeTitulo(titulo: string): { texto: string; color: string | null }[] {
  let acento = 0;
  return titulo.split(/\s+/).map((palabra) => {
    const limpia = palabra.replace(/[^\p{L}\p{N}]/gu, '');
    if (limpia.length > 4) {
      const color = ACENTOS[acento % ACENTOS.length]!;
      acento += 1;
      return { texto: palabra, color };
    }
    return { texto: palabra, color: null };
  });
}

const CabeceraCanal: React.FC<{
  nombre: string;
  avatarSrc?: string | undefined;
  ancho: number;
}> = ({ nombre, avatarSrc, ancho }) => {
  const handle = `@${nombre.toLowerCase().replace(/\s+/g, '')}`;
  const avatar = Math.round(ancho * 0.124); // 134 px a 1080
  return (
    <div
      style={{
        position: 'absolute',
        top: '7.9%',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: Math.round(ancho * 0.022),
      }}
    >
      {avatarSrc !== undefined ? (
        <Img
          src={avatarSrc}
          style={{ width: avatar, height: avatar, borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : null}
      <div style={{ display: 'grid', lineHeight: 1.15 }}>
        <span style={{ ...displayText(800), fontSize: Math.round(ancho * 0.048), color: '#fff' }}>
          {nombre} <span style={{ color: CIAN }}>✓</span>
        </span>
        <span
          style={{
            fontSize: Math.round(ancho * 0.03),
            color: hexToRgba('#ffffff', 0.55),
            fontStyle: 'italic',
          }}
        >
          {handle}
        </span>
      </div>
    </div>
  );
};

const Titular: React.FC<{ titulo: string; ancho: number }> = ({ titulo, ancho }) => {
  const partes = coloresDeTitulo(titulo);
  const chars = Math.max(8, titulo.length);
  // dos líneas a 90 % de ancho: mismo estimador de glifo que la cartela
  const porLinea = Math.ceil(chars / 2);
  const cuerpo = Math.min(
    Math.round(ancho * 0.088),
    Math.floor((ancho * 0.92) / (0.52 * porLinea)),
  );
  return (
    <div
      style={{
        position: 'absolute',
        top: '14.6%',
        left: '5%',
        width: '90%',
        textAlign: 'center',
        ...displayText(800),
        fontSize: cuerpo,
        lineHeight: 1.18,
        color: '#fff',
      }}
    >
      {partes.map((p, i) => (
        <React.Fragment key={i}>
          <span style={p.color !== null ? { color: p.color } : undefined}>{p.texto}</span>
          {i < partes.length - 1 ? ' ' : null}
        </React.Fragment>
      ))}
    </div>
  );
};

/**
 * Subtítulo del formato: SLAM palabra a palabra, portado del catálogo hermano
 * (caption-kinetic-slam): mayúsculas, entra a escala 0,55→1 con sobrepaso,
 * rotación sembrada de ±2° y color alterno amarillo/blanco. El contorno negro
 * y la posición (tercio bajo de la tarjeta) son los del canal de referencia.
 */
const SubtituloClip: React.FC<{ cues: readonly Cue[]; ancho: number }> = ({ cues, ancho }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentMs = (frame / fps) * 1000;
  const activo = cues.find((c) => currentMs >= c.from_ms && currentMs < c.to_ms);
  if (!activo || activo.words.length === 0) return null;
  // pares de ≤2 palabras (la referencia nunca enseña más), pero cada palabra
  // del par SLAMEA por su cuenta cuando le toca sonar
  const pares: { from_ms: number; to_ms: number; words: typeof activo.words }[] = [];
  for (let i = 0; i < activo.words.length; i += 2) {
    const a = activo.words[i]!;
    const b = activo.words[i + 1];
    pares.push({
      from_ms: a.from_ms,
      to_ms: (b ?? a).to_ms,
      words: b !== undefined ? [a, b] : [a],
    });
  }
  const idx = pares.findIndex((g, i) => {
    const sig = pares[i + 1];
    const fin = sig !== undefined ? sig.from_ms : g.to_ms + 260;
    return currentMs >= g.from_ms && currentMs < fin;
  });
  if (idx === -1) return null;
  const grupo = pares[idx]!;
  const texto = grupo.words.map((w) => w.w).join(' ');
  const cuerpo = Math.min(
    Math.round(ancho * 0.085),
    Math.floor((ancho * 0.88) / (0.56 * Math.max(5, texto.length))),
  );
  const borde = Math.max(3, Math.round(cuerpo * 0.09));
  // rotación sembrada por el instante del par: determinista y alterna
  const giro = (idx % 2 === 0 ? 1 : -1) * (1.2 + (grupo.from_ms % 5) * 0.16);
  return (
    <div
      style={{
        position: 'absolute',
        top: '68.5%',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        gap: Math.round(cuerpo * 0.28),
        transform: `rotate(${giro.toFixed(2)}deg)`,
        ...displayText(800),
        fontSize: cuerpo,
        textTransform: 'uppercase',
        letterSpacing: '0.02em',
      }}
    >
      {grupo.words.map((w, i) => {
        const desde = Math.round((w.from_ms / 1000) * fps);
        const e = clamp(span(frame - desde, 0, 5, Ease.outBack6), 0, 1.12);
        const visible = currentMs >= w.from_ms - 40;
        // alterna amarillo/blanco por posición GLOBAL del par, no dentro de él
        const color = (idx + i) % 2 === 0 ? AMARILLO : '#ffffff';
        return (
          <span
            key={i}
            style={{
              opacity: visible ? 1 : 0,
              transform: `scale(${(0.55 + 0.45 * e).toFixed(3)})`,
              color,
              WebkitTextStroke: `${borde}px #000`,
              paintOrder: 'stroke fill',
              textShadow: `0 ${Math.round(cuerpo * 0.06)}px 0 #000, 0 6px 18px ${hexToRgba('#000000', 0.6)}`,
            }}
          >
            {w.w}
          </span>
        );
      })}
    </div>
  );
};

// El layout recibe el maestro PROGRESIVO del player (PiezaMaster), no el tipo
// completo: cada capa tolera la ausencia de su sección, como el resto de Pieza.
export const ClipLayout: React.FC<{
  master: Pick<PiezaMaster, 'beats' | 'cues' | 'brand' | 'short'>;
  design?: DesignTokens | undefined;
  avatarSrc?: string | undefined;
}> = ({ master, design, avatarSrc }) => {
  const d = design ?? defaultDesign();
  const { width: ancho } = useVideoConfig();
  const clipPath = master.beats?.[0]?.asset?.path;
  const nombre = master.brand?.channel_name ?? '';

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', fontFamily: FONT_FAMILY }}>
      <CabeceraCanal nombre={nombre} avatarSrc={avatarSrc} ancho={ancho} />
      {master.short !== undefined ? <Titular titulo={master.short.title} ancho={ancho} /> : null}
      {/* la tarjeta: ~cuadrada, redondeada, con el clip pre-cortado dentro */}
      <div
        style={{
          position: 'absolute',
          top: '29.9%',
          left: '5%',
          width: '90%',
          height: '53.3%',
          borderRadius: Math.round(ancho * 0.042),
          overflow: 'hidden',
          backgroundColor: hexToRgba(d.foreground, 0.04),
        }}
      >
        {clipPath !== undefined && isRenderableSrc(clipPath) ? (
          <OffthreadVideo
            src={toSrc(clipPath)}
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : null}
      </div>
      <SubtituloClip cues={master.cues ?? []} ancho={ancho} />
    </AbsoluteFill>
  );
};
