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
  const { fps, durationInFrames: totalFrames } = useVideoConfig();
  const beats = master.beats ?? [];
  const cues = master.cues ?? [];
  const audio = master.audio;
  const themeRef = master.brand?.components.subtitle_theme ?? FALLBACK_SUBTITLE_THEME;
  return (
    <AbsoluteFill style={{ backgroundColor: '#0b0f19', fontFamily: FONT_FAMILY }}>
      {audio && isRenderableSrc(audio.path) ? <Audio src={toSrc(audio.path)} /> : null}
      {beats.map((beat, i) => {
        const from = Math.round((beat.from_ms / 1000) * fps);
        // el último beat se extiende hasta el final de la composición: la
        // duración total usa ceil y los beats round, y esa fracción de frame
        // dejaría el fotograma final sin visual (flash de fondo desnudo)
        const rawEnd = Math.round((beat.to_ms / 1000) * fps);
        const end = i === beats.length - 1 ? Math.max(rawEnd, totalFrames) : rawEnd;
        const durationInFrames = Math.max(1, end - from);
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
