import { and, eq, lt, sql, type SQL } from 'drizzle-orm';
import { assets } from '@fabrica/db';

// Política de purga (SPEC §11, docs/assets-y-biblioteca.md §7): un asset es
// candidato a purga cuando lleva PURGE_AFTER_DAYS días en la biblioteca sin
// usarse (times_used = 0) y ningún beat de ningún vídeo lo referencia.
// El borrado es SIEMPRE manual desde la UI; el barrido mensual solo cuenta.
// La API (apps/api/src/routes/library-browse.ts) refleja esta misma regla:
// si cambia aquí, debe cambiar allí.

export const PURGE_AFTER_DAYS = 90;

/** Fecha límite: lo creado antes de esta fecha ya cumple la antigüedad. */
export function purgeCutoff(now: Date): Date {
  return new Date(now.getTime() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000);
}

export interface PurgeInput {
  timesUsed: number;
  createdAt: Date;
  /** true si algún beat (de cualquier vídeo) referencia el asset. */
  referencedByBeats: boolean;
}

/** Predicado puro, espejo exacto de la condición SQL de purgeCandidatesCondition. */
export function isPurgeCandidate(asset: PurgeInput, now: Date): boolean {
  return (
    asset.timesUsed === 0 &&
    asset.createdAt.getTime() < purgeCutoff(now).getTime() &&
    !asset.referencedByBeats
  );
}

/** Condición drizzle sobre la tabla assets para listar/contar candidatos. */
export function purgeCandidatesCondition(now: Date): SQL {
  const condition = and(
    eq(assets.timesUsed, 0),
    lt(assets.createdAt, purgeCutoff(now)),
    // referencias directas Y como candidato elegido aún sin ingerir
    sql`NOT EXISTS (SELECT 1 FROM beats WHERE beats.asset_id = ${assets.id}
        OR beats.candidates::text LIKE '%"library:' || ${assets.id} || '"%')`,
  );
  // and() con argumentos no vacíos nunca devuelve undefined
  if (!condition) throw new Error('Condición de purga vacía');
  return condition;
}
