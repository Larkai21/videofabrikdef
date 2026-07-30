import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign, hexToRgba, type DesignTokens } from '@fabrica/shared';
import { FONT_FAMILY } from '../fonts';
import { Ambience } from '../effects';
import { Ease, clamp, mix, pulse, span } from '../effects/motion';
import { hashSeed } from '../seed';
import { AccentSweep, BrandMark, MeshBackdrop, WordsReveal, fitTitleSize } from './shared';

// Intro integrada 'intro-basica@0.1.0' (contrato introOutroPropsSchema).
// Duración fija: INTRO_BASICA_DURATION_FRAMES (registry-gen.ts); la Sequence que
// la monta mide eso y aquí se lee con useVideoConfig.
//
// REESCRITA EN SITIO (mismo ref): los maestros ya renderizados dejan de salir
// idénticos, pero los vídeos en curso heredan la versión nueva sin migrar nada,
// porque master.brand.components congela el ref y nadie lo re-sincroniza.
//
// Tres actos: entrada (0-24), sostenimiento (24-78) y salida (78-96). La entrada
// se ancla a frames absolutos y la salida se deriva de durationInFrames, así la
// pieza funciona igual si se cambia la duración.
//
// `logo` es opcional en el contrato y hay canales sin avatar: en ese caso
// BrandMark cae al monograma, y la malla de fondo es la capa que evita que la
// intro se vea vacía. Determinismo (docs/render.md §4): solo useCurrentFrame +
// matemática pura, fuente empaquetada, sin red, relojes ni animaciones CSS.

export type IntroOutroProps = {
  channel_name: string;
  logo?: string;
  design?: DesignTokens;
};

export const IntroBasica: React.FC<IntroOutroProps> = ({ channel_name, logo, design }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const d = design ?? defaultDesign();
  const seed = hashSeed(channel_name);

  // salida global: fade + leve zoom para entregar el corte al cuerpo
  const exitF = 12;
  const salida = span(frame, durationInFrames - exitF, exitF, Ease.outCubic);
  const exit = 1 - salida;
  const exitScale = mix(1, 1.06, salida);

  // los dos focos de luz derivan despacio: el fondo nunca está del todo quieto
  const driftX = Math.sin(frame / 48) * 3;
  const driftY = Math.cos(frame / 62) * 3;
  const bgIn = span(frame, 0, 10, Ease.outExpo);

  // regla de acento bajo el nombre; el overshoot de outBack es lo que la hace
  // sentirse editada y no interpolada
  const barra = span(frame, 30, 16, Ease.outBack);
  const barraW = mix(0, 320, clamp(barra, 0, 1.15));

  // destello de entrega justo antes del corte, para tapar el salto al b-roll
  const flash = pulse(frame, durationInFrames - 16, durationInFrames - 4, 4, 6) * 0.18;

  const titleSize = fitTitleSize(channel_name);

  return (
    <AbsoluteFill
      style={{ backgroundColor: d.background, fontFamily: FONT_FAMILY, overflow: 'hidden' }}
    >
      {/* dos focos de luz que derivan */}
      <AbsoluteFill
        style={{
          opacity: bgIn * exit,
          background: `radial-gradient(circle at ${30 + driftX}% ${35 + driftY}%, ${hexToRgba(d.accent, 0.18)}, transparent 55%), radial-gradient(circle at ${70 - driftX}% ${70 - driftY}%, ${hexToRgba(d.surface, 0.9)}, transparent 60%)`,
        }}
      />

      <AbsoluteFill style={{ opacity: exit }}>
        <MeshBackdrop design={d} seed={seed} from={0} intensity={0.55} />
      </AbsoluteFill>

      <AbsoluteFill style={{ opacity: exit }}>
        <AccentSweep design={d} from={6} dur={34} />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          opacity: exit,
          transform: `scale(${exitScale})`,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 30,
            padding: '0 120px',
          }}
        >
          <BrandMark channelName={channel_name} logo={logo} design={d} size={200} from={4} />

          <WordsReveal
            text={channel_name}
            from={16}
            stagger={4}
            fontSize={titleSize}
            weight={800}
            color={d.foreground}
          />

          <div
            style={{
              position: 'relative',
              width: barraW,
              height: 6,
              borderRadius: 3,
              background: d.accent,
            }}
          >
            {/* punto que recorre la barra hasta asentarse en el extremo */}
            <div
              style={{
                position: 'absolute',
                top: -2,
                left: mix(0, Math.max(0, barraW - 10), span(frame, 32, 20, Ease.outCubic)),
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: d.foreground,
                boxShadow: `0 0 12px ${hexToRgba(d.accent, 0.9)}`,
                opacity: clamp(barra, 0, 1),
              }}
            />
          </div>
        </div>
      </AbsoluteFill>

      {/* misma atmósfera que el cuerpo del vídeo: une la intro con el b-roll */}
      <Ambience design={d} />

      {flash > 0 ? <AbsoluteFill style={{ background: d.accent, opacity: flash }} /> : null}
    </AbsoluteFill>
  );
};
