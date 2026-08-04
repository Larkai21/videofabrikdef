import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { FastifyInstance } from 'fastify';
import { beats, channels, costLedger, createDb, ideas, videos } from '@fabrica/db';
import {
  channelSettingsSchema,
  inboxDtoSchema,
  masterVideoJsonV1,
  type QueueName,
} from '@fabrica/shared';
import { buildApp } from './app.js';
import type { Enqueuer } from './lib/enqueuer.js';
import { createMemoryEventBus } from './lib/events.js';

// Tests contra la BD real local (docker compose). Ids únicos por corrida y
// limpieza al final; el encolado se stubbea para no depender de Redis.

interface EnqueueCall {
  queue: QueueName;
  job: string;
  payload: unknown;
}

function stubEnqueuer(): { calls: EnqueueCall[]; enqueuer: Enqueuer } {
  const calls: EnqueueCall[] = [];
  return {
    calls,
    enqueuer: {
      async enqueue(queue, job, payload) {
        calls.push({ queue, job, payload });
        return { enqueued: true as const };
      },
      async counts() {
        return {};
      },
      async close() {},
    },
  };
}

const bundle = createDb();
const db = bundle.db;
const { calls, enqueuer } = stubEnqueuer();

let app: FastifyInstance;
const channelId = `test-ch-${nanoid(8)}`;
const createdVideoIds: string[] = [];
const createdIdeaIds: string[] = [];

async function insertIdea(): Promise<string> {
  const id = `test-idea-${nanoid(8)}`;
  createdIdeaIds.push(id);
  await db.insert(ideas).values({
    id,
    channelId,
    title: 'Idea de prueba sobre modelos abiertos',
    summary: 'Resumen corto de la idea de prueba',
    score: 80,
    status: 'new',
    sourceRefs: [{ url: 'https://example.com/nota' }],
  });
  return id;
}

beforeAll(async () => {
  await db.insert(channels).values({
    id: channelId,
    name: 'Canal de prueba api',
    settings: channelSettingsSchema.parse({}),
  });
  app = await buildApp({
    db: bundle,
    enqueuer,
    events: createMemoryEventBus(),
    logger: false,
  });
});

afterAll(async () => {
  if (createdVideoIds.length) {
    await db.delete(beats).where(inArray(beats.videoId, createdVideoIds));
    await db.delete(costLedger).where(inArray(costLedger.videoId, createdVideoIds));
    await db.delete(videos).where(inArray(videos.id, createdVideoIds));
  }
  if (createdIdeaIds.length) {
    await db.delete(ideas).where(inArray(ideas.id, createdIdeaIds));
  }
  await db.delete(channels).where(eq(channels.id, channelId));
  await app.close();
  await bundle.client.end();
});

describe('puertas de la API', () => {
  it('aprobar una idea crea el vídeo en idea_aprobada y encola script.generate', async () => {
    const ideaId = await insertIdea();
    const res = await app.inject({ method: 'POST', url: `/ideas/${ideaId}/approve` });
    expect(res.statusCode).toBe(200);

    const videoId = (res.json() as { video_id: string }).video_id;
    expect(videoId).toBeTruthy();
    createdVideoIds.push(videoId);

    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(video?.state).toBe('idea_aprobada');
    expect(video?.master.video.idea_id).toBe(ideaId);

    expect(calls).toContainEqual({
      queue: 'script',
      job: 'generate',
      payload: { videoId },
    });

    const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId));
    expect(idea?.status).toBe('approved');
  });

  it('approve-script en estado equivocado devuelve 409', async () => {
    const ideaId = await insertIdea();
    const videoId = `test-vid-${nanoid(8)}`;
    createdVideoIds.push(videoId);
    await db.update(ideas).set({ status: 'approved' }).where(eq(ideas.id, ideaId));
    await db.insert(videos).values({
      id: videoId,
      channelId,
      ideaId,
      state: 'idea_aprobada',
      master: masterVideoJsonV1.parse({
        version: '1',
        video: {
          id: videoId,
          channel_id: channelId,
          idea_id: ideaId,
          fps: 30,
          width: 1920,
          height: 1080,
        },
      }),
    });

    const res = await app.inject({ method: 'POST', url: `/videos/${videoId}/approve-script` });
    expect(res.statusCode).toBe(409);
    // puede rechazar por falta de guion (guarda de packaging) o por
    // transición inválida: ambas protegen la puerta
    expect(['conflicto de estado', 'transición inválida']).toContain(
      (res.json() as { error: string }).error,
    );

    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(video?.state).toBe('idea_aprobada');
  });

  // Sin esta guarda el vídeo cruza la puerta 2, gasta voz y assets, y muere
  // veinte minutos después en el render pidiendo el título que nadie eligió.
  it('approve-script sin título elegido devuelve 409 y no transiciona', async () => {
    const ideaId = await insertIdea();
    const videoId = `test-vid-${nanoid(8)}`;
    createdVideoIds.push(videoId);
    await db.update(ideas).set({ status: 'approved' }).where(eq(ideas.id, ideaId));
    await db.insert(videos).values({
      id: videoId,
      channelId,
      ideaId,
      state: 'guion_borrador',
      master: masterVideoJsonV1.parse({
        version: '1',
        video: {
          id: videoId,
          channel_id: channelId,
          idea_id: ideaId,
          fps: 30,
          width: 1920,
          height: 1080,
        },
        script: { scenes: [], hook_notes: '' },
        seo: {
          titles: ['a', 'b', 'c'],
          chosen_idx: null,
          description: '',
          tags: [],
          thumbnails: [],
        },
      }),
    });

    const res = await app.inject({ method: 'POST', url: `/videos/${videoId}/approve-script` });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail?: string }).detail ?? res.json()).toBeDefined();

    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(video?.state).toBe('guion_borrador');
  });

  // SPEC §9: «verde = auto-aprobado; ámbar = revisar». La puerta exigía `locked`
  // en todos, así que el humano pulsaba aprobar también en los que la máquina
  // daba por buenos — y la UI ya habilitaba el botón con `auto_ok`, así que el
  // resultado era un 409 con el botón activo.
  it('approve-timeline acepta los beats auto_ok y solo bloquea los que hay que revisar', async () => {
    const ideaId = await insertIdea();
    const videoId = `test-vid-${nanoid(8)}`;
    createdVideoIds.push(videoId);
    await db.update(ideas).set({ status: 'approved' }).where(eq(ideas.id, ideaId));
    await db.insert(videos).values({
      id: videoId,
      channelId,
      ideaId,
      state: 'assets',
      master: masterVideoJsonV1.parse({
        version: '1',
        video: {
          id: videoId,
          channel_id: channelId,
          idea_id: ideaId,
          fps: 30,
          width: 1920,
          height: 1080,
        },
      }),
    });
    const beatRow = (idx: number, status: 'auto_ok' | 'locked' | 'review') => ({
      id: `test-beat-${nanoid(8)}`,
      videoId,
      idx,
      fromMs: idx * 10_000,
      toMs: (idx + 1) * 10_000,
      text: 'texto',
      visualQuery: 'q',
      status,
    });
    await db
      .insert(beats)
      .values([beatRow(0, 'auto_ok'), beatRow(1, 'locked'), beatRow(2, 'review')]);

    // con un beat en review la puerta sigue cerrada, y nombra solo ese
    const cerrada = await app.inject({
      method: 'POST',
      url: `/videos/${videoId}/approve-timeline`,
    });
    expect(cerrada.statusCode).toBe(409);
    expect((cerrada.json() as { detail: string }).detail).toContain('2');
    expect((cerrada.json() as { detail: string }).detail).not.toContain('0');

    // aprobado ese, los auto_ok pasan sin que nadie los toque
    await db
      .update(beats)
      .set({ status: 'locked' })
      .where(and(eq(beats.videoId, videoId), eq(beats.idx, 2)));
    const abierta = await app.inject({
      method: 'POST',
      url: `/videos/${videoId}/approve-timeline`,
    });
    expect(abierta.statusCode).toBe(200);
    const [v] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(v?.state).toBe('timeline_ok');
  });

  it('GET /inbox devuelve un InboxDto válido', async () => {
    await insertIdea();
    const res = await app.inject({ method: 'GET', url: '/inbox' });
    expect(res.statusCode).toBe(200);

    const dto = inboxDtoSchema.parse(res.json());
    expect(dto.month_budget_usd).toBeGreaterThan(0);
    const ideaGate = dto.gates.find((g) => g.kind === 'idea' && g.channel_id === channelId);
    expect(ideaGate).toBeTruthy();
  });
});
