/**
 * Prueba suelta y ACOTADA de la cosecha temática (sin esperar al lunes).
 *
 *   pnpm --filter @fabrica/workers exec tsx scripts/probar-cosecha.ts <channelId> [query] [tope]
 *
 * Corre cosecharDesdeStock con una sola consulta y tope corto: búsquedas y
 * captions reales, descarga real a la biblioteca con times_used=0. Sirve para
 * verificar el camino entero sin una tarde de descargas.
 */
import { createWorkerContext } from '../src/lib/context.js';
import { cosecharDesdeStock } from '../src/pipelines/assets/index.js';

const channelId = process.argv[2];
if (!channelId) {
  console.error('Uso: probar-cosecha.ts <channelId> [query] [tope]');
  process.exit(1);
}
const query = process.argv[3] ?? 'data center server racks';
const tope = Number(process.argv[4] ?? 2);

const ctx = createWorkerContext();
const n = await cosecharDesdeStock(ctx, channelId, [query], {
  topePorQuery: tope,
  topeTotal: tope,
});
console.log(`cosechados: ${n} («${query}», tope ${tope})`);
await ctx.dbClient.end();
ctx.connection.disconnect();
ctx.pub.disconnect();
process.exit(0);
