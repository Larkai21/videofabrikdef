// A/B de la línea de edición sobre un vídeo YA renderizado: lee su maestro y
// recalcula los efectos con el director actual, COMPLETO (declaradas + reglas +
// micro-fx + la capa de IA que rellena huecos + presupuesto). Compararlo sin la
// capa de IA daría una lectura falsa: faltarían las tarjetas que antes sí salían
// de ella.
//
// Sirve para ver qué cambia en el montaje sin regenerar guion ni voz:
//   pnpm --filter @fabrica/workers exec tsx scripts/ab-edicion.ts <videoId>

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { cobertura, type Edit, type MasterVideoJson } from '@fabrica/shared';
import { createWorkerContext } from '../src/lib/context.js';
import {
  directEdits,
  intentEdits,
  microFxEdits,
  type EditingParams,
} from '../src/pipelines/assets/editing-director.js';

const videoId = process.argv[2];
if (videoId === undefined) {
  console.error('uso: tsx scripts/ab-edicion.ts <videoId>');
  process.exit(1);
}

function resumen(edits: Edit[], durationMs: number): string {
  const porTipo = new Map<string, number>();
  for (const e of edits) {
    const k = e.type === 'sfx' ? `sfx · ${e.sfx}` : e.type;
    porTipo.set(k, (porTipo.get(k) ?? 0) + 1);
  }
  const visuales = edits.filter((e) => e.type !== 'sfx');
  // el reparto por minuto es lo que delata si los efectos se amontonan
  const minutos = Math.max(1, Math.ceil(durationMs / 60_000));
  const porMinuto = Array.from({ length: minutos }, (_, m) =>
    visuales.filter((e) => e.from_ms >= m * 60_000 && e.from_ms < (m + 1) * 60_000).length,
  );
  const cob = cobertura(edits, durationMs);
  return [
    `  total ${edits.length}  (${visuales.length} visuales · ${edits.length - visuales.length} sonidos)`,
    `  visuales por minuto: [${porMinuto.join(', ')}]`,
    // el número que dice si la pieza «se ve vacía»: cuánto metraje tiene algo
    // DIBUJADO, y cuál es el tramo seguido más largo que no tiene nada
    `  cobertura gráfica: ${(cob.ratio * 100).toFixed(1)} %  ·  hueco máximo ${(cob.hueco_max_ms / 1000).toFixed(1)} s`,
    ...[...porTipo.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n]) => `    ${k.padEnd(20)} ${n}`),
  ].join('\n');
}

async function main(): Promise<void> {
  const sql = postgres(process.env.DATABASE_URL ?? '');
  const [video] = await sql<{ master: MasterVideoJson; channelId: string }[]>`
    select master, channel_id as "channelId" from videos where id = ${videoId}`;
  if (!video?.master) throw new Error(`sin maestro para ${videoId}`);
  const beatRows = await sql<{ idx: number; fromMs: number; toMs: number; text: string }[]>`
    select idx, from_ms as "fromMs", to_ms as "toMs", text
    from beats where video_id = ${videoId} order by idx`;
  await sql.end();

  const master = video.master;
  const durationMs = master.audio?.duration_ms ?? 0;
  const antes = master.edits ?? [];

  const params: EditingParams = {
    videoId,
    channelId: video.channelId,
    lang: 'es',
    beats: beatRows.map((b) => ({ idx: b.idx, from_ms: b.fromMs, to_ms: b.toMs, text: b.text })),
    cues: master.cues ?? [],
    scenes: master.script?.scenes ?? [],
    segmentStartMs: (master.segments ?? []).map((s) => s.from_ms),
    seoTags: master.seo?.tags ?? [],
    ...(master.scene_spans ? { sceneSpans: master.scene_spans } : {}),
    ...(master.research ? { claims: master.research.claims } : {}),
  };

  const intents = intentEdits(params);
  const micro = microFxEdits(params);
  const ctx = createWorkerContext();
  const despues = await directEdits(ctx, params);
  await ctx.dbClient.end();
  ctx.connection.disconnect();
  ctx.pub.disconnect();
  for (const q of Object.values(ctx.queues)) await q.close();

  console.log(`\n=== ${videoId} · ${(durationMs / 1000).toFixed(0)} s · ${beatRows.length} beats ===`);
  console.log('\nANTES (la edición con la que se renderizó):');
  console.log(resumen(antes, durationMs));
  console.log('\nDESPUÉS (director nuevo, capas deterministas):');
  console.log(resumen(despues, durationMs));
  console.log(
    `\ndeclaradas por el guion: ${intents.edits.length}` +
      ` · descartadas por no encontrar su palabra: ${intents.dropped}` +
      ` · micro-fx disparados: ${micro.filter((e) => e.type !== 'sfx').length}`,
  );

  const out = path.join(process.env.OUT_DIR ?? '/tmp', `${videoId}.master-nuevo.json`);
  writeFileSync(out, JSON.stringify({ ...master, edits: despues }, null, 2));
  console.log(`\nmaestro con la edición nueva: ${out}`);
}

void main();
