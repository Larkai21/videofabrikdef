import { Worker, type Job } from 'bullmq';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { assets, shorts, videos } from '@fabrica/db';
import {
  encuadreDe,
  fronterasFuertes,
  JOBS,
  QUEUES,
  recortarMaster,
  renderableMasterV1,
  SHORTS_PER_VIDEO,
  type ShortFraming,
  type ShortsProposeJob,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { directShorts, efectosPorBeat } from './director.js';

// Worker de propuesta de shorts. Lee un vídeo ya ENTREGADO, pide al director
// qué fragmentos funcionan solos y guarda un candidato por cada uno con su
// maestro vertical ya recortado y congelado.
//
// No toca la máquina de estados del vídeo: `hecho` es terminal y meterlo en
// `incidencia` porque falle una propuesta de short desharía una entrega buena.

/** Encuadre por ruta de asset, resuelto desde lo que la biblioteca ya sabe. */
async function encuadresDe(
  ctx: WorkerContext,
  rutas: string[],
): Promise<Map<string, ShortFraming>> {
  const mapa = new Map<string, ShortFraming>();
  if (rutas.length === 0) return mapa;
  const filas = await ctx.db
    .select({
      path: assets.path,
      width: assets.width,
      height: assets.height,
      kind: assets.kind,
      // el pie de foto del VLM es lo que delata un plano que ES una pantalla
      caption: assets.caption,
      tags: assets.tags,
    })
    .from(assets)
    .where(inArray(assets.path, rutas));
  for (const fila of filas) mapa.set(fila.path, encuadreDe(fila));
  return mapa;
}

async function handleProposeShorts(ctx: WorkerContext, job: Job<ShortsProposeJob>): Promise<void> {
  const { videoId, excluir, force } = job.data;
  const log = ctx.logger.child({ videoId, queue: QUEUES.shorts });

  const [video] = await ctx.db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!video) throw new Error(`Vídeo no encontrado: ${videoId}`);
  if (video.state !== 'hecho') {
    log.info({ state: video.state }, 'Los shorts se recortan de un vídeo entregado; job ignorado');
    return;
  }

  // idempotencia: un job duplicado no vuelve a proponer sobre lo ya propuesto
  if (force !== true) {
    const vivos = await ctx.db
      .select({ id: shorts.id })
      .from(shorts)
      .where(and(eq(shorts.videoId, videoId), ne(shorts.state, 'descartado')));
    if (vivos.length > 0) {
      log.info({ vivos: vivos.length }, 'El vídeo ya tiene propuestas de short; job ignorado');
      return;
    }
  }

  const parsed = renderableMasterV1.safeParse(video.master);
  if (!parsed.success) {
    // NO se marca incidencia en el vídeo: `hecho` es terminal y el vídeo está
    // entregado; el problema es de esta propuesta, no de la entrega
    const message = 'El maestro del vídeo no está completo; no se pueden recortar shorts';
    log.warn({ issues: parsed.error.issues.slice(0, 3) }, message);
    await ctx.publishEvent({
      type: 'incident',
      video_id: videoId,
      queue: QUEUES.shorts,
      message,
      suggested_action: 'regenerar',
    });
    return;
  }
  const master = parsed.data;

  const beats = efectosPorBeat(master.beats, master.edits ?? []);
  const candidatos = await directShorts(ctx, {
    videoId,
    channelId: video.channelId,
    videoTitle:
      video.titleChosen ?? master.seo.titles[master.seo.chosen_idx ?? 0] ?? master.seo.titles[0],
    ...(master.script?.hook_notes !== undefined ? { hookNotes: master.script.hook_notes } : {}),
    beats,
    fronteras: fronterasFuertes(master),
    ...(excluir !== undefined ? { excluir } : {}),
    cuantos: SHORTS_PER_VIDEO,
  });

  if (candidatos.length === 0) {
    log.warn(
      { beats: beats.length },
      'El director no encontró ningún fragmento que funcione solo; 0 propuestas',
    );
    await ctx.publishEvent({ type: 'inbox_changed' });
    return;
  }

  const rutas = [
    ...new Set(
      master.beats.flatMap((b) => [
        ...(b.asset?.path !== undefined ? [b.asset.path] : []),
        ...(b.visuals ?? []).flatMap((sv) => (sv.asset?.path !== undefined ? [sv.asset.path] : [])),
      ]),
    ),
  ];
  const encuadres = await encuadresDe(ctx, rutas);

  // el índice sigue a los que ya existan: los descartados conservan el suyo
  const previos = await ctx.db
    .select({ idx: shorts.idx })
    .from(shorts)
    .where(eq(shorts.videoId, videoId));
  let siguienteIdx = previos.reduce((max, s) => Math.max(max, s.idx + 1), 0);

  const creados = candidatos.map((c) => {
    const id = nanoid(12);
    return {
      id,
      videoId,
      channelId: video.channelId,
      idx: siguienteIdx++,
      state: 'propuesto',
      fromMs: c.from_ms,
      toMs: c.to_ms,
      title: c.title,
      hook: c.hook,
      reason: c.reason,
      score: c.score,
      master: recortarMaster(master, {
        id,
        from_ms: c.from_ms,
        to_ms: c.to_ms,
        title: c.title,
        hook: c.hook,
        reason: c.reason,
        score: c.score,
        encuadres,
      }),
    };
  });

  await ctx.db.insert(shorts).values(creados);

  for (const s of creados) {
    await ctx.publishEvent({
      type: 'short_state',
      short_id: s.id,
      video_id: videoId,
      state: 'propuesto',
    });
  }
  await ctx.publishEvent({ type: 'inbox_changed' });
  log.info({ propuestos: creados.length }, 'Shorts propuestos');
}

export async function registerShortsWorkers(ctx: WorkerContext): Promise<Worker[]> {
  const worker = new Worker(
    QUEUES.shorts,
    async (job) => {
      if (job.name === JOBS.shorts.propose) {
        await handleProposeShorts(ctx, job as Job<ShortsProposeJob>);
        return;
      }
      ctx.logger.warn({ job: job.name }, 'Job desconocido en la cola de shorts');
    },
    { connection: ctx.connection, concurrency: 1 },
  );
  return [worker];
}
