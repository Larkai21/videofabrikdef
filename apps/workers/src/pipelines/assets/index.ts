import type { Worker } from 'bullmq';
import type { WorkerContext } from '../../lib/context.js';

// TODO(agente assets): cascada biblioteca → Pexels/Pixabay → Flux con
// umbrales T_auto/T_rev/T_stock, stock_cache con TTL, fit calculado
// (trim/loop/kenburns), descarga e ingesta a biblioteca al aprobar la
// timeline. Ver docs/assets-y-biblioteca.md.
export async function registerAssetsWorkers(_ctx: WorkerContext): Promise<Worker[]> {
  return [];
}
