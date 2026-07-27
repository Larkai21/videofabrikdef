import type { CalculateMetadataFunction } from 'remotion';
import type { MasterVideoJson } from '@fabrica/shared';
import { FPS, masterVideoJsonV1, VIDEO_HEIGHT, VIDEO_WIDTH } from '@fabrica/shared';
import { computeBrandKitLayout } from './brand-kit';

export { DEFAULT_DURATION_FRAMES } from './brand-kit';

// La duración la fija el audio (principio 1 del proyecto): los beats solo son
// el fallback mientras la voz no existe. Con brand kit activo, la intro y la
// outro SUMAN frames (durationInFrames = intro + audio + outro) sin tocar la
// ley temporal del audio: computeBrandKitLayout es la única fuente del
// montaje y la comparten esta función y la propia composición LongForm.
// fps/tamaño vienen del contrato.
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
  const layout = computeBrandKitLayout(master);
  return {
    props: master,
    fps: FPS,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    durationInFrames: layout.totalFrames,
  };
};
