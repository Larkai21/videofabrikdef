import {
  SHORT_MAX_VISUALS_PER_BEAT,
  SHORT_PLANO_MAX_MS,
  SHORT_TROCEO_MAX_PARTES,
  SHORT_TROCEO_PARTE_MIN_MS,
  type Beat,
  type RenderableShort,
  type Subvisual,
} from '@fabrica/shared';
import { hashSeed } from '@fabrica/video/seed';
import { trocearCongelado, type LimitesTroceo } from '../assets/trocear.js';

// Ritmo de corte del short: un plano cada 2-3 s.
//
// El vídeo largo va a 4-8 s por plano, y el short hereda la ventana que le toca:
// medido sobre los primeros cuatro shorts reales, 2,8 / 4,8 / 7,5 y 11,3 s por
// plano. Once segundos de plano fijo en una pieza de treinta.
//
// Los cortes NO salen de beats nuevos —eso rompería la ley temporal del audio,
// que es el principio 1— sino de trocear más los planos que el humano YA aprobó:
// jump cuts dentro del mismo clip y re-encuadres de la misma imagen. Es el mismo
// mecanismo de la ingesta con los topes del formato, así que no hay búsqueda
// nueva, ni descarga, ni contenido que nadie haya visto.

const LIMITES_VERTICAL: LimitesTroceo = {
  imagenMaxMs: SHORT_PLANO_MAX_MS,
  clipMaxMs: SHORT_PLANO_MAX_MS,
  maxPartes: SHORT_TROCEO_MAX_PARTES,
  parteMinMs: SHORT_TROCEO_PARTE_MIN_MS,
};

/** Duración de cada asset de la biblioteca, por ruta. La necesita el jump cut. */
export type DuracionesPorRuta = Map<string, number | null>;

export interface ResumenRitmo {
  planosAntes: number;
  planosDespues: number;
  segundosPorPlano: number;
}

/** Los planos de un beat: sus sub-planos, o el asset entero si no los tiene. */
function planosDe(beat: Beat): Subvisual[] {
  if ((beat.visuals ?? []).length > 0) return beat.visuals!;
  if (beat.asset === undefined) return [];
  return [
    {
      from_ms: beat.from_ms,
      to_ms: beat.to_ms,
      visual_query: beat.visual_query,
      asset: beat.asset,
    },
  ];
}

function trocearPlano(plano: Subvisual, duraciones: DuracionesPorRuta, seed: number): Subvisual[] {
  const asset = plano.asset;
  if (asset?.kind === undefined || asset.path === undefined) return [plano];

  const partes = trocearCongelado({
    kind: asset.kind,
    from_ms: plano.from_ms,
    to_ms: plano.to_ms,
    fit: asset.fit,
    assetDurationMs: duraciones.get(asset.path) ?? null,
    seed,
    limites: LIMITES_VERTICAL,
  });
  if (partes.length <= 1) return [plano];

  return partes.map((parte) => ({
    ...plano,
    from_ms: parte.from_ms,
    to_ms: parte.to_ms,
    asset: {
      ...asset,
      fit: parte.fit,
      ...(parte.effect !== undefined ? { effect: parte.effect } : {}),
    },
  }));
}

/**
 * Devuelve el maestro con sus planos troceados al ritmo del formato vertical.
 * Puro: mismo maestro y mismas duraciones → mismo resultado, que es lo que
 * permite seguir congelándolo al proponer.
 */
export function densificarRitmo(
  master: RenderableShort,
  duraciones: DuracionesPorRuta,
): { master: RenderableShort; resumen: ResumenRitmo } {
  const planosAntes = master.beats.reduce((acc, b) => acc + planosDe(b).length, 0);

  const beats = master.beats.map((beat) => {
    const planos = planosDe(beat);
    if (planos.length === 0) return beat;

    const troceados = planos.flatMap((plano, i) =>
      trocearPlano(plano, duraciones, hashSeed(`${master.video.id}:${beat.idx}:${i}`)),
    );
    // el tope por beat existe para que un beat largo no se convierta en un
    // estroboscopio; si se pasa, se conservan los primeros y el último absorbe
    // el resto del tramo
    const visuals =
      troceados.length <= SHORT_MAX_VISUALS_PER_BEAT
        ? troceados
        : [
            ...troceados.slice(0, SHORT_MAX_VISUALS_PER_BEAT - 1),
            { ...troceados[SHORT_MAX_VISUALS_PER_BEAT - 1]!, to_ms: beat.to_ms },
          ];

    // `beat.asset` sigue reflejando el PRIMER plano: lo leen la miniatura y el
    // dashboard, y el render usa `visuals` cuando hay más de uno
    return {
      ...beat,
      ...(visuals[0]?.asset !== undefined ? { asset: visuals[0].asset } : {}),
      ...(visuals.length > 1 ? { visuals } : {}),
    } satisfies Beat;
  });

  const planosDespues = beats.reduce((acc, b) => acc + planosDe(b).length, 0);
  const duracionS = master.short.duration_ms / 1000;
  return {
    master: { ...master, beats },
    resumen: {
      planosAntes,
      planosDespues,
      segundosPorPlano: planosDespues > 0 ? duracionS / planosDespues : duracionS,
    },
  };
}
