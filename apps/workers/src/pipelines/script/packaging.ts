import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { channels, ideas, markIncident, videos } from '@fabrica/db';
import {
  channelSettingsSchema,
  QUEUES,
  type MasterVideoJson,
  type ScriptGenerateJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { resolveSeo, seoGenSchema } from './generate.js';
import { ledgeredLlmJson } from './llm-call.js';
import { packagingSystem, packagingUser } from './prompts.js';

// packaging_first (docs/generacion-guion.md §4.4): al aprobar la idea se
// generan SOLO títulos + conceptos de miniatura; el humano confirma el título
// en la puerta 2 y el guion se escribe después "para cumplir la promesa".

// `packagingOnly` ya forma parte del contrato compartido (ScriptGenerateJob);
// el alias se conserva por los imports existentes de este módulo.
export type ScriptGenerateJobExt = ScriptGenerateJob;

// el mock de la op 'script' devuelve { script, seo }; este esquema no es
// estricto, así que en modo packaging simplemente se queda con el seo
const packagingGenSchema = z.object({ seo: seoGenSchema });
export { packagingGenSchema };

export async function handleScriptPackaging(
  ctx: WorkerContext,
  data: ScriptGenerateJobExt,
): Promise<void> {
  const { videoId } = data;
  const [video] = await ctx.db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);
  if (video.state !== 'idea_aprobada' && video.state !== 'guion_borrador') {
    ctx.logger.warn(
      { videoId, state: video.state },
      'Estado inesperado para generar el packaging; no se hace nada',
    );
    return;
  }
  if (video.master.script) {
    ctx.logger.warn({ videoId }, 'El vídeo ya tiene guion; el packaging no procede');
    return;
  }
  const [idea] = await ctx.db.select().from(ideas).where(eq(ideas.id, video.ideaId));
  const [channel] = await ctx.db.select().from(channels).where(eq(channels.id, video.channelId));
  if (!idea || !channel) throw new Error(`Faltan la idea o el canal del vídeo ${videoId}`);
  const profile = channel.profile;
  if (!profile) {
    const message = 'El canal no tiene perfil; completa el wizard antes de generar el packaging';
    await markIncident(ctx.db, videoId, {
      message,
      suggested_action: 'regenerar',
      queue: QUEUES.script,
    });
    await ctx.publishEvent({
      type: 'incident',
      video_id: videoId,
      queue: QUEUES.script,
      message,
      suggested_action: 'regenerar',
    });
    return;
  }
  const settings = channelSettingsSchema.parse(channel.settings ?? {});

  await ctx.publishEvent({
    type: 'job_progress',
    video_id: videoId,
    queue: QUEUES.script,
    progress: 30,
    detail: 'Generando títulos y conceptos de miniatura (packaging primero)',
  });

  const gen = await ledgeredLlmJson(ctx, {
    videoId,
    channelId: video.channelId,
    op: 'script',
    system: packagingSystem(profile),
    user: packagingUser({
      idea: { title: idea.title, angle: idea.angle, summary: idea.summary, whyNow: idea.whyNow },
      language: profile.language,
    }),
    schema: packagingGenSchema,
    mockContext: {
      ideaTitle: idea.title,
      targetMinutes: settings.target_minutes,
      aiDisclosure: profile.flags.ai_disclosure,
      packagingOnly: true,
    },
  });

  const master: MasterVideoJson = {
    ...video.master,
    seo: resolveSeo(video.master.seo, gen.seo),
  };

  // misma transacción con candado que el generate normal: si el estado cambió
  // mientras el LLM respondía, el paquete se descarta sin pisar nada
  const applied = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: videos.state })
      .from(videos)
      .where(eq(videos.id, videoId))
      .for('update');
    if (!row || (row.state !== 'idea_aprobada' && row.state !== 'guion_borrador')) return false;
    await tx
      .update(videos)
      .set({ master, state: 'guion_borrador', updatedAt: new Date() })
      .where(eq(videos.id, videoId));
    return true;
  });
  if (!applied) {
    ctx.logger.warn({ videoId }, 'Packaging descartado: el estado cambió durante la generación');
    return;
  }
  await ctx.publishEvent({ type: 'video_state', video_id: videoId, state: 'guion_borrador' });
  await ctx.publishEvent({ type: 'inbox_changed' });
  await ctx.publishEvent({
    type: 'job_progress',
    video_id: videoId,
    queue: QUEUES.script,
    progress: 100,
    detail: 'Packaging listo: elige título y miniatura para encargar el guion',
  });
  ctx.logger.info({ videoId }, 'Packaging generado y en puerta de revisión');
}
