import { and, eq } from 'drizzle-orm';
import { channels, videos } from '@fabrica/db';
import { QUEUES, type MasterVideoJson, type Scene, type ScriptRefineJob } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { refineOutputSchema } from './generate.js';
import { ledgeredLlmJson } from './llm-call.js';
import { refineSystem } from './prompts.js';
import { countWords } from './wordcount.js';

export async function handleScriptRefine(
  ctx: WorkerContext,
  data: ScriptRefineJob,
): Promise<void> {
  const { videoId, patchTargets, reasons } = data;
  const [video] = await ctx.db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);
  if (video.state !== 'guion_borrador') {
    ctx.logger.info({ videoId, state: video.state }, 'Refinado omitido: el guion ya no está en borrador');
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
    user: [
      `Motivos del juez: ${reasons.join('; ') || 'ajuste dirigido'}`,
      'Reescribe SOLO estas escenas manteniendo su longitud aproximada:',
      ...targets.map((s) => `- ${s.id}: ${s.text}`),
    ].join('\n'),
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
    return text && targetIds.has(s.id) ? { ...s, text } : s;
  });
  const master: MasterVideoJson = { ...video.master, script: { ...script, scenes } };
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
