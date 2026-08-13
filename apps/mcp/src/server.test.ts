// Integración del servidor MCP con el client del propio SDK (transporte en
// memoria). Los tests contra la API viva se saltan si no hay API escuchando,
// para que la suite sea verde también sin `pnpm dev`.

import { afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createApi, DEFAULT_API_URL } from './api.js';
import { buildServer } from './server.js';

const EXPECTED_TOOLS = [
  'inbox_status',
  'list_ideas',
  'approve_idea',
  'discard_idea',
  'get_video',
  'choose_title',
  'approve_script',
  'request_rewrite',
  'timeline_status',
  'approve_beat',
  'discard_beat',
  'approve_timeline',
  'retry_video',
  'publish_video',
  'library_search',
  'production_costs',
  // clips de episodios: la puerta de curación vía agente
  'list_episode_clips',
  'propose_episode_clips',
  'propose_episode_clip_window',
  'approve_clip',
  'discard_clip',
  // reels (módulo editor): el agente como director antes de la firma
  'list_reels',
  'get_reel',
  'create_reel',
  'update_reel_plan',
  'approve_reel_render',
  'regenerate_reel_plan',
  'retry_reel',
];

interface ToolText {
  text: string;
  isError: boolean;
}

async function connectClient(server: McpServer): Promise<Client> {
  const client = new Client({ name: 'fabrica-mcp-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolText> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content?: { type: string; text?: string }[];
    isError?: boolean;
  };
  const text = (res.content ?? [])
    .flatMap((c) => (c.type === 'text' && typeof c.text === 'string' ? [c.text] : []))
    .join('\n');
  return { text, isError: res.isError === true };
}

const baseUrl = process.env.FABRICA_API_URL ?? DEFAULT_API_URL;
const apiAlive = await fetch(`${baseUrl}/inbox`).then(
  (res) => res.ok,
  () => false,
);

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of closers) await close();
});

describe('catálogo de herramientas', () => {
  it('expone las 27 herramientas (16 de S3 + 4 de clips + 7 de reels)', async () => {
    const server = buildServer(createApi(baseUrl));
    const client = await connectClient(server);
    closers.push(() => client.close(), () => server.close());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
    for (const tool of tools) {
      expect(tool.description, `descripción de ${tool.name}`).toBeTruthy();
    }
  });
});

describe('degradación sin API', () => {
  it('inbox_status devuelve un aviso claro en vez de lanzar', async () => {
    // puerto sin nadie escuchando: la herramienta debe degradar con texto claro
    const server = buildServer(createApi('http://127.0.0.1:59999'));
    const client = await connectClient(server);
    closers.push(() => client.close(), () => server.close());
    const out = await callTool(client, 'inbox_status');
    expect(out.isError).toBe(true);
    expect(out.text).toContain('No se pudo conectar con la API');
    expect(out.text).toContain('http://127.0.0.1:59999');
  });
});

describe.runIf(apiAlive)('integración con la API viva', () => {
  it('inbox_status devuelve la bandeja con coste del mes', async () => {
    const server = buildServer(createApi(baseUrl));
    const client = await connectClient(server);
    closers.push(() => client.close(), () => server.close());

    const inbox = await callTool(client, 'inbox_status');
    expect(inbox.isError).toBe(false);
    const parsed = JSON.parse(inbox.text) as { coste_del_mes: { total_usd: number } };
    expect(parsed).toHaveProperty('puertas_pendientes');
    expect(parsed).toHaveProperty('en_curso');
    expect(parsed).toHaveProperty('entregas');
    expect(typeof parsed.coste_del_mes.total_usd).toBe('number');

    const ideas = await callTool(client, 'list_ideas', {});
    expect(ideas.isError).toBe(false);
    const ideasParsed = JSON.parse(ideas.text) as { total: number; ideas: { id: string }[] };
    expect(typeof ideasParsed.total).toBe('number');

    // get_video con un vídeo real si la bandeja o /ideas dan alguno; si no,
    // con un id inexistente esperando el 404 legible
    const detail = JSON.parse(inbox.text) as {
      puertas_pendientes: { video_id: string | null }[];
      en_curso: { video_id: string }[];
      entregas: { video_id: string }[];
    };
    const videoId =
      detail.en_curso[0]?.video_id ??
      detail.entregas[0]?.video_id ??
      detail.puertas_pendientes.find((g) => g.video_id)?.video_id ??
      null;

    if (videoId) {
      const video = await callTool(client, 'get_video', { video_id: videoId });
      expect(video.isError).toBe(false);
      const videoParsed = JSON.parse(video.text) as { id: string; estado: string };
      expect(videoParsed.id).toBe(videoId);
      expect(videoParsed.estado).toBeTruthy();
    } else {
      const missing = await callTool(client, 'get_video', { video_id: 'no-existe-mcp-test' });
      expect(missing.isError).toBe(true);
      expect(missing.text).toContain('no existe');
    }

    const costs = await callTool(client, 'production_costs', {});
    expect(costs.isError).toBe(false);
    expect(JSON.parse(costs.text)).toHaveProperty('coste_total_usd');

    const pastMonth = await callTool(client, 'production_costs', { month: '2024-01' });
    expect(pastMonth.isError).toBe(true);
    expect(pastMonth.text).toContain('mes en curso');

    const library = await callTool(client, 'library_search', { q: 'server' });
    expect(library.isError).toBe(false);
    expect(JSON.parse(library.text)).toHaveProperty('assets');
  });
});
