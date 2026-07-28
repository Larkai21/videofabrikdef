import { and, eq, gte, isNotNull, isNull, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { channels, ideas, rawItems, sources } from '@fabrica/db';
import {
  channelSettingsSchema,
  DEDUPE_WINDOW_DAYS,
  IDEA_SCORE_THRESHOLD,
  type ChannelProfile,
  type IdeasScoreJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { cosineSimilarity } from '../../providers/embeddings.js';
import { ledgeredLlmJson } from './llm-call.js';
import {
  centroid,
  meanStd,
  metricValue,
  pickSourceRefs,
  scoreCluster,
  zScore,
  type ScoreParts,
} from './scoring.js';

const SATURATION_WINDOW_DAYS = 21;
// tope de fichas por pasada para acotar coste y ruido en la bandeja
const MAX_IDEAS_PER_RUN = 12;

const ideaWriteupSchema = z.object({
  angle: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  why_now: z.string().min(1),
});

interface ItemRow {
  id: string;
  sourceId: string;
  urlCanonical: string;
  title: string;
  excerpt: string | null;
  publishedAt: Date | null;
  fetchedAt: Date;
  metrics: unknown;
  clusterId: string | null;
  embedding: number[] | null;
  sourceKind: string;
}

function ideaSystem(profile: ChannelProfile): string {
  return [
    'Eres el editor jefe de un canal de YouTube.',
    `Canal: ${profile.identity.name}. Posicionamiento: ${profile.identity.positioning}.`,
    `Espectador: ${profile.identity.audience}. Idioma: ${profile.language}.`,
    'A partir de las señales de un cluster de fuentes, redacta la ficha de una idea de vídeo.',
    'Devuelve JSON con: angle (ángulo propuesto), title (título provisional, 70 caracteres máximo),',
    'summary (2-3 frases) y why_now (por qué ahora, exactamente 2 líneas separadas por salto de línea).',
    'En el idioma del canal, sentence case, sin exclamaciones ni clickbait vacío.',
  ].join('\n');
}

export async function handleIdeasScore(ctx: WorkerContext, data: IdeasScoreJob): Promise<void> {
  const { channelId } = data;
  const [channel] = await ctx.db.select().from(channels).where(eq(channels.id, channelId));
  if (!channel) {
    ctx.logger.warn({ channelId }, 'Score de un canal inexistente; se ignora');
    return;
  }
  const profile = channel.profile;
  if (!profile) {
    ctx.logger.warn({ channelId }, 'Canal sin perfil; no se puntúan ideas hasta completar el wizard');
    // cierre para el radar: sin este evento la búsqueda se queda «puntuando»
    await ctx.publishEvent({ type: 'ideas_updated', channel_id: channelId, nuevas: 0 });
    return;
  }
  const settings = channelSettingsSchema.parse(channel.settings ?? {});
  const weights = settings.scoring;

  const since14 = new Date(Date.now() - DEDUPE_WINDOW_DAYS * 86_400_000);
  const rows: ItemRow[] = await ctx.db
    .select({
      id: rawItems.id,
      sourceId: rawItems.sourceId,
      urlCanonical: rawItems.urlCanonical,
      title: rawItems.title,
      excerpt: rawItems.excerpt,
      publishedAt: rawItems.publishedAt,
      fetchedAt: rawItems.fetchedAt,
      metrics: rawItems.metrics,
      clusterId: rawItems.clusterId,
      embedding: rawItems.embedding,
      sourceKind: sources.kind,
    })
    .from(rawItems)
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(
      and(
        gte(rawItems.fetchedAt, since14),
        isNotNull(rawItems.clusterId),
        isNotNull(rawItems.embedding),
        or(isNull(sources.channelId), eq(sources.channelId, channelId)),
      ),
    );

  if (rows.length === 0) {
    ctx.logger.info({ channelId }, 'Sin items en la ventana de 14 días; nada que puntuar');
    await ctx.publishEvent({ type: 'ideas_updated', channel_id: channelId, nuevas: 0 });
    return;
  }

  // clusters activos
  const clusters = new Map<string, ItemRow[]>();
  for (const row of rows) {
    if (!row.clusterId) continue;
    const list = clusters.get(row.clusterId) ?? [];
    list.push(row);
    clusters.set(row.clusterId, list);
  }

  // estadística por fuente para el z-score de la señal externa
  const valuesBySource = new Map<string, number[]>();
  for (const row of rows) {
    const list = valuesBySource.get(row.sourceId) ?? [];
    list.push(metricValue(row.metrics));
    valuesBySource.set(row.sourceId, list);
  }
  const statsBySource = new Map<string, { mean: number; std: number }>();
  for (const [sourceId, values] of valuesBySource) statsBySource.set(sourceId, meanStd(values));

  // embeddings de pilares y de temas de alto CPM en un solo lote
  const pillarTexts = profile.pillars.map(
    (p) => `${p.name}. ${p.description}. ${p.example_queries.join(', ')}`,
  );
  const topicTexts = profile.high_cpm_topics;
  const embedded = await ctx.embeddings.embed([...pillarTexts, ...topicTexts]);
  const pillarVecs = embedded.slice(0, pillarTexts.length);
  const topicVecs = embedded.slice(pillarTexts.length);

  // saturación: títulos de competidores (fuentes youtube) en 21 días
  const since21 = new Date(Date.now() - SATURATION_WINDOW_DAYS * 86_400_000);
  const satRows = await ctx.db
    .select({ embedding: rawItems.embedding })
    .from(rawItems)
    .innerJoin(sources, eq(rawItems.sourceId, sources.id))
    .where(
      and(
        gte(rawItems.fetchedAt, since21),
        eq(sources.kind, 'youtube'),
        isNotNull(rawItems.embedding),
        or(isNull(sources.channelId), eq(sources.channelId, channelId)),
      ),
    );
  const satVecs = satRows.map((r) => r.embedding).filter((v): v is number[] => v !== null);

  // clusters que ya tienen idea (cualquier status): no se duplican
  const prior = await ctx.db
    .select({ clusterId: ideas.clusterId })
    .from(ideas)
    .where(eq(ideas.channelId, channelId));
  const taken = new Set(prior.map((r) => r.clusterId).filter((c): c is string => c !== null));

  const topics = profile.high_cpm_topics.map((t) => t.toLowerCase());
  const now = Date.now();

  const scored: Array<{
    clusterId: string;
    members: ItemRow[];
    cent: number[];
    score: number;
    parts: ScoreParts;
  }> = [];

  for (const [clusterId, members] of clusters) {
    const vecs = members.map((m) => m.embedding).filter((v): v is number[] => v !== null);
    if (vecs.length === 0) continue;
    const cent = centroid(vecs);

    let externalZ = 0;
    for (const m of members) {
      const stats = statsBySource.get(m.sourceId);
      if (!stats) continue;
      externalZ = Math.max(externalZ, zScore(metricValue(m.metrics), stats.mean, stats.std));
    }

    let fitCos = 0;
    for (const p of pillarVecs) fitCos = Math.max(fitCos, cosineSimilarity(cent, p));

    const newest = Math.max(
      ...members.map((m) => (m.publishedAt ?? m.fetchedAt).getTime()),
    );
    const ageHours = Math.max(0, (now - newest) / 3_600_000);

    let saturationCos = 0;
    for (const v of satVecs) saturationCos = Math.max(saturationCos, cosineSimilarity(cent, v));

    const titlesText = members.map((m) => m.title.toLowerCase()).join(' ');
    let commercialFit = topics.some((t) => t.length > 0 && titlesText.includes(t)) ? 1 : 0;
    if (commercialFit === 0) {
      for (const v of topicVecs) commercialFit = Math.max(commercialFit, cosineSimilarity(cent, v));
    }

    const { score, parts } = scoreCluster(
      { externalZ, fitCos, ageHours, saturationCos, commercialFit },
      weights,
    );
    scored.push({ clusterId, members, cent, score, parts });
  }

  const candidates = scored
    .filter((c) => c.score >= IDEA_SCORE_THRESHOLD && !taken.has(c.clusterId))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_IDEAS_PER_RUN);

  let inserted = 0;
  for (const cluster of candidates) {
    const refCandidates = cluster.members.map((m) => ({
      url: m.urlCanonical,
      title: m.title,
      metric: metricValue(m.metrics),
    }));
    const sourceRefs = pickSourceRefs(refCandidates, 5);
    const topTitles = [...cluster.members]
      .sort((a, b) => metricValue(b.metrics) - metricValue(a.metrics))
      .slice(0, 5)
      .map((m) => m.title);

    const writeup = await ledgeredLlmJson(ctx, {
      channelId,
      op: 'idea_writeup',
      system: ideaSystem(profile),
      user: [
        `Cluster con ${cluster.members.length} items en los últimos 14 días.`,
        `Puntuación interna: ${cluster.score.toFixed(1)} sobre 100.`,
        'Títulos más fuertes del cluster:',
        ...topTitles.map((t) => `- ${t}`),
      ].join('\n'),
      schema: ideaWriteupSchema,
      mockContext: { titles: topTitles, clusterId: cluster.clusterId },
    });

    await ctx.db.insert(ideas).values({
      id: nanoid(),
      channelId,
      clusterId: cluster.clusterId,
      title: writeup.title.slice(0, 70),
      summary: writeup.summary,
      angle: writeup.angle,
      whyNow: writeup.why_now,
      score: cluster.score,
      scoreParts: cluster.parts,
      status: 'new',
      sourceRefs,
      embedding: cluster.cent,
    });
    inserted += 1;
  }

  ctx.logger.info(
    { channelId, clusters: clusters.size, candidatos: candidates.length, nuevasIdeas: inserted },
    'Scoring de clusters completado',
  );

  // siempre, con el recuento: el radar de la bandeja necesita el cierre
  // («0 ideas nuevas» también es una respuesta)
  await ctx.publishEvent({ type: 'ideas_updated', channel_id: channelId, nuevas: inserted });
  if (inserted > 0) {
    await ctx.publishEvent({ type: 'inbox_changed' });
  }
}
