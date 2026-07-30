import React from 'react';
import { AbsoluteFill, Composition, Still, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  componentTypeSchema,
  DEFAULT_SUBTITLE_THEME_REF,
  type ComponentType as KitComponentType,
} from '@fabrica/shared';
import { ensureFontLoaded, FONT_FAMILY } from './fonts';
import { samplePropsFor } from './kit-contract';
import { resolveComponent } from './registry.generated';

// Composición envoltorio para el render de humo del validador de zips
// (components.validate): monta un componente del registry con las props de
// ejemplo del contrato y renderiza smoke_frames frames (fixed_duration_frames
// del manifest si existe, 60 por defecto, tope 300). Entry propio
// (kit-smoke-entry.ts) para no tocar el Root de producción.

const SMOKE_BACKGROUND = '#12161f';

export const SMOKE_FRAMES_DEFAULT = 60;
export const SMOKE_FRAMES_MAX = 300;

/** Duración del humo saneada desde inputProps.smoke_frames (1..300). */
export function smokeDurationInFrames(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SMOKE_FRAMES_DEFAULT;
  return Math.min(SMOKE_FRAMES_MAX, Math.max(1, Math.floor(value)));
}

type SmokeProps = Record<string, unknown>;

export const KitSmokeHarness: React.FC<SmokeProps> = (props) => {
  // sin esto los previews del Brand kit salen en la serif del sistema: el
  // harness no cargaba Inter y era lo único que el usuario ve de cada
  // componente. Mismo call site que LongForm.
  ensureFontLoaded();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const parsedType = componentTypeSchema.safeParse(props.kit_type);
  const kitType: KitComponentType = parsedType.success ? parsedType.data : 'subtitle_theme';
  const reference =
    typeof props.reference === 'string' ? props.reference : DEFAULT_SUBTITLE_THEME_REF;
  const sample =
    props.sample_props !== null && typeof props.sample_props === 'object'
      ? (props.sample_props as Record<string, unknown>)
      : samplePropsFor(kitType);

  const Kit = resolveComponent(kitType, reference);
  // los temas de subtítulos reciben el tiempo actual, no un valor fijo
  const kitProps =
    kitType === 'subtitle_theme' ? { ...sample, currentMs: (frame * 1000) / fps } : sample;

  return (
    <AbsoluteFill style={{ backgroundColor: SMOKE_BACKGROUND, fontFamily: FONT_FAMILY }}>
      <Kit {...kitProps} />
    </AbsoluteFill>
  );
};

export const KitSmokeRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="KitSmoke"
        component={KitSmokeHarness}
        width={1920}
        height={1080}
        fps={30}
        durationInFrames={SMOKE_FRAMES_DEFAULT}
        calculateMetadata={({ props }) => ({
          durationInFrames: smokeDurationInFrames(props.smoke_frames),
        })}
        defaultProps={{}}
      />
      {/* miniaturas: 1280×720, un solo frame (thumbnail_template) */}
      <Still
        id="KitThumb"
        component={KitSmokeHarness}
        width={1280}
        height={720}
        defaultProps={{}}
      />
    </>
  );
};
