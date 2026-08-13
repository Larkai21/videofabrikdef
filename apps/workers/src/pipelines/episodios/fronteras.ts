import type { BeatToken } from '../tts/beats.js';

// Ajuste de la ventana de un clip a FRONTERAS DE FRASE. Los beats cortan
// preferentemente en fin de frase, pero cuando la señal es floja la frontera
// puede caer a mitad («…but I've | still got my fingers crossed»): la
// certificación 13-ago-2026 pilló un clip acabando con la palabra colgada.
// Determinista y puro: misma ventana y tokens → misma ventana ajustada.

/** Cuánto se puede estirar el final para completar la frase en curso. */
const EXTENSION_MAX_MS = 3_000;
/** Cuánto se puede adelantar el arranque para saltarse una frase a medias. */
const ARRANQUE_MAX_MS = 2_000;

export interface Ventana {
  from_ms: number;
  to_ms: number;
}

/**
 * Devuelve la ventana con el final en fin de frase y el arranque en inicio
 * de frase. El final se EXTIENDE (hasta EXTENSION_MAX_MS) para no cortar el
 * remate; si la frase no cierra ahí, se RETRAE al último fin de frase dentro
 * de la ventana. El arranque salta hacia delante la frase que venía empezada
 * (hasta ARRANQUE_MAX_MS); si no hay frontera cerca, se queda donde estaba.
 *
 * `retraer: false` (subventanas del operador): en transcripciones run-on sin
 * puntuación la retracción puede comerse 10+ s del encargo — mejor acabar en
 * frase floja que traicionar la ventana que eligió una persona.
 */
export function ajustarVentanaAFrase(
  ventana: Ventana,
  tokens: readonly BeatToken[],
  opts: { retraer?: boolean } = {},
): Ventana {
  const retraer = opts.retraer ?? true;
  let { from_ms, to_ms } = ventana;

  // — arranque: si el token anterior al primero incluido no cierra frase,
  //   la ventana empieza a mitad; salta al primer arranque de frase cercano
  const iPrimero = tokens.findIndex((t) => t.from_ms >= from_ms);
  if (iPrimero > 0 && !tokens[iPrimero - 1]!.sentenceEnd) {
    for (let i = iPrimero; i < tokens.length; i += 1) {
      const t = tokens[i]!;
      if (t.from_ms > from_ms + ARRANQUE_MAX_MS) break;
      if (t.sentenceEnd) {
        const sig = tokens[i + 1];
        if (sig !== undefined && sig.from_ms < to_ms) from_ms = sig.from_ms;
        break;
      }
    }
  }

  // — final: el último token dentro debe cerrar frase; si no, extiende hasta
  //   el fin de frase siguiente o retrae al último que sí cierra
  let iUltimo = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i]!.to_ms <= to_ms) iUltimo = i;
    else break;
  }
  if (iUltimo >= 0 && !tokens[iUltimo]!.sentenceEnd) {
    let extendido = false;
    for (let i = iUltimo + 1; i < tokens.length; i += 1) {
      const t = tokens[i]!;
      if (t.to_ms > to_ms + EXTENSION_MAX_MS) break;
      if (t.sentenceEnd) {
        to_ms = t.to_ms;
        extendido = true;
        break;
      }
    }
    if (!extendido && retraer) {
      for (let i = iUltimo; i >= 0; i -= 1) {
        const t = tokens[i]!;
        if (t.to_ms <= from_ms) break;
        if (t.sentenceEnd) {
          to_ms = t.to_ms;
          break;
        }
      }
    }
  }

  return { from_ms, to_ms };
}
