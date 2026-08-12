import type { SttBlockResult } from '../../providers/stt.js';
import type { BeatSceneSpan, BeatToken } from '../tts/beats.js';

// Del STT a los tokens que computeBeats y buildCues entienden. Es el punto
// donde el principio 1 se juega la vida con audio ajeno: sin `sentenceEnd`
// fiable no hay frontera de frase y un clip puede partir una a la mitad.
//
// La señal se construye CRUZANDO dos fuentes (diseño de la fase B0):
//   - la puntuación de whisper viene en los SEGMENTS (los words llegan
//     pelados): se re-reparte frase a frase sobre los words
//   - la pausa acústica confirma o fuerza: un silencio ≥ FUERZA_MS es fin de
//     frase aunque la ortografía del ASR no lo diga — entre voces habladas el
//     silencio es más honesto que la ortografía
//
// Todo puro: mismos insumos, mismos tokens. El gate (% de fines confirmados
// por pausa) se estampa en episodes.stt_meta para poder auditarlo después.

export const PAUSA_CONFIRMA_MS = 300;
export const PAUSA_FUERZA_MS = 800;
/** Una pausa así de larga separa TURNOS/temas: fronteras de scene spans. */
export const PAUSA_TURNO_MS = 2_000;

const SENTENCE_END_RE = /[.!?…]["')\]»]*$/;
const CLAUSE_END_RE = /[,;:]["')\]»]*$/;

/**
 * Reparte la puntuación de los segments sobre los words: recorre las frases
 * de cada segmento en paralelo a los words y marca el token donde el texto
 * cierra frase (o cláusula). offsetMs re-basa un bloque troceado.
 */
export function aTokens(bloque: SttBlockResult, offsetMs: number): BeatToken[] {
  const out: BeatToken[] = bloque.words.map((w) => ({
    from_ms: offsetMs + w.from_ms,
    to_ms: offsetMs + w.to_ms,
    raw: w.text,
    sentenceEnd: false,
    clauseEnd: false,
    sceneIdx: 0,
  }));
  let cursor = 0;
  for (const seg of bloque.segments) {
    const palabras = seg.text
      .trim()
      .split(/\s+/)
      .filter((p) => p !== '');
    for (const palabra of palabras) {
      const token = out[cursor];
      if (token === undefined) break;
      // el texto del segmento conserva la puntuación que el word pelado perdió
      if (SENTENCE_END_RE.test(palabra)) token.sentenceEnd = true;
      else if (CLAUSE_END_RE.test(palabra)) token.clauseEnd = true;
      token.raw = palabra;
      cursor += 1;
    }
  }
  return out;
}

export interface GatePausas {
  /** fines de frase que puso el ASR (antes de forzar nada) */
  frases_asr: number;
  /** de esos, cuántos coinciden con pausa ≥ confirma: EL gate (≥80 % = GO) */
  confirmadas: number;
  /** fronteras añadidas por silencio ≥ fuerza donde el ASR no puntuó */
  forzadas: number;
  pct_confirmadas: number;
}

/**
 * Cruza puntuación y silencio. El GATE se mide PRIMERO y solo sobre la
 * puntuación del ASR — medirlo después de forzar lo inflaría, porque toda
 * frontera forzada por silencio queda confirmada por construcción. Después
 * una pausa ≥ fuerza añade la frontera aunque no haya punto: entre voces
 * habladas el silencio es más honesto que la ortografía.
 */
export function cruzarConPausas(
  tokens: BeatToken[],
  opts: { confirmaMs?: number; fuerzaMs?: number } = {},
): GatePausas {
  const confirma = opts.confirmaMs ?? PAUSA_CONFIRMA_MS;
  const fuerza = opts.fuerzaMs ?? PAUSA_FUERZA_MS;
  const gapTras = (i: number): number =>
    i + 1 < tokens.length ? tokens[i + 1]!.from_ms - tokens[i]!.to_ms : Number.POSITIVE_INFINITY;

  // 1) el gate, sobre lo que el ASR puntuó
  let frasesAsr = 0;
  let confirmadas = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (!tokens[i]!.sentenceEnd) continue;
    frasesAsr += 1;
    if (gapTras(i) >= confirma) confirmadas += 1;
  }

  // 2) el silencio manda donde la ortografía calló
  let forzadas = 0;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (gapTras(i) >= fuerza && !tokens[i]!.sentenceEnd) {
      tokens[i]!.sentenceEnd = true;
      forzadas += 1;
    }
  }

  return {
    frases_asr: frasesAsr,
    confirmadas,
    forzadas,
    pct_confirmadas: frasesAsr > 0 ? (100 * confirmadas) / frasesAsr : 0,
  };
}

/**
 * Sustituto de los scene_spans del guion: tramos entre pausas LARGAS (turnos,
 * cambios de tema). computeBeats los usa para no fundir en un beat dos turnos
 * distintos; `visual_query` va vacío — en un clip el visual es el hablante.
 * También estampa sceneIdx en cada token.
 */
export function spansDePausas(tokens: BeatToken[], totalMs: number): BeatSceneSpan[] {
  if (tokens.length === 0) {
    return [{ idx: 0, visual_query: '', from_ms: 0, to_ms: totalMs }];
  }
  const spans: BeatSceneSpan[] = [];
  let ini = 0;
  let idx = 0;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const gap = tokens[i + 1]!.from_ms - tokens[i]!.to_ms;
    if (gap >= PAUSA_TURNO_MS) {
      spans.push({ idx, visual_query: '', from_ms: ini, to_ms: tokens[i]!.to_ms });
      ini = tokens[i + 1]!.from_ms;
      idx += 1;
    }
  }
  spans.push({ idx, visual_query: '', from_ms: ini, to_ms: totalMs });
  // sceneIdx por token: computeBeats lo usa para el corte por escena
  let s = 0;
  for (const t of tokens) {
    while (s < spans.length - 1 && t.from_ms >= spans[s + 1]!.from_ms) s += 1;
    t.sceneIdx = spans[s]!.idx;
  }
  return spans;
}
