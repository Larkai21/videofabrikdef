import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { channels, components } from '@fabrica/db';
import {
  channelSettingsSchema,
  componentManifestV1,
  componentTypeSchema,
  QUEUES,
  type ComponentManifest,
  type ComponentsValidateJob,
  type ComponentType,
} from '@fabrica/shared';
import { webpackOverride } from '@fabrica/video/bundling';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { WorkerContext } from '../../lib/context.js';
import { videoSrcLock } from '../../lib/locks.js';
import {
  buildDeterminismEslintConfig,
  buildHarnessSource,
  buildHarnessTsconfig,
  schemaImportPathFor,
} from './harness.js';

// Validador de zips del brand kit (SPEC §10, docs/render.md §2):
//   a) typecheck real (tsc del workspace packages/video + bundle esbuild)
//      + reglas de determinismo (eslint de packages/video sobre el zip)
//   b) contrato de props en runtime (schema.parse de las props mínimas)
//   c) regeneración del registry (copia a src/kit + registry.generated.ts)
//   d) render de humo (fixed_duration_frames del manifest, 60 por defecto,
//      tope 300) + preview.png
// Sin coste externo: no se abren filas del ledger. Los fallos de validación
// son resultado de negocio (status failed, sin reintentos); solo los errores
// de infraestructura llegan a los reintentos de BullMQ.

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const MAX_LOG_CHARS = 8_000;

function videoPackageDir(): string {
  // igual que el worker de render: localiza packages/video via el subpath
  // exportado, sin asumir la estructura del repo
  const entry = require.resolve('@fabrica/video/entry');
  return path.resolve(path.dirname(entry), '..');
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(bin: string, args: string[], cwd: string): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: unknown; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? String(err),
    };
  }
}

function lastJsonLine(stdout: string): unknown {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) return null;
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface RegistrySpecEntry {
  type: ComponentType;
  name: string;
  version: string;
  source_dir: string;
}

// Re-sincroniza src/kit y registry.generated.ts desde la BD. Se llama al
// arrancar los workers: un clon nuevo o un despliegue sin src/kit se
// auto-repara sin esperar a la siguiente validación.
export async function syncRegistryFromDb(ctx: WorkerContext): Promise<void> {
  const videoPkg = videoPackageDir();
  const tsx = path.join(videoPkg, 'node_modules', '.bin', 'tsx');
  if (!fs.existsSync(tsx)) {
    ctx.logger.warn('Sin toolchain en packages/video; no se sincroniza el registry del kit');
    return;
  }
  const rows = await ctx.db.select().from(components).where(eq(components.status, 'validated'));
  const byRef = new Map<string, RegistrySpecEntry>();
  for (const r of rows) {
    const parsedType = componentTypeSchema.safeParse(r.type);
    if (!parsedType.success) continue;
    const key = `${r.name}@${r.version}`;
    if (!byRef.has(key)) {
      byRef.set(key, {
        type: parsedType.data,
        name: r.name,
        version: r.version,
        source_dir: r.path,
      });
    }
  }
  const specDir = path.join(videoPkg, '.kit-validate');
  // poda de arranque: restos de validaciones interrumpidas (no hay ninguna
  // validación en vuelo cuando el worker arranca)
  await fsp.rm(specDir, { recursive: true, force: true }).catch(() => {});
  await fsp.mkdir(specDir, { recursive: true });
  const specPath = path.join(specDir, 'boot-sync.registry-spec.json');
  await fsp.writeFile(specPath, JSON.stringify({ components: [...byRef.values()] }, null, 2));
  const res = await run(tsx, [path.join(videoPkg, 'scripts', 'generate-registry.ts'), specPath], videoPkg);
  if (res.code !== 0) {
    ctx.logger.warn(
      { stderr: res.stderr.slice(0, 500) },
      'La sincronización del registry del kit falló',
    );
  } else {
    ctx.logger.info({ componentes: byRef.size }, 'Registry del brand kit sincronizado desde la BD');
  }
}

// Activa un componente para su tipo en el canal (settings.brand_components).
// Espejo de POST /components/:id/activate, para la auto-activación del worker.
async function activateForChannel(
  ctx: WorkerContext,
  channelId: string,
  type: ComponentType,
  reference: string,
): Promise<void> {
  const [channelRow] = await ctx.db
    .select({ settings: channels.settings })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!channelRow) return;
  const current = channelSettingsSchema.parse(channelRow.settings ?? {});
  const merged = channelSettingsSchema.parse({
    ...current,
    brand_components: { ...current.brand_components, [type]: reference },
  });
  await ctx.db.update(channels).set({ settings: merged }).where(eq(channels.id, channelId));
}

export async function handleComponentsValidate(
  ctx: WorkerContext,
  job: Job<ComponentsValidateJob>,
): Promise<void> {
  const { componentId } = job.data;
  const log = ctx.logger.child({ componentId, queue: QUEUES.components });

  const [row] = await ctx.db
    .select()
    .from(components)
    .where(eq(components.id, componentId))
    .limit(1);
  if (!row) {
    log.warn('Componente no encontrado en BD; job ignorado');
    return;
  }
  const reference = `${row.name}@${row.version}`;

  const publishProgress = async (progress: number, detail: string) => {
    await ctx.publishEvent({
      type: 'job_progress',
      video_id: componentId,
      queue: QUEUES.components,
      progress,
      detail,
    });
  };

  const failValidation = async (phase: string, detail: string) => {
    const trimmed =
      detail.length > MAX_LOG_CHARS
        ? `${detail.slice(0, MAX_LOG_CHARS)}\n… (log recortado)`
        : detail;
    await ctx.db
      .update(components)
      .set({ status: 'failed', log: `[${phase}]\n${trimmed}`, previewPath: null })
      .where(eq(components.id, componentId));
    await publishProgress(100, `Validación fallida: ${phase}`);
    await ctx.publishEvent({ type: 'inbox_changed' });
    log.warn({ phase }, 'Validación de componente fallida');
  };

  const videoPkg = videoPackageDir();
  const tools = {
    tsc: path.join(videoPkg, 'node_modules', '.bin', 'tsc'),
    esbuild: path.join(videoPkg, 'node_modules', '.bin', 'esbuild'),
    tsx: path.join(videoPkg, 'node_modules', '.bin', 'tsx'),
    eslint: path.join(videoPkg, 'node_modules', '.bin', 'eslint'),
  };
  const missingTools = Object.entries(tools)
    .filter(([, bin]) => !fs.existsSync(bin))
    .map(([name]) => name);
  if (missingTools.length > 0) {
    // modo degradado: sin toolchain la validación queda apagada con log claro,
    // nunca rompe el pipeline de vídeo
    const message =
      `Faltan binarios en packages/video/node_modules/.bin (${missingTools.join(', ')}): ` +
      'instala las dependencias del workspace (pnpm install) y vuelve a subir el zip.';
    log.error({ missingTools }, 'Validación de componentes apagada: falta el toolchain');
    await failValidation('herramientas', message);
    return;
  }

  const regenerateRegistry = async (includeCurrent: boolean): Promise<RunResult> => {
    const validatedRows = await ctx.db
      .select()
      .from(components)
      .where(eq(components.status, 'validated'));
    const byRef = new Map<string, RegistrySpecEntry>();
    if (includeCurrent) {
      byRef.set(reference, {
        type: row.type as ComponentType,
        name: row.name,
        version: row.version,
        source_dir: row.path,
      });
    }
    for (const r of validatedRows) {
      if (r.id === componentId) continue; // el actual ya se decidió arriba
      const parsedType = componentTypeSchema.safeParse(r.type);
      if (!parsedType.success) {
        log.warn({ component: r.id, type: r.type }, 'Componente con tipo inválido; fuera del registry');
        continue;
      }
      const key = `${r.name}@${r.version}`;
      // colisión nombre@versión entre canales: manda el componente en curso
      if (byRef.has(key)) continue;
      byRef.set(key, {
        type: parsedType.data,
        name: r.name,
        version: r.version,
        source_dir: r.path,
      });
    }
    const specPath = path.join(videoPkg, '.kit-validate', `${componentId}.registry-spec.json`);
    await fsp.writeFile(specPath, JSON.stringify({ components: [...byRef.values()] }, null, 2));
    return run(tools.tsx, [path.join(videoPkg, 'scripts', 'generate-registry.ts'), specPath], videoPkg);
  };

  try {
    const startedAt = Date.now();
    const phaseTimes: string[] = [];
    let phaseStart = Date.now();
    const tick = (label: string) => {
      phaseTimes.push(`${label} ${((Date.now() - phaseStart) / 1000).toFixed(1)} s`);
      phaseStart = Date.now();
    };

    // ---- preparación: workdir dentro de packages/video para que react,
    // remotion y zod resuelvan bajo pnpm al compilar e importar el schema
    const workRoot = path.join(videoPkg, '.kit-validate');
    await fsp.mkdir(workRoot, { recursive: true });
    const workRootIgnore = path.join(workRoot, '.gitignore');
    if (!fs.existsSync(workRootIgnore)) await fsp.writeFile(workRootIgnore, '*\n');
    const workdir = path.join(workRoot, componentId);
    await fsp.rm(workdir, { recursive: true, force: true });
    await fsp.mkdir(workdir, { recursive: true });
    const componentWorkDir = path.join(workdir, 'component');
    await fsp.cp(row.path, componentWorkDir, { recursive: true });

    let manifest: ComponentManifest;
    try {
      const manifestRaw = await fsp.readFile(path.join(componentWorkDir, 'manifest.json'), 'utf8');
      manifest = componentManifestV1.parse(JSON.parse(manifestRaw));
    } catch (err) {
      await failValidation('estructura', `manifest.json ilegible o inválido: ${errorMessage(err)}`);
      return;
    }
    if (
      manifest.type !== row.type ||
      manifest.name !== row.name ||
      manifest.component_version !== row.version
    ) {
      await failValidation(
        'estructura',
        `El manifest (${manifest.type} ${manifest.name}@${manifest.component_version}) no coincide con la fila (${row.type} ${reference})`,
      );
      return;
    }
    if (!fs.existsSync(path.join(componentWorkDir, 'Component.tsx'))) {
      await failValidation('estructura', 'Falta Component.tsx en la raíz del zip');
      return;
    }
    const schemaImport = schemaImportPathFor(manifest);
    if (schemaImport === null) {
      await failValidation(
        'estructura',
        `props_schema inválido en el manifest: '${manifest.props_schema}' (debe ser un .ts relativo dentro del zip)`,
      );
      return;
    }
    const schemaAbs = path.join(componentWorkDir, path.posix.normalize(manifest.props_schema));
    if (!fs.existsSync(schemaAbs)) {
      await failValidation('estructura', `No existe el schema declarado: ${manifest.props_schema}`);
      return;
    }

    // ---- a) typecheck real contra el contrato (tsc + bundle esbuild)
    await publishProgress(5, 'Compilando el componente contra el contrato');
    await fsp.writeFile(
      path.join(workdir, 'harness.ts'),
      buildHarnessSource(manifest.type, schemaImport),
    );
    await fsp.writeFile(
      path.join(workdir, 'tsconfig.json'),
      buildHarnessTsconfig(path.join(videoPkg, 'tsconfig.json')),
    );
    const tscRes = await run(tools.tsc, ['--noEmit', '--pretty', 'false', '-p', workdir], workdir);
    if (tscRes.code !== 0) {
      // log EXACTO del compilador
      await failValidation('typecheck', `${tscRes.stdout}\n${tscRes.stderr}`.trim());
      return;
    }
    const esRes = await run(
      tools.esbuild,
      [
        'harness.ts',
        '--bundle',
        '--format=esm',
        '--platform=browser',
        '--jsx=automatic',
        '--outfile=harness.bundle.mjs',
        '--log-level=warning',
        '--external:react',
        '--external:react-dom',
        '--external:react/jsx-runtime',
        '--external:remotion',
        '--external:zod',
      ],
      workdir,
    );
    if (esRes.code !== 0) {
      await failValidation('esbuild', `${esRes.stderr}\n${esRes.stdout}`.trim());
      return;
    }
    tick('typecheck');

    // ---- a2) determinismo: las MISMAS reglas de eslint de packages/video
    // (sin Math.random, relojes, timers ni fetch) sobre el código del zip
    await publishProgress(20, 'Comprobando las reglas de determinismo del render');
    const eslintConfigPath = path.join(workdir, 'eslint.config.determinismo.mjs');
    await fsp.writeFile(
      eslintConfigPath,
      buildDeterminismEslintConfig(path.join(videoPkg, 'eslint.config.js')),
    );
    const lintRes = await run(
      tools.eslint,
      ['--config', 'eslint.config.determinismo.mjs', 'component'],
      workdir,
    );
    if (lintRes.code !== 0) {
      // log EXACTO de eslint
      await failValidation('determinismo', `${lintRes.stdout}\n${lintRes.stderr}`.trim());
      return;
    }
    tick('determinismo');

    // ---- b) contrato de props en runtime (schema.parse del ejemplo mínimo)
    await publishProgress(35, 'Verificando el contrato de props');
    const ctRes = await run(
      tools.tsx,
      [path.join(videoPkg, 'scripts', 'check-contract.ts'), schemaAbs, manifest.type],
      videoPkg,
    );
    const contract = lastJsonLine(ctRes.stdout) as {
      ok?: boolean;
      reason?: string;
      sample?: Record<string, unknown>;
    } | null;
    if (ctRes.code !== 0 || contract === null) {
      await failValidation(
        'contrato de props',
        `check-contract no devolvió resultado: ${`${ctRes.stderr}\n${ctRes.stdout}`.trim()}`,
      );
      return;
    }
    if (contract.ok !== true) {
      await failValidation('contrato de props', contract.reason ?? 'contrato rechazado');
      return;
    }
    const sampleProps = contract.sample ?? {};
    tick('contrato');

    // ---- c) registry: copia a src/kit + registry.generated.ts (estado
    // completo: todos los validados más el que se está validando). El candado
    // serializa la mutación del árbol con el bundle del worker de render.
    await publishProgress(55, 'Regenerando el registry del brand kit');
    const previewPath = path.join(row.path, 'preview.png');
    const releaseVideoSrc = await videoSrcLock.acquire();
    try {
    const regRes = await regenerateRegistry(true);
    const regOut = lastJsonLine(regRes.stdout) as {
      ok?: boolean;
      error?: string;
      skipped?: string[];
    } | null;
    if (regRes.code !== 0 || regOut === null || regOut.ok !== true) {
      await failValidation(
        'registry',
        regOut?.error ?? `generate-registry falló: ${`${regRes.stderr}\n${regRes.stdout}`.trim()}`,
      );
      return;
    }
    const skippedCurrent = (regOut.skipped ?? []).find((s) => s.startsWith(reference));
    if (skippedCurrent !== undefined) {
      await failValidation('registry', `El registry omitió el componente: ${skippedCurrent}`);
      return;
    }
    tick('registry');

    // ---- d) render de humo + preview.png: la duración respeta el
    // fixed_duration_frames del manifest (60 por defecto, tope 300)
    const smokeFrames = Math.min(300, Math.max(1, manifest.fixed_duration_frames ?? 60));
    await publishProgress(70, `Render de humo de ${smokeFrames} frames`);
    try {
      await ensureBrowser();
      // bundle fresco en cada validación: el registry acaba de cambiar y la
      // corrección importa más que el minuto de webpack (cola concurrencia 1)
      const serveUrl = await bundle({
        entryPoint: path.join(videoPkg, 'src', 'kit-smoke-entry.ts'),
        publicDir: path.join(videoPkg, 'public'),
        // bajo el workdir: el finally del validador lo barre siempre (sin
        // outDir, bundle() dejaría un temporal huérfano por validación)
        outDir: path.join(workdir, 'bundle'),
        webpackOverride,
      });
      const inputProps = {
        kit_type: manifest.type,
        reference,
        sample_props: sampleProps,
        smoke_frames: smokeFrames,
      };
      if (manifest.type === 'thumbnail_template') {
        // miniaturas: un solo frame 1280×720 con renderStill
        const still = await selectComposition({ serveUrl, id: 'KitThumb', inputProps });
        await renderStill({
          composition: still,
          serveUrl,
          output: previewPath,
          imageFormat: 'png',
          inputProps,
        });
      } else {
        const composition = await selectComposition({ serveUrl, id: 'KitSmoke', inputProps });
        await renderMedia({
          composition,
          serveUrl,
          codec: 'h264',
          crf: 18,
          pixelFormat: 'yuv420p',
          concurrency: 2,
          inputProps,
          outputLocation: path.join(workdir, 'smoke.mp4'),
        });
        await renderStill({
          composition,
          serveUrl,
          frame: 0,
          output: previewPath,
          imageFormat: 'png',
          inputProps,
        });
      }
    } catch (err) {
      // el humo falló con el componente ya copiado al kit: se revierte el
      // registry al estado sin él antes de marcar el fallo
      try {
        const rollback = await regenerateRegistry(false);
        if (rollback.code !== 0) {
          log.error(
            { stderr: rollback.stderr.slice(0, 500) },
            'El rollback del registry terminó con error; el boot-sync lo reparará',
          );
        }
      } catch (rollbackErr) {
        log.error({ err: rollbackErr }, 'No se pudo revertir el registry tras el fallo de humo');
      }
      await failValidation('render de humo', errorMessage(err));
      return;
    }
    tick(`humo (${smokeFrames} frames)`);
    } finally {
      releaseVideoSrc();
    }

    const totalS = ((Date.now() - startedAt) / 1000).toFixed(1);
    const logText = `Validación correcta · ${phaseTimes.join(' · ')} · total ${totalS} s`;
    await ctx.db
      .update(components)
      .set({ status: 'validated', log: logText, previewPath })
      .where(eq(components.id, componentId));

    // auto-activación (components.author): un componente escrito por la IA se
    // activa para su tipo en cuanto valida, sin intervención humana. La subida
    // manual de zips NO trae autoActivate: la activa el humano desde el kit.
    if (job.data.autoActivate === true) {
      try {
        await activateForChannel(ctx, row.channelId, row.type as ComponentType, reference);
        log.info({ reference }, 'Componente de IA activado automáticamente');
      } catch (err) {
        log.warn({ err, reference }, 'No se pudo auto-activar el componente de IA');
      }
    }

    await publishProgress(100, 'Componente validado');
    await ctx.publishEvent({ type: 'inbox_changed' });
    log.info({ reference, previewPath }, 'Componente del brand kit validado');
  } catch (err) {
    const message = `Fallo de infraestructura validando el componente: ${errorMessage(err)}`;
    log.error({ err }, message);
    // dentro del procesador attemptsMade cuenta los intentos ANTERIORES
    const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    if (isFinal) {
      // el registry puede haber quedado con el componente no validado dentro:
      // rollback best-effort desde el estado real de la BD, bajo el candado
      try {
        await videoSrcLock.run(() => syncRegistryFromDb(ctx));
      } catch (rollbackErr) {
        log.error({ err: rollbackErr }, 'No se pudo re-sincronizar el registry tras el fallo');
      }
      try {
        await failValidation('error inesperado', message);
      } catch (failErr) {
        log.error({ err: failErr }, 'No se pudo marcar el componente como fallido');
      }
    }
    throw err;
  } finally {
    // sin fugas: workdir (harness, bundle de humo, mp4) y spec del registry
    // se barren en éxito, fallo de negocio y fallo de infraestructura
    const workRoot = path.join(videoPkg, '.kit-validate');
    await fsp.rm(path.join(workRoot, componentId), { recursive: true, force: true }).catch(() => {});
    await fsp
      .rm(path.join(workRoot, `${componentId}.registry-spec.json`), { force: true })
      .catch(() => {});
  }
}
