// Renderiza un tramo de la composición LongForm a partir de un maestro en disco.
// Sirve para comparar dos montajes del MISMO vídeo sin pasar por la cola:
//
//   pnpm --filter @fabrica/video exec tsx scripts/render-master.ts \
//     <master.json> <salida.mp4> [desdeSeg] [hastaSeg]

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { masterVideoJsonV1 } from '@fabrica/shared';
import { webpackOverride } from '../src/bundling';

const [masterArg, outArg, desdeStr, hastaStr] = process.argv.slice(2);
if (masterArg === undefined || outArg === undefined) {
  console.error('uso: tsx scripts/render-master.ts <master.json> <salida.mp4> [desdeSeg] [hastaSeg]');
  process.exit(1);
}
const masterPath: string = masterArg;
const outPath: string = outArg;

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const master = masterVideoJsonV1.parse(JSON.parse(readFileSync(masterPath, 'utf8')));
  await ensureBrowser();
  console.log('Empaquetando la composición…');
  const serveUrl = await bundle({
    entryPoint: path.join(pkgDir, 'src', 'entry.ts'),
    // sin publicDir el render no encuentra sfx/, fonts/ ni la música
    publicDir: path.join(pkgDir, 'public'),
    webpackOverride,
  });
  const composition = await selectComposition({ serveUrl, id: 'LongForm', inputProps: master });
  const fps = composition.fps;
  const desde = desdeStr !== undefined ? Math.round(Number(desdeStr) * fps) : 0;
  const hasta =
    hastaStr !== undefined
      ? Math.min(composition.durationInFrames - 1, Math.round(Number(hastaStr) * fps))
      : composition.durationInFrames - 1;

  console.log(`Renderizando frames ${desde}–${hasta} de ${composition.durationInFrames}…`);
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf: 20,
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    audioBitrate: '192k',
    frameRange: [desde, hasta],
    inputProps: master,
    outputLocation: outPath,
    onProgress: ({ progress }) => {
      if (progress === 1) console.log('Codificación terminada');
    },
  });
  if (!existsSync(outPath) || statSync(outPath).size <= 0) {
    throw new Error(`no se produjo ${outPath}`);
  }
  console.log(`Listo: ${outPath} (${statSync(outPath).size} bytes)`);
}

void main();
