import type { Worker } from 'bullmq';
import type { WorkerContext } from '../../lib/context.js';

// TODO(agente script): research pack (readability + LLM), guion JSON de
// escenas + paquete SEO en una pasada, juez de alineación y refinamiento
// dirigido. Ver docs/generacion-guion.md.
export async function registerScriptWorkers(_ctx: WorkerContext): Promise<Worker[]> {
  return [];
}
