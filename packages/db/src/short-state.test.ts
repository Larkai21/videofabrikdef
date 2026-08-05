import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { makeDemoShort } from '@fabrica/shared';
import { createDb } from './index.js';
import { channels, ideas, shorts, videos } from './schema.js';
import { markIncidentShort, transitionShort } from './short-state.js';
import { InvalidTransitionError } from './state.js';

// Contra la BD real local (docker compose). Ids únicos por corrida y limpieza
// al final, igual que apps/api/src/app.test.ts.

const { db, client } = createDb();

const sufijo = Math.random().toString(36).slice(2, 10);
const channelId = `test-ch-short-${sufijo}`;
const videoId = `test-vid-short-${sufijo}`;
const ideaId = `test-idea-short-${sufijo}`;
const creados: string[] = [];
let siguienteIdx = 0;

async function nuevoShort(estado = 'propuesto'): Promise<string> {
  const id = `test-short-${sufijo}-${siguienteIdx}`;
  creados.push(id);
  await db.insert(shorts).values({
    id,
    videoId,
    channelId,
    idx: siguienteIdx++,
    state: estado,
    fromMs: 0,
    toMs: 30_000,
    title: 'Título',
    hook: 'Gancho',
    master: makeDemoShort(),
  });
  return id;
}

async function estadoDe(id: string): Promise<string | undefined> {
  const [row] = await db.select().from(shorts).where(eq(shorts.id, id));
  return row?.state;
}

beforeAll(async () => {
  await db.insert(channels).values({ id: channelId, name: 'Canal de prueba shorts' });
  await db.insert(ideas).values({
    id: ideaId,
    channelId,
    title: 'Idea de prueba para shorts',
    summary: 'Resumen corto',
    score: 70,
    status: 'approved',
    sourceRefs: [{ url: 'https://example.com/nota' }],
  });
  await db.insert(videos).values({
    id: videoId,
    channelId,
    ideaId,
    state: 'hecho',
    master: {
      version: '1',
      video: {
        id: videoId,
        channel_id: channelId,
        idea_id: ideaId,
        fps: 30,
        width: 1920,
        height: 1080,
      },
    },
  });
});

afterAll(async () => {
  if (creados.length > 0) await db.delete(shorts).where(inArray(shorts.id, creados));
  await db.delete(videos).where(eq(videos.id, videoId));
  await db.delete(ideas).where(eq(ideas.id, ideaId));
  await db.delete(channels).where(eq(channels.id, channelId));
  await client.end();
});

describe('transitionShort', () => {
  it('avanza por el camino feliz', async () => {
    const id = await nuevoShort();
    await transitionShort(db, id, 'aprobado', { expectFrom: 'propuesto' });
    expect(await estadoDe(id)).toBe('aprobado');
    await transitionShort(db, id, 'render', { expectFrom: 'aprobado' });
    await transitionShort(db, id, 'hecho', { expectFrom: 'render' });
    expect(await estadoDe(id)).toBe('hecho');
  });

  it('rechaza un salto que la máquina no permite', async () => {
    const id = await nuevoShort();
    await expect(transitionShort(db, id, 'hecho')).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(await estadoDe(id)).toBe('propuesto');
  });

  it('rechaza cuando el estado de partida no es el esperado', async () => {
    const id = await nuevoShort();
    await expect(
      transitionShort(db, id, 'aprobado', { expectFrom: 'incidencia' }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
    expect(await estadoDe(id)).toBe('propuesto');
  });

  // hecho y descartado son terminales: un short entregado no se mueve y uno
  // rechazado se sustituye pidiendo otra propuesta
  it('no deja salir de un estado terminal', async () => {
    const hecho = await nuevoShort('hecho');
    await expect(transitionShort(db, hecho, 'render')).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
    const descartado = await nuevoShort('descartado');
    await expect(transitionShort(db, descartado, 'aprobado')).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });

  it('guarda la incidencia y el estado previo en el mismo update', async () => {
    const id = await nuevoShort('aprobado');
    await markIncidentShort(db, id, { message: 'el render falló', suggested_action: 'reintentar' });

    const [row] = await db.select().from(shorts).where(eq(shorts.id, id));
    expect(row?.state).toBe('incidencia');
    expect(row?.stateBeforeIncident).toBe('aprobado');
    expect(row?.incident?.message).toBe('el render falló');
  });

  it('al salir de incidencia limpia el rastro', async () => {
    const id = await nuevoShort('aprobado');
    await markIncidentShort(db, id, { message: 'fallo', suggested_action: 'reintentar' });
    await transitionShort(db, id, 'aprobado', { expectFrom: 'incidencia' });

    const [row] = await db.select().from(shorts).where(eq(shorts.id, id));
    expect(row?.state).toBe('aprobado');
    expect(row?.stateBeforeIncident).toBeNull();
    expect(row?.incident).toBeNull();
  });

  it('un short que no existe da un error claro', async () => {
    await expect(transitionShort(db, 'no-existe', 'aprobado')).rejects.toThrow(/no encontrado/);
  });
});
