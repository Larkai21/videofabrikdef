import type { Worker } from 'bullmq';
import type { WorkerContext } from '../../lib/context.js';

// TODO(agente brand kit): job components.validate — compilar el zip contra el
// contrato de props, render de humo de 60 frames, preview PNG, regenerar el
// registry y activar. SPEC §10 y docs/render.md §2.
export async function registerComponentsWorkers(_ctx: WorkerContext): Promise<Worker[]> {
  return [];
}
