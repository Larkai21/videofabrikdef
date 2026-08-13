import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { execa } from 'execa';
import { markIncidentReel, reels, transitionReel } from '@fabrica/db';
import { JOBS, QUEUES, type EditPrepareJob, type EditRenderJob } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';

// Pipeline de reels: el worker NO edita — orquesta los scripts del módulo
// editor (apps/editor: HTML+GSAP rasterizado con Playwright, composición
// ffmpeg) contra un build aislado por reel (EDITOR_BUILD, el mismo mecanismo
// que piezas.py usa para montar 10 vídeos en paralelo). Los scripts se
// invocan como procesos (execa), nunca como imports: la regla «los workers no
// importan de apps/*» se mantiene — esto es un sidecar, como transcribe-mlx.
//
// Estados: prepare lleva nuevo→preparando→plan_listo (transcripción, rostro,
// cruce guion↔grabación, apretado de silencios, validación); LA PUERTA es
// plan_listo. render lleva plan_listo→render→hecho volcando ANTES el plan de
// la BD a build/plan.json: el render usa exactamente lo que el humano firmó.

/** Raíz del módulo editor. En el monorepo vive en apps/editor. */
function editorDir(): string {
  return process.env.EDITOR_DIR ?? path.resolve(process.cwd(), '..', 'editor');
}

/** Python del venv del editor (mlx-whisper, Vision). Patrón STT_MLX_PYTHON. */
function editorPython(): string {
  return process.env.EDITOR_PYTHON ?? path.join(editorDir(), '.venv', 'bin', 'python3');
}

async function runEditor(
  ctx: WorkerContext,
  reelId: string,
  buildDir: string,
  cmd: string[],
  paso: string,
): Promise<void> {
  ctx.logger.info({ reelId, paso, cmd: cmd.join(' ') }, 'editor: paso');
  const [bin, ...args] = cmd;
  await execa(bin as string, args, {
    cwd: editorDir(),
    env: { ...process.env, EDITOR_BUILD: buildDir },
    // los scripts del editor «no se callan»: su stderr es diagnóstico, no ruido
    stderr: 'inherit',
    stdout: 'inherit',
  });
}

type ReelRow = typeof reels.$inferSelect;

async function loadReel(ctx: WorkerContext, reelId: string): Promise<ReelRow> {
  const [row] = await ctx.db.select().from(reels).where(eq(reels.id, reelId)).limit(1);
  if (!row) throw new Error(`Reel no encontrado: ${reelId}`);
  return row;
}

export async function handlePrepare(ctx: WorkerContext, job: Job<EditPrepareJob>): Promise<void> {
  const { reelId } = job.data;
  const reel = await loadReel(ctx, reelId);
  if (reel.state !== 'nuevo' && reel.state !== 'preparando') {
    ctx.logger.warn({ reelId, state: reel.state }, 'prepare ignorado: estado no preparable');
    return;
  }
  if (reel.arollPath === null || !existsSync(reel.arollPath)) {
    throw new Error(`El A-roll del reel ${reelId} no está en disco: ${reel.arollPath ?? '∅'}`);
  }
  // .nosync: iCloud ignora el directorio (miles de PNG por build; ver la
  // misma decisión en el propio editor con su symlink build→build.nosync)
  const buildDir = reel.buildDir ?? path.join(path.dirname(reel.arollPath), 'build.nosync');
  await mkdir(buildDir, { recursive: true });
  const guionPath = path.join(path.dirname(reel.arollPath), 'guion.json');
  if (!existsSync(guionPath)) {
    // la copia en disco la escribe la API al alta; si falta (fila antigua),
    // se regenera desde la BD, que es la fuente congelada
    await writeFile(guionPath, JSON.stringify(reel.guion, null, 2));
  }

  try {
    if (reel.state === 'nuevo') {
      await transitionReel(ctx.db, reelId, 'preparando', { expectFrom: 'nuevo' });
      await ctx.publishEvent({ type: 'reel_state', reel_id: reelId, state: 'preparando' });
    }
    const py = editorPython();

    // 1. transcripción con word timestamps (idempotente contra disco)
    if (!existsSync(path.join(buildDir, 'transcript.json'))) {
      await runEditor(
        ctx,
        reelId,
        buildDir,
        [py, 'scripts/transcribe_mlx.py', '--input', reel.arollPath],
        'transcribir',
      );
    }
    // 2. limpieza → timeline.json (keep[] + words[]); --audio apunta al origen
    //    para que timeline.source deje al compositor encontrar el metraje
    await runEditor(
      ctx,
      reelId,
      buildDir,
      [py, 'scripts/clean_transcript.py', '--audio', reel.arollPath],
      'limpiar',
    );
    // 3. rostro (zonas seguras para colocar grafismo)
    if (!existsSync(path.join(buildDir, 'face.json'))) {
      await runEditor(
        ctx,
        reelId,
        buildDir,
        [py, 'scripts/detect_face_bbox.py', '--input', reel.arollPath],
        'rostro',
      );
    }
    // 4. cruce guion↔grabación → plan.json (aborta si <25 % literal)
    await runEditor(
      ctx,
      reelId,
      buildDir,
      [py, 'scripts/leer_guion.py', guionPath, '--escribir'],
      'plan',
    );
    // 5. apretado de silencios: remapea plan y timeline JUNTOS
    await runEditor(
      ctx,
      reelId,
      buildDir,
      [py, 'scripts/silencios.py', '--fuente', reel.arollPath, '--aplicar'],
      'silencios',
    );
    // 6. puerta barata antes de molestar al humano
    await runEditor(
      ctx,
      reelId,
      buildDir,
      [py, 'scripts/validar_plan.py', path.join(buildDir, 'plan.json')],
      'validar',
    );

    const plan = JSON.parse(await readFile(path.join(buildDir, 'plan.json'), 'utf8')) as Record<
      string,
      unknown
    >[];
    await ctx.db
      .update(reels)
      .set({ plan, buildDir, updatedAt: new Date() })
      .where(eq(reels.id, reelId));
    await transitionReel(ctx.db, reelId, 'plan_listo', { expectFrom: 'preparando' });
    await ctx.publishEvent({ type: 'reel_state', reel_id: reelId, state: 'plan_listo' });
    await ctx.publishEvent({ type: 'inbox_changed' });
  } catch (err) {
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      await markIncidentReel(ctx.db, reelId, {
        message: err instanceof Error ? err.message : 'Fallo preparando el reel',
        suggested_action: 'reintentar',
        job: { queue: QUEUES.edit, name: JOBS.edit.prepare, data: { reelId } },
      });
      await ctx.publishEvent({ type: 'reel_state', reel_id: reelId, state: 'incidencia' });
    }
    throw err;
  }
}

export async function handleRender(ctx: WorkerContext, job: Job<EditRenderJob>): Promise<void> {
  const { reelId } = job.data;
  const reel = await loadReel(ctx, reelId);
  if (reel.state === 'hecho') {
    ctx.logger.info({ reelId }, 'render duplicado ignorado: el reel ya está hecho');
    return;
  }
  if (reel.state !== 'render') {
    throw new Error(`El render espera un reel en 'render' (estado: ${reel.state})`);
  }
  if (reel.plan === null || reel.buildDir === null) {
    throw new Error(`El reel ${reelId} no tiene plan o build preparados`);
  }
  const buildDir = reel.buildDir;
  const outDir = path.join(ctx.outputsDir, 'reels', reelId);
  await mkdir(outDir, { recursive: true });

  try {
    // el plan firmado en la BD ES el que se renderiza: se vuelca al build
    // pisando lo que hubiera (el humano pudo editar capas en la puerta)
    const planPath = path.join(buildDir, 'plan.json');
    await writeFile(planPath, JSON.stringify(reel.plan, null, 2));

    // 1. rasterizado por capas (Playwright abre SU Chromium; concurrency 1)
    await runEditor(
      ctx,
      reelId,
      buildDir,
      [
        'node',
        'scripts/render_playwright.js',
        '--build',
        buildDir,
        '--plan',
        planPath,
        '--formato',
        reel.formato,
      ],
      'rasterizar',
    );
    // 2. composición: esquiva el rostro con lo ya rasterizado (no re-renderiza)
    await runEditor(ctx, reelId, buildDir, [editorPython(), 'scripts/colocar.py', '--aplicar'], 'colocar');
    // 3. composición ffmpeg. El LUT es explícito por diseño del editor:
    //    REEL_LUT lo cambia; 'none' = sin grado, honesto por defecto
    await runEditor(
      ctx,
      reelId,
      buildDir,
      [
        editorPython(),
        'scripts/composite_ffmpeg.py',
        '--lut',
        process.env.REEL_LUT ?? 'none',
        '--output',
        path.join(outDir, 'final.mp4'),
        ...(reel.formato !== '9:16' ? ['--formato', reel.formato] : []),
      ],
      'componer',
    );
    // 4. portada: candidatas puntuadas de la pieza compuesta
    await runEditor(
      ctx,
      reelId,
      buildDir,
      [
        editorPython(),
        'scripts/portada.py',
        '--input',
        path.join(outDir, 'final.mp4'),
        '--salida',
        path.join(outDir, 'portada.jpg'),
      ],
      'portada',
    );

    await ctx.db
      .update(reels)
      .set({ outputDir: outDir, updatedAt: new Date() })
      .where(eq(reels.id, reelId));
    await transitionReel(ctx.db, reelId, 'hecho', { expectFrom: 'render' });
    await ctx.publishEvent({ type: 'reel_state', reel_id: reelId, state: 'hecho' });
    await ctx.publishEvent({ type: 'inbox_changed' });
  } catch (err) {
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      await markIncidentReel(ctx.db, reelId, {
        message: err instanceof Error ? err.message : 'Fallo renderizando el reel',
        suggested_action: 'reintentar',
        job: { queue: QUEUES.edit, name: JOBS.edit.render, data: { reelId } },
      });
      await ctx.publishEvent({ type: 'reel_state', reel_id: reelId, state: 'incidencia' });
    }
    throw err;
  }
}

export async function registerReelsWorkers(ctx: WorkerContext): Promise<Worker[]> {
  const worker = new Worker(
    QUEUES.edit,
    async (job) => {
      if (job.name === JOBS.edit.prepare) {
        await handlePrepare(ctx, job as Job<EditPrepareJob>);
        return;
      }
      if (job.name === JOBS.edit.render) {
        await handleRender(ctx, job as Job<EditRenderJob>);
        return;
      }
      ctx.logger.warn({ job: job.name }, 'Job desconocido en la cola de edit');
    },
    // concurrency 1: el render del editor abre su propio Chromium y una
    // composición ffmpeg pesada; no debe competir consigo mismo
    { connection: ctx.connection, concurrency: 1 },
  );
  return [worker];
}
