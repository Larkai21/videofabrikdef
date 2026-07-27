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
import { componentManifestV1 } from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { badRequest, notFound } from '../lib/errors.js';

const execFileAsync = promisify(execFile);

// No hay dependencia de zip declarada en el paquete: se usa el binario `unzip`
// del sistema (presente en macOS y en la imagen Debian del VPS). La validación
// completa (typecheck de props + render de humo de 60 frames) llega en S2.

export function registerComponentRoutes(app: FastifyInstance, ctx: ApiContext): void {
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

    if (!zipPath) throw badRequest('Falta el zip en el multipart');
    const channelId = fields.channel_id;
    if (!channelId) {
      await rm(zipPath, { force: true });
      throw badRequest('Falta el campo channel_id');
    }
    // channel_id forma parte de la ruta de extracción: alfabeto cerrado y
    // existencia en BD antes de tocar disco (manifest.type y name ya vienen
    // constreñidos por el esquema componentManifestV1)
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(channelId)) {
      await rm(zipPath, { force: true });
      throw badRequest('channel_id inválido');
    }
    const [channel] = await ctx.db
      .select({ id: channels.id })
      .from(channels)
      .where(eq(channels.id, channelId))
      .limit(1);
    if (!channel) {
      await rm(zipPath, { force: true });
      throw notFound(`El canal ${channelId} no existe`);
    }

    let manifestRaw: string;
    try {
      const { stdout } = await execFileAsync('unzip', ['-p', zipPath, 'manifest.json']);
      manifestRaw = stdout;
    } catch {
      throw badRequest('No se pudo leer manifest.json del zip');
    }

    let manifest;
    try {
      manifest = componentManifestV1.parse(JSON.parse(manifestRaw));
    } catch (error) {
      throw badRequest(
        `manifest.json inválido: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const destDir = path.join(
      ctx.libraryDir,
      'components',
      channelId,
      manifest.type,
      `${manifest.name}@${manifest.component_version}`,
    );
    await mkdir(destDir, { recursive: true });
    try {
      await execFileAsync('unzip', ['-o', zipPath, '-d', destDir]);
    } catch {
      throw badRequest('No se pudo extraer el zip');
    }

    const id = nanoid();
    const log = 'validación completa en S2';
    const [row] = await ctx.db
      .insert(components)
      .values({
        id,
        channelId,
        type: manifest.type,
        name: manifest.name,
        version: manifest.component_version,
        path: destDir,
        manifest,
        status: 'validated',
        log,
      })
      .onConflictDoUpdate({
        target: [components.channelId, components.name, components.version],
        set: { manifest, path: destDir, status: 'validated', log, type: manifest.type },
      })
      .returning();

    return reply.code(201).send({
      ok: true as const,
      component: {
        id: row?.id ?? id,
        type: manifest.type,
        name: manifest.name,
        version: manifest.component_version,
        status: 'validated',
        log,
      },
    });
  });
}
