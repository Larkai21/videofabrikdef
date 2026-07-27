import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { videos } from '@fabrica/db';
import { JOBS, QUEUES, type ScriptJudgeJob, type ScriptRefineJob } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { ledgeredLlmJson } from './llm-call.js';
import { judgeSystem, judgeUser } from './prompts.js';

const judgeOutputSchema = z.object({
  verdict: z.enum(['aligned', 'misaligned']),
  reasons: z.array(z.string()),
  patch_targets: z.array(z.string()),
});

export async function handleScriptJudge(ctx: WorkerContext, data: ScriptJudgeJob): Promise<void> {
  const { videoId } = data;
  const [video] = await ctx.db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);
  const script = video.master.script;
  const seo = video.master.seo;
  if (!script || !seo) {
    ctx.logger.warn({ videoId }, 'Sin guion o sin seo; el juez no tiene nada que comparar');
    return;
  }
  const title =
    video.titleChosen ?? (seo.chosen_idx !== null ? seo.titles[seo.chosen_idx] : undefined);
  if (!title) {
    ctx.logger.warn({ videoId }, 'Sin título elegido; el juez se ejecuta al confirmar título');
    return;
  }
  const hook = script.scenes.find((s) => s.section === 'hook');
  const closing = [...script.scenes].reverse().find((s) => s.section === 'cta') ?? script.scenes.at(-1);

  const result = await ledgeredLlmJson(ctx, {
    videoId,
    channelId: video.channelId,
    op: 'judge',
    system: judgeSystem(),
    user: judgeUser({
      title,
      hook: hook?.text ?? '',
      closing: closing?.text ?? '',
      hookNotes: script.hook_notes,
    }),
    schema: judgeOutputSchema,
    mockContext: { title },
  });

  if (result.verdict === 'misaligned') {
    const editable = new Set(script.scenes.filter((s) => !s.edited_by_human).map((s) => s.id));
    const targets = result.patch_targets.filter((id) => editable.has(id));
    if (targets.length > 0) {
      await ctx.queues.script.add(JOBS.script.refine, {
        videoId,
        patchTargets: targets,
        reasons: result.reasons,
      } satisfies ScriptRefineJob);
      await ctx.publishEvent({
        type: 'job_progress',
        video_id: videoId,
        queue: QUEUES.script,
        progress: 100,
        detail: `El juez pide ajustar ${targets.length} escenas: ${result.reasons.join('; ')}`.slice(0, 300),
      });
    } else {
      ctx.logger.info(
        { videoId, patchTargets: result.patch_targets },
        'El juez señaló solo escenas editadas por el humano; no se toca nada',
      );
      await ctx.publishEvent({
        type: 'job_progress',
        video_id: videoId,
        queue: QUEUES.script,
        progress: 100,
        detail: 'El juez señaló escenas editadas a mano; se respetan sin cambios',
      });
    }
  } else {
    await ctx.publishEvent({
      type: 'job_progress',
      video_id: videoId,
      queue: QUEUES.script,
      progress: 100,
      detail: 'Título y guion alineados',
    });
  }
}
