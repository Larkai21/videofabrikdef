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
/** Margen al casar un silencio del audio con el final de una palabra. */
const MARGEN_SILENCIO_MS = 150;

/**
 * Pausa REAL tras cada token. Con `silencios` (medidos en el audio con
 * silencedetect) manda el silencio: Whisper alarga la última palabra de cada
 * frase hasta el siguiente ataque —trampa documentada en el proyecto hermano—
 * así que el hueco entre sus words casi siempre es 0 y no vale como señal.
 * Sin silencios (tests, mock) se cae al hueco entre words.
 */
export function pausasTrasToken(
  tokens: readonly BeatToken[],
  silencios?: readonly [number, number][],
): number[] {
  return tokens.map((t, i) => {
    const sig = tokens[i + 1];
    const hueco = sig === undefined ? Number.POSITIVE_INFINITY : sig.from_ms - t.to_ms;
    if (silencios === undefined || silencios.length === 0) return hueco;
    // un silencio es la pausa TRAS el token i si DESEMBOCA en su frontera:
    // e ≈ [fin del token, arranque del siguiente]. Whisper estira la palabra
    // por encima del silencio, así que el fin del silencio coincide con el fin
    // (estirado) de la palabra — no con su arranque.
    const ventanaFin = sig === undefined ? Number.POSITIVE_INFINITY : sig.from_ms + MARGEN_SILENCIO_MS;
    let mejor = hueco;
    for (const [s, e] of silencios) {
      if (s > ventanaFin) break;
      if (e >= t.to_ms - MARGEN_SILENCIO_MS && e <= ventanaFin) {
        mejor = Math.max(mejor, e - s);
      }
    }
    return mejor;
  });
}

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
  /** de esos, cuántos coinciden con pausa ≥ confirma */
  confirmadas: number;
  /** fronteras añadidas por silencio ≥ fuerza donde el ASR no puntuó */
  forzadas: number;
  pct_confirmadas: number;
  /**
   * Fronteras FUERTES (confirmadas + forzadas) por minuto: la métrica
   * operativa. computeBeats necesita un corte fuerte cada 8-15 s, o sea ≥4/min
   * para que ningún beat se estire hasta el fallback de fin de palabra.
   * Medido en el primer episodio real (monólogo rápido, whisper turbo):
   * pct_confirmadas 7 % — la ortografía del ASR NO es señal — pero 5,2
   * fronteras/min respaldadas por silencio, de sobra para el formato.
   */
  fuertes_por_min: number;
}

/**
 * Cruza puntuación y silencio. El GATE se mide PRIMERO y solo sobre la
 * puntuación del ASR — medirlo después de forzar lo inflaría, porque toda
 * frontera forzada por silencio queda confirmada por construcción.
 *
 * Después el silencio MANDA en las dos direcciones (medido en el primer
 * episodio real: solo el 7 % de los puntos del ASR coincidían con pausa):
 *   - pausa ≥ fuerza sin punto → se AÑADE la frontera
 *   - punto sin pausa ≥ confirma → se DEGRADA a cláusula (frontera débil):
 *     cortar un clip donde el audio no respira suena roto aunque la
 *     ortografía diga que ahí acababa la frase
 * computeBeats ve así fuertes solo las fronteras que se OYEN.
 */
export function cruzarConPausas(
  tokens: BeatToken[],
  opts: {
    confirmaMs?: number;
    fuerzaMs?: number;
    /** silencios [desde,hasta] medidos en el AUDIO (detectarSilencios) */
    silencios?: readonly [number, number][];
  } = {},
): GatePausas {
  const confirma = opts.confirmaMs ?? PAUSA_CONFIRMA_MS;
  const fuerza = opts.fuerzaMs ?? PAUSA_FUERZA_MS;
  const pausas = pausasTrasToken(tokens, opts.silencios);

  // 1) el gate, sobre lo que el ASR puntuó
  let frasesAsr = 0;
  let confirmadas = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    if (!tokens[i]!.sentenceEnd) continue;
    frasesAsr += 1;
    if (pausas[i]! >= confirma) confirmadas += 1;
  }

  // 2) el silencio manda donde la ortografía calló…
  let forzadas = 0;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (pausas[i]! >= fuerza && !tokens[i]!.sentenceEnd) {
      tokens[i]!.sentenceEnd = true;
      forzadas += 1;
    }
  }
  // …y donde puntuó sin que el audio respire
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i]!.sentenceEnd && pausas[i]! < confirma) {
      tokens[i]!.sentenceEnd = false;
      tokens[i]!.clauseEnd = true;
    }
  }

  const fin = tokens[tokens.length - 1];
  const durMin = fin !== undefined ? fin.to_ms / 60_000 : 0;
  const fuertes = tokens.filter((t) => t.sentenceEnd).length;
  return {
    frases_asr: frasesAsr,
    confirmadas,
    forzadas,
    pct_confirmadas: frasesAsr > 0 ? (100 * confirmadas) / frasesAsr : 0,
    fuertes_por_min: durMin > 0 ? fuertes / durMin : 0,
  };
}

/**
 * Sustituto de los scene_spans del guion: tramos entre pausas LARGAS (turnos,
 * cambios de tema). computeBeats los usa para no fundir en un beat dos turnos
 * distintos; `visual_query` va vacío — en un clip el visual es el hablante.
 * También estampa sceneIdx en cada token.
 */
export function spansDePausas(
  tokens: BeatToken[],
  totalMs: number,
  silencios?: readonly [number, number][],
): BeatSceneSpan[] {
  if (tokens.length === 0) {
    return [{ idx: 0, visual_query: '', from_ms: 0, to_ms: totalMs }];
  }
  const pausas = pausasTrasToken(tokens, silencios);
  const spans: BeatSceneSpan[] = [];
  let ini = 0;
  let idx = 0;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const gap = pausas[i]!;
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
