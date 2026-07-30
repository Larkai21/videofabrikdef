import type { StockResult } from '../../providers/stock.js';
import { computeFit } from './fit.js';

// Qué resultados de stock llegan a puntuarse. Es una decisión de PRODUCTO
// disfrazada de detalle de implementación: los candidatos que no entran aquí no
// existen para el resto de la cascada, así que este reparto fija el suelo del
// porcentaje de imágenes fijas del vídeo entero.

/**
 * Reparto de plazas entre clips e imágenes, con relleno cruzado.
 *
 * `imagenesMax` es un TECHO, no una cuota fija: si no hay imágenes, los clips
 * se llevan todo. Y al revés — si no hay clips suficientes, las imágenes
 * rellenan. Los finalistas siempre son `total` mientras haya material.
 */
export function repartirPlazas(
  nClips: number,
  nImagenes: number,
  total: number,
  imagenesMax: number,
): { clips: number; imagenes: number } {
  const imagenes = Math.min(nImagenes, imagenesMax);
  const clips = Math.min(nClips, total - imagenes);
  // relleno cruzado en los dos sentidos
  const hueco = total - clips - imagenes;
  if (hueco <= 0) return { clips, imagenes };
  return {
    clips: clips + Math.min(hueco, nClips - clips),
    imagenes: imagenes + Math.min(Math.max(0, hueco - (nClips - clips)), nImagenes - imagenes),
  };
}

// Intercalado por proveedor: sin esto los finalistas salen por orden de API y
// Pixabay casi nunca llega a puntuarse. Ojo — antes agrupaba por proveedor Y
// tipo, y ahí estaba el problema: mezclaba equidad entre FUENTES (que es lo que
// se quiere) con reparto entre TIPOS de plano (que es una decisión editorial y
// no debe salir de un round-robin). Con 6 plazas, las fotos se llevaban 2,16 de
// media por pura construcción.
export function interleaveByProvider<T extends { provider: string }>(results: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const r of results) {
    const group = groups.get(r.provider) ?? [];
    group.push(r);
    groups.set(r.provider, group);
  }
  const lists = [...groups.values()];
  const out: T[] = [];
  for (let i = 0; out.length < results.length; i++) {
    for (const list of lists) {
      const item = list[i];
      if (item) out.push(item);
    }
    if (lists.every((l) => i >= l.length)) break;
  }
  return out;
}

/**
 * Los `total` finalistas de una búsqueda de stock, con techo de imágenes fijas.
 *
 * Tres cosas que tienen que pasar EN ESTE ORDEN, y el orden es el arreglo:
 *
 * 1. Vetar antes de cuotear. Antes se intercalaba, se filtraba y se cortaba, así
 *    que un ref ya usado en otro beat se comía una plaza y la desperdiciaba: la
 *    mezcla real se apartaba de la nominal justo en los beats finales, que son
 *    los que más refs acumulan vetados.
 * 2. Comprobar el encaje antes de gastar una plaza. Un clip más corto que el
 *    tramo y que ni con bucles lo cubre se descartaba DESPUÉS, en `computeFit`,
 *    cuando ya había desplazado a otro candidato.
 * 3. Nunca dejar las imágenes a cero. Medido sobre 173 consultas reales: con
 *    cero plazas, ninguna imagen de stock llega a puntuarse en ningún caso, y
 *    la cascada se queda sin red cuando ningún clip encaja en el tramo. Ya no
 *    hay generación de imagen detrás que rescate el beat, así que esa plaza es
 *    lo único que separa un plano flojo de no tener plano. Cuesta nada y
 *    convierte una prohibición en una preferencia.
 */
export function pickFinalists(
  results: readonly StockResult[],
  opts: {
    total: number;
    imagenesMax: number;
    spanMs: number;
    vetoedRefs: ReadonlySet<string>;
  },
): StockResult[] {
  const usable = results.filter((r) => !opts.vetoedRefs.has(r.ref));
  const cubre = (r: StockResult): boolean =>
    computeFit({
      kind: 'clip',
      assetDurationMs: r.meta.duration_ms,
      beatDurationMs: opts.spanMs,
    }) !== null;
  const clips = interleaveByProvider(usable.filter((r) => r.meta.kind === 'clip' && cubre(r)));
  const imagenes = interleaveByProvider(usable.filter((r) => r.meta.kind !== 'clip'));
  const plazas = repartirPlazas(clips.length, imagenes.length, opts.total, opts.imagenesMax);
  return [...clips.slice(0, plazas.clips), ...imagenes.slice(0, plazas.imagenes)];
}
