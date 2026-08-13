// Banco del director de highlights: corre el prompt sobre los beats REALES de
// un episodio, SIN cola y SIN insertar nada. Es el `pnpm guion` del clipping:
// iterar el prompt y contrastar proveedores/modelos (¿la anécdota no sale por
// criterio o por auto-censura?) sin pagar pre-cortes ni ensuciar la puerta.
//
// Uso:
//   pnpm clips:director <episodeId>              — beats tal y como están en BD
//   pnpm clips:director <episodeId> --con-risas  — recalcula la señal de
//     carcajada desde transcript.json + silencios del wav (sin re-transcribir)
//   pnpm clips:director <episodeId> --con-risas --guardar — además persiste
//     los beats anotados en la BD (para que la cola real también la vea)

import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { episodes } from '@fabrica/db';
import { createWorkerContext } from '../src/lib/context.js';
import { directHighlights } from '../src/pipelines/episodios/highlights.js';
import { detectarRisas, risaTrasBeat } from '../src/pipelines/episodios/risas.js';
import { detectarSilencios } from '../src/pipelines/episodios/silencios.js';
import type { BeatToken } from '../src/pipelines/tts/beats.js';

const args = process.argv.slice(2);
const episodeId = args.find((a) => !a.startsWith('--')) ?? '';
const conRisas = args.includes('--con-risas');
const guardar = args.includes('--guardar');
if (episodeId === '') {
  console.error('uso: pnpm clips:director <episodeId> [--con-risas] [--guardar]');
  process.exit(1);
}

const ctx = createWorkerContext();

const [ep] = await ctx.db.select().from(episodes).where(eq(episodes.id, episodeId)).limit(1);
if (!ep) {
  console.error(`Episodio ${episodeId} no existe`);
  process.exit(1);
}
if (ep.beats === null || ep.beats.length === 0) {
  console.error('El episodio no tiene beats (¿está transcrito?)');
  process.exit(1);
}

let beats = ep.beats.map((b) => ({ ...b, edits: 0 }));

if (conRisas) {
  if (ep.transcriptPath === null || ep.audioPath === null) {
    console.error('--con-risas necesita transcript.json y el wav del episodio');
    process.exit(1);
  }
  const { tokens } = JSON.parse(fs.readFileSync(ep.transcriptPath, 'utf8')) as {
    tokens: BeatToken[];
  };
  const silencios = await detectarSilencios(ep.audioPath);
  const risas = detectarRisas(tokens, silencios);
  beats = beats.map((b) => {
    const risa = risaTrasBeat(b.to_ms, risas);
    return risa !== undefined ? { ...b, risa_despues_ms: risa } : b;
  });
  const marcados = beats.filter((b) => b.risa_despues_ms !== undefined).length;
  console.log(`risas: ${risas.length} eventos · ${marcados}/${beats.length} beats con carcajada`);
  if (guardar) {
    await ctx.db
      .update(episodes)
      .set({
        beats: beats.map(({ edits: _e, ...b }) => b),
        updatedAt: new Date(),
      })
      .where(eq(episodes.id, episodeId));
    console.log('beats anotados guardados en la BD');
  }
}

const { candidatos, source } = await directHighlights(ctx, {
  episodeId,
  channelId: ep.channelId,
  titulo: ep.sourceTitle ?? ep.sourceUrl,
  canal: ep.sourceChannelName ?? '—',
  beats,
});

console.log(`\nfuente: ${source} · proveedor LLM: ${ctx.llm.name}`);
for (const c of candidatos) {
  const finBeat = beats.find((b) => b.idx === c.end_beat_idx);
  const remataEnRisa = finBeat?.risa_despues_ms !== undefined;
  console.log(
    [
      `${(c.from_ms / 1000).toFixed(1)}-${(c.to_ms / 1000).toFixed(1)} s`,
      `${Math.round((c.to_ms - c.from_ms) / 1000)} s`,
      `score ${c.score}`,
      remataEnRisa ? 'REMATA EN CARCAJADA' : 'sin risa al final',
      `«${c.title}»`,
    ].join(' · '),
  );
  console.log(`   hook: ${c.hook}`);
}

process.exit(0);
