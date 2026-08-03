import type { FastifyInstance } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { channels, ideas, videos } from '@fabrica/db';
import {
  channelSettingsSchema,
  defaultBrand,
  defaultDesign,
  ideasOrderRequestSchema,
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
    manual_rank: row.manualRank ?? null,
    source_refs: row.sourceRefs ?? [],
    created_at: row.createdAt.toISOString(),
  };
}

const discardBodySchema = z.object({ reason: z.string().optional() }).optional();

export function registerIdeaRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/ideas', async (req) => {
    // multicanal (SPEC §14 S3): ?channel= filtra el ranking por canal;
    // sin el parámetro se devuelve todo (lo usa el MCP)
    const query = req.query as { status?: string; channel?: string };
    const status = ideaStatusSchema.parse(query.status ?? 'new');
    const channel =
      typeof query.channel === 'string' && query.channel.trim() !== ''
        ? query.channel.trim()
        : undefined;
    const rows = await ctx.db
      .select()
      .from(ideas)
      .where(
        channel !== undefined
          ? and(eq(ideas.status, status), eq(ideas.channelId, channel))
          : eq(ideas.status, status),
      )
      // el orden manual del humano manda; sin él, el score preestablecido
      .orderBy(sql`${ideas.manualRank} asc nulls last`, desc(ideas.score));
    return rows.map(ideaDto);
  });

  // Reordenación manual del radar: la lista llega completa y en orden; a cada
  // id se le asigna su posición y el resto de ideas quedan detrás (rank null).
  app.put('/ideas/order', async (req) => {
    const body = ideasOrderRequestSchema.parse(req.body);
    const rows = await ctx.db
      .select({ id: ideas.id })
      .from(ideas)
      .where(and(eq(ideas.channelId, body.channel), eq(ideas.status, 'new')));
    const known = new Set(rows.map((r) => r.id));
    for (const id of body.ids) {
      if (!known.has(id)) throw notFound(`La idea ${id} no está en el ranking del canal`);
    }
    await ctx.db.transaction(async (tx) => {
      // se limpia el orden anterior para que borrar/aprobar no deje huecos raros
      await tx
        .update(ideas)
        .set({ manualRank: null })
        .where(and(eq(ideas.channelId, body.channel), eq(ideas.status, 'new')));
      for (const [i, id] of body.ids.entries()) {
        // acotado a canal + estado: si la idea se aprobó/descartó entre la
        // validación y aquí (TOCTOU), el update no la toca
        await tx
          .update(ideas)
          .set({ manualRank: i })
          .where(and(eq(ideas.id, id), eq(ideas.channelId, body.channel), eq(ideas.status, 'new')));
      }
    });
    return { ok: true as const };
  });

  app.post('/ideas/:id/approve', async (req) => {
    const { id } = req.params as { id: string };
    const videoId = nanoid();

    const { channelId, packagingFirst } = await ctx.db.transaction(async (tx) => {
      const [idea] = await tx.select().from(ideas).where(eq(ideas.id, id)).for('update');
      if (!idea) throw notFound(`Idea ${id} no existe`);
      if (idea.status !== 'new') throw conflict(`La idea ya fue decidida (${idea.status})`);

      await tx
        .update(ideas)
        // el rank manual pertenece al ranking: no viaja con la idea decidida
        .set({ status: 'approved', manualRank: null, decidedAt: new Date() })
        .where(eq(ideas.id, id));

      // el vídeo nace con la selección de brand kit del canal; el tema de
      // subtítulos integrado garantiza que el maestro siempre sea renderizable
      const [channel] = await tx
        .select({
          settings: channels.settings,
          profile: channels.profile,
          name: channels.name,
          avatarPath: channels.avatarPath,
        })
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
          // el render no lee BD: nombre, tokens de diseño, avatar y refs congelados
          channel_name: channel?.profile?.identity.name ?? channel?.name ?? '',
          ...(channel?.profile?.identity.tagline
            ? { tagline: channel.profile.identity.tagline }
            : {}),
          design: channel?.profile?.brand_design ?? defaultDesign(),
          // avatar del canal: solo si el ajuste lo permite. Apagado, la intro
          // se monta como la cabecera del canal (entramado + logotipo), que es
          // lo que hace el render cuando no le llega `logo`.
          ...(channel?.avatarPath && settings.avatar_en_video
            ? { avatar_path: channel.avatarPath }
            : {}),
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
      return {
        channelId: idea.channelId,
        packagingFirst: channel?.profile?.flags.packaging_first === true,
      };
    });

    // packaging_first (docs/generacion-guion.md §4.4): el worker genera SOLO
    // títulos + miniaturas y el guion se escribe tras confirmar el título.
    const payload: ScriptGenerateJob = {
      videoId,
      ...(packagingFirst ? { packagingOnly: true } : {}),
    };
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
        manualRank: null,
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
