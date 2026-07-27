import type { Worker } from 'bullmq';
import type { WorkerContext } from '../../lib/context.js';

// TODO(agente biblioteca): job library.backfill (caption VLM + embedding de
// assets sin indexar, p. ej. subidas manuales) y job library.purge-scan
// (candidatos a purga: times_used=0 a los 90 días; borrado manual). SPEC §11.
export async function registerLibraryWorkers(_ctx: WorkerContext): Promise<Worker[]> {
  return [];
}
