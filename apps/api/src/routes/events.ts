import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../lib/context.js';
import { allowedOrigins } from '../lib/origins.js';

const HEARTBEAT_MS = 15_000;

export function registerEventRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/events', (req, reply) => {
    reply.hijack();
    // la respuesta hijacked no pasa por @fastify/cors: se refleja el origin
    // SOLO si está en la allowlist ('*' dejaba leer ids y estados de vídeo a
    // cualquier web abierta en el navegador)
    const { origin } = req.headers;
    const corsHeader =
      origin !== undefined && allowedOrigins().includes(origin)
        ? { 'access-control-allow-origin': origin }
        : {};
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      ...corsHeader,
    });
    reply.raw.write(': conectado\n\n');

    const unsubscribe = ctx.events.subscribe((json) => {
      reply.raw.write(`data: ${json}\n\n`);
    });
    const heartbeat = setInterval(() => {
      reply.raw.write(': latido\n\n');
    }, HEARTBEAT_MS);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });
}
