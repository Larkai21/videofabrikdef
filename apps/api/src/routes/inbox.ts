import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { beats, channels, costLedger, ideas, sources, videos } from '@fabrica/db';
import {
  channelSettingsSchema,
  type InboxDto,
  type VideoState,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { videoTitle } from '../lib/master.js';

// multicanal (SPEC §14 S3): ?channel= filtra puertas, en curso, hechos y costes
// por canal; sin el parámetro se devuelve todo (lo usan el MCP y los agregados)
const inboxQuerySchema = z.object({
  channel: z.string().trim().min(1).optional(),
});

type Gate = InboxDto['gates'][number];
type Running = InboxDto['running'][number];

// fuentes con este nº de fallos consecutivos se consideran "caídas"
const STALE_SOURCE_FAILURES = 3;

const RUNNING_STATES: VideoState[] = [
  'idea_aprobada',
  'guion_ok',
  'audio',
  'timeline_ok',
  'render',
  'incidencia',
];

const RUNNING_DETAILS: Partial<Record<VideoState, string>> = {
  idea_aprobada: 'Generando guion y paquete SEO',
  guion_ok: 'Sintetizando voz y cortando beats',
  audio: 'Buscando assets para los beats',
  timeline_ok: 'Descargando assets elegidos',
  render: 'Renderizando vídeo',
};

export function registerInboxRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/inbox', async (req): Promise<InboxDto> => {
    const { channel } = inboxQuerySchema.parse(req.query ?? {});

    const [videoRows, newIdeas, channelRows] = await Promise.all([
      ctx.db
        .select()
        .from(videos)
        .where(channel !== undefined ? eq(videos.channelId, channel) : undefined),
      ctx.db
        .select()
        .from(ideas)
        .where(
          channel !== undefined
            ? and(eq(ideas.status, 'new'), eq(ideas.channelId, channel))
            : eq(ideas.status, 'new'),
        )
        .orderBy(desc(ideas.score)),
      // sin ?channel el presupuesto es el AGREGADO de todos los canales, no
      // el de un canal arbitrario frente a costes de todos
      channel !== undefined
        ? ctx.db.select().from(channels).where(eq(channels.id, channel)).limit(1)
        : ctx.db.select().from(channels),
    ]);

    const gates: Gate[] = [];

    // puerta de ideas: una por canal con ranking pendiente
    const ideasByChannel = new Map<string, typeof newIdeas>();
    for (const idea of newIdeas) {
      const list = ideasByChannel.get(idea.channelId) ?? [];
      list.push(idea);
      ideasByChannel.set(idea.channelId, list);
    }
    for (const [channelId, list] of ideasByChannel) {
      const top = list[0];
      if (!top) continue;
      gates.push({
        kind: 'idea',
        video_id: null,
        channel_id: channelId,
        step_label: 'Puerta 1 · elegir',
        title: top.title,
        meta: `${list.length} ideas nuevas en el ranking`,
        eta_min: 1,
      });
    }

    // puerta de guion
    for (const video of videoRows.filter((v) => v.state === 'guion_borrador')) {
      gates.push({
        kind: 'guion',
        video_id: video.id,
        channel_id: video.channelId,
        step_label: 'Puerta 2 · aprobar',
        title: videoTitle(video),
        meta: 'Borrador listo para revisar',
        eta_min: 8,
      });
    }

    // puerta de timeline, con progreso de curación por beats
    const timelineVideos = videoRows.filter((v) => v.state === 'assets');
    const beatCounts = new Map<string, { total: number; locked: number }>();
    if (timelineVideos.length) {
      const rows = await ctx.db
        .select({ videoId: beats.videoId, status: beats.status })
        .from(beats)
        .where(inArray(beats.videoId, timelineVideos.map((v) => v.id)));
      for (const row of rows) {
        const agg = beatCounts.get(row.videoId) ?? { total: 0, locked: 0 };
        agg.total += 1;
        if (row.status === 'locked') agg.locked += 1;
        beatCounts.set(row.videoId, agg);
      }
    }
    for (const video of timelineVideos) {
      const agg = beatCounts.get(video.id) ?? { total: 0, locked: 0 };
      gates.push({
        kind: 'timeline',
        video_id: video.id,
        channel_id: video.channelId,
        step_label: 'Puerta 3 · curar',
        title: videoTitle(video),
        meta: `${agg.locked}/${agg.total} beats aprobados`,
        eta_min: 4,
      });
    }

    // puerta de entrega: hecho con carpeta de salida
    for (const video of videoRows.filter((v) => v.state === 'hecho' && v.outputDir)) {
      gates.push({
        kind: 'entrega',
        video_id: video.id,
        channel_id: video.channelId,
        step_label: 'Entrega · subir a mano',
        title: videoTitle(video),
        meta: 'MP4 y metadatos listos para subir',
        eta_min: 2,
      });
    }

    const running: Running[] = videoRows
      .filter((v) => RUNNING_STATES.includes(v.state as VideoState))
      .map((video) => {
        const state = video.state as VideoState;
        const detail =
          state === 'incidencia'
            ? (video.incident?.message ?? 'Incidencia sin detalle')
            : (RUNNING_DETAILS[state] ?? 'En proceso');
        return {
          video_id: video.id,
          title: videoTitle(video),
          state,
          detail,
          progress: null,
          cost_usd: video.costsTotal,
          incident: video.incident
            ? {
                message: video.incident.message,
                suggested_action: video.incident.suggested_action,
              }
            : null,
        };
      });

    const done = videoRows
      .filter((v) => v.state === 'hecho')
      .map((video) => ({
        video_id: video.id,
        title: videoTitle(video),
        output_dir: video.outputDir ?? '',
        finished_at: video.updatedAt.toISOString(),
        youtube: video.youtube ?? null,
      }));

    const monthStart = sql`date_trunc('month', now())`;
    const [[costRow], [countRow]] = await Promise.all([
      ctx.db
        .select({ total: sql<string>`coalesce(sum(${costLedger.cost}), 0)` })
        .from(costLedger)
        .where(
          channel !== undefined
            ? and(gte(costLedger.createdAt, monthStart), eq(costLedger.channelId, channel))
            : gte(costLedger.createdAt, monthStart),
        ),
      ctx.db
        .select({ n: sql<string>`count(*)` })
        .from(videos)
        .where(
          and(
            eq(videos.state, 'hecho'),
            gte(videos.updatedAt, monthStart),
            ...(channel !== undefined ? [eq(videos.channelId, channel)] : []),
          ),
        ),
    ]);

    const monthBudget = channelRows.reduce(
      (acc, row) => acc + channelSettingsSchema.parse(row.settings ?? {}).monthly_budget_usd,
      0,
    );

    // fuentes de scraping caídas: fallos consecutivos altos en fuentes activas
    const staleRows = await ctx.db
      .select({ id: sources.id, label: sources.label, url: sources.url, failures: sources.consecutiveFailures })
      .from(sources)
      .where(
        and(
          eq(sources.enabled, true),
          gte(sources.consecutiveFailures, STALE_SOURCE_FAILURES),
          ...(channel !== undefined ? [eq(sources.channelId, channel)] : []),
        ),
      )
      .orderBy(desc(sources.consecutiveFailures))
      .limit(20);

    return {
      gates,
      running,
      done,
      month_cost_usd: Number(costRow?.total ?? 0),
      month_videos: Number(countRow?.n ?? 0),
      month_budget_usd: monthBudget,
      stale_sources: staleRows.map((s) => ({
        id: s.id,
        label: s.label ?? s.url,
        failures: s.failures,
      })),
    };
  });
}
