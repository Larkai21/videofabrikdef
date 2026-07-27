import type { Worker } from 'bullmq';
import type { WorkerContext } from '../../lib/context.js';

// TODO(agente sources): polling de fuentes (RSS, HN, arXiv, Google News),
// normalización a raw_items, dedupe exacto por hash y semántico por embeddings,
// clustering; modo bootstrap del wizard. Ver docs/scraper.md.
export async function registerSourcesWorkers(_ctx: WorkerContext): Promise<Worker[]> {
  return [];
}
