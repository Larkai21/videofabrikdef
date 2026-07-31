import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { channels, ideas, markIncident, videos } from '@fabrica/db';
import {
  channelSettingsSchema,
  suficienciaResearch,
  editIntentSchema,
  JOBS,
  QUEUES,
  researchSchema,
  type ChannelProfile,
  type MasterVideoJson,
  type Scene,
  type ScriptGenerateJob,
  type ScriptJudgeJob,
  type Seo,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { countIntents, intentWarning, keepValidIntents, sweepIntents } from './intents.js';
import { ledgeredLlmJson } from './llm-call.js';
import { refineSystem, researchSystem, researchUser, scriptSystem, scriptUser } from './prompts.js';
import { downloadSources } from './research.js';
import { scriptWords, withinTolerance, wordTarget } from './wordcount.js';

const genSceneSchema = z.object({
  id: z.string().min(1),
  section: z.enum(['hook', 'body', 'cta']),
  text: z.string().min(1),
  visual_query: z.string().min(1),
  emphasis: z.boolean().optional(),
  // Intención visual declarada por el propio guionista. Se valida después con
  // sweepIntents, NO aquí: un rechazo en el esquema del LLM tumba el guion
  // entero por una intención de más.
  //
  // Eso es exactamente lo que decía este comentario y lo que la línea de abajo
  // hacía al revés: llevaba `.max(MAX_INTENTS_PER_SCENE)`, y el modelo declara
  // tres intenciones en la escena 0 con la frecuencia suficiente como para
  // tumbar 2 de cada 18 generaciones incluso después del reintento. Medido en
  // seis tandas del banco: 12 guiones perdidos de 152, un 8 %, y en producción
  // sería un vídeo en incidencia por una etiqueta de más.
  //
  // El tope sigue existiendo donde importa: `validateSceneIntents` descarta las
  // que pasan de MAX_INTENTS_PER_SCENE con motivo `exceso`, y el esquema del
  // maestro (`master-json.ts`) lo exige en lo que se persiste. Aquí se lee con
  // tolerancia, como ya se hace con `edits` y con `scene_notes`.
  edit_intents: z.array(editIntentSchema).optional(),
});

// exportado: packaging_first genera SOLO esta parte (packaging.ts)
export const seoGenSchema = z.object({
  titles: z.array(z.string()).min(3),
  description: z.string(),
  tags: z.array(z.string()).min(5),
  thumbnails: z.array(z.object({ text: z.string(), visual: z.string() })).min(2),
});

// lo usa también el banco de guiones (`scripts/guion.ts`), que llama al mismo
// prompt sin pasar por la cola ni por la máquina de estados
export const scriptGenSchema = z.object({
  script: z.object({
    scenes: z.array(genSceneSchema).min(3),
    hook_notes: z.string(),
  }),
  seo: seoGenSchema,
});

// El seo generado solo sustituye al existente si el humano aún no eligió
// título (packaging_first: el guion se escribe después y NO pisa el paquete
// confirmado en la puerta). Exportado para tests y para packaging.ts.
export function resolveSeo(existing: Seo | undefined, gen: z.infer<typeof seoGenSchema>): Seo {
  if (existing && existing.chosen_idx !== null) return existing;
  const [t0, t1, t2] = gen.titles;
  return {
    titles: [(t0 ?? '').slice(0, 70), (t1 ?? '').slice(0, 70), (t2 ?? '').slice(0, 70)],
    chosen_idx: null,
    description: gen.description,
    tags: gen.tags.slice(0, 15),
    thumbnails: gen.thumbnails.slice(0, 2),
  };
}

export const refineOutputSchema = z.object({
  scenes: z.array(z.object({ id: z.string(), text: z.string() })),
});

// en una reescritura, las escenas editadas por el humano no se tocan
function mergeHumanEdits(
  generated: Array<z.infer<typeof genSceneSchema>>,
  edited: Scene[],
): Scene[] {
  const byId = new Map(edited.map((s) => [s.id, s]));
  return generated.map((g) => {
    const human = byId.get(g.id);
    // al conservar el texto humano sobre la escena regenerada, las intenciones
    // generadas pueden apuntar a palabras que ese texto ya no tiene
    return human
      ? { ...g, text: human.text, edited_by_human: true, ...keepValidIntents(g, human.text) }
      : { ...g };
  });
}

async function adjustLength(
  ctx: WorkerContext,
  ids: { videoId: string; channelId: string },
  profile: ChannelProfile,
  scenes: Scene[],
  targetWords: number,
): Promise<Scene[]> {
  const adjustable = scenes.filter((s) => s.section === 'body' && !s.edited_by_human);
  if (adjustable.length === 0) {
    ctx.logger.warn(
      { videoId: ids.videoId },
      'Guion fuera de duración sin escenas body ajustables; se deja como está',
    );
    return scenes;
  }
  const lockedWords = scriptWords(scenes.filter((s) => !adjustable.includes(s)));
  const perScene = Math.min(
    70,
    Math.max(40, Math.round((targetWords - lockedWords) / adjustable.length)),
  );
  const result = await ledgeredLlmJson(ctx, {
    videoId: ids.videoId,
    channelId: ids.channelId,
    op: 'refine',
    system: refineSystem(profile),
    user: [
      `Ajusta la duración del guion. Reescribe SOLO estas escenas a ~${perScene} palabras cada una, conservando su contenido y su orden:`,
      ...adjustable.map((s) => `- ${s.id}: ${s.text}`),
    ].join('\n'),
    schema: refineOutputSchema,
    mockContext: {
      scenes: adjustable.map((s) => ({
        id: s.id,
        seed: `${ids.videoId}:${s.id}:ajuste`,
        words: perScene,
      })),
    },
  });
  const adjustableIds = new Set(adjustable.map((s) => s.id));
  const newTexts = new Map(result.scenes.map((s) => [s.id, s.text]));
  const out = scenes.map((s) => {
    const text = newTexts.get(s.id);
    // al reescribir el texto, las intenciones que apuntaban a una palabra que ya
    // no está se caen: si no, el efecto se anclaría en el sitio equivocado
    return text && adjustableIds.has(s.id) ? { ...s, text, ...keepValidIntents(s, text) } : s;
  });
  if (!withinTolerance(scriptWords(out), targetWords)) {
    ctx.logger.warn(
      { videoId: ids.videoId, words: scriptWords(out), targetWords },
      'El guion sigue fuera de la tolerancia de duración tras la pasada de ajuste',
    );
  }
  return out;
}

export async function handleScriptGenerate(
  ctx: WorkerContext,
  data: ScriptGenerateJob,
): Promise<void> {
  const { videoId, rewriteReason } = data;
  const [video] = await ctx.db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);
  if (video.state !== 'idea_aprobada' && video.state !== 'guion_borrador') {
    ctx.logger.warn(
      { videoId, state: video.state },
      'Estado inesperado para generar guion; no se hace nada',
    );
    return;
  }
  const [idea] = await ctx.db.select().from(ideas).where(eq(ideas.id, video.ideaId));
  const [channel] = await ctx.db.select().from(channels).where(eq(channels.id, video.channelId));
  if (!idea || !channel) throw new Error(`Faltan la idea o el canal del vídeo ${videoId}`);
  const profile = channel.profile;
  if (!profile) {
    const message = 'El canal no tiene perfil; completa el wizard antes de generar guiones';
    await markIncident(ctx.db, videoId, {
      message,
      suggested_action: 'regenerar',
      queue: QUEUES.script,
    });
    await ctx.publishEvent({
      type: 'incident',
      video_id: videoId,
      queue: QUEUES.script,
      message,
      suggested_action: 'regenerar',
    });
    return;
  }
  const settings = channelSettingsSchema.parse(channel.settings ?? {});

  const progress = (p: number, detail: string) =>
    ctx.publishEvent({
      type: 'job_progress',
      video_id: videoId,
      queue: QUEUES.script,
      progress: p,
      detail,
    });

  await progress(10, 'Descargando fuentes del research');
  const refs = idea.sourceRefs ?? [];
  const docs = await downloadSources(ctx.logger, refs, ctx.llm.name === 'mock');

  await progress(30, 'Sintetizando el research pack');
  const research = await ledgeredLlmJson(ctx, {
    videoId,
    channelId: video.channelId,
    op: 'research',
    system: researchSystem(),
    user: researchUser({ title: idea.title, angle: idea.angle, summary: idea.summary }, docs),
    schema: researchSchema,
    mockContext: { refs, ideaTitle: idea.title },
  });

  // La duración sale del MATERIAL, no solo del ajuste del canal. Un tuit da dos
  // minutos honestos; pedirle siete produce mil palabras de generalidades, y el
  // guion llegaba a confesárselo al espectador («Nuestro research pack es
  // limitado»). No se apaga la fábrica: si de verdad no hay nada, incidencia;
  // si hay poco, se escribe más corto.
  const caracteres = docs.reduce((n, d) => n + d.text.length, 0);
  const suficiencia = suficienciaResearch(research, caracteres, settings.duracion);
  if (suficiencia.nivel === 'insuficiente') {
    await markIncident(ctx.db, videoId, {
      message: suficiencia.motivo,
      suggested_action: 'descartar',
      queue: QUEUES.script,
    });
    await ctx.publishEvent({
      type: 'incident',
      video_id: videoId,
      queue: QUEUES.script,
      message: suficiencia.motivo,
      suggested_action: 'descartar',
    });
    return;
  }
  if (suficiencia.nivel === 'justo') {
    ctx.logger.info(
      { videoId, ...suficiencia },
      'Research corto: se acorta el vídeo en vez de rellenarlo',
    );
  }
  const targetWordsReal = wordTarget(suficiencia.minutos);

  await progress(55, 'Redactando guion y paquete SEO');
  const prevScenes = video.master.script?.scenes ?? [];
  const editedScenes = prevScenes.filter((s) => s.edited_by_human);
  // packaging_first: si el humano ya confirmó el título, el guion se escribe
  // "para cumplir la promesa" (el título entra en el prompt y el seo se conserva)
  const existingSeo = video.master.seo;
  const chosenTitle =
    video.titleChosen ??
    (existingSeo && existingSeo.chosen_idx !== null
      ? existingSeo.titles[existingSeo.chosen_idx]
      : undefined);
  const gen = await ledgeredLlmJson(ctx, {
    videoId,
    channelId: video.channelId,
    op: 'script',
    system: scriptSystem(profile, targetWordsReal),
    user: scriptUser({
      idea: { title: idea.title, angle: idea.angle, summary: idea.summary, whyNow: idea.whyNow },
      research,
      targetWords: targetWordsReal,
      language: profile.language,
      ...(rewriteReason ? { rewriteReason } : {}),
      ...(chosenTitle ? { chosenTitle } : {}),
      editedScenes,
    }),
    schema: scriptGenSchema,
    mockContext: {
      ideaTitle: idea.title,
      targetMinutes: settings.target_minutes,
      aiDisclosure: profile.flags.ai_disclosure,
      ...(chosenTitle ? { chosenTitle } : {}),
    },
  });

  let scenes = mergeHumanEdits(gen.script.scenes, editedScenes);

  // se cuenta ANTES del barrido: sin este número no se distingue «el modelo
  // declaró tres» de «declaró doce y once se cayeron», que son problemas
  // distintos y se arreglan en sitios distintos
  const declaradas = countIntents(gen.script.scenes);

  // portón de las intenciones visuales: lo que el guionista declaró mal se cae
  // aquí y se avisa, en vez de llegar al director y colocarse en el sitio
  // equivocado
  const barrido = sweepIntents(scenes, research.claims);
  scenes = barrido.scenes;
  const avisoIntents = intentWarning(barrido.dropped);
  if (avisoIntents !== null) {
    ctx.logger.info({ videoId, descartados: barrido.dropped.length }, avisoIntents);
    await progress(78, avisoIntents);
  }

  const trasBarrido = countIntents(scenes);
  let pasadaDuracion = false;
  // Contra targetWordsReal, NO contra el ajuste del canal: si el material solo
  // daba para dos minutos, comprobar la tolerancia contra los siete haría que
  // esta pasada estirase el guion corto de vuelta al relleno que se acaba de
  // evitar. Es el mismo número con el que se escribió.
  if (!withinTolerance(scriptWords(scenes), targetWordsReal)) {
    await progress(80, 'Ajustando la duración del guion');
    pasadaDuracion = true;
    scenes = await adjustLength(
      ctx,
      { videoId, channelId: video.channelId },
      profile,
      scenes,
      targetWordsReal,
    );
  }
  // la pasada reescribe el texto, así que se lleva por delante las intenciones
  // cuya palabra disparadora desapareció. Es el mayor destructor silencioso de
  // efectos declarados, y hasta ahora no se contaba en ningún sitio.
  const perdidasEnDuracion = Math.max(0, trasBarrido - countIntents(scenes));

  // escritura y transición en una transacción con candado y RELECTURA: si el
  // humano aprobó el guion mientras el LLM generaba, el borrador se descarta;
  // si eligió título durante la generación, se conserva su seo (los títulos
  // nuevos invalidarían la elección) y las ediciones de escena frescas
  const applied = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ state: videos.state, master: videos.master, titleChosen: videos.titleChosen })
      .from(videos)
      .where(eq(videos.id, videoId))
      .for('update');
    if (!row || (row.state !== 'idea_aprobada' && row.state !== 'guion_borrador')) return false;
    const freshSeo = row.master.seo;
    const titlePicked = row.titleChosen !== null || freshSeo?.chosen_idx != null;
    const seo: Seo =
      titlePicked && freshSeo ? freshSeo : resolveSeo(freshSeo ?? existingSeo, gen.seo);
    const freshEdited = (row.master.script?.scenes ?? []).filter((s) => s.edited_by_human);
    const finalScenes = freshEdited.length > 0 ? mergeHumanEdits(scenes, freshEdited) : scenes;
    const master: MasterVideoJson = {
      ...row.master,
      research,
      script: { scenes: finalScenes, hook_notes: gen.script.hook_notes },
      script_telemetry: {
        words: scriptWords(finalScenes),
        target_words: targetWordsReal,
        scenes: finalScenes.length,
        intents_declared: declaradas,
        intents_kept: countIntents(finalScenes),
        intents_dropped: barrido.dropped.map((d) => ({
          scene_id: d.sceneId,
          effect: d.effect,
          reason: d.reason,
        })),
        intents_lost_in_length_pass: perdidasEnDuracion,
        length_pass_ran: pasadaDuracion,
      },
      seo,
    };
    await tx
      .update(videos)
      .set({ master, state: 'guion_borrador', updatedAt: new Date() })
      .where(eq(videos.id, videoId));
    return true;
  });
  if (!applied) {
    ctx.logger.warn({ videoId }, 'Borrador descartado: el estado cambió durante la generación');
    return;
  }
  await ctx.publishEvent({ type: 'video_state', video_id: videoId, state: 'guion_borrador' });
  await ctx.publishEvent({ type: 'inbox_changed' });
  // El juez corre SIEMPRE. Antes solo con título confirmado, así que la mitad
  // de los vídeos no pasaban ningún control; sin título evalúa la promesa que
  // enuncia el propio gancho. Es idempotente por huella del guion.
  await ctx.queues.script.add(JOBS.script.judge, { videoId } satisfies ScriptJudgeJob);
  ctx.logger.info(
    { videoId, words: scriptWords(scenes), targetWords: targetWordsReal, escenas: scenes.length },
    'Guion generado y en puerta de revisión',
  );
}
