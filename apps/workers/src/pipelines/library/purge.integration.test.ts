import { and, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, describe, expect, it } from 'vitest';
import { assets, beats, channels, createDb, ideas, videos } from '@fabrica/db';
import { makeDemoMaster } from '@fabrica/shared';
import { loadEnv } from '../../lib/env.js';
import { isPurgeCandidate, purgeCandidatesCondition } from './purge.js';

// Test de integración contra el Postgres local (docker compose). Crea sus
// propias filas con ids únicos y las limpia al final. Si la BD no responde,
// se salta entero: los tests puros de purge.test.ts cubren el predicado.

loadEnv();

let bundle: ReturnType<typeof createDb> | null = null;
{
  const candidate = createDb();
  try {
    await Promise.race([
      candidate.db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3_000)),
    ]);
    bundle = candidate;
  } catch {
    bundle = null;
    await candidate.client.end({ timeout: 1 }).catch(() => {});
  }
}

const NOW = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

const run = nanoid(8);
const channelId = `test-purga-ch-${run}`;
const ideaId = `test-purga-idea-${run}`;
const videoId = `test-purga-video-${run}`;
const aOldUnused = `test-purga-a1-${run}`;
const aOldUsed = `test-purga-a2-${run}`;
const aRecent = `test-purga-a3-${run}`;
const aReferenced = `test-purga-a4-${run}`;
const allAssetIds = [aOldUnused, aOldUsed, aRecent, aReferenced];

describe.skipIf(bundle === null)('purgeCandidatesCondition (BD local)', () => {
  afterAll(async () => {
    if (!bundle) return;
    const { db, client } = bundle;
    try {
      await db.delete(beats).where(eq(beats.videoId, videoId));
      await db.delete(videos).where(eq(videos.id, videoId));
      await db.delete(ideas).where(eq(ideas.id, ideaId));
      await db.delete(assets).where(inArray(assets.id, allAssetIds));
      await db.delete(channels).where(eq(channels.id, channelId));
    } finally {
      await client.end();
    }
  });

  it('devuelve exactamente los assets sin uso, antiguos y sin beats', async () => {
    if (!bundle) return;
    const { db } = bundle;

    await db.insert(channels).values({ id: channelId, name: 'Canal de prueba purga' });
    const baseAsset = {
      scope: 'channel',
      channelId,
      kind: 'clip',
      path: `/tmp/no-existe-${run}.mp4`,
      source: 'pexels',
      license: 'Pexels',
      tags: ['prueba'],
    };
    await db.insert(assets).values([
      { ...baseAsset, id: aOldUnused, timesUsed: 0, createdAt: daysAgo(120) },
      { ...baseAsset, id: aOldUsed, timesUsed: 2, createdAt: daysAgo(120) },
      { ...baseAsset, id: aRecent, timesUsed: 0, createdAt: daysAgo(10) },
      { ...baseAsset, id: aReferenced, timesUsed: 0, createdAt: daysAgo(120) },
    ]);
    // cadena mínima para poder referenciar aReferenced desde un beat
    await db.insert(ideas).values({
      id: ideaId,
      channelId,
      title: 'Idea de prueba purga',
      summary: 'Solo para el test de integración',
    });
    await db.insert(videos).values({
      id: videoId,
      channelId,
      ideaId,
      master: makeDemoMaster(),
    });
    await db.insert(beats).values({
      id: `test-purga-beat-${run}`,
      videoId,
      idx: 0,
      fromMs: 0,
      toMs: 8_000,
      text: 'Beat de prueba',
      visualQuery: 'prueba',
      assetId: aReferenced,
    });

    const rows = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.channelId, channelId), purgeCandidatesCondition(NOW)));
    expect(rows.map((r) => r.id)).toEqual([aOldUnused]);

    // paridad con el predicado puro, fila a fila
    const stored = await db.select().from(assets).where(inArray(assets.id, allAssetIds));
    const referenced = new Set([aReferenced]);
    for (const row of stored) {
      const expected = isPurgeCandidate(
        {
          timesUsed: row.timesUsed,
          createdAt: row.createdAt,
          referencedByBeats: referenced.has(row.id),
        },
        NOW,
      );
      expect(expected, row.id).toBe(row.id === aOldUnused);
    }
  });
});
