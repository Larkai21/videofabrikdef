import type { BeatToken } from '../tts/beats.js';

// Detección de CARCAJADAS (reacciones sonoras sin palabras) a partir de lo ya
// medido: los tokens del STT y los silencios del audio. Cero pasadas nuevas
// de ffmpeg y cero aleatoriedad (principio 6).
//
// La física de la señal: whisper estira la última palabra de cada frase hasta
// el siguiente ataque de voz (trampa documentada en tokens.ts). Si ese
// estirón — o un hueco entre palabras — NO está cubierto por silencio, en el
// audio hay SONIDO SIN PALABRAS: en una entrevista, risas o reacción. La
// referencia (CrispyTheory) corta el clip exactamente ahí, en la carcajada;
// esta señal es lo que le faltaba al director para dejar de adivinar el
// remate (certificación 13-ago-2026).
//
// El estirón solo se evalúa en tokens con fin de frase o cláusula: una
// palabra larga de verdad a mitad de frase («advantageous») no es reacción.

export interface Risa {
  at_ms: number;
  dur_ms: number;
}

/** Lo que dura decir una palabra; el exceso sobre esto es estirón del ASR. */
const DUR_PALABRA_NOMINAL_MS = 400;
/** Menos que esto no es reacción: es una respiración. */
const RISA_MIN_MS = 500;
/** Si el silencio cubre más que esto del tramo, es pausa callada, no risa. */
const COBERTURA_SILENCIO_MAX = 0.4;
/** Dos eventos más cerca que esto son la misma carcajada. */
const FUSION_MS = 300;

function solapeConSilencios(
  desde: number,
  hasta: number,
  silencios: readonly [number, number][],
): number {
  let total = 0;
  for (const [s, e] of silencios) {
    if (s >= hasta) break;
    if (e <= desde) continue;
    total += Math.min(e, hasta) - Math.max(s, desde);
  }
  return total;
}

/**
 * Eventos de risa/reacción del episodio, ordenados y fusionados. Puro:
 * mismos tokens y silencios → mismos eventos.
 */
export function detectarRisas(
  tokens: readonly BeatToken[],
  silencios: readonly [number, number][],
): Risa[] {
  const crudos: Risa[] = [];
  const considerar = (desde: number, hasta: number) => {
    const dur = hasta - desde;
    if (dur < RISA_MIN_MS) return;
    const cubierto = solapeConSilencios(desde, hasta, silencios);
    if (cubierto / dur > COBERTURA_SILENCIO_MAX) return;
    crudos.push({ at_ms: desde, dur_ms: dur });
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    // estirón de la palabra que cierra frase/cláusula: el remate y su risa
    if (t.sentenceEnd || t.clauseEnd) {
      considerar(t.from_ms + DUR_PALABRA_NOMINAL_MS, t.to_ms);
    }
    // hueco entre palabras sin silencio: reacción entre turnos
    const sig = tokens[i + 1];
    if (sig !== undefined) {
      considerar(t.to_ms, sig.from_ms);
    }
  }

  crudos.sort((a, b) => a.at_ms - b.at_ms);
  const out: Risa[] = [];
  for (const r of crudos) {
    const ultima = out[out.length - 1];
    if (ultima !== undefined && r.at_ms <= ultima.at_ms + ultima.dur_ms + FUSION_MS) {
      // fusiona: el fin es el más tardío de los dos
      ultima.dur_ms = Math.max(ultima.at_ms + ultima.dur_ms, r.at_ms + r.dur_ms) - ultima.at_ms;
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** Ventana alrededor del fin del beat donde una risa cuenta como SU remate. */
const ANTES_MS = 1_500;
const DESPUES_MS = 2_000;

/**
 * La risa que remata un beat (si la hay): el evento más largo que arranca
 * cerca de su frontera final. Devuelve la duración en ms o undefined.
 */
export function risaTrasBeat(beatToMs: number, risas: readonly Risa[]): number | undefined {
  let mejor: number | undefined;
  for (const r of risas) {
    if (r.at_ms < beatToMs - ANTES_MS) continue;
    if (r.at_ms > beatToMs + DESPUES_MS) break;
    if (mejor === undefined || r.dur_ms > mejor) mejor = r.dur_ms;
  }
  return mejor;
}
