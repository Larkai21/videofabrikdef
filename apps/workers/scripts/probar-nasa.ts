/**
 * Prueba suelta del cliente de NASA (red de clips de dominio público).
 *
 *   pnpm --filter @fabrica/workers exec tsx scripts/probar-nasa.ts [consulta]
 *
 * Pega contra la API real (búsqueda + collection/metadata por candidato) y
 * enseña lo que entraría al pool: ref, duración, dimensiones, caption y mp4.
 * Escribe en stock_cache como cualquier búsqueda (TTL 24 h).
 */
import pino from 'pino';
import { createDb } from '@fabrica/db';
import { searchNasa } from '../src/providers/stock.js';

const query = process.argv[2] ?? 'mars rover';
const { db, client } = createDb();
const logger = pino({ level: 'warn' });

const res = await searchNasa(db, logger, query, {});
console.log(`«${query}» → ${res.length} candidatos`);
for (const r of res) {
  console.log(
    [
      `- ${r.ref} · ${Math.round(Number(r.meta.duration_ms) / 1000)} s · ${r.meta.width}x${r.meta.height}`,
      `  ${String(r.meta.title).slice(0, 76)}`,
      `  caption: ${String(r.meta.caption ?? '—').slice(0, 90)}`,
      `  mp4: ${String(r.meta.download_url).slice(0, 96)}`,
    ].join('\n'),
  );
}
await client.end();
