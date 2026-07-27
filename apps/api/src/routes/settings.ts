import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { channels } from '@fabrica/db';
import { channelSettingsSchema, channelSettingsUpdateSchema } from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { notFound } from '../lib/errors.js';

// Ajustes de canal (settings jsonb): parche parcial validado; el perfil
// editable va aparte (PUT /channels/:id/profile).
export function registerSettingsRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/channels/:id/settings', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(channels).where(eq(channels.id, id)).limit(1);
    if (!row) throw notFound(`El canal ${id} no existe`);
    return channelSettingsSchema.parse(row.settings ?? {});
  });

  app.put('/channels/:id/settings', async (req) => {
    const { id } = req.params as { id: string };
    const patch = channelSettingsUpdateSchema.parse(req.body);
    const [row] = await ctx.db.select().from(channels).where(eq(channels.id, id)).limit(1);
    if (!row) throw notFound(`El canal ${id} no existe`);
    const current = channelSettingsSchema.parse(row.settings ?? {});
    const merged = channelSettingsSchema.parse({ ...current, ...patch });
    await ctx.db.update(channels).set({ settings: merged }).where(eq(channels.id, id));
    return merged;
  });
}
