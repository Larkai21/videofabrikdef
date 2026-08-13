import { eq } from 'drizzle-orm';
import { canTransitionReel, type ReelState } from '@fabrica/shared';
import type { Db } from './index.js';
import { reels } from './schema.js';
import { InvalidTransitionError, type IncidentPayload } from './state.js';

// Motor de transiciones del reel. Calco del de episodios (episode-state.ts):
// SELECT … FOR UPDATE en transacción, la máquina que valida es la de
// @fabrica/shared y la API mapea InvalidTransitionError a 409.

export async function transitionReel(
  db: Db,
  reelId: string,
  to: ReelState,
  opts: { expectFrom?: ReelState; incident?: IncidentPayload } = {},
): Promise<{ from: ReelState; to: ReelState }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: reels.state })
      .from(reels)
      .where(eq(reels.id, reelId))
      .for('update');
    if (!row) throw new Error(`Reel no encontrado: ${reelId}`);
    const from = row.state as ReelState;
    if (opts.expectFrom && from !== opts.expectFrom) {
      throw new InvalidTransitionError(from, to);
    }
    if (!canTransitionReel(from, to)) throw new InvalidTransitionError(from, to);
    await tx
      .update(reels)
      .set({
        state: to,
        updatedAt: new Date(),
        ...(to === 'incidencia'
          ? { stateBeforeIncident: from, incident: opts.incident ?? null }
          : {}),
        ...(from === 'incidencia' ? { stateBeforeIncident: null, incident: null } : {}),
      })
      .where(eq(reels.id, reelId));
    return { from, to };
  });
}

export async function markIncidentReel(
  db: Db,
  reelId: string,
  incident: IncidentPayload,
): Promise<void> {
  await transitionReel(db, reelId, 'incidencia', { incident });
}
