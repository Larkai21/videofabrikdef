import React from 'react';
import { AbsoluteFill, Composition, Still, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  componentTypeSchema,
  DEFAULT_SUBTITLE_THEME_REF,
  type ComponentType as KitComponentType,
} from '@fabrica/shared';
import { samplePropsFor } from './kit-contract';
import { resolveComponent } from './registry.generated';

// Composición envoltorio para el render de humo del validador de zips
// (components.validate): monta un componente del registry con las props de
// ejemplo del contrato y renderiza 60 frames. Entry propio
// (kit-smoke-entry.ts) para no tocar el Root de producción.

const SMOKE_BACKGROUND = '#12161f';

type SmokeProps = Record<string, unknown>;

export const KitSmokeHarness: React.FC<SmokeProps> = (props) => {
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
    <AbsoluteFill style={{ backgroundColor: SMOKE_BACKGROUND }}>
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
        durationInFrames={60}
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
