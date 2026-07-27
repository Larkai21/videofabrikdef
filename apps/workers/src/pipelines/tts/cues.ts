// Constructor de cues de subtítulos a partir de tokens temporizados.
// Reglas (docs/voz-y-beats.md §3): líneas de máx CUE_MAX_CHARS o CUE_MAX_WORDS,
// máx CUE_MAX_LINES por cue, corte preferente en puntuación, duración 1–5 s.
// Lógica pura, sin I/O.

import {
  CUE_MAX_CHARS,
  CUE_MAX_LINES,
  CUE_MAX_S,
  CUE_MIN_S,
  CUE_MAX_WORDS,
  type Cue,
  type Word,
} from '@fabrica/shared';

export interface CueToken {
  from_ms: number;
  to_ms: number;
  raw: string;
}

const SENTENCE_END_RE = /[.!?…]["')\]»]*$/;
const ANY_PUNCT_RE = /[.,;:!?…]["')\]»]*$/;

interface LineAcc {
  words: Word[];
  chars: number;
}

export function buildCues(tokens: CueToken[], totalMs?: number): Cue[] {
  const cues: Cue[] = [];
  let lines: LineAcc[] = [];
  let line: LineAcc = { words: [], chars: 0 };

  const lineText = (l: LineAcc) => l.words.map((w) => w.w).join(' ');

  const closeCue = () => {
    if (line.words.length > 0) lines.push(line);
    line = { words: [], chars: 0 };
    if (lines.length === 0) return;
    const allWords = lines.flatMap((l) => l.words);
    const first = allWords[0];
    const last = allWords[allWords.length - 1];
    if (!first || !last) return;
    cues.push({
      from_ms: first.from_ms,
      to_ms: last.to_ms,
      text: lines.map(lineText).join('\n'),
      words: allWords,
    });
    lines = [];
  };

  const closeLine = () => {
    if (line.words.length === 0) return;
    lines.push(line);
    line = { words: [], chars: 0 };
    if (lines.length >= CUE_MAX_LINES) closeCue();
  };

  for (const token of tokens) {
    const wordLen = token.raw.length;
    const cueStart = lines[0]?.words[0]?.from_ms ?? line.words[0]?.from_ms;

    // no superar la duración máxima del cue al añadir la siguiente palabra
    if (cueStart !== undefined && token.to_ms - cueStart > CUE_MAX_S * 1000) {
      closeCue();
    }

    // no superar límites de la línea al añadir la siguiente palabra
    const wouldChars = line.chars === 0 ? wordLen : line.chars + 1 + wordLen;
    if (line.words.length >= CUE_MAX_WORDS || wouldChars > CUE_MAX_CHARS) {
      closeLine();
    }

    line.words.push({ from_ms: token.from_ms, to_ms: token.to_ms, w: token.raw });
    line.chars = line.chars === 0 ? wordLen : line.chars + 1 + wordLen;

    if (SENTENCE_END_RE.test(token.raw)) {
      // la puntuación fuerte cierra el cue entero
      closeCue();
    } else if (ANY_PUNCT_RE.test(token.raw) && line.chars >= CUE_MAX_CHARS / 2) {
      // corte preferente en puntuación débil cuando la línea ya tiene cuerpo
      closeLine();
    }
  }
  closeCue();

  // duración mínima: estirar hacia el hueco disponible sin pisar el siguiente cue
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (!cue) continue;
    if (cue.to_ms - cue.from_ms < CUE_MIN_S * 1000) {
      const limit = cues[i + 1]?.from_ms ?? totalMs ?? cue.from_ms + CUE_MIN_S * 1000;
      cue.to_ms = Math.max(cue.to_ms, Math.min(cue.from_ms + CUE_MIN_S * 1000, limit));
    }
  }

  return cues;
}
