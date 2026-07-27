import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { channels, components } from '@fabrica/db';
import {
  channelSettingsSchema,
  componentDtoSchema,
  componentManifestV1,
  JOBS,
  QUEUES,
  type ChannelSettings,
  type ComponentDto,
  type ComponentsValidateJob,
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
