import {
  IMAGE_HANDICAP,
  LIBRARY_HANDICAP,
  MAX_LOOPS,
  T_REV,
  type BeatCandidate,
  type Fit,
} from '@fabrica/shared';
import { cosineSimilarity } from '../../providers/embeddings.js';

// La elección del plano entre los candidatos ya puntuados. Vive aparte de
// index.ts porque es la única parte de la cascada que es PURA —sin BD, sin red,
// sin coste— y por tanto la única que se puede probar de verdad. Estaba dentro
// del worker y por eso no tenía un solo test.

export interface PoolEntry {
  cand: BeatCandidate;
  kind: 'clip' | 'image';
  durationMs: number | null;
  // similitud coseno pura query↔contenido: la que se compara con los umbrales
  cos: number;
  // compuesto 0,6·cos + calidad + novedad: solo para ordenar entre parecidos
  composite: number;
  // otras identidades del MISMO asset (library:<id> ↔ sourceRef de stock)
  altRefs: string[];
  // embedding del contenido (caption/tags): para no repetir el mismo plano en
  // beats contiguos. Vacío si no se conoce.
  vec: number[];
}

export function identityRefs(entry: PoolEntry): string[] {
  return [entry.cand.ref, ...entry.altRefs];
}

/**
 * Coseno con el que se ORDENA (el crudo se conserva para los umbrales y para
 * enseñárselo al humano). Dos handicaps, por motivos distintos:
 *
 * - BIBLIOTECA: compite en desigualdad de material. El stock busca de cero
 *   entre millones de clips y casi siempre tiene algo que ilustra la consulta;
 *   la biblioteca tiene un par de cientos de assets, así que para la mayoría de
 *   consultas no tiene nada realmente relevante — pero como los cosenos están
 *   comprimidos en una franja estrecha, un asset mediocre suyo empata con uno
 *   bueno de stock y gana por azar. Medido: «lupa sobre texto impreso» se
 *   resolvió con un logo de Windows.
 * - IMAGEN FIJA: es el plan B del b-roll. Un vídeo hecho de fotos con Ken
 *   Burns se siente una presentación, y el sistema no tenía ninguna preferencia
 *   por el movimiento en ningún sitio.
 *
 * Se suman: una imagen de biblioteca arrastra los dos. Es deliberado —es el
 * candidato menos deseable de todos— pero sigue pudiendo ganar si de verdad es
 * mucho mejor, que es la única situación en la que aporta.
 */
export function cosEfectivo(e: PoolEntry, imagenHandicap = IMAGE_HANDICAP): number {
  const lib = e.cand.provider === 'library' ? LIBRARY_HANDICAP : 0;
  const img = e.kind === 'image' ? imagenHandicap : 0;
  return e.cos - lib - img;
}

// Penalización de encaje: 0 para una sola pasada (trim/stretch/kenburns),
// nº de repeticiones para loop. Menor es mejor.
export function loopPenalty(fit: Fit): number {
  return fit.mode === 'loop' ? (fit.loops ?? MAX_LOOPS) : 0;
}

// margen de coseno dentro del cual se prefiere el clip que cubre el beat en una
// sola pasada (evita bucles) frente al de coseno ligeramente mayor
export const PICK_COS_MARGIN = 0.04;
// coseno de contenido por encima del cual dos clips se consideran "el mismo
// plano" y no deben caer en beats contiguos aunque sean refs distintos
export const ADJACENT_DEDUPE_COS = 0.9;

/**
 * Elige el candidato entre los que están dentro de PICK_COS_MARGIN del mejor
 * coseno disponible: prefiere el que no repite plano del beat anterior y el que
 * cubre el beat sin bucle. Fuera de esa banda manda el coseno.
 *
 * La guarda de viabilidad es lo primero que se aplica y no es cosmética: la
 * banda se ancla en el coseno EFECTIVO (con handicaps) pero T_REV se compara
 * contra el CRUDO. Sin la guarda, el orden intra-banda —que antepone «sin
 * bucle» al coseno— puede elegir un candidato por debajo de T_REV existiendo
 * otro por encima. Es la precondición de los handicaps: mientras exista un
 * candidato aceptable se elige uno aceptable, y por tanto ninguna preferencia
 * de tipo puede degradar el plano por debajo del umbral.
 *
 * (Cuando existía el tier de generación de imagen, esto además evitaba pagar
 * por un Flux teniendo el clip delante. Ese tier ya no está, pero la guarda
 * sigue siendo necesaria: ahora lo que evita es mandar a revisión humana un
 * plano flojo habiendo uno bueno en el mismo pool.)
 */
export function selectPick(
  fitted: readonly { entry: PoolEntry; fit: Fit }[],
  usedRefs: ReadonlySet<string>,
  prevVec: number[] | null,
  imagenHandicap = IMAGE_HANDICAP,
): { entry: PoolEntry; fit: Fit } | undefined {
  if (fitted.length === 0) return undefined;
  // Red de seguridad: el pool ya viene sin los refs usados, pero un mismo
  // recurso puede entrar con varios alias (altRefs), y ahí sí puede colarse un
  // repetido. Nunca se degrada a reutilizar salvo que NO quede otra cosa.
  const fresh = fitted.filter((f) => identityRefs(f.entry).every((r) => !usedRefs.has(r)));
  const conRefs = fresh.length > 0 ? fresh : fitted;
  const viables = conRefs.filter((f) => f.entry.cos >= T_REV);
  const base = viables.length > 0 ? viables : conRefs;
  const cos = (e: PoolEntry): number => cosEfectivo(e, imagenHandicap);
  const bestCos = base[0] ? cos(base[0].entry) : 0; // fitted ya viene ordenado
  const band = base.filter((f) => bestCos - cos(f.entry) <= PICK_COS_MARGIN);
  const isAdjacent = (e: PoolEntry): boolean =>
    prevVec !== null && e.vec.length > 0 && cosineSimilarity(prevVec, e.vec) > ADJACENT_DEDUPE_COS;
  const notAdjacent = band.filter((f) => !isAdjacent(f.entry));
  const contenders = notAdjacent.length > 0 ? notAdjacent : band;
  // dentro de la banda: primero sin bucle, luego mayor coseno
  return [...contenders].sort(
    (a, b) => loopPenalty(a.fit) - loopPenalty(b.fit) || cos(b.entry) - cos(a.entry),
  )[0];
}
