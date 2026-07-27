import { eq } from 'drizzle-orm';
import { channels, sources } from '@fabrica/db';
import { channelProfileV1, type SourcesBootstrapJob } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { ledgeredLlmJson } from './llm-call.js';
import { detectLang } from './normalize.js';
import { upsertPollScheduler } from './scheduler.js';

const PROFILE_SYNTH_SYSTEM = [
  'Eres estratega de canales de YouTube sin rostro.',
  'Sintetiza un channel_profile v1 en JSON con exactamente estos campos:',
  "version: '1'.",
  'identity: { name, positioning, audience, tone (lista de 2-4 adjetivos) }.',
  "language: 'es' o 'en'.",
  'pillars: 2-4 pilares { name, description, example_queries (2-3 consultas de búsqueda) }.',
  "style: { visual_prompt_suffix (sufijo para prompts de imagen, en inglés), stock_query_lang ('en' salvo motivo claro), banned (temas o muletillas prohibidos) }.",
  "voice: { provider: 'edge', voice_id (una voz neural de Microsoft acorde al idioma), rate (p. ej. '-8%') }.",
  "title_patterns: 2-4 plantillas { template con huecos {X}, example, source: 'mined' }.",
  'high_cpm_topics: 3-6 temas de alto valor publicitario del nicho.',
  'flags: { packaging_first: false, ai_disclosure: true }.',
  'Sé concreto y coherente con el nicho; no inventes métricas de audiencia.',
].join('\n');

export function extractYoutubeChannelId(input: string): string | null {
  const trimmed = input.trim();
  if (/^UC[0-9A-Za-z_-]{10,}$/.test(trimmed)) return trimmed;
  const match = /\/channel\/(UC[0-9A-Za-z_-]{10,})/.exec(trimmed);
  return match?.[1] ?? null;
}

export async function handleBootstrap(
  ctx: WorkerContext,
  data: SourcesBootstrapJob,
): Promise<void> {
  const [channel] = await ctx.db.select().from(channels).where(eq(channels.id, data.channelId));
  if (!channel) {
    ctx.logger.warn({ channelId: data.channelId }, 'Bootstrap de un canal inexistente; se ignora');
    return;
  }
  const language = channel.profile?.language ?? detectLang(data.niche);

  const profile = await ledgeredLlmJson(ctx, {
    channelId: data.channelId,
    op: 'profile_synthesis',
    system: PROFILE_SYNTH_SYSTEM,
    user: [
      `Nicho: ${data.niche}`,
      `Competidores: ${data.competitors.length > 0 ? data.competitors.join(', ') : 'sin lista'}`,
      `Idioma del canal: ${language}`,
    ].join('\n'),
    schema: channelProfileV1,
    mockContext: { niche: data.niche, competitors: data.competitors, language },
  });

  await ctx.db
    .update(channels)
    .set({ profile, profileApproved: false })
    .where(eq(channels.id, data.channelId));

  // Fuentes de competidores: solo URLs con id de canal UC… (feed RSS sin cuota).
  // La resolución de /@handle necesita la API de YouTube y queda para S2.
  let created = 0;
  for (const competitor of data.competitors) {
    const ucId = extractYoutubeChannelId(competitor);
    if (!ucId) {
      ctx.logger.info(
        { competitor },
        'Competidor sin id de canal UC; la resolución por handle queda para S2',
      );
      continue;
    }
    const sourceId = `src-yt-${ucId}`;
    await ctx.db
      .insert(sources)
      .values({
        id: sourceId,
        channelId: data.channelId,
        kind: 'youtube',
        url: `https://www.youtube.com/feeds/videos.xml?channel_id=${ucId}`,
        label: `Competidor · ${ucId}`,
        cadenceMinutes: 120,
        config: {},
      })
      .onConflictDoNothing();
    await upsertPollScheduler(ctx.queues.sources, { id: sourceId, cadenceMinutes: 120 });
    created += 1;
  }

  await ctx.publishEvent({ type: 'inbox_changed' });
  ctx.logger.info(
    { channelId: data.channelId, competidores: data.competitors.length, fuentesCreadas: created },
    'Bootstrap completado: perfil sintetizado en borrador',
  );
}
