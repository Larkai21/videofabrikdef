/**
 * Sintetiza un guion ya escrito con una voz concreta, por el MISMO camino que
 * el worker, y mide lo que hace falta para calibrar.
 *
 *   pnpm probar:voz <videoId> --voz <voiceId> [--proveedor elevenlabs|edge]
 *
 * Por qué existe: cambiar de voz no es cambiar un ajuste. Toda la timeline
 * —beats, subtítulos y el anclaje de cada rótulo— cuelga de la alineación
 * palabra a palabra que devuelve el proveedor, y `WORDS_PER_MIN` está calibrado
 * contra la velocidad de UNA voz. Si las dos cosas no se comprueban antes, el
 * cambio no falla: saca vídeos con los rótulos descolocados y un 17 % más
 * largos de lo pedido, que es peor que fallar.
 *
 * No toca el vídeo ni la BD: sintetiza a un temporal e informa.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { eq } from 'drizzle-orm';
import { createDb, videos } from '@fabrica/db';
import { WORDS_PER_MIN } from '@fabrica/shared';
import { createTts } from '../src/providers/tts.js';

const logger = pino({ level: 'warn' });

function arg(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const videoId = process.argv[2];
  if (!videoId) throw new Error('Falta el videoId');
  const voiceId = arg('voz');
  if (!voiceId) throw new Error('Falta --voz <voiceId>');
  const proveedor = (arg('proveedor') ?? 'elevenlabs') as 'edge' | 'elevenlabs';

  const { db, client } = createDb();
  const [video] = await db.select().from(videos).where(eq(videos.id, videoId));
  if (!video?.master.script) throw new Error(`El vídeo ${videoId} no tiene guion`);
  const escenas = video.master.script.scenes;
  await client.end();

  const tts = createTts(logger).providerFor(proveedor);
  if (tts.name !== proveedor) {
    throw new Error(`El proveedor degradó a ${tts.name}: revisa la clave y TTS_PROVIDER`);
  }
  console.log(`Proveedor ${tts.name}${tts.model ? ` (${tts.model})` : ''} · voz ${voiceId}\n`);

  let caracteres = 0;
  let palabras = 0;
  let conTiempos = 0;
  let sinTiempos = 0;
  let duracionMs = 0;
  const rutas: string[] = [];

  for (const escena of escenas) {
    const r = await tts.synthesizeScene(escena.text, { voiceId, rate: '0%' });
    caracteres += escena.text.length;
    const enTexto = escena.text.trim().split(/\s+/).length;
    palabras += enTexto;
    // la alineación es lo que sostiene la timeline: si viene vacía o con menos
    // palabras que el texto, los rótulos se anclan donde no toca
    if (r.words.length > 0) conTiempos += 1;
    else sinTiempos += 1;
    const ultima = r.words.at(-1);
    const fin = ultima ? ultima.offset_ms + ultima.duration_ms : 0;
    duracionMs += fin;
    rutas.push(r.audioPath);
    const cobertura = enTexto > 0 ? (100 * r.words.length) / enTexto : 0;
    console.log(
      `  ${escena.id.padEnd(12)} ${String(enTexto).padStart(3)} pal · ${r.words.length} con tiempo (${cobertura.toFixed(0)} %) · ${(fin / 1000).toFixed(1)} s`,
    );
  }

  const minutos = duracionMs / 60000;
  const wpmReal = palabras / Math.max(minutos, 0.001);
  console.log(`\n  ${escenas.length} escenas · ${caracteres} caracteres · ${palabras} palabras`);
  console.log(`  alineación: ${conTiempos} escenas con tiempos, ${sinTiempos} sin ellos`);
  console.log(`  duración: ${minutos.toFixed(2)} min`);
  console.log(
    `  velocidad REAL: ${wpmReal.toFixed(1)} wpm (WORDS_PER_MIN actual: ${WORDS_PER_MIN})`,
  );
  if (Math.abs(wpmReal - WORDS_PER_MIN) > 5) {
    const pedido = 5;
    console.log(
      `\n  ⚠ Con ${WORDS_PER_MIN} wpm, un vídeo pedido a ${pedido} min saldría de ` +
        `${((WORDS_PER_MIN * pedido) / wpmReal).toFixed(1)} min. Ajusta la constante a ${Math.round(wpmReal)}.`,
    );
  }
  writeFileSync(
    path.join(process.cwd(), 'voz-medida.json'),
    JSON.stringify({ proveedor, voiceId, caracteres, palabras, minutos, wpmReal, rutas }, null, 2),
  );
  console.log(`\n  audio en ${rutas[0] ? path.dirname(rutas[0]) : '(nada)'}`);
}

await main();
