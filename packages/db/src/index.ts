import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export * from './schema.js';
export * from './state.js';
export { schema };

export type Db = ReturnType<typeof createDb>['db'];

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? 'postgres://fabrica:fabrica@localhost:55432/fabrica';
}

export function createDb(url = databaseUrl()) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, client };
}

// similitud coseno para pgvector: 1 - distancia coseno
export function cosineSimilarityExpr(distance: number): number {
  return 1 - distance;
}
