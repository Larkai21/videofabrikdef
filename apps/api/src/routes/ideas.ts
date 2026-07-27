import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { channels, ideas, videos } from '@fabrica/db';
import {
  channelSettingsSchema,
  defaultBrand,
  ideaStatusSchema,
  JOBS,
  masterVideoJsonV1,
  QUEUES,
  type IdeaDto,
  type ScriptGenerateJob,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { conflict, notFound } from '../lib/errors.js';

type IdeaRow = typeof ideas.$inferSelect;

function ideaDto(row: IdeaRow): IdeaDto {
  return {
    id: row.id,
    channel_id: row.channelId,
    title: row.title,
    summary: row.summary,
    angle: row.angle ?? null,
    why_now: row.whyNow ?? null,
    score: row.score,
    status: ideaStatusSchema.parse(row.status),
    source_refs: row.sourceRefs ?? [],
    created_at: row.createdAt.toISOString(),
  };
}

const discardBodySchema = z.object({ reason: z.string().optional() }).optional();

export function registerIdeaRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/ideas', async (req) => {
    const raw = (req.query as { status?: string }).status ?? 'new';
    const status = ideaStatusSchema.parse(raw);
    const rows = await ctx.db
      .select()
      .from(ideas)
      .where(eq(ideas.status, status))
      .orderBy(desc(ideas.score));
    return rows.map(ideaDto);
  });

  app.post('/ideas/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    const videoId = nanoid();

    const channelId = await ctx.db.transaction(async (tx) => {
      const [idea] = await tx.select().from(ideas).where(eq(ideas.id, id)).for('update');
      if (!idea) throw notFound(`Idea ${id} no existe`);
      if (idea.status !== 'new') throw conflict(`La idea ya fue decidida (${idea.status})`);

      await tx
        .update(ideas)
        .set({ status: 'approved', decidedAt: new Date() })
        .where(eq(ideas.id, id));

      // el vídeo nace con la selección de brand kit del canal; el tema de
      // subtítulos integrado garantiza que el maestro siempre sea renderizable
      const [channel] = await tx
        .select({ settings: channels.settings })
        .from(channels)
        .where(eq(channels.id, idea.channelId));
      const settings = channelSettingsSchema.parse(channel?.settings ?? {});
      const master = masterVideoJsonV1.parse({
        version: '1',
        video: {
          id: videoId,
          channel_id: idea.channelId,
          idea_id: idea.id,
          fps: 30,
          width: 1920,
          height: 1080,
        },
        brand: {
          components: { ...defaultBrand().components, ...settings.brand_components },
        },
      });
      await tx.insert(videos).values({
        id: videoId,
        channelId: idea.channelId,
        ideaId: idea.id,
        state: 'idea_aprobada',
        master,
      });
      return idea.channelId;
    });

    const payload: ScriptGenerateJob = { videoId };
    await ctx.enqueuer.enqueue(QUEUES.script, JOBS.script.generate, payload);
    await ctx.events.publish({ type: 'video_state', video_id: videoId, state: 'idea_aprobada' });
    await ctx.events.publish({ type: 'ideas_updated', channel_id: channelId });
    await ctx.events.publish({ type: 'inbox_changed' });

    return { video_id: videoId };
  });

  app.post('/ideas/:id/discard', async (req) => {
    const { id } = req.params as { id: string };
    const body = discardBodySchema.parse(req.body ?? undefined);
    const [row] = await ctx.db
      .update(ideas)
      .set({
        status: 'discarded',
        discardReason: body?.reason ?? null,
        decidedAt: new Date(),
      })
      .where(eq(ideas.id, id))
      .returning({ channelId: ideas.channelId });
    if (!row) throw notFound(`Idea ${id} no existe`);

    await ctx.events.publish({ type: 'ideas_updated', channel_id: row.channelId });
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const };
  });
}
