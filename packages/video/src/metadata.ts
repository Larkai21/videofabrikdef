import type { CalculateMetadataFunction } from 'remotion';
import {
  FPS,
  masterVideoJsonV1,
  shortMasterV1,
  SHORT_HEIGHT,
  SHORT_WIDTH,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
} from '@fabrica/shared';
import { computeBrandKitLayout, type PiezaMaster } from './brand-kit';

export { DEFAULT_DURATION_FRAMES } from './brand-kit';

// La duración la fija el audio (principio 1 del proyecto): los beats solo son
// el fallback mientras la voz no existe. Con brand kit activo, la intro y la
// outro SUMAN frames (durationInFrames = intro + audio + outro) sin tocar la
// ley temporal del audio: computeBrandKitLayout es la única fuente del
// montaje y la comparten estas funciones y la propia composición Pieza.
// fps/tamaño vienen del contrato.
//
// Las dos validan ANTES de calcular nada: el tipo de props de una Composition
// es estructural (PiezaMaster acepta las dos formas), así que el esquema es lo
// único que impide que un maestro vertical entre por el id del largo.

function detalleDe(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
}

export const calculateLongFormMetadata: CalculateMetadataFunction<PiezaMaster> = ({ props }) => {
  const parsed = masterVideoJsonV1.safeParse(props);
  if (!parsed.success) {
    throw new Error(
      `El maestro no valida contra masterVideoJsonV1: ${detalleDe(parsed.error.issues)}`,
    );
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

export const calculateShortFormMetadata: CalculateMetadataFunction<PiezaMaster> = ({ props }) => {
  const parsed = shortMasterV1.safeParse(props);
  if (!parsed.success) {
    throw new Error(
      `El maestro del short no valida contra shortMasterV1: ${detalleDe(parsed.error.issues)}`,
    );
  }
  const short = parsed.data;
  const layout = computeBrandKitLayout(short);
  return {
    props: short,
    fps: FPS,
    width: SHORT_WIDTH,
    height: SHORT_HEIGHT,
    durationInFrames: layout.totalFrames,
  };
};
