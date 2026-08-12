import { eq } from 'drizzle-orm';
import { canTransitionEpisode, type EpisodeState } from '@fabrica/shared';
import type { Db } from './index.js';
import { episodes } from './schema.js';
import { InvalidTransitionError, type IncidentPayload } from './state.js';

// Motor de transiciones del episodio externo. Calco del de shorts
// (short-state.ts): SELECT … FOR UPDATE en transacción, la máquina que valida
// es la de @fabrica/shared y la API mapea InvalidTransitionError a 409.

export async function transitionEpisode(
  db: Db,
  episodeId: string,
  to: EpisodeState,
  opts: { expectFrom?: EpisodeState; incident?: IncidentPayload } = {},
): Promise<{ from: EpisodeState; to: EpisodeState }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: episodes.state })
      .from(episodes)
      .where(eq(episodes.id, episodeId))
      .for('update');
    if (!row) throw new Error(`Episodio no encontrado: ${episodeId}`);
    const from = row.state as EpisodeState;
    if (opts.expectFrom && from !== opts.expectFrom) {
      throw new InvalidTransitionError(from, to);
    }
    if (!canTransitionEpisode(from, to)) throw new InvalidTransitionError(from, to);
    await tx
      .update(episodes)
      .set({
        state: to,
        updatedAt: new Date(),
        ...(to === 'incidencia'
          ? { stateBeforeIncident: from, incident: opts.incident ?? null }
          : {}),
        ...(from === 'incidencia' ? { stateBeforeIncident: null, incident: null } : {}),
      })
      .where(eq(episodes.id, episodeId));
    return { from, to };
  });
}

export async function markIncidentEpisode(
  db: Db,
  episodeId: string,
  incident: IncidentPayload,
): Promise<void> {
  await transitionEpisode(db, episodeId, 'incidencia', { incident });
}
