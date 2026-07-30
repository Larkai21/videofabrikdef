import React from 'react';
import { AbsoluteFill, Composition, Still } from 'remotion';
import { defaultDesign, makeDemoMaster } from '@fabrica/shared';
import { LongForm } from './LongForm';
import { calculateLongFormMetadata } from './metadata';
import {
  INTRO_BASICA_DURATION_FRAMES,
  OUTRO_BASICA_DURATION_FRAMES,
} from './registry-gen';
import { IntroBasica } from './themes/IntroBasica';
import { OutroBasica } from './themes/OutroBasica';
import { RotuloBasico } from './themes/RotuloBasico';
import { TituloSeccion } from './themes/TituloSeccion';
import { ThumbnailTemplate, type ThumbnailTemplateProps } from './ThumbnailTemplate';

const THUMBNAIL_DEFAULTS: ThumbnailTemplateProps = {
  text: 'Todos copian',
  variant: 'a',
};

// Composiciones de PREVIEW de las piezas del brand kit integradas: sirven para
// afinarlas frame a frame en `pnpm --filter @fabrica/video studio` sin buscarlas
// dentro de los ~1500 frames de LongForm. No las usa nadie en producción (el
// worker y el humo seleccionan el id 'LongForm' explícitamente).
const KIT_PREVIEW = { width: 1920, height: 1080, fps: 30 } as const;
const DEMO_CHANNEL = 'Canal de ejemplo';

// las piezas de overlay se juzgan SOBRE contenido, no sobre negro
const OverlayBackdrop: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      background:
        'linear-gradient(135deg, #1b2a4a 0%, #0d1526 40%, #22344f 100%)',
    }}
  >
    {children}
  </AbsoluteFill>
);

const TituloSeccionPreview: React.FC<{ title: string }> = ({ title }) => (
  <OverlayBackdrop>
    <TituloSeccion title={title} fromFrame={0} design={defaultDesign()} />
  </OverlayBackdrop>
);

const RotuloBasicoPreview: React.FC<{ title: string; subtitle?: string }> = ({
  title,
  subtitle,
}) => (
  <OverlayBackdrop>
    <RotuloBasico title={title} subtitle={subtitle} fromFrame={0} design={defaultDesign()} />
  </OverlayBackdrop>
);

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="LongForm"
        component={LongForm}
        calculateMetadata={calculateLongFormMetadata}
        defaultProps={makeDemoMaster()}
      />
      <Still
        id="Thumbnail"
        component={ThumbnailTemplate}
        width={1280}
        height={720}
        defaultProps={THUMBNAIL_DEFAULTS}
      />

      <Composition
        id="KitIntro"
        component={IntroBasica}
        {...KIT_PREVIEW}
        durationInFrames={INTRO_BASICA_DURATION_FRAMES}
        defaultProps={{ channel_name: DEMO_CHANNEL, design: defaultDesign() }}
      />
      {/* con avatar: el caso que el canal de ejemplo no cubre */}
      <Composition
        id="KitIntroConLogo"
        component={IntroBasica}
        {...KIT_PREVIEW}
        durationInFrames={INTRO_BASICA_DURATION_FRAMES}
        defaultProps={{
          channel_name: DEMO_CHANNEL,
          logo: 'demo/image.png',
          design: defaultDesign(),
        }}
      />
      <Composition
        id="KitOutro"
        component={OutroBasica}
        {...KIT_PREVIEW}
        durationInFrames={OUTRO_BASICA_DURATION_FRAMES}
        defaultProps={{ channel_name: DEMO_CHANNEL, design: defaultDesign() }}
      />
      <Composition
        id="KitTituloSeccion"
        component={TituloSeccionPreview}
        {...KIT_PREVIEW}
        durationInFrames={90}
        defaultProps={{ title: 'Por qué todos copian a DeepSeek' }}
      />
      <Composition
        id="KitRotulo"
        component={RotuloBasicoPreview}
        {...KIT_PREVIEW}
        durationInFrames={150}
        defaultProps={{ title: 'Por qué todos copian a DeepSeek', subtitle: DEMO_CHANNEL }}
      />
    </>
  );
};
