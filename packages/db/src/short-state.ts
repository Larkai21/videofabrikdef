import { eq } from 'drizzle-orm';
import { canTransitionShort, type ShortState } from '@fabrica/shared';
import type { Db } from './index.js';
import { shorts } from './schema.js';
import { InvalidTransitionError, type IncidentPayload } from './state.js';

// Motor de transiciones del short. Calco del de vídeo (state.ts): mismo
// SELECT … FOR UPDATE dentro de la transacción y misma InvalidTransitionError,
// que la API ya mapea a 409. La máquina que valida es la del short, que es
// distinta y vive en @fabrica/shared.

export async function transitionShort(
  db: Db,
  shortId: string,
  to: ShortState,
  opts: { expectFrom?: ShortState; incident?: IncidentPayload } = {},
): Promise<{ from: ShortState; to: ShortState }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: shorts.state })
      .from(shorts)
      .where(eq(shorts.id, shortId))
      .for('update');
    if (!row) throw new Error(`Short no encontrado: ${shortId}`);
    const from = row.state as ShortState;
    if (opts.expectFrom && from !== opts.expectFrom) {
      throw new InvalidTransitionError(from, to);
    }
    if (!canTransitionShort(from, to)) throw new InvalidTransitionError(from, to);
    await tx
      .update(shorts)
      .set({
        state: to,
        updatedAt: new Date(),
        // el payload viaja en el MISMO update que la transición: nunca hay
        // 'incidencia' sin mensaje ni mensaje sobre un short ya reintentado
        ...(to === 'incidencia'
          ? { stateBeforeIncident: from, incident: opts.incident ?? null }
          : {}),
        ...(from === 'incidencia' ? { stateBeforeIncident: null, incident: null } : {}),
      })
      .where(eq(shorts.id, shortId));
    return { from, to };
  });
}

export async function markIncidentShort(
  db: Db,
  shortId: string,
  incident: IncidentPayload,
): Promise<void> {
  await transitionShort(db, shortId, 'incidencia', { incident });
}
