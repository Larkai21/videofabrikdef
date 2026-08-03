import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { defaultDesign, hexToRgba } from '@fabrica/shared';
import { displayText, FONT_FAMILY } from '../fonts';
import { Ambience } from '../effects';
import { Ease, clamp, mix, pulse, span } from '../effects/motion';
import { Entramado, Losa, Nucleo, TextoMetal } from './kernel';
import { WordsReveal } from './shared';

// Outro integrada 'outro-basica@0.1.0' (contrato introOutroPropsSchema).
// Duración fija OUTRO_BASICA_DURATION_FRAMES (registry-gen.ts); se monta tras el
// último beat, así que NO desplaza nada: solo suma a la duración total.
//
// REESCRITA EN SITIO (mismo ref), igual que la intro.
//
// Es la intro al revés y a propósito: allí el entramado se dibuja hacia fuera y
// el núcleo prende; aquí el entramado se cierra sobre el centro y lo último que
// queda encendido es el núcleo. Un canal se reconoce por cómo abre y cierra.
//
// El latido de la píldora es un pulso por segundo con ping de radar, no un
// Math.sin continuo: un elemento que vibra sin parar se lee como barato, y uno
// que late una vez por segundo se lee como una llamada a la acción.
//
// Sin `logo` el Núcleo cae al iris esquemático. Determinismo: solo
// useCurrentFrame + matemática pura, sin relojes, red ni animaciones CSS.

export const OutroBasica: React.FC<{
  channel_name: string;
  logo?: string;
  tagline?: string;
  design?: import('@fabrica/shared').DesignTokens;
}> = ({ channel_name, logo, design }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const d = design ?? defaultDesign();

  const exitF = 12;
  const salida = span(frame, durationInFrames - exitF, exitF, Ease.outCubic);
  const exit = 1 - salida;
  const exitScale = mix(1, 1.04, salida);

  // revelado en cortina: misma gramática que las transiciones de sección
  const cortina = span(frame, 0, 14, Ease.outExpo);
  const inset = (1 - cortina) * 50;

  // el entramado se CIERRA: entra ancho y se recoge sobre el centro
  const recoge = span(frame, 10, 54, Ease.inOutCubic);

  // píldora: entra con rebote y luego late una vez por segundo
  const pill = span(frame, 34, 14, Ease.outBack6);
  const ciclo = frame >= 56 ? (frame - 56) % 30 : -1;
  const latido = ciclo >= 0 ? 1 + 0.05 * pulse(ciclo, 0, 30, 6, 10) : 1;
  const ping = ciclo >= 0 ? span(ciclo, 0, 30, Ease.outCubic) : 0;

  // barra de cierre al pie: rima con la ProgressBar del cuerpo y dice «se acabó»
  const cierre = span(frame, 44, 66, Ease.inOutCubic);

  return (
    <AbsoluteFill
      style={{ backgroundColor: d.background, fontFamily: FONT_FAMILY, overflow: 'hidden' }}
    >
      <AbsoluteFill style={{ opacity: exit }}>
        <Losa design={d} luz={0.8} />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          opacity: exit,
          background: `radial-gradient(circle at 50% 46%, ${hexToRgba(d.accent, 0.14)}, transparent 58%)`,
        }}
      />

      {/* El entramado converge hacia el núcleo en vez de abrirse, y con el
          centro AGUJEREADO: aquí va detrás del texto, y sin el hueco los
          puntales cruzan «Gracias por ver» y el remate se lee peor que el
          b-roll que acaba de terminar. */}
      <AbsoluteFill style={{ opacity: exit * 0.7, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ transform: `scale(${mix(1.55, 1.05, recoge)})` }}>
          <Entramado design={d} from={0} size={980} giro={-0.03} intensidad={0.75} hueco={0.34} />
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          opacity: exit,
          transform: `scale(${exitScale})`,
          clipPath: `inset(0 ${inset}% 0 ${inset}%)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 18,
            padding: '0 120px',
            textAlign: 'center',
          }}
        >
          <Nucleo logo={logo} design={d} size={148} from={6} />

          <WordsReveal
            text="Gracias por ver"
            from={14}
            stagger={3}
            fontSize={60}
            weight={800}
            color={d.foreground}
          />

          {channel_name.length > 0 ? (
            // a 34 px el degradado de metal no tiene sitio para leerse como
            // metal y solo se ve gris; a 44 sí, y aguanta el fondo oscuro
            <TextoMetal texto={channel_name} from={24} fontSize={44} weight={800} tracking={0.16} />
          ) : null}

          <div style={{ position: 'relative', marginTop: 12 }}>
            {/* ping de radar que sale de la píldora */}
            {ping > 0 ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 999,
                  border: `2px solid ${d.accent}`,
                  transform: `scale(${mix(1, 1.35, ping)})`,
                  opacity: (1 - ping) * 0.5,
                }}
              />
            ) : null}
            <div
              style={{
                ...displayText(700),
                transform: `scale(${mix(0.7, 1, clamp(pill, 0, 1.15)) * latido})`,
                opacity: clamp(pill, 0, 1),
                background: d.accent,
                color: d.accent_fg,
                fontSize: 26,
                padding: '12px 30px',
                borderRadius: 999,
                boxShadow: `0 10px 30px ${hexToRgba(d.accent, 0.45)}`,
              }}
            >
              Suscríbete
            </div>
          </div>
        </div>
      </AbsoluteFill>

      {/* barra de cierre */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: 4,
          width: `${cierre * 100}%`,
          background: d.accent,
          opacity: exit * 0.9,
        }}
      />

      <Ambience design={d} />
    </AbsoluteFill>
  );
};
