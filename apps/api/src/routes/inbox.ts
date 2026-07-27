import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { beats, channels, costLedger, ideas, videos } from '@fabrica/db';
import {
  channelSettingsSchema,
  type InboxDto,
  type VideoState,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { videoTitle } from '../lib/master.js';

type Gate = InboxDto['gates'][number];
type Running = InboxDto['running'][number];

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
  app.get('/inbox', async (): Promise<InboxDto> => {
    const [videoRows, newIdeas, channelRows] = await Promise.all([
      ctx.db.select().from(videos),
      ctx.db.select().from(ideas).where(eq(ideas.status, 'new')).orderBy(desc(ideas.score)),
      ctx.db.select().from(channels).limit(1),
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
        step_label: 'Elegir idea',
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
        step_label: 'Revisar guion y elegir título',
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
        step_label: 'Curar timeline',
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
        step_label: 'Subida manual',
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
        .where(gte(costLedger.createdAt, monthStart)),
      ctx.db
        .select({ n: sql<string>`count(*)` })
        .from(videos)
        .where(and(eq(videos.state, 'hecho'), gte(videos.updatedAt, monthStart))),
    ]);

    const settings = channelSettingsSchema.parse(channelRows[0]?.settings ?? {});

    return {
      gates,
      running,
      done,
      month_cost_usd: Number(costRow?.total ?? 0),
      month_videos: Number(countRow?.n ?? 0),
      month_budget_usd: settings.monthly_budget_usd,
    };
  });
}
