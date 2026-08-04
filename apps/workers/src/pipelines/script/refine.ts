import { and, eq } from 'drizzle-orm';
import { channels, videos } from '@fabrica/db';
import {
  ARREGLO_POR_AVISO,
  BLOCKING_LINT_KINDS,
  JOBS,
  QUEUES,
  blockingSceneIds,
  lintScenes,
  type MasterVideoJson,
  type Scene,
  type ScriptRefineJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { refineOutputSchema } from './generate.js';
import { keepValidIntents, normalizaEscena } from './intents.js';
import { ledgeredLlmJson } from './llm-call.js';
import { refineSystem } from './prompts.js';
import { countWords } from './wordcount.js';

/**
 * El encargo que recibe el refinado, con el arreglo concreto de cada escena y
 * sus vecinas alrededor.
 *
 * `ScriptRefineJob.notes` existe en el contrato desde el principio, con un
 * comentario que dice «sin ellas el refinado reescribe a ciegas», y `judge.ts`
 * las rellena con `{axis, issue, fix}` por escena. Pero la palabra `notes` no
 * aparecía en este fichero: se leían solo `patchTargets` y `reasons`, así que
 * el refinado recibía la lista de motivos del guion ENTERO y tenía que adivinar
 * cuál corresponde a cuál escena.
 *
 * Y va la escena anterior y la siguiente como contexto de solo lectura, porque
 * una de las reglas de oficio es «cada escena arranca enlazando con la
 * anterior» y era imposible de cumplir sin verla.
 */
export function instruccionesDeRefinado(
  todas: readonly Scene[],
  objetivos: readonly Scene[],
  reasons: readonly string[],
  notes: readonly { id: string; axis: string; issue: string; fix: string }[],
): string {
  const porId = new Map(notes.map((n) => [n.id, n]));
  const idx = new Map(todas.map((s, i) => [s.id, i]));
  const lineas: string[] = [];
  if (reasons.length > 0) lineas.push(`Motivos generales del juez: ${reasons.join('; ')}`);
  lineas.push('Reescribe SOLO estas escenas, manteniendo su longitud aproximada.');
  for (const s of objetivos) {
    const i = idx.get(s.id) ?? -1;
    const previa = i > 0 ? todas[i - 1] : undefined;
    const siguiente = i >= 0 ? todas[i + 1] : undefined;
    lineas.push('');
    lineas.push(`## ${s.id}`);
    const nota = porId.get(s.id);
    if (nota) {
      lineas.push(`Problema (${nota.axis}): ${nota.issue}`);
      lineas.push(`Arreglo pedido: ${nota.fix}`);
    }
    if (previa) lineas.push(`Escena anterior (NO la reescribas): ${previa.text}`);
    lineas.push(`Texto a reescribir: ${s.text}`);
    if (siguiente) lineas.push(`Escena siguiente (NO la reescribas): ${siguiente.text}`);
  }
  return lineas.join('\n');
}

/**
 * Cuántas veces se le puede pedir lo mismo al modelo. Dos: la del juez y una de
 * insistencia. A la tercera ya no es el modelo teniendo un mal día, es el prompt.
 */
const MAX_VUELTAS = 2;

/**
 * Lo que sigue mal DESPUÉS de reescribir, con la instrucción para el reintento.
 *
 * Existe porque nadie comprobaba que el arreglo se hubiera aplicado: el juez
 * pedía la reparación, el refinado escribía algo, y ahí terminaba la cadena.
 * Visto en producción: una escena que abría con el rótulo «Qué hacer ya:» llegó
 * a la puerta humana con el rótulo intacto, después de pasar por el refinado,
 * con la nota del juez diciendo exactamente que lo quitara.
 *
 * La comprobación es gratis —el linter es determinista, no hay llamada— y por
 * eso puede correr siempre en vez de fiarse de que el modelo obedeció.
 */
export function loQueSigueMal(
  reescritas: readonly Scene[],
  claims: readonly { text: string }[],
  /** título del vídeo: de ahí sale el nombre completo para `apellido_suelto` */
  title?: string,
): Array<{ id: string; axis: string; issue: string; fix: string }> {
  const hits = lintScenes(reescritas, { claims, ...(title !== undefined ? { title } : {}) });
  const malas = new Set(blockingSceneIds(hits));
  return hits
    .filter((h) => malas.has(h.id) && BLOCKING_LINT_KINDS.includes(h.kind))
    .map((h) => ({
      id: h.id,
      axis: h.kind,
      // que el reintento SEPA que ya se intentó: si no, el modelo vuelve a
      // hacer la misma reescritura y el aviso sobrevive otra vuelta
      issue: `sigue igual tras un intento de arreglo: ${h.detail}`,
      fix: ARREGLO_POR_AVISO[h.kind] ?? 'reescribe la escena corrigiendo eso.',
    }));
}

export async function handleScriptRefine(ctx: WorkerContext, data: ScriptRefineJob): Promise<void> {
  const { videoId, patchTargets, reasons, notes, pass = 1 } = data;
  const [video] = await ctx.db.select().from(videos).where(eq(videos.id, videoId));
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);
  if (video.state !== 'guion_borrador') {
    ctx.logger.info(
      { videoId, state: video.state },
      'Refinado omitido: el guion ya no está en borrador',
    );
    return;
  }
  const script = video.master.script;
  if (!script) {
    ctx.logger.warn({ videoId }, 'Sin guion que refinar');
    return;
  }
  const byId = new Map(script.scenes.map((s) => [s.id, s]));
  // nunca se reescriben escenas editadas por el humano
  const targets = patchTargets
    .map((id) => byId.get(id))
    .filter((s): s is Scene => s !== undefined && !s.edited_by_human);
  if (targets.length === 0) {
    ctx.logger.warn({ videoId, patchTargets }, 'Nada que refinar: escenas inexistentes o editadas');
    return;
  }

  const [channel] = await ctx.db.select().from(channels).where(eq(channels.id, video.channelId));
  const profile = channel?.profile;
  if (!profile) {
    ctx.logger.warn({ videoId }, 'Canal sin perfil; no se refina el guion');
    return;
  }

  const result = await ledgeredLlmJson(ctx, {
    videoId,
    channelId: video.channelId,
    op: 'refine',
    system: refineSystem(profile),
    user: instruccionesDeRefinado(script.scenes, targets, reasons, notes ?? []),
    schema: refineOutputSchema,
    mockContext: {
      scenes: targets.map((s) => ({
        id: s.id,
        seed: `${videoId}:${s.id}:refine`,
        words: countWords(s.text),
      })),
    },
  });

  const targetIds = new Set(targets.map((s) => s.id));
  const newTexts = new Map(result.scenes.map((s) => [s.id, s.text]));
  const scenes = script.scenes.map((s) => {
    const text = newTexts.get(s.id);
    // el parche puede haber quitado la palabra a la que apuntaba un efecto
    if (!text || !targetIds.has(s.id)) return s;
    // misma normalización que en la generación: el refinado también escribe
    // texto que se va a locutar
    return normalizaEscena({ ...s, text, ...keepValidIntents(s, text) });
  });
  // La revisión queda obsoleta: el guion que juzgó ya no es este. Marcarla evita
  // que el fingerprint la dé por buena, y que refine y judge se llamen en bucle.
  const master: MasterVideoJson = {
    ...video.master,
    script: { ...script, scenes },
    ...(video.master.script_review
      ? { script_review: { ...video.master.script_review, stale: true } }
      : {}),
  };
  // escritura condicionada al estado: si el humano aprobó mientras el LLM
  // trabajaba, el guion aprobado no se pisa (puerta 2 intocable)
  const updated = await ctx.db
    .update(videos)
    .set({ master, updatedAt: new Date() })
    .where(and(eq(videos.id, videoId), eq(videos.state, 'guion_borrador')))
    .returning({ id: videos.id });
  if (updated.length === 0) {
    ctx.logger.warn({ videoId }, 'Refinado descartado: el estado cambió durante la reescritura');
    return;
  }
  // ¿Se aplicó el arreglo? Hasta ahora nadie lo comprobaba: el juez pedía la
  // reparación, el refinado escribía algo y ahí terminaba la cadena. Visto en
  // producción: una escena que abría con el rótulo «Qué hacer ya:» llegó a la
  // puerta humana con el rótulo intacto después de pasar por el refinado, con
  // la nota del juez diciendo exactamente que lo quitara.
  //
  // La comprobación es GRATIS —el linter es determinista, no hay llamada— y
  // solo se reintenta lo que sigue mal, con tope de una vuelta: si a la segunda
  // el modelo tampoco lo arregla, es un problema de prompt y lo verá el humano
  // en la puerta, que para eso está.
  const otraVuelta = loQueSigueMal(
    scenes.filter((s) => targetIds.has(s.id)),
    video.master.research?.claims ?? [],
    video.master.seo?.titles[video.master.seo.chosen_idx ?? 0],
  );
  if (otraVuelta.length > 0 && pass < MAX_VUELTAS) {
    await ctx.queues.script.add(JOBS.script.refine, {
      videoId,
      patchTargets: otraVuelta.map((n) => n.id),
      reasons,
      notes: otraVuelta,
      pass: pass + 1,
    } satisfies ScriptRefineJob);
  } else if (otraVuelta.length > 0) {
    ctx.logger.warn(
      { videoId, escenas: otraVuelta.map((n) => n.id) },
      'El refinado no consiguió quitar el aviso duro; el guion llega a la puerta con él',
    );
  }

  await ctx.publishEvent({
    type: 'job_progress',
    video_id: videoId,
    queue: QUEUES.script,
    progress: 100,
    detail:
      otraVuelta.length > 0 && pass < MAX_VUELTAS
        ? `Guion refinado en ${targets.length} escenas; ${otraVuelta.length} necesitan otra vuelta`
        : `Guion refinado en ${targets.length} escenas`,
  });
  await ctx.publishEvent({ type: 'inbox_changed' });
}
