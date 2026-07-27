import type { Worker } from 'bullmq';
import type { WorkerContext } from '../../lib/context.js';

// TODO(agente publicación): job publish.upload — subida resumable a YouTube
// en PRIVADO con containsSyntheticMedia y publishAt del siguiente hueco de la
// programación del canal; miniatura elegida; proveedor mock sin credenciales.
// La subida SIEMPRE la aprueba el humano desde la bandeja. SPEC §12 y §14 S3.
export async function registerPublishWorkers(_ctx: WorkerContext): Promise<Worker[]> {
  return [];
}
