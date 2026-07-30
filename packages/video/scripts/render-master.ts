// Renderiza un tramo de la composición LongForm a partir de un maestro en disco.
// Sirve para comparar dos montajes del MISMO vídeo sin pasar por la cola:
//
//   pnpm --filter @fabrica/video exec tsx scripts/render-master.ts \
//     <master.json> <salida.mp4> [desdeSeg] [hastaSeg]
//
// El maestro de outputs/ guarda rutas ABSOLUTAS de disco y OffthreadVideo solo
// acepta http(s), así que hay que reescribirlas a /files como hace el worker de
// render. Sin esto el b-roll salía negro y la comparación no servía para nada.
// Necesita la API levantada (FILES_BASE_URL, por defecto localhost:3001).

import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { masterVideoJsonV1, type MasterVideoJson } from '@fabrica/shared';
import { webpackOverride } from '../src/bundling';

const [masterArg, outArg, desdeStr, hastaStr] = process.argv.slice(2);
if (masterArg === undefined || outArg === undefined) {
  console.error(
    'uso: tsx scripts/render-master.ts <master.json> <salida.mp4> [desdeSeg] [hastaSeg]',
  );
  process.exit(1);
}
const masterPath: string = masterArg;
const outPath: string = outArg;

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pkgDir, '..', '..');
const baseUrl = process.env.FILES_BASE_URL ?? 'http://127.0.0.1:3001/files';
const libraryDir = process.env.LIBRARY_DIR ?? path.join(repoRoot, 'library');
const outputsDir = process.env.OUTPUTS_DIR ?? path.join(repoRoot, 'outputs');

/** Absoluta bajo library/ u outputs/ → URL de /files. */
function servible(p: string): string {
  if (/^(https?:|data:|blob:)/.test(p) || !path.isAbsolute(p)) return p;
  for (const [root, prefijo] of [
    [libraryDir, 'library'],
    [outputsDir, 'outputs'],
  ] as const) {
    const rel = path.relative(root, p);
    if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return `${baseUrl.replace(/\/$/, '')}/${prefijo}/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;
    }
  }
  return p;
}

function conMediosServibles(m: MasterVideoJson): MasterVideoJson {
  const c = structuredClone(m);
  if (c.audio) c.audio.path = servible(c.audio.path);
  const avatar = c.brand?.avatar_path;
  if (c.brand && typeof avatar === 'string') c.brand.avatar_path = servible(avatar);
  for (const b of c.beats ?? []) {
    const ba = b.asset;
    if (ba && typeof ba.path === 'string') ba.path = servible(ba.path);
    for (const v of b.visuals ?? []) {
      const va = v.asset;
      if (va && typeof va.path === 'string') va.path = servible(va.path);
    }
  }
  return c;
}

async function main(): Promise<void> {
  const crudo = masterVideoJsonV1.parse(JSON.parse(readFileSync(masterPath, 'utf8')));
  const master = conMediosServibles(crudo);
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
