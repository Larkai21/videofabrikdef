import type { CalculateMetadataFunction } from 'remotion';
import type { MasterVideoJson } from '@fabrica/shared';
import { FPS, masterVideoJsonV1, VIDEO_HEIGHT, VIDEO_WIDTH } from '@fabrica/shared';

// Frames por defecto cuando el maestro aún no tiene audio ni beats (player
// del dashboard con el maestro recién creado).
export const DEFAULT_DURATION_FRAMES = 300;

// La duración la fija el audio (principio 1 del proyecto): los beats solo son
// el fallback mientras la voz no existe. fps/tamaño vienen del contrato.
export const calculateLongFormMetadata: CalculateMetadataFunction<MasterVideoJson> = ({
  props,
}) => {
  const parsed = masterVideoJsonV1.safeParse(props);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`El maestro no valida contra masterVideoJsonV1: ${detail}`);
  }
  const master = parsed.data;
  let durationInFrames = DEFAULT_DURATION_FRAMES;
  if (master.audio) {
    durationInFrames = Math.ceil((master.audio.duration_ms / 1000) * FPS);
  } else if (master.beats && master.beats.length > 0) {
    const last = master.beats[master.beats.length - 1];
    if (last) durationInFrames = Math.max(1, Math.ceil((last.to_ms / 1000) * FPS));
  }
  return {
    props: master,
    fps: FPS,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    durationInFrames,
  };
};
