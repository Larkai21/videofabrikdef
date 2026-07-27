import type { FastifyInstance } from 'fastify';
import type { ApiContext } from '../lib/context.js';

// TODO(agente biblioteca): GET /library (grid con filtros kind/q/procedencia,
// paginado, purge_candidate), DELETE /library/:id (guardado: nunca borrar
// assets referenciados por un vídeo renderizado), POST /library/backfill.
export function registerLibraryBrowseRoutes(_app: FastifyInstance, _ctx: ApiContext): void {}
