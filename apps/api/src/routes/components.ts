import { execFile } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { and, eq, ne, sql } from 'drizzle-orm';
import { channels, components, videos } from '@fabrica/db';
import {
  AUTHOR_ALL_TYPES,
  buildComponentPrompt,
  channelSettingsSchema,
  componentDtoSchema,
  componentManifestV1,
  componentTypeSchema,
  JOBS,
  QUEUES,
  type ChannelSettings,
  type ComponentDto,
  type ComponentsAuthorJob,
  type ComponentsValidateJob,
  type ComponentType,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { toFileUrl } from '../lib/files.js';

const execFileAsync = promisify(execFile);

// Brand kit por zips (SPEC §10): la API recibe el zip, lo extrae bajo
// library/components/ y encola components.validate; la validación real
// (typecheck, contrato de props, registry, render de humo) vive en el worker.
// No hay dependencia de zip declarada: se usa el binario `unzip` del sistema
// (presente en macOS y en la imagen Debian del VPS).

type ComponentRow = typeof components.$inferSelect;

function refOf(row: ComponentRow): string {
  return `${row.name}@${row.version}`;
}

function toDto(row: ComponentRow, settings: ChannelSettings): ComponentDto {
  // preview animada: el validador escribe preview.mp4 junto a preview.png para
  // los componentes animados (no las miniaturas). Solo se expone si EXISTE en
  // disco (los validados antes de esta función no lo tienen → regenerar preview).
  const previewVideoPath =
    row.previewPath !== null && row.type !== 'thumbnail_template'
      ? path.join(path.dirname(row.previewPath), 'preview.mp4')
      : null;
  const previewVideoUrl =
    previewVideoPath !== null && existsSync(previewVideoPath) ? toFileUrl(previewVideoPath) : null;
  return componentDtoSchema.parse({
    id: row.id,
    channel_id: row.channelId,
    type: row.type,
    name: row.name,
    version: row.version,
    status: row.status,
    log: row.log,
    // el dashboard consume URLs /files, nunca rutas de disco
    preview_url: row.previewPath !== null ? toFileUrl(row.previewPath) : null,
    preview_video_url: previewVideoUrl,
    active: settings.brand_components[row.type] === refOf(row),
    created_at: row.createdAt.toISOString(),
  });
}

export function registerComponentRoutes(app: FastifyInstance, ctx: ApiContext): void {
  // ---- subida del zip: extrae, registra pending y encola la validación
  app.post('/components', async (req, reply) => {
    const fields: Record<string, string> = {};
    let zipPath: string | null = null;

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (!part.filename.toLowerCase().endsWith('.zip')) {
          throw badRequest('El componente debe subirse como zip');
        }
        const incomingDir = path.join(ctx.libraryDir, 'components', 'incoming');
        await mkdir(incomingDir, { recursive: true });
        zipPath = path.join(incomingDir, `${nanoid()}.zip`);
        await pipeline(part.file, createWriteStream(zipPath));
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    const cleanup = async () => {
      if (zipPath !== null) await rm(zipPath, { force: true });
    };

    if (zipPath === null) throw badRequest('Falta el zip en el multipart');
    const channelId = fields.channel_id;
    if (!channelId) {
      await cleanup();
      throw badRequest('Falta el campo channel_id');
    }
    // channel_id forma parte de la ruta de extracción: alfabeto cerrado y
    // existencia en BD antes de tocar disco (manifest.type y name ya vienen
    // constreñidos por componentManifestV1)
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(channelId)) {
      await cleanup();
      throw badRequest('channel_id inválido');
    }
    const [channel] = await ctx.db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);
    if (!channel) {
      await cleanup();
      throw notFound(`El canal ${channelId} no existe`);
    }

    // manifest.json debe estar en la RAÍZ del zip (formato fijo del contrato)
    let manifestRaw: string;
    try {
      const { stdout } = await execFileAsync('unzip', ['-p', zipPath, 'manifest.json']);
      manifestRaw = stdout;
    } catch {
      await cleanup();
      throw badRequest('No se pudo leer manifest.json en la raíz del zip');
    }
    let manifest;
    try {
      manifest = componentManifestV1.parse(JSON.parse(manifestRaw));
    } catch (err) {
      await cleanup();
      throw badRequest(
        `manifest.json inválido: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // una name@version validada es INMUTABLE: re-subirla destruiría la única
    // fuente del componente (library/) y resetearía a pending sin rollback
    // posible; los cambios exigen bump de versión. La unicidad es global (el
    // registry y src/kit se indexan por name@version, sin canal).
    const [existing] = await ctx.db
      .select({ id: components.id, status: components.status, channelId: components.channelId })
      .from(components)
      .where(and(eq(components.name, manifest.name), eq(components.version, manifest.component_version)))
      .limit(1);
    if (existing && existing.channelId !== channelId) {
      await cleanup();
      throw conflict(
        `${manifest.name}@${manifest.component_version} ya existe en otro canal; el nombre@versión es global`,
      );
    }
    if (existing && existing.status === 'validated') {
      await cleanup();
      throw conflict(
        `${manifest.name}@${manifest.component_version} ya está validado; sube una versión nueva (bump de semver)`,
      );
    }

    const destDir = path.join(
      ctx.libraryDir,
      'components',
      channelId,
      manifest.type,
      `${manifest.name}@${manifest.component_version}`,
    );
    // extracción limpia: sin restos de una subida anterior de la misma versión
    await rm(destDir, { recursive: true, force: true });
    await mkdir(destDir, { recursive: true });
    try {
      await execFileAsync('unzip', ['-o', zipPath, '-d', destDir]);
    } catch {
      await cleanup();
      throw badRequest('No se pudo extraer el zip');
    }
    await cleanup();

    const [row] = await ctx.db
      .insert(components)
      .values({
        id: nanoid(),
        channelId,
        type: manifest.type,
        name: manifest.name,
        version: manifest.component_version,
        path: destDir,
        manifest,
        status: 'pending',
        log: null,
        previewPath: null,
      })
      .onConflictDoUpdate({
        target: [components.channelId, components.name, components.version],
        set: {
          manifest,
          path: destDir,
          type: manifest.type,
          status: 'pending',
          log: null,
          previewPath: null,
        },
      })
      .returning();
    if (!row) throw new Error('La inserción del componente no devolvió fila');

    const payload: ComponentsValidateJob = { componentId: row.id };
    await ctx.enqueuer.enqueue(QUEUES.components, JOBS.components.validate, payload);
    await ctx.events.publish({ type: 'inbox_changed' });

    const [channelRow] = await ctx.db
      .select()
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);
    const settings = channelSettingsSchema.parse(channelRow?.settings ?? {});
    return reply.code(201).send({ ok: true as const, component: toDto(row, settings) });
  });

  // ---- listado por canal con el activo resuelto desde settings
  app.get('/components', async (req) => {
    const { channel } = req.query as { channel?: string };
    if (!channel) throw badRequest('Falta el parámetro channel');
    const [channelRow] = await ctx.db
      .select()
      .from(channels)
      .where(eq(channels.id, channel))
      .limit(1);
    if (!channelRow) throw notFound(`El canal ${channel} no existe`);
    const settings = channelSettingsSchema.parse(channelRow.settings ?? {});
    const rows = await ctx.db
      .select()
      .from(components)
      .where(eq(components.channelId, channel))
      .orderBy(components.type, components.name, components.version);
    return { components: rows.map((row) => toDto(row, settings)) };
  });

  // prompt de diseño (SPEC §10): genera el "prompt-contrato" por tipo con los
  // tokens de marca del canal, para diseñar el componente con Claude Design.
  app.get('/components/prompt', async (req) => {
    const { channel, type } = req.query as { channel?: string; type?: string };
    if (!channel) throw badRequest('Falta el parámetro channel');
    const parsedType = componentTypeSchema.safeParse(type);
    if (!parsedType.success) throw badRequest('Tipo de componente inválido');
    const [channelRow] = await ctx.db
      .select()
      .from(channels)
      .where(eq(channels.id, channel))
      .limit(1);
    if (!channelRow) throw notFound(`El canal ${channel} no existe`);
    const profile = channelRow.profile;
    const prompt = buildComponentPrompt(parsedType.data, {
      channel_name: profile?.identity.name ?? channelRow.name,
      ...(profile?.identity.tone ? { tone: profile.identity.tone } : {}),
      ...(profile?.style.visual_prompt_suffix
        ? { visual_prompt_suffix: profile.style.visual_prompt_suffix }
        : {}),
      language: profile?.language === 'en' ? 'en' : 'es',
    });
    return { type: parsedType.data, prompt };
  });

  // ---- autoría por IA (Fase 4): encola components.author para uno o todos los
  // tipos; el worker escribe los ficheros, valida y auto-activa al terminar.
  app.post('/components/author', async (req) => {
    const body = (req.body ?? {}) as { channel?: string; channel_id?: string; type?: string };
    const channelId = body.channel ?? body.channel_id;
    if (!channelId) throw badRequest('Falta el parámetro channel');
    const [channelRow] = await ctx.db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);
    if (!channelRow) throw notFound(`El canal ${channelId} no existe`);

    // sin type (o type='all') se generan todos los tipos que la composición monta
    let types: ComponentType[];
    if (body.type === undefined || body.type === 'all') {
      types = AUTHOR_ALL_TYPES;
    } else {
      const parsed = componentTypeSchema.safeParse(body.type);
      if (!parsed.success) throw badRequest('Tipo de componente inválido');
      types = [parsed.data];
    }

    for (const type of types) {
      const payload: ComponentsAuthorJob = { channelId, type };
      await ctx.enqueuer.enqueue(QUEUES.components, JOBS.components.author, payload);
    }
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const, enqueued: types };
  });

  // ---- regenerar preview: re-encola la validación de un componente existente
  // (útil para los validados antes de la preview animada: regenera preview.mp4
  // + still de frame medio sin re-subir el zip).
  app.post('/components/:id/revalidate', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(components).where(eq(components.id, id)).limit(1);
    if (!row) throw notFound(`El componente ${id} no existe`);
    const payload: ComponentsValidateJob = { componentId: id };
    await ctx.enqueuer.enqueue(QUEUES.components, JOBS.components.validate, payload);
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const };
  });

  // ---- activar: solo componentes validados; actualiza settings.brand_components
  app.post('/components/:id/activate', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(components).where(eq(components.id, id)).limit(1);
    if (!row) throw notFound(`El componente ${id} no existe`);
    if (row.status !== 'validated') {
      throw conflict(`Solo se activan componentes validados (estado actual: ${row.status})`);
    }
    const [channelRow] = await ctx.db
      .select()
      .from(channels)
      .where(eq(channels.id, row.channelId))
      .limit(1);
    if (!channelRow) throw notFound(`El canal ${row.channelId} no existe`);
    const current = channelSettingsSchema.parse(channelRow.settings ?? {});
    const merged = channelSettingsSchema.parse({
      ...current,
      brand_components: { ...current.brand_components, [row.type]: refOf(row) },
    });
    await ctx.db.update(channels).set({ settings: merged }).where(eq(channels.id, row.channelId));
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const };
  });

  // ---- borrar: nunca el activo; limpia el directorio extraído
  app.delete('/components/:id', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(components).where(eq(components.id, id)).limit(1);
    if (!row) throw notFound(`El componente ${id} no existe`);
    const [channelRow] = await ctx.db
      .select()
      .from(channels)
      .where(eq(channels.id, row.channelId))
      .limit(1);
    const settings = channelSettingsSchema.parse(channelRow?.settings ?? {});
    if (settings.brand_components[row.type] === refOf(row)) {
      throw conflict('El componente está activo; activa otro de su tipo antes de borrarlo');
    }
    // los vídeos no terminados llevan la ref congelada en su maestro: borrar
    // el componente los mandaría a incidencia al llegar al render
    const needle = `%"${refOf(row)}"%`;
    const [inUse] = await ctx.db
      .select({ id: videos.id })
      .from(videos)
      .where(
        and(ne(videos.state, 'hecho'), sql`(${videos.master}->'brand')::text LIKE ${needle}`),
      )
      .limit(1);
    if (inUse) {
      throw conflict(
        `El componente lo referencia un vídeo en curso (${inUse.id}); termina o descarta ese vídeo antes de borrarlo`,
      );
    }
    await ctx.db.delete(components).where(eq(components.id, id));
    // borrar en disco solo si la ruta cae bajo library/ (defensa ante filas raras);
    // la copia en packages/video/src/kit se poda en la próxima validación
    const resolved = path.resolve(row.path);
    if (resolved.startsWith(path.resolve(ctx.libraryDir) + path.sep)) {
      await rm(resolved, { recursive: true, force: true });
    }
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const };
  });
}
