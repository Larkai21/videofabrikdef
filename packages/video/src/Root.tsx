import React from 'react';
import { Composition, Still } from 'remotion';
import { makeDemoMaster } from '@fabrica/shared';
import { LongForm } from './LongForm';
import { calculateLongFormMetadata } from './metadata';
import { ThumbnailTemplate, type ThumbnailTemplateProps } from './ThumbnailTemplate';

const THUMBNAIL_DEFAULTS: ThumbnailTemplateProps = {
  text: 'Todos copian',
  variant: 'a',
};

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
    </>
  );
};
