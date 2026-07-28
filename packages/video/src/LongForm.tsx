import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { defaultDesign, type ComponentType as KitType, type MasterVideoJson } from '@fabrica/shared';
import { BeatVisual } from './BeatVisual';
import { computeBrandKitLayout, computeBrollTrack } from './brand-kit';
import { ensureFontLoaded, FONT_FAMILY } from './fonts';
import { isRenderableSrc, toSrc } from './media-src';
import { resolveComponent } from './registry.generated';
import { Subtitles } from './Subtitles';

const FALLBACK_SUBTITLE_THEME = 'subtitulos-basicos@0.1.0';

// Un componente del brand kit resuelto del registry generado. Se resuelve al
// renderizar (no al montar el árbol) y solo para slots que el layout ya
// comprobó presentes en el registry.
const KitSlot: React.FC<{
  type: KitType;
  refName: string;
  kitProps: Record<string, unknown>;
}> = ({ type, refName, kitProps }) => {
  const Kit = resolveComponent(type, refName);
  return <Kit {...kitProps} />;
};

// Composición principal. inputProps = JSON maestro PROGRESIVO: el player del
// dashboard la monta con el maestro a medio construir (sin audio, sin assets),
// así que cada capa tolera la ausencia de su sección. El render SSR valida
// antes con renderableMasterV1, que sí exige todo.
//
// Brand kit (docs/render.md §1): la intro DESPLAZA beats, audio y subtítulos
// layout.introFrames — la ley temporal del audio no cambia, solo su offset —
// y la outro se monta tras el último beat. Sin intro/outro activos el árbol
// es exactamente el de siempre (offset 0, sin Sequence extra).
export const LongForm: React.FC<MasterVideoJson> = (master) => {
  ensureFontLoaded();
  const { fps, durationInFrames: totalFrames } = useVideoConfig();
  const beats = master.beats ?? [];
  const cues = master.cues ?? [];
  const audio = master.audio;
  const themeRef = master.brand?.components.subtitle_theme ?? FALLBACK_SUBTITLE_THEME;
  // tokens de diseño del canal (colores/tipografía); fallback a la paleta base
  const design = master.brand?.design ?? defaultDesign();
  const avatar =
    master.brand?.avatar_path && isRenderableSrc(master.brand.avatar_path)
      ? toSrc(master.brand.avatar_path)
      : undefined;
  const layout = React.useMemo(() => computeBrandKitLayout(master), [master]);
  const offset = layout.introFrames;
  // fin del cuerpo relativo a la duración real de la composición (igual que
  // la extensión del último beat de siempre, ahora restando la outro)
  const bodyEnd = Math.max(offset + 1, totalFrames - layout.outroFrames);

  const audioEl = audio && isRenderableSrc(audio.path) ? <Audio src={toSrc(audio.path)} /> : null;
  const subtitlesEl = <Subtitles cues={cues} themeRef={themeRef} design={design} />;

  // pista de b-roll con transiciones: solape compensado para que el corte
  // quede centrado y el total siga siendo baseFrames (audio/subtítulos intactos)
  const segmentStartIdxs = React.useMemo(
    () => new Set((master.segments ?? []).map((s) => s.beat_idx)),
    [master.segments],
  );
  const brollTrack = React.useMemo(
    () => computeBrollTrack(beats, { fps, baseFrames: layout.baseFrames, segmentStartIdxs }),
    [beats, fps, layout.baseFrames, segmentStartIdxs],
  );

  return (
    <AbsoluteFill style={{ backgroundColor: design.background, fontFamily: FONT_FAMILY }}>
      {audioEl !== null ? (
        offset > 0 ? (
          <Sequence from={offset} name="Voz">
            {audioEl}
          </Sequence>
        ) : (
          audioEl
        )
      ) : null}
      {beats.length > 0 ? (
        <Sequence from={offset} durationInFrames={Math.max(1, bodyEnd - offset)} name="B-roll">
          <TransitionSeries>
            {brollTrack.sequences.map((seq, i) => {
              const beat = beats[i]!;
              const trans = i > 0 ? brollTrack.transitions[i - 1]! : null;
              return (
                <React.Fragment key={seq.beatIdx}>
                  {trans !== null ? (
                    <TransitionSeries.Transition
                      timing={linearTiming({ durationInFrames: trans.durationInFrames })}
                      presentation={
                        trans.kind === 'section' ? slide({ direction: 'from-right' }) : fade()
                      }
                    />
                  ) : null}
                  <TransitionSeries.Sequence durationInFrames={seq.durationInFrames}>
                    <BeatVisual
                      beat={beat}
                      videoId={master.video.id}
                      durationInFrames={seq.durationInFrames}
                    />
                  </TransitionSeries.Sequence>
                </React.Fragment>
              );
            })}
          </TransitionSeries>
        </Sequence>
      ) : null}
      {offset > 0 ? (
        <Sequence from={offset} durationInFrames={Math.max(1, bodyEnd - offset)} name="Subtítulos">
          {subtitlesEl}
        </Sequence>
      ) : (
        subtitlesEl
      )}
      {layout.titleCard !== null ? (
        <Sequence
          from={layout.titleCard.from}
          durationInFrames={layout.titleCard.durationInFrames}
          name="Title card"
        >
          <KitSlot
            type="title_card"
            refName={layout.titleCard.ref}
            kitProps={{ title: layout.titleCard.title, fromFrame: 0, design }}
          />
        </Sequence>
      ) : null}
      {layout.sectionCards.map((card, i) => (
        <Sequence
          key={`seccion-${i}`}
          from={card.from}
          durationInFrames={card.durationInFrames}
          name={`Sección ${i + 1}`}
        >
          <KitSlot
            type="title_card"
            refName={card.ref}
            kitProps={{ title: card.title, fromFrame: 0, design }}
          />
        </Sequence>
      ))}
      {layout.lowerThird !== null ? (
        <Sequence
          from={layout.lowerThird.from}
          durationInFrames={layout.lowerThird.durationInFrames}
          name="Rótulo"
        >
          <KitSlot
            type="lower_third"
            refName={layout.lowerThird.ref}
            kitProps={{
              title: layout.lowerThird.title,
              fromFrame: 0,
              design,
              ...(master.brand?.channel_name ? { subtitle: master.brand.channel_name } : {}),
            }}
          />
        </Sequence>
      ) : null}
      {layout.intro !== null ? (
        <Sequence from={0} durationInFrames={layout.intro.durationInFrames} name="Intro">
          <KitSlot
            type="intro"
            refName={layout.intro.ref}
            kitProps={{
              channel_name: master.brand?.channel_name ?? '',
              design,
              ...(avatar ? { logo: avatar } : {}),
            }}
          />
        </Sequence>
      ) : null}
      {layout.outro !== null ? (
        <Sequence
          from={layout.outro.from}
          durationInFrames={layout.outro.durationInFrames}
          name="Outro"
        >
          <KitSlot
            type="outro"
            refName={layout.outro.ref}
            kitProps={{
              channel_name: master.brand?.channel_name ?? '',
              design,
              ...(avatar ? { logo: avatar } : {}),
            }}
          />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
