import { eq } from 'drizzle-orm';
import { canTransition, type VideoState } from '@fabrica/shared';
import type { Db } from './index.js';
import { videos } from './schema.js';

// Máquina de estados en un solo sitio (SPEC principio 3). Las PUERTAS humanas
// solo se cruzan desde la API; los workers usan esto para avances automáticos
// (guion_ok→audio→assets, timeline_ok→render→hecho) y para incidencias.
// La validación de transición es idéntica en ambos casos.

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Transición inválida: ${from} → ${to}`);
  }
}

export interface IncidentPayload {
  message: string;
  suggested_action: 'reintentar' | 'regenerar' | 'descartar' | null;
  queue?: string;
}

export async function transitionVideo(
  db: Db,
  videoId: string,
  to: VideoState,
  opts: { expectFrom?: VideoState; incident?: IncidentPayload } = {},
): Promise<{ from: VideoState; to: VideoState }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: videos.state })
      .from(videos)
      .where(eq(videos.id, videoId))
      .for('update');
    if (!row) throw new Error(`Vídeo no encontrado: ${videoId}`);
    const from = row.state as VideoState;
    if (opts.expectFrom && from !== opts.expectFrom) {
      throw new InvalidTransitionError(from, to);
    }
    if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
    await tx
      .update(videos)
      .set({
        state: to,
        updatedAt: new Date(),
        // el payload viaja en el MISMO update que la transición: nunca hay
        // 'incidencia' sin mensaje ni mensaje sobre un vídeo ya reintentado
        ...(to === 'incidencia'
          ? { stateBeforeIncident: from, incident: opts.incident ?? null }
          : {}),
        ...(from === 'incidencia' ? { stateBeforeIncident: null, incident: null } : {}),
      })
      .where(eq(videos.id, videoId));
    return { from, to };
  });
}

export async function markIncident(
  db: Db,
  videoId: string,
  incident: IncidentPayload,
): Promise<void> {
  await transitionVideo(db, videoId, 'incidencia', { incident });
}
