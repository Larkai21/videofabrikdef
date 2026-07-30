import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { channels } from '@fabrica/db';
import {
  channelProfileV1,
  channelSettingsSchema,
  designTokensSchema,
  JOBS,
  QUEUES,
  wizardRequestSchema,
  type ChannelDto,
  type SourcesBootstrapJob,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { toFileUrl } from '../lib/files.js';

type ChannelRow = typeof channels.$inferSelect;

function channelDto(row: ChannelRow): ChannelDto {
  return {
    id: row.id,
    name: row.name,
    profile: row.profile ?? null,
    profile_approved: row.profileApproved,
    // el dashboard consume URLs /files, nunca rutas de disco
    avatar_url: row.avatarPath ? toFileUrl(row.avatarPath) : null,
    created_at: row.createdAt.toISOString(),
  };
}

const AVATAR_EXTS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// Borra los avatar-*.png|jpg|webp anteriores del canal (sin acumular en disco).
async function removePreviousAvatars(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((e) => /^avatar[-.].*\.(png|jpg|jpeg|webp)$/i.test(e))
      .map((e) => rm(path.join(dir, e), { force: true }).catch(() => {})),
  );
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

  // Design system: guarda solo los tokens de color/tipografía dentro del perfil
  // sin obligar al dashboard a reenviar el perfil completo. Los vídeos NUEVOS
  // congelan estos tokens en master.brand.design al aprobar la idea (ideas.ts);
  // los ya existentes no cambian (el render no lee BD).
  app.patch('/channels/:id/design', async (req) => {
    const { id } = req.params as { id: string };
    const design = designTokensSchema.parse(req.body);
    const [current] = await ctx.db
      .select({ profile: channels.profile })
      .from(channels)
      .where(eq(channels.id, id))
      .limit(1);
    if (!current) throw notFound(`Canal ${id} no existe`);
    if (!current.profile) {
      throw conflict('El canal todavía no tiene un perfil aprobado');
    }
    const profile = channelProfileV1.parse({ ...current.profile, brand_design: design });
    const [row] = await ctx.db
      .update(channels)
      .set({ profile })
      .where(eq(channels.id, id))
      .returning();
    if (!row) throw notFound(`Canal ${id} no existe`);
    return channelDto(row);
  });

  // ---- avatar/personaje: subida directa (multipart). Guarda bajo
  // library/assets/<canal>/avatar-<id>.<ext> y setea avatar_path.
  app.post('/channels/:id/avatar', async (req) => {
    const { id } = req.params as { id: string };
    const [channel] = await ctx.db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.id, id))
      .limit(1);
    if (!channel) throw notFound(`Canal ${id} no existe`);

    const destDir = path.join(ctx.libraryDir, 'assets', id);
    let destPath: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const ext = AVATAR_EXTS[part.mimetype];
        if (ext === undefined) {
          throw badRequest('El avatar debe ser PNG, JPG o WebP');
        }
        await mkdir(destDir, { recursive: true });
        await removePreviousAvatars(destDir);
        destPath = path.join(destDir, `avatar-${nanoid()}.${ext}`);
        await pipeline(part.file, createWriteStream(destPath));
      }
    }
    if (destPath === null) throw badRequest('Falta el archivo de imagen en el multipart');

    const [row] = await ctx.db
      .update(channels)
      .set({ avatarPath: destPath })
      .where(eq(channels.id, id))
      .returning();
    if (!row) throw notFound(`Canal ${id} no existe`);
    await ctx.events.publish({ type: 'inbox_changed' });
    return channelDto(row);
  });
}
