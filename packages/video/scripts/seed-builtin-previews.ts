import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { BUILTIN_KIT_COMPONENTS } from '@fabrica/shared';
import { webpackOverride } from '../src/bundling';
import { samplePropsFor, type MarcaDeEjemplo } from '../src/kit-contract';

// Siembra las previews de los componentes INTEGRADOS: renderiza cada uno por la
// composición KitSmoke (la misma que usa el validador de zips) a
// library/builtin-previews/[<canal>/]<name@version>/preview.{mp4,png}, servidas
// por la API en /files para que el Brand kit los muestre animados.
//
//   pnpm previews:kit                 # con la marca del canal (lo normal)
//   pnpm --filter @fabrica/video exec tsx scripts/seed-builtin-previews.ts
//
// Con `--marca <fichero.json>` las previews se pintan con la paleta, el nombre,
// la coletilla y el avatar de ESE canal, y se escriben en su subcarpeta. Sin
// argumentos salen genéricas, en la carpeta compartida.
//
// Importa: una preview con la paleta por defecto y «Canal de ejemplo» no dice
// cómo va a quedar el componente, dice cómo quedaría en otro canal — y esa es
// justo la pregunta que el humano está respondiendo en esa pantalla.

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pkgDir, '..', '..');

function leerMarca(): { marca: MarcaDeEjemplo; canal: string | null } {
  const i = process.argv.indexOf('--marca');
  if (i < 0 || !process.argv[i + 1]) return { marca: {}, canal: null };
  const raw = JSON.parse(readFileSync(process.argv[i + 1]!, 'utf8')) as MarcaDeEjemplo & {
    channel_id?: string;
  };
  const { channel_id, ...marca } = raw;
  return { marca, canal: channel_id ?? null };
}

async function main(): Promise<void> {
  const { marca, canal } = leerMarca();
  const outRoot = path.join(
    repoRoot,
    'library',
    'builtin-previews',
    ...(canal !== null ? [canal] : []),
  );
  console.log(canal !== null ? `Marca de ${canal}` : 'Marca genérica');
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
      sample_props: samplePropsFor(b.type, marca),
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
