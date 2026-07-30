import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign, hexToRgba, type DesignTokens } from '@fabrica/shared';
import { displayText, FONT_FAMILY } from '../fonts';
import { glassSurface } from '../effects';
import { Ease, mix, span } from '../effects/motion';
import { WordsReveal, overlayWindows } from './shared';

// Rótulo inferior integrado 'rotulo-basico@0.1.0' (contrato lowerThirdPropsSchema).
//
// REESCRITA EN SITIO (mismo ref).
//
// El gesto es «pintar y revelar» en dos tiempos: primero un brochazo sólido de
// acento que crece de izquierda a derecha, y después ese brochazo se retrae a
// una espina mientras el panel de cristal aparece detrás. Es el movimiento de
// rótulo broadcast reconocible, y cuesta unas quince líneas.
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
  // 2) se retrae a una espina de 8 px mientras el panel se revela detrás
  const retrae = span(frame, 10, 12, Ease.outCubic);
  const panel = span(frame, 10, 12, Ease.outCubic);

  const sub = span(frame, 20, 12, Ease.outCubic);
  const filete = span(frame, 26, 14, Ease.outCubic);

  const sale = span(frame, durationInFrames - exitF, exitF, Ease.inOutCubic);

  if (title.trim() === '') return null;

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
          overflow: 'hidden',
          // al salir barre hacia la izquierda, espejo de la entrada
          clipPath: `inset(0 0 0 ${sale * 100}%)`,
          boxShadow: `0 12px 34px ${hexToRgba('#000000', 0.4)}`,
        }}
      >
        {/* brochazo → espina: el ancho pasa de todo el bloque a 8 px */}
        <div
          style={{
            width: mix(8, 460, brocha * (1 - retrae)) + 8 * retrae,
            flex: 'none',
            background: d.accent,
          }}
        />
        <div
          style={{
            padding: '14px 26px 16px 22px',
            clipPath: `inset(0 ${(1 - panel) * 100}% 0 0)`,
            ...glassSurface(d),
            borderRadius: 0,
            border: 'none',
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
                fontSize: 22,
                color: d.muted,
                marginTop: 4,
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
