import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { Cue, DesignTokens } from '@fabrica/shared';
import { LIENZO_LARGO, useLienzo } from './lienzo';
import { resolveComponent } from './registry.generated';

/**
 * Alias de compatibilidad: los mismos 90/160/120/160 de siempre. El área segura
 * la decide ahora el lienzo, que es lo que permite que un tema vertical reciba
 * la suya sin tocar el contrato del brand kit.
 */
export const SAFE_AREA = LIENZO_LARGO.safe;

// Capa de subtítulos: convierte el frame actual a milisegundos y delega en el
// tema del brand kit resuelto por el registry.
export const Subtitles: React.FC<{
  cues: Cue[];
  themeRef: string;
  design?: DesignTokens;
  highlightKeywords?: string[];
}> = ({ cues, themeRef, design, highlightKeywords }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lienzo = useLienzo();
  const Theme = resolveComponent('subtitle_theme', themeRef);
  const currentMs = (frame * 1000) / fps;
  return (
    <Theme
      cues={cues}
      currentMs={currentMs}
      design={design}
      highlightKeywords={highlightKeywords}
      safeArea={lienzo.safe}
    />
  );
};
