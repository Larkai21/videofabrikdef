import React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Cue, DesignTokens } from '@fabrica/shared';
import type { PiezaMaster } from '../brand-kit';
import { defaultDesign, hexToRgba } from '@fabrica/shared';
import { clamp, Ease, span } from '../effects/motion';
import { CLIP_FONT_FAMILY, clipText, ensureClipFontLoaded } from '../fonts';
import { anchoLibreCentrado, useLienzo } from '../lienzo';
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
        <span style={{ ...clipText(800), fontSize: Math.round(ancho * 0.048), color: '#fff' }}>
          {nombre} <span style={{ color: CIAN }}>✓</span>
        </span>
        <span
          style={{
            ...clipText(500),
            fontSize: Math.round(ancho * 0.03),
            color: hexToRgba('#ffffff', 0.55),
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
        ...clipText(800),
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
 * Subtítulos del formato: tres coreografías del catálogo hermano rotando por
 * frase, como alterna el editor del tutorial —
 *   slam         (caption-kinetic-slam): mayúsculas, escala con sobrepaso,
 *                rotación sembrada, amarillo/blanco alternos
 *   weight-shift (caption-weight-shift): el par entero visible; la palabra
 *                ACTIVA engorda y brilla, la otra adelgaza y se apaga
 *   highlight    (caption-highlight): caja amarilla barriendo detrás de la
 *                palabra activa, texto negro encima
 * Todo dentro del área segura DE VERDAD: ancho de anchoLibreCentrado (la
 * columna de acciones manda) y borde inferior por encima de la banda de la
 * interfaz — antes iba a porcentajes a ojo y se metía en la banda.
 */
const SubtituloClip: React.FC<{ cues: readonly Cue[]; ancho: number }> = ({ cues, ancho }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lienzo = useLienzo();
  const currentMs = (frame / fps) * 1000;
  const cueIdx = cues.findIndex((c) => currentMs >= c.from_ms && currentMs < c.to_ms);
  const activo = cueIdx >= 0 ? cues[cueIdx] : undefined;
  if (activo === undefined || activo.words.length === 0) return null;

  const pares: { from_ms: number; to_ms: number; words: typeof activo.words }[] = [];
  for (let i = 0; i < activo.words.length; i += 2) {
    const a = activo.words[i]!;
    const b = activo.words[i + 1];
    pares.push({ from_ms: a.from_ms, to_ms: (b ?? a).to_ms, words: b !== undefined ? [a, b] : [a] });
  }
  const idx = pares.findIndex((g, i) => {
    const sig = pares[i + 1];
    const fin = sig !== undefined ? sig.from_ms : g.to_ms + 260;
    return currentMs >= g.from_ms && currentMs < fin;
  });
  if (idx === -1) return null;
  const grupo = pares[idx]!;
  const texto = grupo.words.map((w) => w.w).join(' ');

  // geometría del área segura: ancho libre real y suelo sobre la banda.
  // El cuerpo base es la medida DICHA en el tutorial de referencia («size of
  // the captions … I'm going to go with 60» sobre secuencia 1080×1920): 60 px
  // a 1080 de ancho. El 0.08 anterior daba 86 px y desbordaba el área segura
  // en cuanto el par de palabras crecía.
  const anchoLibre = anchoLibreCentrado(lienzo);
  const cuerpo = Math.min(
    Math.round(ancho * 0.056),
    Math.floor(anchoLibre / (0.58 * Math.max(5, texto.length))),
  );
  const borde = Math.max(3, Math.round(cuerpo * 0.09));
  const sueloPx = lienzo.safe.bottom + Math.round(ancho * 0.015);

  // la coreografía rota POR FRASE (cue), sembrada por su índice: mayoría de
  // slam con weight-shift y highlight intercalados, como el editor real
  const estilos = ['slam', 'slam', 'weight', 'slam', 'highlight'] as const;
  const estilo = estilos[cueIdx % estilos.length]!;
  const giro = estilo === 'slam' ? (idx % 2 === 0 ? 1 : -1) * (1.2 + (grupo.from_ms % 5) * 0.16) : 0;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: sueloPx,
        left: (ancho - anchoLibre) / 2,
        width: anchoLibre,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'baseline',
        gap: Math.round(cuerpo * 0.28),
        transform: `rotate(${giro.toFixed(2)}deg)`,
        ...clipText(800),
        fontSize: cuerpo,
        textTransform: 'uppercase',
        letterSpacing: '0.02em',
      }}
    >
      {grupo.words.map((w, i) => {
        const desde = Math.round((w.from_ms / 1000) * fps);
        const e = clamp(span(frame - desde, 0, 5, Ease.outBack6), 0, 1.12);
        const visible = currentMs >= w.from_ms - 40;
        const activa = currentMs >= w.from_ms && currentMs < (grupo.words[i + 1]?.from_ms ?? grupo.to_ms + 260);

        if (estilo === 'weight') {
          // la activa engorda y brilla; la otra adelgaza y se apaga
          return (
            <span
              key={i}
              style={{
                opacity: visible ? (activa ? 1 : 0.55) : 0,
                transform: `scale(${activa ? (0.92 + 0.08 * e).toFixed(3) : '0.92'})`,
                fontWeight: activa ? 800 : 500,
                color: '#ffffff',
                WebkitTextStroke: `${borde}px #000`,
                paintOrder: 'stroke fill',
                textShadow: `0 ${Math.round(cuerpo * 0.06)}px 0 #000`,
              }}
            >
              {w.w}
            </span>
          );
        }
        if (estilo === 'highlight') {
          // caja amarilla barriendo detrás de la palabra activa, texto negro
          return (
            <span key={i} style={{ position: 'relative', display: 'inline-block' }}>
              <span
                style={{
                  position: 'absolute',
                  inset: `-${Math.round(cuerpo * 0.08)}px -${Math.round(cuerpo * 0.18)}px`,
                  background: AMARILLO,
                  borderRadius: Math.round(cuerpo * 0.14),
                  transform: `scaleX(${activa ? Math.min(1, e).toFixed(3) : '0'})`,
                  transformOrigin: 'left center',
                }}
              />
              <span
                style={{
                  position: 'relative',
                  opacity: visible ? 1 : 0,
                  color: activa ? '#111' : '#ffffff',
                  WebkitTextStroke: activa ? undefined : `${borde}px #000`,
                  paintOrder: 'stroke fill',
                }}
              >
                {w.w}
              </span>
            </span>
          );
        }
        // slam
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
  ensureClipFontLoaded();
  const d = design ?? defaultDesign();
  const { width: ancho } = useVideoConfig();
  const clipPath = master.beats?.[0]?.asset?.path;
  const nombre = master.brand?.channel_name ?? '';

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', fontFamily: CLIP_FONT_FAMILY }}>
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
