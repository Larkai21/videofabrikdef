import fsp from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { channels, videos } from '@fabrica/db';
import {
  defaultDesign,
  QUEUES,
  thumbnailBriefSchema,
  type ThumbnailBriefJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { mockHash, registerMockOp } from '../../providers/llm.js';
import { ledgeredLlmJson } from './llm-call.js';

// Brief de miniatura de alta conversión (Fase: miniaturas). En vez de generar la
// imagen, la app devuelve una DESCRIPCIÓN detallada (ES) de la miniatura ideal +
// un PROMPT (EN) listo para pegar en un generador; el humano la crea y la sube.
// Se escribe en outputs/<id>/thumbnail-brief.json (mismo patrón que title.txt).

const OUTPUT_FILE = 'thumbnail-brief.json';

function briefSystem(): string {
  return [
    'Eres director de arte experto en miniaturas de YouTube de ALTA CONVERSIÓN.',
    'Diseñas la miniatura perfecta para maximizar el CTR: un sujeto claro, una emoción legible,',
    'contraste alto, un punto focal y (opcional) un texto corto y enorme.',
    'Devuelves SOLO un objeto JSON con las claves "brief" y "prompt".',
  ].join(' ');
}

function briefUser(input: {
  title: string;
  concept: string;
  audience: string;
  tone: string[];
  character?: { name: string; description: string };
  accent: string;
  background: string;
}): string {
  const characterLine = input.character
    ? `Personaje/mascota del canal: "${input.character.name}" (${input.character.description}). Debe ser el sujeto principal o aparecer de forma destacada.`
    : 'El canal no tiene personaje fijo; elige un sujeto humano/objeto que encaje con el tema.';
  return [
    `Título del vídeo: ${input.title}`,
    input.concept ? `Concepto de miniatura de partida: ${input.concept}` : '',
    `Audiencia: ${input.audience}`,
    `Tono del canal: ${input.tone.join(', ')}`,
    characterLine,
    `Colores de marca: acento ${input.accent}, fondo ${input.background} (úsalos en la paleta).`,
    'Lienzo 16:9 (1280×720).',
    '',
    'Devuelve JSON con:',
    '- "brief": descripción DETALLADA en español de la imagen ideal, para que un humano la genere:',
    '  sujeto y expresión/emoción, composición (regla de tercios, punto focal, dónde mira),',
    '  fondo, paleta (con los colores de marca), texto grande sugerido (≤4 palabras) y su posición,',
    '  qué EVITAR (texto pequeño, caras neutras, fondos ruidosos) y por qué esta miniatura convierte.',
    '- "prompt": UN prompt en inglés listo para pegar en un generador de imágenes (Nano Banana,',
    '  Midjourney, etc.): sujeto + estilo + iluminación + colores + estado de ánimo + "16:9",',
    '  incluyendo el personaje si existe. Sin texto pequeño; deja zona libre para el título grande.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export async function handleThumbnailBrief(
  ctx: WorkerContext,
  data: ThumbnailBriefJob,
): Promise<void> {
  const { videoId } = data;
  const log = ctx.logger.child({ videoId, queue: QUEUES.script, op: 'thumbnail_brief' });

  const [video] = await ctx.db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!video) {
    log.warn('Vídeo no encontrado; brief de miniatura ignorado');
    return;
  }
  const master = video.master;
  const [channel] = await ctx.db
    .select({ profile: channels.profile })
    .from(channels)
    .where(eq(channels.id, video.channelId))
    .limit(1);
  const profile = channel?.profile;
  const design = profile?.brand_design ?? defaultDesign();

  const seo = master?.seo;
  const chosenIdx = seo?.chosen_idx ?? 0;
  const title = video.titleChosen ?? seo?.titles?.[chosenIdx] ?? seo?.titles?.[0] ?? '';
  const concept = seo?.thumbnails?.[0]?.visual ?? '';

  const progress = (p: number, detail: string) =>
    ctx.publishEvent({
      type: 'job_progress',
      video_id: videoId,
      queue: QUEUES.script,
      progress: p,
      detail,
    });

  await progress(20, 'Redactando el brief de miniatura');
  const result = await ledgeredLlmJson(ctx, {
    videoId,
    channelId: video.channelId,
    op: 'thumbnail_brief',
    system: briefSystem(),
    user: briefUser({
      title,
      concept,
      audience: profile?.identity.audience ?? '',
      tone: profile?.identity.tone ?? [],
      ...(profile?.character ? { character: profile.character } : {}),
      accent: design.accent,
      background: design.background,
    }),
    schema: thumbnailBriefSchema,
    mockContext: { title, concept, character: profile?.character?.name },
  });

  const outDir = video.outputDir ?? path.join(ctx.outputsDir, videoId);
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(path.join(outDir, OUTPUT_FILE), JSON.stringify(result, null, 2));

  await progress(100, 'Brief de miniatura listo');
  await ctx.publishEvent({ type: 'inbox_changed' });
  log.info('Brief de miniatura generado');
}

// Mock: brief determinista derivado del título y el personaje (sin claves).
export function registerThumbnailBriefMock(): void {
  registerMockOp('thumbnail_brief', ({ mockContext }) => {
    const title = String(mockContext.title ?? 'el tema del vídeo');
    const character = mockContext.character ? String(mockContext.character) : null;
    const subject = character ?? 'un primer plano expresivo relacionado con el tema';
    const seed = mockHash(title);
    const bigText = title.split(/\s+/).slice(0, 3).join(' ').toUpperCase();
    return z
      .object({ brief: z.string(), prompt: z.string() })
      .parse({
        brief: [
          `Miniatura para "${title}".`,
          `Sujeto principal: ${subject}, con una expresión de sorpresa/curiosidad clara.`,
          'Composición en regla de tercios: el sujeto a la izquierda mirando hacia el texto; punto focal en su rostro.',
          `Fondo desenfocado con la paleta de marca (acento vivo sobre fondo oscuro), luz de recorte para separar al sujeto.`,
          `Texto grande sugerido (≤4 palabras): "${bigText}" arriba a la derecha, tipografía gruesa con borde.`,
          'Evita: texto pequeño, cara neutra, fondos ruidosos o con logos. Alto contraste = más CTR.',
          `(variante mock #${seed % 1000})`,
        ].join(' '),
        prompt: [
          `YouTube thumbnail, 16:9, ${subject},`,
          'dramatic rim lighting, high contrast, shallow depth of field,',
          'bold cinematic color grade, brand accent color pop on dark background,',
          'expressive face, clear focal point, leave empty space top-right for large title text, no small text',
        ].join(' '),
      });
  });
}
