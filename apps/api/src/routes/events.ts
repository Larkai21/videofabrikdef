import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../lib/context.js';

const HEARTBEAT_MS = 15_000;

export function registerEventRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      // la respuesta hijacked no pasa por @fastify/cors
      'access-control-allow-origin': '*',
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
