import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { databaseUrl } from './index.js';

// La extensión vector debe existir antes de que las migraciones creen
// columnas vector(); drizzle-kit no la genera por sí solo.
async function main() {
  const client = postgres(databaseUrl(), { max: 1, onnotice: () => {} });
  await client`CREATE EXTENSION IF NOT EXISTS vector`;
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: new URL('../migrations', import.meta.url).pathname });
  await client.end();
  console.log('Migraciones aplicadas');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
