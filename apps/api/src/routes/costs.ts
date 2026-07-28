import type { FastifyInstance } from 'fastify';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { costLedger } from '@fabrica/db';
import { costsDtoSchema, type CostsDto } from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';

// Panel de costes (SPEC §12): agrega el cost_ledger por proveedor y por
// operación con filtros opcionales ?video=, ?channel= y ?month=YYYY-MM. Solo
// cuenta el gasto REALIZADO (status 'complete'); los pending/failed no suman.

export function registerCostRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/costs', async (req): Promise<CostsDto> => {
    const q = req.query as { video?: string; channel?: string; month?: string };
    const conds = [eq(costLedger.status, 'complete')];
    if (q.video) conds.push(eq(costLedger.videoId, q.video));
    if (q.channel) conds.push(eq(costLedger.channelId, q.channel));
    if (q.month && /^\d{4}-\d{2}$/.test(q.month)) {
      const start = sql`to_timestamp(${`${q.month}-01`}, 'YYYY-MM-DD')`;
      conds.push(gte(costLedger.createdAt, start));
      conds.push(lt(costLedger.createdAt, sql`(${start} + interval '1 month')`));
    }
    const where = and(...conds);

    const costExpr = sql<string>`coalesce(sum(${costLedger.cost}), 0)`;
    const callsExpr = sql<string>`count(*)`;
    const [byProvider, byOperation] = await Promise.all([
      ctx.db
        .select({ key: costLedger.provider, cost: costExpr, calls: callsExpr })
        .from(costLedger)
        .where(where)
        .groupBy(costLedger.provider),
      ctx.db
        .select({ key: costLedger.operation, cost: costExpr, calls: callsExpr })
        .from(costLedger)
        .where(where)
        .groupBy(costLedger.operation),
    ]);

    const toRows = (rows: { key: string; cost: string; calls: string }[]) =>
      rows
        .map((r) => ({ key: r.key, cost_usd: Number(r.cost), calls: Number(r.calls) }))
        .sort((a, b) => b.cost_usd - a.cost_usd);

    const total = byProvider.reduce((s, r) => s + Number(r.cost), 0);
    return costsDtoSchema.parse({
      total_usd: total,
      by_provider: toRows(byProvider),
      by_operation: toRows(byOperation),
    });
  });
}
