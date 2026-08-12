// A/B de la línea de edición sobre un vídeo YA renderizado: lee su maestro y
// recalcula los efectos con el director actual, COMPLETO (declaradas + reglas +
// micro-fx + la capa de IA que rellena huecos + presupuesto). Compararlo sin la
// capa de IA daría una lectura falsa: faltarían las tarjetas que antes sí salían
// de ella.
//
// Sirve para ver qué cambia en el montaje sin regenerar guion ni voz:
//   pnpm --filter @fabrica/workers exec tsx scripts/ab-edicion.ts <videoId>
//   pnpm --filter @fabrica/workers exec tsx scripts/ab-edicion.ts --short <shortId>
//
// La variante --short existe porque sin ella el A/B siempre usaba el
// presupuesto del LARGO (directEdits sin tercer argumento) y el vertical
// (PRESUPUESTO_VERTICAL) era inalcanzable desde la herramienta: la pasada de
// efectos del short se entregó sin banco de pruebas.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import {
  cobertura,
  SHORT_EDIT_ALLOWED,
  type Edit,
  type MasterVideoJson,
  type ShortMasterJson,
} from '@fabrica/shared';
import { createWorkerContext } from '../src/lib/context.js';
import {
  directEdits,
  intentEdits,
  microFxEdits,
  PRESUPUESTO_VERTICAL,
  type EditingParams,
} from '../src/pipelines/assets/editing-director.js';

const args = process.argv.slice(2);
const esShort = args[0] === '--short';
const targetId = (esShort ? args[1] : args[0]) ?? '';
if (targetId === '') {
  console.error('uso: tsx scripts/ab-edicion.ts <videoId> | --short <shortId>');
  process.exit(1);
}

function resumen(edits: Edit[], durationMs: number, bucketMs = 60_000): string {
  const porTipo = new Map<string, number>();
  for (const e of edits) {
    const k = e.type === 'sfx' ? `sfx · ${e.sfx}` : e.type;
    porTipo.set(k, (porTipo.get(k) ?? 0) + 1);
  }
  const visuales = edits.filter((e) => e.type !== 'sfx');
  // el reparto por tramo es lo que delata si los efectos se amontonan; en el
  // largo el tramo es el minuto, en el short serían cubos de 5 s (un minuto
  // entero colapsa la pieza en un solo número)
  const cubos = Math.max(1, Math.ceil(durationMs / bucketMs));
  const porCubo = Array.from({ length: cubos }, (_, m) =>
    visuales.filter((e) => e.from_ms >= m * bucketMs && e.from_ms < (m + 1) * bucketMs).length,
  );
  const etiqueta = bucketMs === 60_000 ? 'minuto' : `${bucketMs / 1000} s`;
  const cob = cobertura(edits, durationMs);
  return [
    `  total ${edits.length}  (${visuales.length} visuales · ${edits.length - visuales.length} sonidos)`,
    `  visuales por ${etiqueta}: [${porCubo.join(', ')}]`,
    // el número que dice si la pieza «se ve vacía»: cuánto metraje tiene algo
    // DIBUJADO, y cuál es el tramo seguido más largo que no tiene nada
    `  cobertura gráfica: ${(cob.ratio * 100).toFixed(1)} %  ·  hueco máximo ${(cob.hueco_max_ms / 1000).toFixed(1)} s`,
    ...[...porTipo.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, n]) => `    ${k.padEnd(20)} ${n}`),
  ].join('\n');
}

/**
 * A/B de la pasada vertical sobre un short YA propuesto: mismos parámetros que
 * `efectosDelShort` (efectos.ts), que es el contrato que este banco vigila.
 */
async function mainShort(): Promise<void> {
  const sql = postgres(process.env.DATABASE_URL ?? '');
  const [fila] = await sql<
    { master: ShortMasterJson; videoId: string; channelId: string; masterLargo: MasterVideoJson }[]
  >`
    select s.master, s.video_id as "videoId", s.channel_id as "channelId",
           v.master as "masterLargo"
    from shorts s join videos v on v.id = s.video_id
    where s.id = ${targetId}`;
  await sql.end();
  if (!fila?.master) throw new Error(`sin maestro para el short ${targetId}`);

  const master = fila.master;
  const largo = fila.masterLargo;
  const durationMs = master.short.duration_ms;
  const antes = master.edits ?? [];
  const heredados: readonly Edit[] = antes.filter((e) => SHORT_EDIT_ALLOWED[e.type]);

  const ctx = createWorkerContext();
  const despues = await directEdits(
    ctx,
    {
      videoId: fila.videoId,
      channelId: fila.channelId,
      lang: 'es',
      beats: master.beats?.map((b) => ({
        idx: b.idx,
        from_ms: b.from_ms,
        to_ms: b.to_ms,
        text: b.text,
      })) ?? [],
      cues: master.cues ?? [],
      scenes: [],
      segmentStartMs: [],
      seoTags: master.seo?.tags ?? [],
      title: master.short.title,
      hookNotes: master.short.hook,
      ...(largo.research ? { claims: largo.research.claims } : {}),
    },
    { presupuesto: PRESUPUESTO_VERTICAL, heredados, vertical: true },
  );
  await ctx.dbClient.end();
  ctx.connection.disconnect();
  ctx.pub.disconnect();
  for (const q of Object.values(ctx.queues)) await q.close();

  console.log(
    `\n=== short ${targetId} · ${(durationMs / 1000).toFixed(0)} s · ${master.beats?.length ?? 0} beats ===`,
  );
  console.log('\nANTES (la edición congelada al proponer):');
  console.log(resumen(antes, durationMs, 5_000));
  console.log('\nDESPUÉS (director actual, presupuesto vertical):');
  console.log(resumen(despues, durationMs, 5_000));
  console.log(`\nheredados del largo que entraron como declarados: ${heredados.length}`);

  const out = path.join(process.env.OUT_DIR ?? '/tmp', `${targetId}.short-nuevo.json`);
  writeFileSync(out, JSON.stringify({ ...master, edits: despues }, null, 2));
  console.log(`\nmaestro con la edición nueva: ${out}`);
}

async function main(): Promise<void> {
  const videoId = targetId;
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

void (esShort ? mainShort() : main());
