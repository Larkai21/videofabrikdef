import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { costLedger, videos, type Db } from '@fabrica/db';
import type { CostOperation, CostProvider } from '@fabrica/shared';

// Copia mínima del ledger de apps/workers/src/lib/ledger.ts (duplicación
// asumida en S1: apps/* no se importan entre sí y la lib canónica vive en los
// workers). Regla docs/contratos.md §5: la fila se escribe ANTES de la llamada
// externa (status pending) y se completa con la respuesta.

export interface CostHandle {
  id: string;
  videoId: string | null;
}

export async function openCost(
  db: Db,
  params: {
    videoId?: string | null;
    channelId?: string | null;
    provider: CostProvider;
    operation: CostOperation;
    meta?: Record<string, unknown>;
  },
): Promise<CostHandle> {
  const id = nanoid();
  await db.insert(costLedger).values({
    id,
    videoId: params.videoId ?? null,
    channelId: params.channelId ?? null,
    provider: params.provider,
    operation: params.operation,
    status: 'pending',
    meta: params.meta ?? {},
  });
  return { id, videoId: params.videoId ?? null };
}

export async function closeCost(
  db: Db,
  handle: CostHandle,
  result: { units: number; unitCost: number; cost?: number; meta?: Record<string, unknown> },
): Promise<void> {
  const cost = result.cost ?? result.units * result.unitCost;
  await db
    .update(costLedger)
    .set({
      units: result.units,
      unitCost: result.unitCost,
      cost,
      status: 'complete',
      ...(result.meta ? { meta: result.meta } : {}),
    })
    .where(eq(costLedger.id, handle.id));
  if (handle.videoId && cost > 0) {
    await db
      .update(videos)
      .set({ costsTotal: sql`${videos.costsTotal} + ${cost}` })
      .where(eq(videos.id, handle.videoId));
  }
}

export async function failCost(db: Db, handle: CostHandle, message: string): Promise<void> {
  await db
    .update(costLedger)
    .set({ status: 'failed', meta: { error: message } })
    .where(eq(costLedger.id, handle.id));
}
