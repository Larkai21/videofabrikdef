import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { Cue, DesignTokens } from '@fabrica/shared';
import { resolveComponent } from './registry.generated';

export const SAFE_AREA = { top: 90, right: 160, bottom: 120, left: 160 } as const;

// Capa de subtítulos de LongForm: convierte el frame actual a milisegundos y
// delega en el tema del brand kit resuelto por el registry.
export const Subtitles: React.FC<{
  cues: Cue[];
  themeRef: string;
  design?: DesignTokens;
  highlightKeywords?: string[];
}> = ({ cues, themeRef, design, highlightKeywords }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const Theme = resolveComponent('subtitle_theme', themeRef);
  const currentMs = (frame * 1000) / fps;
  return (
    <Theme
      cues={cues}
      currentMs={currentMs}
      design={design}
      highlightKeywords={highlightKeywords}
      safeArea={SAFE_AREA}
    />
  );
};
