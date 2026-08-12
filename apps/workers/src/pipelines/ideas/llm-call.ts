import type { z } from 'zod';
import { PRICES, type CostOperation } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { closeCost, failCost, openCost } from '../../lib/ledger.js';
import type { LlmUsage } from '../../providers/llm.js';

// Llamada LLM con ledger: fila pending ANTES de la llamada, complete/failed después.

export function usageCost(usage: LlmUsage, model: string) {
  const cost =
    usage.inputTokens * PRICES.openai.input_per_token +
    usage.outputTokens * PRICES.openai.output_per_token;
  return {
    units: usage.inputTokens + usage.outputTokens,
    unitCost: 0,
    cost,
    meta: { model, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens },
  };
}

export async function ledgeredLlmJson<S extends z.ZodType>(
  ctx: WorkerContext,
  params: {
    videoId?: string | null;
    channelId?: string | null;
    op: CostOperation;
    system: string;
    user: string;
    schema: S;
    mockContext?: Record<string, unknown>;
    /** claves extra para cost_ledger.meta (p. ej. short_id: la facturación va
     * contra el vídeo largo y sin esto el coste por short es invisible) */
    meta?: Record<string, unknown>;
  },
): Promise<z.infer<S>> {
  const handle = await openCost(ctx.db, {
    videoId: params.videoId ?? null,
    channelId: params.channelId ?? null,
    provider: ctx.llm.ledgerProvider,
    operation: params.op,
    meta: { model: ctx.llm.model, ...(params.meta ?? {}) },
  });
  try {
    const { data, usage } = await ctx.llm.completeJson({
      op: params.op,
      system: params.system,
      user: params.user,
      schema: params.schema,
      mockContext: params.mockContext ?? {},
    });
    await closeCost(ctx.db, handle, usageCost(usage, ctx.llm.model));
    return data;
  } catch (err) {
    await failCost(ctx.db, handle, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
