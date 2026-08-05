import type { Word } from '@fabrica/shared';

// Reparto de las palabras de un cue en GRUPOS para el subtítulo vertical.
//
// El tema apaisado pinta el cue entero en dos líneas de 54 px. En vertical la
// gramática es la contraria: una o dos palabras enormes que se relevan al ritmo
// de la voz. Los cues de entrada ya vienen acotados (CUE_MAX_WORDS=7,
// CUE_MAX_CHARS=32), así que cada uno produce dos o tres grupos.
//
// Puro y sin tiempo de render: se prueba sin montar nada.

export const GRUPO_MAX_PALABRAS = 3;
export const GRUPO_MAX_CARACTERES = 16;
/** Una respiración más larga que esto corta el grupo. */
export const GRUPO_HUECO_MS = 200;
/** Por debajo de esto el grupo parpadea, así que se fusiona con el siguiente. */
export const GRUPO_MIN_MS = 380;
/** Tope duro tras fusionar: cuatro palabras ya no caben a cuerpo de titular. */
const GRUPO_TOPE_FUSION = 4;

export interface Grupo {
  words: Word[];
  from_ms: number;
  to_ms: number;
}

const largo = (words: Word[]): number =>
  words.reduce((acc, w) => acc + w.w.length, 0) + Math.max(0, words.length - 1);

function cerrar(words: Word[]): Grupo {
  return {
    words,
    from_ms: words[0]!.from_ms,
    to_ms: words[words.length - 1]!.to_ms,
  };
}

export function agruparPalabras(words: Word[]): Grupo[] {
  if (words.length === 0) return [];

  const grupos: Grupo[] = [];
  let actual: Word[] = [];
  for (const w of words) {
    if (actual.length === 0) {
      actual.push(w);
      continue;
    }
    const anterior = actual[actual.length - 1]!;
    const cabe =
      actual.length < GRUPO_MAX_PALABRAS && largo([...actual, w]) <= GRUPO_MAX_CARACTERES;
    const seguido = w.from_ms - anterior.to_ms <= GRUPO_HUECO_MS;
    if (cabe && seguido) {
      actual.push(w);
    } else {
      grupos.push(cerrar(actual));
      actual = [w];
    }
  }
  if (actual.length > 0) grupos.push(cerrar(actual));

  // Fusión de los que parpadearían. Se mira primero HACIA DELANTE: una
  // partícula suelta («y», «que») se lee con lo que viene, no con lo que ya
  // pasó. Hacia atrás solo si es el último grupo y no hay siguiente.
  const salida: Grupo[] = [];
  for (let i = 0; i < grupos.length; i += 1) {
    const g = grupos[i]!;
    const corto = g.to_ms - g.from_ms < GRUPO_MIN_MS;
    if (!corto) {
      salida.push(g);
      continue;
    }
    const siguiente = grupos[i + 1];
    if (siguiente !== undefined && g.words.length + siguiente.words.length <= GRUPO_TOPE_FUSION) {
      grupos[i + 1] = cerrar([...g.words, ...siguiente.words]);
      continue;
    }
    const previo = salida[salida.length - 1];
    if (previo !== undefined && previo.words.length + g.words.length <= GRUPO_TOPE_FUSION) {
      salida[salida.length - 1] = cerrar([...previo.words, ...g.words]);
      continue;
    }
    // sin vecino con quien fusionar: mejor un grupo corto que perder la palabra
    salida.push(g);
  }
  return salida;
}

/**
 * Cuerpo que cabe en el ancho útil. Réplica de fitTitleSize con los topes del
 * formato vertical; se saca aparte para poder comprobar la contención por
 * aritmética en CI, sin navegador ni getBoundingClientRect.
 */
export function cuerpoDeGrupo(texto: string, anchoUtil: number): number {
  const MAX = 128;
  const MIN = 72;
  const PRESUPUESTO = 1520;
  const propuesto = PRESUPUESTO / Math.max(8, texto.trim().length);
  const acotado = Math.min(MAX, Math.max(MIN, propuesto));
  // ancho medio de glifo en Inter 800 ≈ 0,55 em; si aun así no cabe, se baja
  const estimado = texto.trim().length * 0.55 * acotado;
  if (estimado <= anchoUtil) return Math.round(acotado);
  return Math.round(Math.max(MIN * 0.7, anchoUtil / (texto.trim().length * 0.55)));
}
