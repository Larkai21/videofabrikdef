import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import type { MasterVideoJson } from '@fabrica/shared';
import { BeatVisual } from './BeatVisual';
import { ensureFontLoaded, FONT_FAMILY } from './fonts';
import { isRenderableSrc, toSrc } from './media-src';
import { Subtitles } from './Subtitles';

const FALLBACK_SUBTITLE_THEME = 'subtitulos-basicos@0.1.0';

// Composición principal. inputProps = JSON maestro PROGRESIVO: el player del
// dashboard la monta con el maestro a medio construir (sin audio, sin assets),
// así que cada capa tolera la ausencia de su sección. El render SSR valida
// antes con renderableMasterV1, que sí exige todo.
export const LongForm: React.FC<MasterVideoJson> = (master) => {
  ensureFontLoaded();
  const { fps } = useVideoConfig();
  const beats = master.beats ?? [];
  const cues = master.cues ?? [];
  const audio = master.audio;
  const themeRef = master.brand?.components.subtitle_theme ?? FALLBACK_SUBTITLE_THEME;
  return (
    <AbsoluteFill style={{ backgroundColor: '#0b0f19', fontFamily: FONT_FAMILY }}>
      {audio && isRenderableSrc(audio.path) ? <Audio src={toSrc(audio.path)} /> : null}
      {beats.map((beat) => {
        const from = Math.round((beat.from_ms / 1000) * fps);
        const durationInFrames = Math.max(
          1,
          Math.round((beat.to_ms / 1000) * fps) - from,
        );
        return (
          <Sequence
            key={beat.idx}
            from={from}
            durationInFrames={durationInFrames}
            name={`Beat ${beat.idx}`}
          >
            <BeatVisual
              beat={beat}
              videoId={master.video.id}
              durationInFrames={durationInFrames}
            />
          </Sequence>
        );
      })}
      <Subtitles cues={cues} themeRef={themeRef} />
    </AbsoluteFill>
  );
};
