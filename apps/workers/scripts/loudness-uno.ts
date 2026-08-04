import pino from 'pino';
import { ajustarLoudnessEntrega } from '../src/pipelines/render/loudness.js';

// Utilidad de verificación: aplica la ganancia de entrega a un MP4 ya
// renderizado, sin repetir el render. Idempotente (la segunda pasada no toca).
const mp4 = process.argv[2];
if (!mp4) {
  console.error('Uso: pnpm --filter @fabrica/workers exec tsx scripts/loudness-uno.ts <video.mp4>');
  process.exit(1);
}
await ajustarLoudnessEntrega(mp4, pino({ level: 'info' }));
