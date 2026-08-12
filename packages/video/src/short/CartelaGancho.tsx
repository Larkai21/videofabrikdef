import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import type { DesignTokens } from '@fabrica/shared';
import { defaultDesign, hexToRgba } from '@fabrica/shared';
import { glassSurface } from '../effects';
import { clamp, Ease, span } from '../effects/motion';
import { displayText, FONT_FAMILY } from '../fonts';
import { useLienzo } from '../lienzo';
import { CARTELA_INTERLINEA, CARTELA_PAD_X, CARTELA_PAD_Y, cuerpoDeCartela } from './cuerpo';

// El titular del short, en la banda que en 9:16 existe y en 16:9 no: entre la
// cabecera de la plataforma y la ventana limpia.
//
// Se retira a los ~3 s en vez de quedarse toda la pieza. Un título persistente
// roba durante treinta segundos la única banda donde cabe una tarjeta sin
// chocar con el subtítulo, y pasados tres segundos ya no lo lee nadie.
//
// El `hook` NO se pinta, y es decisión, no hueco: la banda mide 200 px y en
// los 3 s de cartela ya compiten el titular y los subtítulos; un segundo texto
// no cabe sin robar la ventana limpia. Además el hook ES la primera frase del
// audio por construcción (el director prima empezar en el beat 0) y viaja en
// description.txt, así que pintarlo sería oírlo y leerlo dos veces.

// los tiempos y la geometría viven en ./cuerpo (puro); se re-exportan para
// que los consumidores de la composición no cambien de import
export {
  CARTELA_ATERRIZA_FRAME,
  CARTELA_FRAMES,
  CARTELA_SALE_FRAME,
} from './cuerpo';
import {
  CARTELA_ENTRADA_FRAMES as ENTRADA_FRAMES,
  CARTELA_PERMANENCIA_FRAMES as PERMANENCIA_FRAMES,
  CARTELA_SALIDA_FRAMES as SALIDA_FRAMES,
} from './cuerpo';

export const CartelaGancho: React.FC<{ title: string; design?: DesignTokens }> = ({
  title,
  design,
}) => {
  const d = design ?? defaultDesign();
  const lienzo = useLienzo();
  const frame = useCurrentFrame();
  if (title.trim() === '') return null;

  const entra = clamp(span(frame, 0, ENTRADA_FRAMES, Ease.outBack6), 0, 1.1);
  const sale = span(frame, ENTRADA_FRAMES + PERMANENCIA_FRAMES, SALIDA_FRAMES, Ease.inCubic);
  const opacidad = clamp(span(frame, 0, 8, Ease.outExpo), 0, 1) * (1 - sale);
  const [cartelaIni, cartelaFin] = lienzo.zonas.cartela;
  const alto = cartelaFin - cartelaIni;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', fontFamily: FONT_FAMILY }}>
      <div
        style={{
          position: 'absolute',
          top: cartelaIni,
          left: lienzo.safe.left,
          right: lienzo.safe.right,
          minHeight: alto * 0.55,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          opacity: opacidad,
          // entra desde arriba y se asienta con el sobrepaso calibrado al 6 %
          transform: `translateY(${((1 - entra) * -40).toFixed(1)}px) scale(${(0.92 + 0.08 * entra).toFixed(3)})`,
          ...glassSurface(d, { accent: true }),
          padding: `${CARTELA_PAD_Y}px ${CARTELA_PAD_X}px`,
          borderRadius: 18,
        }}
      >
        <span
          style={{
            ...displayText(800),
            fontSize: cuerpoDeCartela(title, lienzo),
            lineHeight: CARTELA_INTERLINEA,
            color: d.foreground,
            textShadow: `0 2px 12px ${hexToRgba('#000000', 0.5)}`,
          }}
        >
          {title}
        </span>
      </div>
    </AbsoluteFill>
  );
};
