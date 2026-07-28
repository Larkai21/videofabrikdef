import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { channels, components } from '@fabrica/db';
import {
  authoredComponentName,
  buildComponentAuthorPrompt,
  componentAuthorOutputSchema,
  authoredTemplateOutput,
  componentManifestV1,
  defaultDesign,
  JOBS,
  QUEUES,
  type BrandTokens,
  type ComponentManifest,
  type ComponentsAuthorJob,
  type ComponentsValidateJob,
  type ComponentType,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { ledgeredLlmJson } from '../script/llm-call.js';
import { registerMockOp } from '../../providers/llm.js';

// Autoría por IA de componentes del brand kit (Fase 4). Pide a la LLM los tres
// ficheros del zip (con el prompt-contrato extendido: props exactas + tokens de
// diseño + avatar + determinismo), los escribe bajo library/components/ y encola
// components.validate con autoActivate. La validación de siempre (typecheck,
// determinismo, contrato, registry, humo) decide si se activa. En modo mock, el
// generador registrado devuelve las plantillas deterministas de shared.

const TYPES_NEEDING_FIXED: ComponentType[] = ['intro', 'outro', 'transition'];

// Siguiente versión en la línea 0.1.x para un nombre dado (las validadas son
// inmutables, así que re-generar exige bump).
async function nextVersion(ctx: WorkerContext, name: string): Promise<string> {
  const rows = await ctx.db
    .select({ version: components.version })
    .from(components)
    .where(eq(components.name, name));
  let maxPatch = -1;
  for (const r of rows) {
    const m = /^0\.1\.(\d+)$/.exec(r.version);
    if (m) maxPatch = Math.max(maxPatch, Number.parseInt(m[1]!, 10));
  }
  return `0.1.${maxPatch + 1}`;
}

export async function handleComponentsAuthor(
  ctx: WorkerContext,
  job: Job<ComponentsAuthorJob>,
): Promise<void> {
  const { channelId, type } = job.data;
  const log = ctx.logger.child({ channelId, type, queue: QUEUES.components, op: 'author' });

  const [channel] = await ctx.db
    .select({ name: channels.name, profile: channels.profile })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!channel) {
    log.warn('Canal no encontrado; job de autoría ignorado');
    return;
  }
  const profile = channel.profile;
  const design = profile?.brand_design ?? defaultDesign();
  const tokens: BrandTokens = {
    channel_name: profile?.identity.name ?? channel.name,
    ...(profile?.identity.tone ? { tone: profile.identity.tone } : {}),
    ...(profile?.style.visual_prompt_suffix
      ? { visual_prompt_suffix: profile.style.visual_prompt_suffix }
      : {}),
    language: profile?.language === 'en' ? 'en' : 'es',
  };

  const prompt = buildComponentAuthorPrompt(type, tokens, {
    design: design as unknown as Record<string, string>,
    ...(profile?.character ? { character: profile.character } : {}),
  });

  // fila de progreso de la cola components: el dashboard la escucha por SSE
  const publishProgress = async (progress: number, detail: string, componentId: string) => {
    await ctx.publishEvent({
      type: 'job_progress',
      video_id: componentId,
      queue: QUEUES.components,
      progress,
      detail,
    });
  };

  const authored = await ledgeredLlmJson(ctx, {
    channelId,
    op: 'component_author',
    system:
      'Eres un diseñador de componentes de vídeo con Remotion. Devuelves SOLO un objeto JSON válido con los ficheros pedidos.',
    user: prompt,
    schema: componentAuthorOutputSchema,
    // el mock deriva la plantilla determinista a partir del tipo
    mockContext: { type },
  });

  // el worker es la autoridad sobre nombre/versión (evita colisiones y permite
  // re-generar); el fixed_duration lo aporta la IA/plantilla
  const name = authoredComponentName(type);
  const version = await nextVersion(ctx, name);

  if (TYPES_NEEDING_FIXED.includes(type) && authored.fixed_duration_frames === undefined) {
    log.warn('La IA no devolvió fixed_duration_frames para un tipo que lo exige; se descarta');
    throw new Error(`El tipo ${type} exige fixed_duration_frames y la IA no lo devolvió`);
  }

  const manifest: ComponentManifest = componentManifestV1.parse({
    version: '1',
    type,
    name,
    component_version: version,
    props_schema: './schema.ts',
    assets: [],
    ...(authored.fixed_duration_frames !== undefined
      ? { fixed_duration_frames: authored.fixed_duration_frames }
      : {}),
  });

  const destDir = path.join(
    ctx.libraryDir,
    'components',
    channelId,
    type,
    `${name}@${version}`,
  );
  await fsp.rm(destDir, { recursive: true, force: true });
  await fsp.mkdir(destDir, { recursive: true });
  await fsp.writeFile(path.join(destDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await fsp.writeFile(path.join(destDir, 'schema.ts'), authored.schema_ts);
  await fsp.writeFile(path.join(destDir, 'Component.tsx'), authored.component_tsx);

  const componentId = nanoid();
  await ctx.db.insert(components).values({
    id: componentId,
    channelId,
    type,
    name,
    version,
    path: destDir,
    manifest,
    status: 'pending',
    log: 'Generado por IA; validación en marcha',
    previewPath: null,
  });

  await publishProgress(5, 'Componente generado por IA; validando', componentId);
  const payload: ComponentsValidateJob = { componentId, autoActivate: true };
  await ctx.queues.components.add(JOBS.components.validate, payload);
  await ctx.publishEvent({ type: 'inbox_changed' });
  log.info({ reference: `${name}@${version}`, componentId }, 'Componente autorizado por IA; a validar');
}

// Modo mock: la operación 'component_author' devuelve la plantilla determinista
// del tipo (un componente real que lee design y muestra el avatar). Así el flujo
// completo corre sin claves de LLM.
export function registerComponentsAuthorMock(): void {
  registerMockOp('component_author', ({ mockContext }) => {
    const type = mockContext.type as ComponentType;
    return authoredTemplateOutput(type);
  });
}
