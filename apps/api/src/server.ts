import { buildApp } from './app.js';
import { env, loadEnv } from './lib/env.js';

loadEnv();

const app = await buildApp();
const host = env('API_HOST', '127.0.0.1');
const port = Number(env('API_PORT', '3001'));

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
