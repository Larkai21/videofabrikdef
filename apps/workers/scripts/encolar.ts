// Re-encola un job perdido (encadenado roto por reinicio del worker).
// Uso: tsx scripts/encolar.ts <cola> <job> <videoId>
import { JOBS, QUEUES } from '@fabrica/shared';
import { createWorkerContext } from '../src/lib/context.js';

const [cola, job, videoId] = process.argv.slice(2);
const ctx = createWorkerContext();
if (cola === 'assets' && job === 'match') {
  await ctx.queues.assets.add(JOBS.assets.match, { videoId });
  console.log('encolado assets.match para', videoId);
} else {
  console.error('combinación no soportada:', cola, job);
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 1500));
process.exit(0);
