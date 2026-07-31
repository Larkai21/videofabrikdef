import { and, eq } from 'drizzle-orm';
import { channels, videos } from '@fabrica/db';
import { QUEUES, type MasterVideoJson, type Scene, type ScriptRefineJob } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { refineOutputSchema } from './generate.js';
import { keepValidIntents } from './intents.js';
import { ledgeredLlmJson } from './llm-call.js';
import { refineSystem } from './prompts.js';
import { countWords } from './wordcount.js';

/**
 * El encargo que recibe el refinado, con el arreglo concreto de cada escena y
 * sus vecinas alrededor.
 *
 * `ScriptRefineJob.notes` existe en el contrato desde el principio, con un
 * comentario que dice «sin ellas el refinado reescribe a ciegas», y `judge.ts`
 * las rellena con `{axis, issue, fix}` por escena. Pero la palabra `notes` no
 * aparecía en este fichero: se leían solo `patchTargets` y `reasons`, así que
 * el refinado recibía la lista de motivos del guion ENTERO y tenía que adivinar
 * cuál corresponde a cuál escena.
 *
 * Y va la escena anterior y la siguiente como contexto de solo lectura, porque
 * una de las reglas de oficio es «cada escena arranca enlazando con la
 * anterior» y era imposible de cumplir sin verla.
 */
export function instruccionesDeRefinado(
  todas: readonly Scene[],
  objetivos: readonly Scene[],
  reasons: readonly string[],
  notes: readonly { id: string; axis: string; issue: string; fix: string }[],
): string {
  const porId = new Map(notes.map((n) => [n.id, n]));
  const idx = new Map(todas.map((s, i) => [s.id, i]));
  const lineas: string[] = [];
  if (reasons.length > 0) lineas.push(`Motivos generales del juez: ${reasons.join('; ')}`);
  lineas.push('Reescribe SOLO estas escenas, manteniendo su longitud aproximada.');
  for (const s of objetivos) {
    const i = idx.get(s.id) ?? -1;
    const previa = i > 0 ? todas[i - 1] : undefined;
    const siguiente = i >= 0 ? todas[i + 1] : undefined;
    lineas.push('');
    lineas.push(`## ${s.id}`);
    const nota = porId.get(s.id);
    if (nota) {
      lineas.push(`Problema (${nota.axis}): ${nota.issue}`);
      lineas.push(`Arreglo pedido: ${nota.fix}`);
    }
    if (previa) lineas.push(`Escena anterior (NO la reescribas): ${previa.text}`);
    lineas.push(`Texto a reescribir: ${s.text}`);
    if (siguiente) lineas.push(`Escena siguiente (NO la reescribas): ${siguiente.text}`);
  }
  return lineas.join('\n');
}

export async function handleScriptRefine(ctx: WorkerContext, data: ScriptRefineJob): Promise<void> {
  const { videoId, patchTargets, reasons, notes } = data;
  const [video] = await ctx.db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);
  if (video.state !== 'guion_borrador') {
    ctx.logger.info(
      { videoId, state: video.state },
      'Refinado omitido: el guion ya no está en borrador',
    );
    return;
  }
  const script = video.master.script;
  if (!script) {
    ctx.logger.warn({ videoId }, 'Sin guion que refinar');
    return;
  }
  const byId = new Map(script.scenes.map((s) => [s.id, s]));
  // nunca se reescriben escenas editadas por el humano
  const targets = patchTargets
    .map((id) => byId.get(id))
    .filter((s): s is Scene => s !== undefined && !s.edited_by_human);
  if (targets.length === 0) {
    ctx.logger.warn({ videoId, patchTargets }, 'Nada que refinar: escenas inexistentes o editadas');
    return;
  }

  const [channel] = await ctx.db.select().from(channels).where(eq(channels.id, video.channelId));
  const profile = channel?.profile;
  if (!profile) {
    ctx.logger.warn({ videoId }, 'Canal sin perfil; no se refina el guion');
    return;
  }

  const result = await ledgeredLlmJson(ctx, {
    videoId,
    channelId: video.channelId,
    op: 'refine',
    system: refineSystem(profile),
    user: instruccionesDeRefinado(script.scenes, targets, reasons, notes ?? []),
    schema: refineOutputSchema,
    mockContext: {
      scenes: targets.map((s) => ({
        id: s.id,
        seed: `${videoId}:${s.id}:refine`,
        words: countWords(s.text),
      })),
    },
  });

  const targetIds = new Set(targets.map((s) => s.id));
  const newTexts = new Map(result.scenes.map((s) => [s.id, s.text]));
  const scenes = script.scenes.map((s) => {
    const text = newTexts.get(s.id);
    // el parche puede haber quitado la palabra a la que apuntaba un efecto
    return text && targetIds.has(s.id) ? { ...s, text, ...keepValidIntents(s, text) } : s;
  });
  // La revisión queda obsoleta: el guion que juzgó ya no es este. Marcarla evita
  // que el fingerprint la dé por buena, y que refine y judge se llamen en bucle.
  const master: MasterVideoJson = {
    ...video.master,
    script: { ...script, scenes },
    ...(video.master.script_review
      ? { script_review: { ...video.master.script_review, stale: true } }
      : {}),
  };
  // escritura condicionada al estado: si el humano aprobó mientras el LLM
  // trabajaba, el guion aprobado no se pisa (puerta 2 intocable)
  const updated = await ctx.db
    .update(videos)
    .set({ master, updatedAt: new Date() })
    .where(and(eq(videos.id, videoId), eq(videos.state, 'guion_borrador')))
    .returning({ id: videos.id });
  if (updated.length === 0) {
    ctx.logger.warn({ videoId }, 'Refinado descartado: el estado cambió durante la reescritura');
    return;
  }
  await ctx.publishEvent({
    type: 'job_progress',
    video_id: videoId,
    queue: QUEUES.script,
    progress: 100,
    detail: `Guion refinado en ${targets.length} escenas`,
  });
  await ctx.publishEvent({ type: 'inbox_changed' });
}
