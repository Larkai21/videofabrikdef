import type { Worker } from 'bullmq';
import type { WorkerContext } from '../../lib/context.js';

// TODO(agente ideas): scoring de clusters (señal externa, encaje, frescura,
// saturación, valor comercial) y redacción de ideas con LLM. Ver docs/scraper.md §4.
export async function registerIdeasWorkers(_ctx: WorkerContext): Promise<Worker[]> {
  return [];
}
