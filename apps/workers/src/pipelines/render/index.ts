import type { Worker } from 'bullmq';
import type { WorkerContext } from '../../lib/context.js';

// TODO(agente render): validar renderableMasterV1, bundle() cacheado de
// packages/video, renderMedia h264 crf 18 con progreso a Redis, renderStill
// de 2 miniaturas y salida outputs/<id>/ con metadatos. Cola con concurrencia
// 1. Ver docs/render.md.
export async function registerRenderWorkers(_ctx: WorkerContext): Promise<Worker[]> {
  return [];
}
