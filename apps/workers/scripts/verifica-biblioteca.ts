/**
 * ¿La biblioteca gana por parecerse al plano o por parecerse a la búsqueda que
 * la trajo? Embebe unas consultas y enseña qué assets de biblioteca ganan.
 *
 *   pnpm --filter @fabrica/workers exec tsx scripts/verifica-biblioteca.ts
 */
import { sql } from 'drizzle-orm';
import { assets, createDb } from '@fabrica/db';
import { createEmbeddings } from '../src/providers/embeddings.js';

const CONSULTAS = [
  'ai agent automating support tickets on a laptop',
  'team reviewing productivity dashboard in an office',
  'library archive reading room stacks wide',
];

const { db, client } = createDb();
const embeddings = createEmbeddings(console as never);

for (const q of CONSULTAS) {
  const [vec] = await embeddings.embed([q]);
  const lit = `[${(vec ?? []).join(',')}]`;
  const filas = await db
    .select({
      caption: assets.caption,
      originQuery: assets.originQuery,
      cos: sql<number>`1 - (${assets.embedding} <=> ${lit}::vector)`,
    })
    .from(assets)
    .where(sql`${assets.embedding} is not null`)
    .orderBy(sql`${assets.embedding} <=> ${lit}::vector`)
    .limit(3);
  console.log(`\nconsulta: «${q}»`);
  for (const f of filas) {
    console.log(`  ${f.cos.toFixed(3)}  ${(f.caption ?? '(sin descripción)').slice(0, 66)}`);
    console.log(`         se ingirió para: ${(f.originQuery ?? '—').slice(0, 60)}`);
  }
}
await client.end();
process.exit(0);
