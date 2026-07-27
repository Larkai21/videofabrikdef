// Prueba de humo por stdio real: lanza `tsx src/server.ts` como subproceso,
// habla JSON-RPC por stdin/stdout con el client del SDK y ejercita
// inbox_status, list_ideas y get_video. Uso:
//   pnpm --filter @fabrica/mcp exec tsx scripts/smoke.ts

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function firstText(res: unknown): string {
  const content = (res as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .flatMap((c) => (c.type === 'text' && typeof c.text === 'string' ? [c.text] : []))
    .join('\n');
}

function isError(res: unknown): boolean {
  return (res as { isError?: boolean }).isError === true;
}

async function main(): Promise<void> {
  // misma invocación que .mcp.json.example (--silent evita que el banner de
  // pnpm contamine el stdout del protocolo)
  const transport = new StdioClientTransport({
    command: 'pnpm',
    args: ['--silent', '--filter', '@fabrica/mcp', 'start'],
    cwd: repoRoot,
    env: { ...process.env } as Record<string, string>,
    stderr: 'inherit',
  });
  const client = new Client({ name: 'fabrica-mcp-smoke', version: '0.0.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`[smoke] herramientas registradas: ${tools.length}`);
  console.log(tools.map((t) => `  - ${t.name}`).join('\n'));

  const inbox = await client.callTool({ name: 'inbox_status', arguments: {} });
  console.log(`\n[smoke] inbox_status (isError=${isError(inbox)}):\n${firstText(inbox)}`);

  const ideas = await client.callTool({ name: 'list_ideas', arguments: {} });
  console.log(`\n[smoke] list_ideas (isError=${isError(ideas)}):\n${firstText(ideas)}`);

  // vídeo real si la bandeja da alguno; si no, id inexistente para ver el 404 legible
  let videoId = 'no-existe-smoke';
  if (!isError(inbox)) {
    const parsed = JSON.parse(firstText(inbox)) as {
      puertas_pendientes: { video_id: string | null }[];
      en_curso: { video_id: string }[];
      entregas: { video_id: string }[];
    };
    videoId =
      parsed.en_curso[0]?.video_id ??
      parsed.entregas[0]?.video_id ??
      parsed.puertas_pendientes.find((g) => g.video_id)?.video_id ??
      videoId;
  }
  const video = await client.callTool({ name: 'get_video', arguments: { video_id: videoId } });
  console.log(`\n[smoke] get_video(${videoId}) (isError=${isError(video)}):\n${firstText(video)}`);

  const publish = await client.callTool({ name: 'publish_video', arguments: { video_id: videoId } });
  console.log(`\n[smoke] publish_video(${videoId}) (isError=${isError(publish)}):\n${firstText(publish)}`);

  await client.close();
}

main().catch((cause) => {
  console.error('[smoke] fallo:', cause);
  process.exit(1);
});
