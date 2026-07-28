import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { Beat } from '@fabrica/shared';
import { LOOP_CROSSFADE_MS, MAX_LOOPS } from '@fabrica/shared';
import { FONT_FAMILY } from './fonts';
import { isRenderableSrc, toSrc } from './media-src';
import { hashSeed } from './seed';

type BeatVisualProps = {
  beat: Beat;
  videoId: string;
  durationInFrames: number;
};

const COVER_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

// Direcciones de paneo Ken Burns; la elección deriva de hashSeed(video, beat).
const PAN_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

// Placa neutra determinista para beats sin asset resuelto: la preview del
// player siempre pinta algo aunque el maestro esté a medio construir.
const Placeholder: React.FC<{ beat: Beat }> = ({ beat }) => {
  const hue = (beat.idx * 47) % 360;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: `hsl(${hue}, 28%, 16%)`,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 120,
      }}
    >
      <div
        style={{
          fontFamily: FONT_FAMILY,
          fontSize: 44,
          fontWeight: 500,
          color: 'rgba(255, 255, 255, 0.75)',
          textAlign: 'center',
        }}
      >
        {beat.visual_query}
      </div>
    </AbsoluteFill>
  );
};

const KenBurnsImage: React.FC<{
  src: string;
  seed: number;
  durationInFrames: number;
  // efecto congelado en el maestro por la ingesta ('kenburns-in-left'…);
  // manda sobre la derivación local para que master.json documente lo que
  // realmente se renderiza
  effect?: string;
}> = ({ src, seed, durationInFrames, effect }) => {
  const frame = useCurrentFrame();
  let direction = PAN_DIRECTIONS[seed % PAN_DIRECTIONS.length] ?? [1, 0];
  let zoomIn = true;
  if (effect?.startsWith('kenburns-')) {
    zoomIn = effect.includes('-in-');
    direction = effect.endsWith('left') ? [1, 0] : [-1, 0];
  }
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // el zoom 1,00→1,08 deja un 4% de margen por lado; el paneo usa como máximo
  // la mitad de ese margen y va ligado al zoom para no descubrir bordes
  const zoomProgress = zoomIn ? progress : 1 - progress;
  const scale = 1 + 0.08 * zoomProgress;
  const translateX = 2 * zoomProgress * direction[0];
  const translateY = 2 * zoomProgress * direction[1];
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img
        src={src}
        style={{
          ...COVER_STYLE,
          transform: `scale(${scale}) translate(${translateX}%, ${translateY}%)`,
        }}
      />
    </AbsoluteFill>
  );
};

const FadeIn: React.FC<{ fadeFrames: number; children: React.ReactNode }> = ({
  fadeFrames,
  children,
}) => {
  const frame = useCurrentFrame();
  const opacity =
    fadeFrames <= 0
      ? 1
      : interpolate(frame, [0, fadeFrames], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const LoopedClip: React.FC<{
  src: string;
  trimBeforeFrames: number;
  loops: number;
  durationInFrames: number;
  fps: number;
}> = ({ src, trimBeforeFrames, loops, durationInFrames, fps }) => {
  const plays = Math.max(1, Math.min(loops, MAX_LOOPS));
  if (plays === 1) {
    return (
      <AbsoluteFill>
        <OffthreadVideo src={src} trimBefore={trimBeforeFrames} muted style={COVER_STYLE} />
      </AbsoluteFill>
    );
  }
  const fadeFrames = msToFrames(LOOP_CROSSFADE_MS, fps);
  // cada pasada solapa fadeFrames con la anterior para el crossfade de opacidad
  const segmentFrames = Math.ceil((durationInFrames + (plays - 1) * fadeFrames) / plays);
  const segments: { from: number; duration: number }[] = [];
  for (let i = 0; i < plays; i += 1) {
    const from = i * (segmentFrames - fadeFrames);
    const duration = Math.min(segmentFrames, durationInFrames - from);
    if (duration <= 0) break;
    segments.push({ from, duration });
  }
  return (
    <AbsoluteFill>
      {segments.map((segment, i) => (
        <Sequence
          key={i}
          from={segment.from}
          durationInFrames={segment.duration}
          name={`Pasada ${i + 1}`}
        >
          <FadeIn fadeFrames={i === 0 ? 0 : fadeFrames}>
            <OffthreadVideo src={src} trimBefore={trimBeforeFrames} muted style={COVER_STYLE} />
          </FadeIn>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// Visual de un beat según asset.fit.mode: trim (clip con offset), stretch (clip
// algo más corto reproducido una vez a cámara ligeramente lenta), loop (clip
// repetido con crossfade, último recurso) o kenburns (imagen con zoom/paneo).
export const BeatVisual: React.FC<BeatVisualProps> = ({ beat, videoId, durationInFrames }) => {
  const { fps } = useVideoConfig();
  const asset = beat.asset;
  if (!asset?.path || !asset.kind || !isRenderableSrc(asset.path)) {
    return <Placeholder beat={beat} />;
  }
  const src = toSrc(asset.path);
  const seed = hashSeed(`${videoId}:${beat.idx}`);
  const trimBeforeFrames = msToFrames(asset.fit.offset_ms ?? 0, fps);

  if (asset.kind === 'image') {
    return (
      <KenBurnsImage
        src={src}
        seed={seed}
        durationInFrames={durationInFrames}
        effect={asset.effect}
      />
    );
  }
  if (asset.fit.mode === 'loop') {
    return (
      <LoopedClip
        src={src}
        trimBeforeFrames={trimBeforeFrames}
        loops={asset.fit.loops ?? 1}
        durationInFrames={durationInFrames}
        fps={fps}
      />
    );
  }
  // stretch: una sola pasada ralentizada (playback_rate < 1) que llena el beat
  // sin reinicios; trim: clip que sobra, recortado con offset. Ambos son un
  // único OffthreadVideo, la diferencia es el playbackRate.
  const playbackRate = asset.fit.mode === 'stretch' ? (asset.fit.playback_rate ?? 1) : 1;
  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={src}
        trimBefore={trimBeforeFrames}
        playbackRate={playbackRate}
        muted
        style={COVER_STYLE}
      />
    </AbsoluteFill>
  );
};
