import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { Cue, Word } from '@fabrica/shared';
import { CUE_MAX_LINES } from '@fabrica/shared';
import { FONT_FAMILY } from '../fonts';

// Contrato de props de un tema de subtítulos: subtitleThemePropsSchema en
// packages/shared/src/component-manifest.ts. Los cues llegan como unknown[]
// porque el zip del brand kit no conoce los tipos internos del maestro.
export type SubtitleThemeProps = {
  cues: unknown[];
  currentMs: number;
  safeArea: { top: number; right: number; bottom: number; left: number };
};

// Reparte las palabras del cue en como máximo CUE_MAX_LINES líneas
// equilibradas por caracteres. Determinista por cue: las líneas no dependen
// del tiempo, solo el resaltado karaoke.
export function splitCueLines(words: Word[]): Word[][] {
  const totalChars = words.reduce((sum, w) => sum + w.w.length + 1, 0);
  if (words.length <= 3 || totalChars <= 34 || CUE_MAX_LINES < 2) return [words];
  let acc = 0;
  let cut = words.length - 1;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (!word) continue;
    acc += word.w.length + 1;
    if (acc >= totalChars / 2) {
      cut = i + 1;
      break;
    }
  }
  cut = Math.max(1, Math.min(cut, words.length - 1));
  return [words.slice(0, cut), words.slice(cut)];
}

function wordColor(word: Word, currentMs: number): string {
  if (currentMs >= word.from_ms && currentMs < word.to_ms) return '#ffd166';
  if (currentMs >= word.to_ms) return '#ffffff';
  return 'rgba(255, 255, 255, 0.55)';
}

// Tema integrado 'subtitulos-basicos@0.1.0': cue activo por tiempo, máximo
// dos líneas, karaoke palabra a palabra, anclado a la safe area inferior.
export const SubtitlesBasicos: React.FC<SubtitleThemeProps> = ({
  cues,
  currentMs,
  safeArea,
}) => {
  const typedCues = cues as Cue[];
  const active = typedCues.find((c) => currentMs >= c.from_ms && currentMs < c.to_ms);
  if (!active) return null;
  const lines = active.words.length > 0 ? splitCueLines(active.words) : [];
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          left: safeArea.left,
          right: safeArea.right,
          bottom: safeArea.bottom,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
          fontFamily: FONT_FAMILY,
          fontSize: 54,
          fontWeight: 700,
          lineHeight: 1.2,
          textAlign: 'center',
          textShadow: '0 3px 14px rgba(0, 0, 0, 0.85), 0 0 4px rgba(0, 0, 0, 0.9)',
        }}
      >
        {lines.length > 0 ? (
          lines.map((line, li) => (
            <div key={li}>
              {line.map((word, wi) => (
                <span key={wi} style={{ color: wordColor(word, currentMs) }}>
                  {word.w}
                  {wi < line.length - 1 ? ' ' : ''}
                </span>
              ))}
            </div>
          ))
        ) : (
          <div style={{ color: '#ffffff' }}>{active.text}</div>
        )}
      </div>
    </AbsoluteFill>
  );
};
