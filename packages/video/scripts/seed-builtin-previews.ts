import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { BUILTIN_KIT_COMPONENTS } from '@fabrica/shared';
import { webpackOverride } from '../src/bundling';
import { samplePropsFor } from '../src/kit-contract';

// Siembra las previews de los componentes INTEGRADOS (una vez): renderiza cada
// uno por la composición KitSmoke (misma que usa el validador de zips) a
// library/builtin-previews/<name@version>/preview.{mp4,png}, servidas por la API
// en /files para que el Brand kit los muestre animados.
//
//   pnpm --filter @fabrica/video exec tsx scripts/seed-builtin-previews.ts

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pkgDir, '..', '..');
const outRoot = path.join(repoRoot, 'library', 'builtin-previews');

async function main(): Promise<void> {
  await ensureBrowser();
  console.log('Empaquetando el harness del kit…');
  const serveUrl = await bundle({
    entryPoint: path.join(pkgDir, 'src', 'kit-smoke-entry.ts'),
    publicDir: path.join(pkgDir, 'public'),
    webpackOverride,
  });

  for (const b of BUILTIN_KIT_COMPONENTS) {
    const frames = Math.min(300, Math.max(1, b.fixed_duration_frames ?? 90));
    const inputProps = {
      kit_type: b.type,
      reference: b.ref,
      sample_props: samplePropsFor(b.type),
      smoke_frames: frames,
    };
    const dir = path.join(outRoot, `${b.name}@${b.version}`);
    mkdirSync(dir, { recursive: true });
    const composition = await selectComposition({ serveUrl, id: 'KitSmoke', inputProps });
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      crf: 20,
      pixelFormat: 'yuv420p',
      concurrency: 2,
      inputProps,
      outputLocation: path.join(dir, 'preview.mp4'),
    });
    await renderStill({
      composition,
      serveUrl,
      frame: Math.floor(frames / 2),
      output: path.join(dir, 'preview.png'),
      imageFormat: 'png',
      inputProps,
    });
    console.log(`preview: ${b.ref} → ${dir}`);
  }
  console.log('Previews de integrados sembradas.');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
