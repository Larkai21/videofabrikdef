import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import type { ComponentType as KitType, MasterVideoJson } from '@fabrica/shared';
import { BeatVisual } from './BeatVisual';
import { beatWindow, computeBrandKitLayout } from './brand-kit';
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
  const layout = React.useMemo(() => computeBrandKitLayout(master), [master]);
  const offset = layout.introFrames;
  // fin del cuerpo relativo a la duración real de la composición (igual que
  // la extensión del último beat de siempre, ahora restando la outro)
  const bodyEnd = Math.max(offset + 1, totalFrames - layout.outroFrames);

  const audioEl = audio && isRenderableSrc(audio.path) ? <Audio src={toSrc(audio.path)} /> : null;
  const subtitlesEl = <Subtitles cues={cues} themeRef={themeRef} />;

  return (
    <AbsoluteFill style={{ backgroundColor: '#0b0f19', fontFamily: FONT_FAMILY }}>
      {audioEl !== null ? (
        offset > 0 ? (
          <Sequence from={offset} name="Voz">
            {audioEl}
          </Sequence>
        ) : (
          audioEl
        )
      ) : null}
      {beats.map((beat, i) => {
        const frameWindow = beatWindow(beat, {
          fps,
          offsetFrames: offset,
          isLast: i === beats.length - 1,
          bodyEndFrames: bodyEnd,
        });
        return (
          <Sequence
            key={beat.idx}
            from={frameWindow.from}
            durationInFrames={frameWindow.durationInFrames}
            name={`Beat ${beat.idx}`}
          >
            <BeatVisual
              beat={beat}
              videoId={master.video.id}
              durationInFrames={frameWindow.durationInFrames}
            />
          </Sequence>
        );
      })}
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
            kitProps={{ title: layout.titleCard.title, fromFrame: 0 }}
          />
        </Sequence>
      ) : null}
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
            kitProps={{ channel_name: master.brand?.channel_name ?? '' }}
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
            kitProps={{ channel_name: master.brand?.channel_name ?? '' }}
          />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
