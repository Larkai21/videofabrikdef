import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign, hexToRgba, type DesignTokens } from '@fabrica/shared';
import { displayText, FONT_FAMILY } from '../fonts';
import { glassSurface } from '../effects';
import { Ease, clamp, mix, span } from '../effects/motion';
import { WordsReveal, overlayWindows } from './shared';

// Rótulo inferior integrado 'rotulo-basico@0.1.0' (contrato lowerThirdPropsSchema).
//
// REESCRITA EN SITIO (mismo ref).
//
// El gesto es «pintar y revelar» en dos tiempos: primero un brochazo sólido que
// crece de izquierda a derecha, y después se retrae a un PUNTAL con su nodo
// encendido mientras el panel de cristal aparece detrás. El puntal y el nodo son
// la misma pieza que forma el entramado de la intro: el rótulo es una celda
// suelta de esa retícula, no una barra de color cualquiera.
//
// bottom: 250 y no 150 — el bloque de subtítulos de dos líneas ocupa la franja
// inferior y el rótulo anterior lo solapaba.
//
// Determinismo: solo useCurrentFrame + matemática pura, sin fondo a pantalla
// completa (pointerEvents none), sin relojes ni animaciones CSS.

export type LowerThirdProps = {
  title: string;
  subtitle?: string;
  fromFrame: number;
  design?: DesignTokens;
};

export const RotuloBasico: React.FC<LowerThirdProps> = ({ title, subtitle, design }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const d = design ?? defaultDesign();
  const { exitF } = overlayWindows(durationInFrames, 22, 12);

  // 1) brochazo: crece de 0 al ancho completo
  const brocha = span(frame, 0, 12, Ease.outExpo);
  // 2) se retrae al puntal mientras el panel se revela detrás
  const retrae = span(frame, 10, 12, Ease.outCubic);
  const panel = span(frame, 10, 12, Ease.outCubic);
  // 3) el nodo prende cuando el puntal ya está en su sitio
  const nodo = span(frame, 20, 12, Ease.outExpo);

  const sub = span(frame, 20, 12, Ease.outCubic);
  const filete = span(frame, 26, 14, Ease.outCubic);

  const sale = span(frame, durationInFrames - exitF, exitF, Ease.inOutCubic);

  if (title.trim() === '') return null;

  const anchoPuntal = 9;

  return (
    <AbsoluteFill style={{ fontFamily: FONT_FAMILY, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: 96,
          bottom: 250,
          opacity: 1 - sale,
          transform: `translateX(${-sale * 24}px)`,
          display: 'flex',
          alignItems: 'stretch',
          borderRadius: 12,
          overflow: 'visible',
          // al salir barre hacia la izquierda, espejo de la entrada
          clipPath: `inset(-40px 0 -40px ${sale * 100}%)`,
          filter: `drop-shadow(0 12px 34px ${hexToRgba('#000000', 0.45)})`,
        }}
      >
        {/* brochazo → puntal, con el nodo de la retícula en la cabeza */}
        <div
          style={{
            position: 'relative',
            width: mix(anchoPuntal, 460, brocha * (1 - retrae)) + anchoPuntal * retrae,
            flex: 'none',
            borderRadius: '12px 0 0 12px',
            background: `linear-gradient(180deg, ${d.accent}, ${hexToRgba(d.accent, 0.55)})`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: anchoPuntal / 2 - 7,
              top: -7,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: d.accent,
              boxShadow: `0 0 ${18 * nodo}px ${hexToRgba(d.accent, 0.95)}`,
              opacity: clamp(nodo, 0, 1) * retrae,
              transform: `scale(${mix(0.4, 1, nodo)})`,
            }}
          />
        </div>
        <div
          style={{
            padding: '14px 30px 16px 24px',
            clipPath: `inset(0 ${(1 - panel) * 100}% 0 0)`,
            ...glassSurface(d),
            borderRadius: 0,
            border: 'none',
            // muesca hexagonal en la esquina, como las celdas del entramado
            borderTopRightRadius: 0,
            maskImage: 'linear-gradient(225deg, transparent 0 14px, #000 14px)',
            WebkitMaskImage: 'linear-gradient(225deg, transparent 0 14px, #000 14px)',
          }}
        >
          <WordsReveal
            text={title}
            from={14}
            stagger={2}
            fontSize={40}
            weight={800}
            color={d.foreground}
            align="left"
          />
          {subtitle !== undefined && subtitle.length > 0 ? (
            <div
              style={{
                ...displayText(500),
                fontSize: 21,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: d.muted,
                marginTop: 6,
                opacity: sub,
                transform: `translateY(${(1 - sub) * 8}px)`,
              }}
            >
              {subtitle}
            </div>
          ) : null}
          {/* filete de acento que se dibuja bajo el texto */}
          <div
            style={{
              marginTop: 10,
              width: `${filete * 100}%`,
              height: 2,
              borderRadius: 1,
              background: hexToRgba(d.accent, 0.9),
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
