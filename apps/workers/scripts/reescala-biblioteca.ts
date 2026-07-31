/**
 * Baja a 1080p los clips de la biblioteca que se ingirieron antes de que la
 * ingesta lo hiciera sola.
 *
 *   pnpm reescala:biblioteca --dry
 *   pnpm reescala:biblioteca
 *
 * Por qué hace falta: el render sale a 1920×1080 y un clip más ancho no aporta
 * un píxel, pero hay que decodificarlo entero en cada fotograma del navegador
 * headless. Un vídeo real murió con «Timeout (30000ms) exceeded rendering the
 * component at frame 2597» sobre un clip de 3840×2160, y en la biblioteca
 * quedaban 50 por encima de 1080p. La ingesta ya no deja entrar más; esto
 * limpia los que ya estaban.
 *
 * Reescribe el archivo en su sitio y actualiza width/height, así que el
 * `source_ref` y el embedding siguen valiendo: es el mismo plano, con menos
 * píxeles. Idempotente: al segundo pase no encuentra nada.
 */
import { stat, rename, unlink } from 'node:fs/promises';
import { execa } from 'execa';
import pino from 'pino';
import { and, eq, gt, sql } from 'drizzle-orm';
import { assets, createDb } from '@fabrica/db';

const ANCHO = 1920;
const logger = pino({ transport: { target: 'pino-pretty' } });
const seco = process.argv.includes('--dry');

async function main(): Promise<void> {
  const { db, client } = createDb();
  const grandes = await db
    .select({ id: assets.id, path: assets.path, width: assets.width, height: assets.height })
    .from(assets)
    .where(and(eq(assets.kind, 'clip'), gt(assets.width, ANCHO)))
    .orderBy(sql`${assets.width} desc`);

  logger.info({ total: grandes.length }, 'Clips por encima de 1080p');
  let hechos = 0;
  let ahorro = 0;

  for (const a of grandes) {
    const etiqueta = `${a.width}x${a.height ?? '?'}`;
    if (seco) {
      logger.info({ id: a.id, de: etiqueta }, 'se reescalaría');
      continue;
    }
    const tmp = `${a.path}.1080.mp4`;
    try {
      const antes = (await stat(a.path)).size;
      await execa('ffmpeg', [
        '-nostdin',
        '-loglevel',
        'error',
        '-y',
        '-i',
        a.path,
        '-vf',
        `scale=${ANCHO}:-2`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-an',
        tmp,
      ]);
      await rename(tmp, a.path);
      const despues = (await stat(a.path)).size;
      const { stdout } = await execa('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height',
        '-of',
        'csv=p=0',
        a.path,
      ]);
      const [w, h] = stdout.trim().split(',').map(Number);
      await db
        .update(assets)
        .set({ width: w ?? ANCHO, height: h ?? null })
        .where(eq(assets.id, a.id));
      hechos += 1;
      ahorro += antes - despues;
      logger.info(
        { id: a.id, de: etiqueta, a: `${w}x${h}`, mb: ((antes - despues) / 1e6).toFixed(1) },
        'reescalado',
      );
    } catch (err) {
      await unlink(tmp).catch(() => {});
      logger.warn({ err, id: a.id }, 'no se pudo reescalar; se deja como estaba');
    }
  }

  logger.info({ hechos, ahorro_mb: (ahorro / 1e6).toFixed(1) }, 'Terminado');
  await client.end();
}

await main();
