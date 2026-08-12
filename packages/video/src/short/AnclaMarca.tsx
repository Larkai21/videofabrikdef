import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame } from 'remotion';
import type { DesignTokens } from '@fabrica/shared';
import { defaultDesign, hexToRgba } from '@fabrica/shared';
import { clamp, Ease, span } from '../effects/motion';
import { displayText, FONT_FAMILY } from '../fonts';
import { useLienzo } from '../lienzo';

// El ancla de marca del short: avatar y nombre del canal, pequeños y arriba,
// desde que la cartela se retira hasta el final.
//
// Existe porque un short compartido fuera de la plataforma no decía de quién
// era en 30 de sus 33 s: la cartela se va a los ~3 s (decisión correcta, roba
// la única banda útil) y con ella se iba la única marca visible. Esto ocupa la
// esquina superior del área segura a opacidad baja: presencia, no rótulo — el
// rótulo del kit se descartó en vertical porque compite con los subtítulos.

const ENTRADA_FRAMES = 10;

export const AnclaMarca: React.FC<{
  nombre?: string | undefined;
  avatarSrc?: string | undefined;
  design?: DesignTokens | undefined;
}> = ({ nombre, avatarSrc, design }) => {
  const d = design ?? defaultDesign();
  const lienzo = useLienzo();
  const frame = useCurrentFrame();
  if ((nombre ?? '') === '' && avatarSrc === undefined) return null;

  const opacidad = clamp(span(frame, 0, ENTRADA_FRAMES, Ease.outCubic), 0, 1) * 0.7;
  const [cartelaIni] = lienzo.zonas.cartela;
  const alto = 30;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', fontFamily: FONT_FAMILY }}>
      <div
        style={{
          position: 'absolute',
          top: cartelaIni,
          left: lienzo.safe.left,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          opacity: opacidad,
        }}
      >
        {avatarSrc !== undefined ? (
          <Img
            src={avatarSrc}
            style={{
              width: alto,
              height: alto,
              borderRadius: '50%',
              objectFit: 'cover',
              border: `1px solid ${hexToRgba(d.foreground, 0.4)}`,
            }}
          />
        ) : null}
        {(nombre ?? '') !== '' ? (
          <span
            style={{
              ...displayText(700),
              fontSize: 24,
              color: d.foreground,
              textShadow: `0 1px 8px ${hexToRgba('#000000', 0.6)}`,
            }}
          >
            {nombre}
          </span>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
