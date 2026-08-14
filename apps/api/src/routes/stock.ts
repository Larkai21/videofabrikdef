import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { videos } from '@fabrica/db';
import type { StockSearchResult } from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { candidateForDto } from '../lib/beats.js';
import { badRequest } from '../lib/errors.js';
import { searchStock } from '../lib/stock.js';

export function registerStockRoutes(app: FastifyInstance, ctx: ApiContext): void {
  // búsqueda libre desde la timeline; `beat` llega como contexto y se ignora en S1.
  // `video` sirve para resolver el canal: la búsqueda mira PRIMERO su biblioteca.
  app.get('/stock/search', async (req): Promise<StockSearchResult> => {
    const query = req.query as { q?: string; video?: string };
    const q = query.q?.trim();
    if (!q) throw badRequest('Falta el parámetro q');
    let channelId: string | null = null;
    if (query.video) {
      const [video] = await ctx.db
        .select({ channelId: videos.channelId })
        .from(videos)
        .where(eq(videos.id, query.video))
        .limit(1);
      channelId = video?.channelId ?? null;
    }
    const results = await searchStock(ctx.db, q, channelId);
    // los candidatos de biblioteca guardan ruta de disco: el navegador necesita
    // la URL servida (misma derivación que los candidatos de la cascada)
    return { results: results.map(candidateForDto) };
  });
}
