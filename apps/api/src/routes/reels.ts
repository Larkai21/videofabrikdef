import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { channels, reels, transitionReel } from '@fabrica/db';
import {
  JOBS,
  QUEUES,
  reelPlanUpdateRequestSchema,
  type ReelDetailDto,
  type ReelDto,
  type ReelState,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';

// Reels del módulo editor: A-roll PROPIO + guion de dirección JSON. El humano
// sube los dos, la máquina prepara (transcripción + plan) y se para en
// plan_listo — LA puerta del pipeline. El render solo arranca con una firma.

type ReelRow = typeof reels.$inferSelect;

function toDto(row: ReelRow): ReelDto {
  const rendido = row.outputDir !== null && row.state === 'hecho';
  const rel = `outputs/reels/${row.id}`;
  const portada = rendido && existsSync(path.join(row.outputDir as string, 'portada.jpg'));
  return {
    id: row.id,
    channel_id: row.channelId,
    state: row.state as ReelState,
    title: row.title,
    formato: row.formato as ReelDto['formato'],
    duration_ms: row.durationMs,
    plan_capas: row.plan === null ? null : row.plan.length,
    video_url: rendido ? `/files/${rel}/final.mp4` : null,
    portada_url: portada ? `/files/${rel}/portada.jpg` : null,
    incident: row.incident
      ? { message: row.incident.message, suggested_action: row.incident.suggested_action }
      : null,
    created_at: row.createdAt.toISOString(),
  };
}

function toDetailDto(row: ReelRow): ReelDetailDto {
  return {
    ...toDto(row),
    plan: (row.plan as ReelDetailDto['plan']) ?? null,
    guion: row.guion,
  };
}

async function loadReel(ctx: ApiContext, id: string): Promise<ReelRow> {
  const [row] = await ctx.db.select().from(reels).where(eq(reels.id, id)).limit(1);
  if (!row) throw notFound(`Reel ${id} no existe`);
  return row;
}

export function registerReelRoutes(app: FastifyInstance, ctx: ApiContext): void {
  // Alta: multipart con el A-roll (file) + campos channel_id, guion (JSON del
  // contrato de apps/editor/guiones/CONTRATO.md), title? y formato?. El guion
  // se congela aquí: regenerar el plan lo relee, no lo reescribe.
  app.post('/reels', async (req) => {
    const fields: Record<string, string> = {};
    let tmpPath: string | null = null;
    let filename = '';

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        filename = part.filename;
        const tmpDir = path.join(ctx.libraryDir, 'reels', '.tmp');
        await mkdir(tmpDir, { recursive: true });
        tmpPath = path.join(tmpDir, nanoid());
        await pipeline(part.file, createWriteStream(tmpPath));
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    const cleanup = async () => {
      if (tmpPath) await rm(tmpPath, { force: true });
    };

    if (!tmpPath || !filename) throw badRequest('Falta el A-roll en el multipart');
    const channelId = fields.channel_id;
    if (!channelId) {
      await cleanup();
      throw badRequest('Falta el campo channel_id');
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
    if (!fields.guion) {
      await cleanup();
      throw badRequest('Falta el campo guion (JSON de dirección)');
    }
    let guion: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(fields.guion);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('el guion debe ser un objeto');
      }
      guion = parsed as Record<string, unknown>;
    } catch (err) {
      await cleanup();
      throw badRequest(`El guion no es JSON válido: ${err instanceof Error ? err.message : ''}`);
    }
    const formato = fields.formato ?? '9:16';
    if (!['9:16', '16:9', '1:1'].includes(formato)) {
      await cleanup();
      throw badRequest(`Formato desconocido: ${formato}`);
    }

    const id = nanoid();
    const reelDir = path.join(ctx.libraryDir, 'reels', id);
    await mkdir(reelDir, { recursive: true });
    // la extensión original se conserva: el editor hace probe, no adivina
    const ext = path.extname(filename) || '.mp4';
    const arollPath = path.join(reelDir, `input${ext}`);
    await rename(tmpPath, arollPath);
    // copia del guion a disco junto al material: el módulo editor trabaja
    // contra ficheros y así un build es auditable sin abrir la BD
    await writeFile(path.join(reelDir, 'guion.json'), JSON.stringify(guion, null, 2));

    await ctx.db.insert(reels).values({
      id,
      channelId,
      title:
        fields.title?.trim() ||
        (typeof guion.titulo === 'string' ? guion.titulo : path.basename(filename, ext)),
      formato,
      arollPath,
      guion,
      // .nosync: iCloud no sincroniza esos directorios. Lección aprendida del
      // propio editor: los frames por capa son miles de PNG y las copias de
      // conflicto de iCloud envenenaban montajes
      buildDir: path.join(reelDir, 'build.nosync'),
    });

    await ctx.enqueuer.enqueue(
      QUEUES.edit,
      JOBS.edit.prepare,
      { reelId: id },
      { dedupeId: `reel-prepare-${id}` },
    );
    return { reel_id: id };
  });

  app.get('/reels', async () => {
    const rows = await ctx.db.select().from(reels).orderBy(desc(reels.createdAt));
    return { reels: rows.map(toDto) };
  });

  app.get('/reels/:id', async (req) => {
    const { id } = req.params as { id: string };
    return toDetailDto(await loadReel(ctx, id));
  });

  // Editar el plan: SOLO en plan_listo — es la puerta. La BD es la fuente de
  // verdad del plan aprobado; el worker lo vuelca a build/plan.json al
  // renderizar, así el render usa exactamente lo que se firmó.
  app.patch('/reels/:id/plan', async (req) => {
    const { id } = req.params as { id: string };
    const body = reelPlanUpdateRequestSchema.parse(req.body);
    const row = await loadReel(ctx, id);
    if (row.state !== 'plan_listo') {
      throw conflict(`El plan solo se edita con el reel en plan_listo (estado: ${row.state})`);
    }
    await ctx.db
      .update(reels)
      .set({ plan: body.plan, updatedAt: new Date() })
      .where(eq(reels.id, id));
    return { ok: true as const, capas: body.plan.length };
  });

  // Aprobar y renderizar: la firma humana. Compensación como en shorts: si el
  // encolado falla tras la transición, el reel cae a incidencia reintentable
  // en vez de quedarse en 'render' esperando un job que no existe.
  app.post('/reels/:id/render', async (req) => {
    const { id } = req.params as { id: string };
    const row = await loadReel(ctx, id);
    if (row.plan === null || row.plan.length === 0) {
      throw conflict('El reel no tiene plan todavía');
    }
    await transitionReel(ctx.db, id, 'render', { expectFrom: 'plan_listo' });
    try {
      await ctx.enqueuer.enqueue(
        QUEUES.edit,
        JOBS.edit.render,
        { reelId: id },
        { dedupeId: `reel-render-${id}` },
      );
    } catch (err) {
      await transitionReel(ctx.db, id, 'incidencia', {
        incident: {
          message: 'No se pudo encolar el render',
          suggested_action: 'reintentar',
          job: { queue: QUEUES.edit, name: JOBS.edit.render, data: { reelId: id } },
        },
      }).catch(() => {});
      throw err;
    }
    await ctx.events.publish({ type: 'reel_state', reel_id: id, state: 'render' });
    // la puerta del plan se cierra al firmar
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const };
  });

  // Volver a preparar: regenera el plan releyendo el guion congelado (p. ej.
  // tras descubrir en la puerta que el cruce guion↔grabación salió mal).
  app.post('/reels/:id/preparar', async (req) => {
    const { id } = req.params as { id: string };
    await transitionReel(ctx.db, id, 'preparando', { expectFrom: 'plan_listo' });
    await ctx.enqueuer.enqueue(
      QUEUES.edit,
      JOBS.edit.prepare,
      { reelId: id },
      { dedupeId: `reel-prepare-${id}` },
    );
    await ctx.events.publish({ type: 'reel_state', reel_id: id, state: 'preparando' });
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const };
  });

  // Reintento de incidencia: mismo contrato que episodios — volver al estado
  // donde se falló y re-encolar el job exacto que la incidencia dejó apuntado.
  app.post('/reels/:id/retry', async (req) => {
    const { id } = req.params as { id: string };
    const row = await loadReel(ctx, id);
    if (row.state !== 'incidencia') {
      throw conflict(`Solo se reintenta un reel en incidencia (estado: ${row.state})`);
    }
    const volverA = (row.stateBeforeIncident as ReelState | null) ?? 'nuevo';
    await transitionReel(ctx.db, id, volverA, { expectFrom: 'incidencia' });
    const job = row.incident?.job;
    await ctx.enqueuer.enqueue(
      (job?.queue as (typeof QUEUES)[keyof typeof QUEUES] | undefined) ?? QUEUES.edit,
      job?.name ?? JOBS.edit.prepare,
      { reelId: id, ...(job?.data ?? {}) },
      { dedupeId: `reel-retry-${id}-${Date.now()}` },
    );
    await ctx.events.publish({ type: 'reel_state', reel_id: id, state: volverA });
    return { ok: true as const };
  });
}
