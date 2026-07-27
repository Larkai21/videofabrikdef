import type { FastifyInstance } from 'fastify';
import type { StockSearchResult } from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { badRequest } from '../lib/errors.js';
import { searchStock } from '../lib/stock.js';

export function registerStockRoutes(app: FastifyInstance, ctx: ApiContext): void {
  // búsqueda libre desde la timeline; `beat` llega como contexto y se ignora en S1
  app.get('/stock/search', async (req): Promise<StockSearchResult> => {
    const q = (req.query as { q?: string }).q?.trim();
    if (!q) throw badRequest('Falta el parámetro q');
    const results = await searchStock(ctx.db, q);
    return { results };
  });
}
