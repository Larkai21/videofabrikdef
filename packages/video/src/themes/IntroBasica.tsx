import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign, hexToRgba, type DesignTokens } from '@fabrica/shared';
import { FONT_FAMILY, displayText } from '../fonts';
import { Ambience } from '../effects';
import { Ease, clamp, mix, pulse, span } from '../effects/motion';
import { Entramado, Losa, Nucleo, ReglaNodo, TextoMetal } from './kernel';
import { fitTitleSize } from './shared';

// Intro integrada 'intro-basica@0.1.0' (contrato introOutroPropsSchema).
// Duración fija: INTRO_BASICA_DURATION_FRAMES (registry-gen.ts); la Sequence que
// la monta mide eso y aquí se lee con useVideoConfig.
//
// REESCRITA EN SITIO (mismo ref), como ya se hizo antes: los maestros ya
// renderizados dejan de salir idénticos, pero los vídeos en curso heredan la
// versión nueva sin migrar nada, porque master.brand.components congela el ref
// y nadie lo re-sincroniza.
//
// La composición es la de la cabecera del canal, animada: entramado a los dos
// lados, logotipo en metal en el centro y la coletilla debajo. Lo que cambia
// respecto a una intro genérica es el ORDEN de los gestos: primero llega la
// pieza, después se enciende.
//
// El avatar solo entra si el canal lo pide (`avatar_en_video`). Sin él la
// pieza no queda coja: la cabecera de YouTube TAMPOCO lleva el avatar dentro,
// así que la versión sin disco es la fiel, y el entramado se acerca para
// ocupar el sitio.
//
// Tres actos: se dibuja (0-34), prende y se lee (34-78), entrega (78-96). La
// entrada va a frames absolutos y la salida se deriva de durationInFrames, así
// la pieza aguanta un cambio de duración.
//
// Determinismo (docs/render.md §4): solo useCurrentFrame + matemática pura,
// fuente empaquetada, sin red, relojes ni animaciones CSS.

export type IntroOutroProps = {
  channel_name: string;
  logo?: string;
  tagline?: string;
  design?: DesignTokens;
};

export const IntroBasica: React.FC<IntroOutroProps> = ({ channel_name, logo, tagline, design }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const d = design ?? defaultDesign();

  // salida global: fade + leve acercamiento para entregar el corte al cuerpo
  const exitF = 12;
  const salida = span(frame, durationInFrames - exitF, exitF, Ease.outCubic);
  const exit = 1 - salida;
  const exitScale = mix(1, 1.06, salida);

  // destello de entrega justo antes del corte, para tapar el salto al b-roll
  const flash = pulse(frame, durationInFrames - 16, durationInFrames - 4, 4, 6) * 0.16;

  const conAvatar = logo !== undefined && logo !== '';
  const titleSize = fitTitleSize(channel_name, 104, 52, 2050);
  const bgIn = span(frame, 0, 12, Ease.outExpo);
  // sin disco central el encuadre pide los motivos más adentro, como en la
  // cabecera, donde flanquean el logotipo de cerca
  const ladoX = conAvatar ? -140 : -40;

  return (
    <AbsoluteFill
      style={{ backgroundColor: d.background, fontFamily: FONT_FAMILY, overflow: 'hidden' }}
    >
      <AbsoluteFill style={{ opacity: bgIn * exit }}>
        <Losa design={d} />
      </AbsoluteFill>

      {/* El entramado flanquea el logotipo, como en la cabecera del canal: no va
          detrás del texto, va a los lados. Girando en sentidos opuestos y muy
          despacio, que es lo que lo mantiene vivo sin pedir atención. */}
      <AbsoluteFill style={{ opacity: exit, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', left: ladoX, top: '50%', marginTop: -300 }}>
          <Entramado design={d} from={2} size={600} giro={0.045} />
        </div>
        <div style={{ position: 'absolute', right: ladoX, top: '50%', marginTop: -300 }}>
          <Entramado design={d} from={5} size={600} giro={-0.045} />
        </div>
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
            gap: 26,
            padding: '0 140px',
          }}
        >
          {conAvatar ? <Nucleo logo={logo} design={d} size={230} from={4} /> : null}

          {/* el barrido especular cruza el logotipo cuando ya se ha leído */}
          <TextoMetal
            texto={channel_name}
            from={conAvatar ? 26 : 14}
            fontSize={conAvatar ? titleSize : Math.round(titleSize * 1.18)}
            weight={800}
            barrido={conAvatar ? 48 : 36}
          />

          {tagline !== undefined && tagline !== '' ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 22,
                opacity: clamp(span(frame, conAvatar ? 44 : 32, 18, Ease.outCubic), 0, 1),
              }}
            >
              {/* regla a los dos lados: con una sola, el grupo se centra como
                  bloque y la coletilla queda descentrada respecto al logotipo */}
              <ReglaNodo design={d} from={conAvatar ? 40 : 28} ancho={80} />
              <span
                style={{
                  ...displayText(600),
                  fontSize: Math.round(titleSize * 0.24),
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: d.muted,
                }}
              >
                {tagline}
              </span>
              <div style={{ transform: 'scaleX(-1)' }}>
                <ReglaNodo design={d} from={conAvatar ? 40 : 28} ancho={80} />
              </div>
            </div>
          ) : (
            <ReglaNodo design={d} from={conAvatar ? 40 : 28} ancho={320} alto={5} />
          )}
        </div>
      </AbsoluteFill>

      {/* misma atmósfera que el cuerpo del vídeo: une la intro con el b-roll */}
      <Ambience design={d} />

      {flash > 0 ? (
        <AbsoluteFill style={{ background: hexToRgba(d.accent, 0.9), opacity: flash }} />
      ) : null}
    </AbsoluteFill>
  );
};
