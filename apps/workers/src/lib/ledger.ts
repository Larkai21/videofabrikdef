import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { costLedger, videos, type Db } from '@fabrica/db';
import type { CostOperation, CostProvider } from '@fabrica/shared';

// Regla del ledger (docs/contratos.md §5): la fila se escribe ANTES de la
// llamada externa (status pending) y se completa con la respuesta; una caída
// a mitad no pierde el gasto.

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
  // El error se AÑADE al meta, no lo sustituye. Sustituirlo borraba el contexto
  // con el que se abrió la fila (modelo, consulta, variante del banco…), que es
  // justo lo que hace falta para saber qué falló: una llamada fallida se ha
  // pagado igual si llegó al proveedor, y sin ese contexto la fila solo dice
  // que algo se rompió en algún sitio.
  await db
    .update(costLedger)
    .set({
      status: 'failed',
      meta: sql`coalesce(${costLedger.meta}, '{}'::jsonb) || ${JSON.stringify({ error: message })}::jsonb`,
    })
    .where(eq(costLedger.id, handle.id));
}
