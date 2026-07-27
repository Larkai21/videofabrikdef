import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { channels } from '@fabrica/db';
import {
  channelProfileV1,
  channelSettingsSchema,
  JOBS,
  QUEUES,
  wizardRequestSchema,
  type ChannelDto,
  type SourcesBootstrapJob,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { notFound } from '../lib/errors.js';

type ChannelRow = typeof channels.$inferSelect;

function channelDto(row: ChannelRow): ChannelDto {
  return {
    id: row.id,
    name: row.name,
    profile: row.profile ?? null,
    profile_approved: row.profileApproved,
    created_at: row.createdAt.toISOString(),
  };
}

export function registerChannelRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/channels', async () => {
    const rows = await ctx.db.select().from(channels);
    return rows.map(channelDto);
  });

  app.get('/channels/:id', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(channels).where(eq(channels.id, id)).limit(1);
    if (!row) throw notFound(`Canal ${id} no existe`);
    return channelDto(row);
  });

  app.post('/channels/wizard', async (req, reply) => {
    const body = wizardRequestSchema.parse(req.body);
    const id = nanoid();
    const [row] = await ctx.db
      .insert(channels)
      .values({
        id,
        name: body.name,
        profile: null,
        settings: channelSettingsSchema.parse({}),
      })
      .returning();
    if (!row) throw new Error('No se pudo crear el canal');

    const payload: SourcesBootstrapJob = {
      channelId: id,
      niche: body.niche,
      competitors: body.competitors,
    };
    await ctx.enqueuer.enqueue(QUEUES.sources, JOBS.sources.bootstrap, payload);

    return reply.code(201).send(channelDto(row));
  });

  app.put('/channels/:id/profile', async (req) => {
    const { id } = req.params as { id: string };
    const profile = channelProfileV1.parse(req.body);
    const [row] = await ctx.db
      .update(channels)
      .set({ profile, profileApproved: true })
      .where(eq(channels.id, id))
      .returning();
    if (!row) throw notFound(`Canal ${id} no existe`);
    return channelDto(row);
  });
}
