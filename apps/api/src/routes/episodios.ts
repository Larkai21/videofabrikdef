import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { episodes, transitionEpisode } from '@fabrica/db';
import {
  episodeClaimRequestSchema,
  episodeCreateRequestSchema,
  JOBS,
  QUEUES,
  type EpisodeDto,
  type EpisodesListDto,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

// Episodios externos (clipping): pegar una URL, ver el progreso de descarga y
// transcripción, y desde `listo` proponer clips. El material es ajeno: la
// fuente completa se guarda desde el día 1 (es el registro de defensa ante
// reclamaciones) y la atribución viaja después en cada short.

type EpisodeRow = typeof episodes.$inferSelect;

function plataformaDe(url: string): 'youtube' | 'twitch' | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
      return 'youtube';
    }
    if (host === 'twitch.tv' || host.endsWith('.twitch.tv')) return 'twitch';
    return null;
  } catch {
    return null;
  }
}

function toDto(row: EpisodeRow): EpisodeDto {
  return {
    id: row.id,
    channel_id: row.channelId,
    state: row.state as EpisodeDto['state'],
    source_url: row.sourceUrl,
    source_platform: row.sourcePlatform,
    source_title: row.sourceTitle,
    source_channel_name: row.sourceChannelName,
    license_status: row.licenseStatus as EpisodeDto['license_status'],
    duration_ms: row.durationMs,
    claims: row.claims,
    incident: row.incident
      ? { message: row.incident.message, suggested_action: row.incident.suggested_action }
      : null,
    downloaded_at: row.downloadedAt?.toISOString() ?? null,
    transcribed_at: row.transcribedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

export function registerEpisodeRoutes(app: FastifyInstance, ctx: ApiContext): void {
  // Alta por URL: crea la fila y encola la descarga. El mismo episodio
  // (plataforma + id de vídeo) no se ingiere dos veces — el índice único lo
  // garantiza cuando la descarga resuelve el id; aquí se corta antes por URL.
  app.post('/episodios', async (req) => {
    const body = episodeCreateRequestSchema.parse(req.body);
    const plataforma = plataformaDe(body.url);
    if (plataforma === null) {
      throw badRequest('Solo YouTube y Twitch por ahora');
    }
    const [duplicado] = await ctx.db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.sourceUrl, body.url))
      .limit(1);
    if (duplicado) {
      return { episode_id: duplicado.id, ya_existia: true as const };
    }
    const id = nanoid();
    await ctx.db.insert(episodes).values({
      id,
      channelId: body.channel_id,
      sourceUrl: body.url,
      sourcePlatform: plataforma,
    });
    await ctx.enqueuer.enqueue(
      QUEUES.media,
      JOBS.media.download,
      { episodeId: id },
      { dedupeId: `episode-download-${id}` },
    );
    return { episode_id: id, ya_existia: false as const };
  });

  app.get('/episodios', async (): Promise<EpisodesListDto> => {
    const rows = await ctx.db.select().from(episodes).orderBy(desc(episodes.createdAt));
    return { episodes: rows.map(toDto) };
  });

  app.get('/episodios/:id', async (req): Promise<EpisodeDto> => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!row) throw notFound(`Episodio ${id} no existe`);
    return toDto(row);
  });

  // Reintento desde incidencia: vuelve al estado en el que se falló y
  // re-encola el job exacto que la incidencia dejó apuntado.
  app.post('/episodios/:id/retry', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!row) throw notFound(`Episodio ${id} no existe`);
    if (row.state !== 'incidencia') {
      throw conflict(`Solo se reintenta un episodio en incidencia (estado: ${row.state})`);
    }
    const volverA = (row.stateBeforeIncident ?? 'nuevo') as Parameters<
      typeof transitionEpisode
    >[2];
    await transitionEpisode(ctx.db, id, volverA, { expectFrom: 'incidencia' });
    const job = row.incident?.job;
    await ctx.enqueuer.enqueue(
      QUEUES.media,
      job?.name ?? JOBS.media.download,
      { episodeId: id, ...(job?.data ?? {}) },
      { dedupeId: `episode-retry-${id}-${Date.now()}` },
    );
    return { ok: true as const };
  });

  // Registro manual de una reclamación: el historial de defensa del episodio.
  // No dispara nada; si la acción es retirar un short, eso se hace en su
  // pantalla. Política documentada: no disputar por defecto, retirar si el
  // creador lo pide.
  app.post('/episodios/:id/claim', async (req) => {
    const { id } = req.params as { id: string };
    const body = episodeClaimRequestSchema.parse(req.body ?? {});
    const [row] = await ctx.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!row) throw notFound(`Episodio ${id} no existe`);
    const claim = {
      date: new Date().toISOString(),
      kind: body.kind,
      action: body.action,
      ...(body.note !== undefined && body.note !== '' ? { note: body.note } : {}),
    };
    await ctx.db
      .update(episodes)
      .set({ claims: [...row.claims, claim], updatedAt: new Date() })
      .where(eq(episodes.id, id));
    return { ok: true as const, claims: row.claims.length + 1 };
  });
}
