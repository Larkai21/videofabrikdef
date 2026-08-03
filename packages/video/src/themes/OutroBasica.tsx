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
// A 15 s (las pantallas finales de YouTube exigen 5–20 s), la outro tiene dos
// actos: el cierre de siempre en el centro, y a los ~3,5 s el bloque se desliza
// al tercio izquierdo mientras a la derecha se dibujan DOS MARCOS 16:9 vacíos.
// No son decoración: son las zonas donde YouTube Studio coloca los elementos
// de pantalla final (vídeo sugerido y lista), así el «suscríbete» hablado pasa
// a ser clicable sin que los elementos tapen nada. Los marcos se dejan quietos
// y con poco contraste: encima va una miniatura real, no hay que competir.
//
// El latido de la píldora es un pulso por segundo con ping de radar, no un
// Math.sin continuo: un elemento que vibra sin parar se lee como barato, y uno
// que late una vez por segundo se lee como una llamada a la acción.
//
// El avatar solo entra si el canal lo pide (`avatar_en_video`); sin él manda el
// entramado, que ya converge al centro y hace de foco. Determinismo: solo
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

  // segundo acto: el bloque central se hace a un lado y entran las zonas de
  // pantalla final. El deslizamiento respira DESPUÉS del remate del cierre.
  const desliza = span(frame, 104, 26, Ease.inOutCubic);
  const marcoA = span(frame, 118, 16, Ease.outCubic);
  const marcoB = span(frame, 130, 16, Ease.outCubic);
  const rotulo = span(frame, 142, 14, Ease.outCubic);

  // barra de cierre al pie: rima con la ProgressBar del cuerpo y dice «se
  // acabó» — recorre la outro ENTERA, así también es la cuenta atrás real
  const cierre = span(frame, 44, Math.max(1, durationInFrames - 44 - exitF), Ease.inOutCubic);

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
      <AbsoluteFill
        style={{
          opacity: exit * mix(0.7, 0.3, desliza),
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            transform: `translateX(${mix(0, -430, desliza)}px) scale(${mix(1.55, 1.05, recoge)})`,
          }}
        >
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
            transform: `translateX(${mix(0, -430, desliza)}px) scale(${mix(1, 0.92, desliza)})`,
          }}
        >
          {logo !== undefined && logo !== '' ? (
            <Nucleo logo={logo} design={d} size={148} from={6} />
          ) : null}

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

      {/* zonas de pantalla final: dos marcos 16:9 en la mitad derecha, dentro
          del área segura. YouTube coloca encima el vídeo sugerido y la lista;
          los marcos solo tienen que decir «esto va aquí» sin competir. */}
      <AbsoluteFill style={{ opacity: exit }}>
        <div
          style={{
            position: 'absolute',
            left: 1120,
            top: 116,
            width: 640,
            opacity: rotulo,
            transform: `translateY(${(1 - rotulo) * 10}px)`,
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: '0.04em',
            color: hexToRgba(d.foreground, 0.6),
          }}
        >
          Más del canal
        </div>
        {[
          { p: marcoA, top: 168 },
          { p: marcoB, top: 566 },
        ].map(({ p, top }, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: 1120,
              top,
              width: 640,
              height: 360,
              borderRadius: 18,
              border: `2px solid ${hexToRgba(d.foreground, 0.22)}`,
              background: hexToRgba(d.accent, 0.05),
              boxShadow: `inset 0 0 40px ${hexToRgba(d.accent, 0.06)}`,
              opacity: p,
              transform: `scale(${mix(0.96, 1, p)})`,
            }}
          />
        ))}
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
