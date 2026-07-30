import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
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
        video: { id: videoId, channel_id: channelId, idea_id: ideaId, fps: 30, width: 1920, height: 1080 },
        script: { scenes: [], hook_notes: '' },
        seo: { titles: ['a', 'b', 'c'], chosen_idx: null, description: '', tags: [], thumbnails: [] },
      }),
    });

    const res = await app.inject({ method: 'POST', url: `/videos/${videoId}/approve-script` });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { detail?: string }).detail ?? res.json()).toBeDefined();

    const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
    expect(video?.state).toBe('guion_borrador');
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
