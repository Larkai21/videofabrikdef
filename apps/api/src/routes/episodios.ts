import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { episodes, shorts, transitionEpisode } from '@fabrica/db';
import {
  episodeClaimRequestSchema,
  episodeCreateRequestSchema,
  episodeFocusRequestSchema,
  JOBS,
  QUEUES,
  type EpisodeDto,
  type EpisodeEncuadresDto,
  type EpisodesListDto,
} from '@fabrica/shared';
import type { ApiContext } from '../lib/context.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { shortToDto } from './shorts.js';

const ejec = promisify(execFile);

/** Las tres x candidatas del encuadre; el humano elige entre ellas. */
const ENCUADRES: { id: 'izq' | 'centro' | 'dcha'; x: number }[] = [
  { id: 'izq', x: 0.25 },
  { id: 'centro', x: 0.5 },
  { id: 'dcha', x: 0.75 },
];

// Episodios externos (clipping): pegar una URL, ver el progreso de descarga y
// transcripción, y desde `listo` proponer clips. El material es ajeno: la
// fuente completa se guarda desde el día 1 (es el registro de defensa ante
// reclamaciones) y la atribución viaja después en cada short.

type EpisodeRow = typeof episodes.$inferSelect;

function plataformaDe(url: string): 'youtube' | 'twitch' | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
      return 'youtube';
    }
    if (host === 'twitch.tv' || host.endsWith('.twitch.tv')) return 'twitch';
    return null;
  } catch {
    return null;
  }
}

function toDto(row: EpisodeRow): EpisodeDto {
  return {
    id: row.id,
    channel_id: row.channelId,
    state: row.state as EpisodeDto['state'],
    source_url: row.sourceUrl,
    source_platform: row.sourcePlatform,
    source_title: row.sourceTitle,
    source_channel_name: row.sourceChannelName,
    license_status: row.licenseStatus as EpisodeDto['license_status'],
    duration_ms: row.durationMs,
    focus_x: row.focus?.x ?? null,
    claims: row.claims,
    incident: row.incident
      ? { message: row.incident.message, suggested_action: row.incident.suggested_action }
      : null,
    downloaded_at: row.downloadedAt?.toISOString() ?? null,
    transcribed_at: row.transcribedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

export function registerEpisodeRoutes(app: FastifyInstance, ctx: ApiContext): void {
  // Alta por URL: crea la fila y encola la descarga. El mismo episodio
  // (plataforma + id de vídeo) no se ingiere dos veces — el índice único lo
  // garantiza cuando la descarga resuelve el id; aquí se corta antes por URL.
  app.post('/episodios', async (req) => {
    const body = episodeCreateRequestSchema.parse(req.body);
    const plataforma = plataformaDe(body.url);
    if (plataforma === null) {
      throw badRequest('Solo YouTube y Twitch por ahora');
    }
    const [duplicado] = await ctx.db
      .select({ id: episodes.id })
      .from(episodes)
      .where(eq(episodes.sourceUrl, body.url))
      .limit(1);
    if (duplicado) {
      return { episode_id: duplicado.id, ya_existia: true as const };
    }
    const id = nanoid();
    await ctx.db.insert(episodes).values({
      id,
      channelId: body.channel_id,
      sourceUrl: body.url,
      sourcePlatform: plataforma,
    });
    await ctx.enqueuer.enqueue(
      QUEUES.media,
      JOBS.media.download,
      { episodeId: id },
      { dedupeId: `episode-download-${id}` },
    );
    return { episode_id: id, ya_existia: false as const };
  });

  app.get('/episodios', async (): Promise<EpisodesListDto> => {
    const rows = await ctx.db.select().from(episodes).orderBy(desc(episodes.createdAt));
    return { episodes: rows.map(toDto) };
  });

  app.get('/episodios/:id', async (req): Promise<EpisodeDto> => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!row) throw notFound(`Episodio ${id} no existe`);
    return toDto(row);
  });

  // Reintento desde incidencia: vuelve al estado en el que se falló y
  // re-encola el job exacto que la incidencia dejó apuntado.
  app.post('/episodios/:id/retry', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!row) throw notFound(`Episodio ${id} no existe`);
    if (row.state !== 'incidencia') {
      throw conflict(`Solo se reintenta un episodio en incidencia (estado: ${row.state})`);
    }
    const volverA = (row.stateBeforeIncident ?? 'nuevo') as Parameters<
      typeof transitionEpisode
    >[2];
    await transitionEpisode(ctx.db, id, volverA, { expectFrom: 'incidencia' });
    const job = row.incident?.job;
    await ctx.enqueuer.enqueue(
      QUEUES.media,
      job?.name ?? JOBS.media.download,
      { episodeId: id, ...(job?.data ?? {}) },
      { dedupeId: `episode-retry-${id}-${Date.now()}` },
    );
    return { ok: true as const };
  });

  // Los tres encuadres candidatos: cada uno es una TIRA con la misma x en tres
  // instantes (10/50/90 %), porque un episodio multicámara cambia de plano y
  // el foco fijo tiene que elegirse viendo varias tomas, no una. Se generan a
  // demanda con ffmpeg (utilidad, no cuerpo) y se sirven por /files/library.
  app.get('/episodios/:id/encuadres', async (req): Promise<EpisodeEncuadresDto> => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!row) throw notFound(`Episodio ${id} no existe`);
    if (row.mediaPath === null || !fs.existsSync(row.mediaPath)) {
      throw conflict('El episodio aún no tiene vídeo descargado');
    }
    const durMs = row.durationMs ?? 0;
    const dir = path.join(path.dirname(row.mediaPath), 'encuadres');
    fs.mkdirSync(dir, { recursive: true });

    const W = row.width ?? 1920;
    const H = row.height ?? 1080;
    const cropW = Math.round((H * 9) / 16);
    const instantes = [0.1, 0.5, 0.9].map((f) => Math.max(1, Math.round((durMs * f) / 1000)));

    for (const e of ENCUADRES) {
      const destino = path.join(dir, `${e.id}.jpg`);
      if (fs.existsSync(destino)) continue;
      const x = Math.min(W - cropW, Math.max(0, Math.round(W * e.x - cropW / 2)));
      const trozos: string[] = [];
      for (const [i, t] of instantes.entries()) {
        const frame = path.join(dir, `.${e.id}-${i}.jpg`);
        await ejec('ffmpeg', [
          '-nostdin',
          '-loglevel',
          'error',
          '-ss',
          String(t),
          '-i',
          row.mediaPath,
          '-frames:v',
          '1',
          '-vf',
          `crop=${cropW}:${H}:${x}:0,scale=304:540`,
          '-q:v',
          '4',
          '-y',
          frame,
        ]);
        trozos.push(frame);
      }
      await ejec('ffmpeg', [
        '-nostdin',
        '-loglevel',
        'error',
        ...trozos.flatMap((f) => ['-i', f]),
        '-filter_complex',
        '[0][1][2]hstack=3',
        '-q:v',
        '4',
        '-y',
        destino,
      ]);
      for (const f of trozos) fs.rmSync(f, { force: true });
    }

    // la ruta relativa a libraryDir es lo que /files/library sirve
    const rel = path.relative(ctx.libraryDir, dir);
    return {
      opciones: ENCUADRES.map((e) => ({
        id: e.id,
        x: e.x,
        url: `/files/library/${rel}/${e.id}.jpg`,
      })),
      elegido_x: row.focus?.x ?? null,
    };
  });

  // La elección: entre candidatos, no un asa. Se puede re-elegir mientras no
  // haya clips propuestos (los clips congelan su encuadre al proponerse).
  app.post('/episodios/:id/focus', async (req) => {
    const { id } = req.params as { id: string };
    const body = episodeFocusRequestSchema.parse(req.body);
    const [row] = await ctx.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!row) throw notFound(`Episodio ${id} no existe`);
    await ctx.db
      .update(episodes)
      .set({ focus: { x: body.x }, updatedAt: new Date() })
      .where(eq(episodes.id, id));
    // la puerta «Clips · proponer» de la bandeja deriva su texto del encuadre;
    // sin este aviso la ficha seguiría pidiendo elegirlo hasta el refetch de
    // respaldo (30 s)
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const, x: body.x };
  });

  // Archivar: purga el mp4 grande (quedan wav + transcript + los pre-cortes
  // de los clips, que por eso archivar no los rompe). Es una decisión humana
  // CONSCIENTE — después no se pueden proponer más clips ni re-elegir
  // encuadre, y por eso no hay disparador automático: la máquina no decide
  // cuándo un episodio está exprimido.
  app.post('/episodios/:id/archivar', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!row) throw notFound(`Episodio ${id} no existe`);
    const propuestos = await ctx.db
      .select({ id: shorts.id })
      .from(shorts)
      .where(and(eq(shorts.episodeId, id), eq(shorts.state, 'propuesto')))
      .limit(1);
    if (propuestos.length > 0) {
      throw conflict('Hay clips propuestos esperando decisión: apruébalos o descártalos antes de archivar');
    }
    await transitionEpisode(ctx.db, id, 'archivado', { expectFrom: 'listo' });
    // primero la transición, luego el disco: si el rm falla, el episodio ya
    // no propone clips y el fichero huérfano se limpia a mano sin incidencia
    if (row.mediaPath !== null && fs.existsSync(row.mediaPath)) {
      fs.rmSync(row.mediaPath, { force: true });
    }
    await ctx.db
      .update(episodes)
      .set({ mediaPath: null, archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(episodes.id, id));
    await ctx.events.publish({ type: 'episode_state', episode_id: id, state: 'archivado' });
    await ctx.events.publish({ type: 'inbox_changed' });
    return { ok: true as const };
  });

  // Propuesta de clips: mismo contrato que los shorts de vídeo («proponer
  // otros» excluye descartadas con motivo Y vivas).
  app.post('/episodios/:id/clips', async (req) => {
    const { id } = req.params as { id: string };
    const [row] = await ctx.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!row) throw notFound(`Episodio ${id} no existe`);
    if (row.state !== 'listo') {
      throw conflict(`Los clips salen de un episodio listo (estado actual: ${row.state})`);
    }
    if (row.focus === null) {
      throw conflict('Elige el encuadre del episodio antes de proponer clips');
    }
    const previos = await ctx.db
      .select({
        fromMs: shorts.fromMs,
        toMs: shorts.toMs,
        state: shorts.state,
        discardReason: shorts.discardReason,
      })
      .from(shorts)
      .where(eq(shorts.episodeId, id));
    const excluir = previos.map((s) =>
      s.state === 'descartado'
        ? {
            from_ms: s.fromMs,
            to_ms: s.toMs,
            ...(s.discardReason !== null ? { reason: s.discardReason } : {}),
          }
        : { from_ms: s.fromMs, to_ms: s.toMs, reason: 'ya propuesta o aprobada' },
    );
    const vivos = previos.filter((s) => s.state !== 'descartado').length;
    const res = await ctx.enqueuer.enqueue(
      QUEUES.highlights,
      JOBS.highlights.propose,
      {
        episodeId: id,
        ...(excluir.length > 0 ? { excluir } : {}),
        ...(vivos === 0 ? {} : { force: true }),
      },
      { dedupeId: `highlights-${id}` },
    );
    return { ok: true as const, ya_en_curso: !res.enqueued };
  });

  app.get('/episodios/:id/clips', async (req) => {
    const { id } = req.params as { id: string };
    const rows = await ctx.db
      .select()
      .from(shorts)
      .where(eq(shorts.episodeId, id))
      .orderBy(asc(shorts.idx));
    return { shorts: rows.map(shortToDto) };
  });

  // Registro manual de una reclamación: el historial de defensa del episodio.
  // No dispara nada; si la acción es retirar un short, eso se hace en su
  // pantalla. Política documentada: no disputar por defecto, retirar si el
  // creador lo pide.
  app.post('/episodios/:id/claim', async (req) => {
    const { id } = req.params as { id: string };
    const body = episodeClaimRequestSchema.parse(req.body ?? {});
    const [row] = await ctx.db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
    if (!row) throw notFound(`Episodio ${id} no existe`);
    const claim = {
      date: new Date().toISOString(),
      kind: body.kind,
      action: body.action,
      ...(body.note !== undefined && body.note !== '' ? { note: body.note } : {}),
    };
    await ctx.db
      .update(episodes)
      .set({ claims: [...row.claims, claim], updatedAt: new Date() })
      .where(eq(episodes.id, id));
    return { ok: true as const, claims: row.claims.length + 1 };
  });
}
