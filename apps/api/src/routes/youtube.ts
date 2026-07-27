import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../lib/context.js';

// TODO(agente publicación): OAuth loopback de YouTube por canal
// (GET /youtube/auth-url?channel=, GET /youtube/callback, DELETE conexión),
// POST /videos/:id/publish (aprobación desde la bandeja → encola
// publish.upload) y estado de la conexión para Ajustes.
export function registerYoutubeRoutes(_app: FastifyInstance, _ctx: ApiContext): void {}
