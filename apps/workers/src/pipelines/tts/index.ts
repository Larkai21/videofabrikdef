import type { Worker } from 'bullmq';
import type { WorkerContext } from '../../lib/context.js';

// TODO(agente tts): síntesis por escena con msedge-tts tras interfaz
// TtsProvider, concat ffmpeg con silencios, loudnorm −16 LUFS, cues de
// subtítulos y algoritmo de beats 8–15 s. Ver docs/voz-y-beats.md.
export async function registerTtsWorkers(_ctx: WorkerContext): Promise<Worker[]> {
  return [];
}
