/**
 * Fotogramas sueltos de las cuatro piezas del brand kit con la MARCA REAL del
 * canal (tokens, avatar, nombre y coletilla), a out/marca/.
 *
 *   pnpm --filter @fabrica/video preview:marca                      # sin avatar
 *   pnpm --filter @fabrica/video preview:marca demo/avatar.jpg      # con él
 *   pnpm --filter @fabrica/video preview:marca --video              # y los clips
 *
 * Existe porque `render:smoke` usa el maestro de demo con la paleta por defecto:
 * comprueba que el montaje no se rompe, no que la marca se vea bien. Y una
 * decisión de diseño no se juzga leyendo el código, se juzga mirando el
 * fotograma.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { makeDemoMaster, type MasterVideoJson } from '@fabrica/shared';
import { webpackOverride } from '../src/bundling';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(pkgDir, 'out', 'marca');

// Tokens medidos con cuentagotas sobre el avatar y la cabecera del canal.
const MARCA = {
  background: '#12151A',
  surface: '#1E232A',
  foreground: '#E8EDF2',
  muted: '#8E999F',
  accent: '#43D5E0',
  accent_fg: '#08181B',
  font_family: 'Inter',
} as const;

async function main(): Promise<void> {
  // el primer argumento que NO es una bandera es la ruta del avatar; sin este
  // filtro `--video` se colaba como ruta de imagen y el render moría pidiendo
  // http://localhost:3000/public/--video
  const avatar = process.argv.slice(2).find((a) => !a.startsWith('--'));
  mkdirSync(outDir, { recursive: true });
  await ensureBrowser();

  const master: MasterVideoJson = makeDemoMaster({
    audioPath: 'demo/silence.wav',
    clipPath: 'demo/clip-1.mp4',
    imagePath: 'demo/image.png',
  });
  master.brand = {
    channel_name: 'Kernel AI',
    tagline: 'Noticias de tecnología e IA',
    design: MARCA,
    ...(avatar ? { avatar_path: avatar } : {}),
    components: {
      subtitle_theme: 'subtitulos-basicos@0.1.0',
      intro: 'intro-basica@0.1.0',
      outro: 'outro-basica@0.1.0',
      title_card: 'titulo-seccion@0.1.0',
      lower_third: 'rotulo-basico@0.1.0',
    },
  };
  // una sección al principio del cuerpo fuerza la tarjeta y el rótulo
  master.segments = [{ title: 'Lo que ha pasado', beat_idx: 0, from_ms: 0 }];
  // y las tarjetas del catálogo, para verlas con la paleta del canal: son
  // «todos los motion graphics» y no valen de nada si solo se comprueba la intro
  master.edits = [
    { type: 'text_callout', from_ms: 1500, to_ms: 4000, text: 'pesos abiertos' },
    { type: 'stat_card', from_ms: 5000, to_ms: 7600, value: '70%', label: 'de los modelos' },
    { type: 'quote_card', from_ms: 8500, to_ms: 11500, text: 'Nadie audita lo que no se publica' },
    {
      type: 'split_versus',
      from_ms: 12500,
      to_ms: 15900,
      items: ['Pesos abiertos', 'API cerrada'],
    },
    {
      type: 'pasos_flow',
      from_ms: 16800,
      to_ms: 21000,
      items: ['Descarga', 'Ajusta', 'Mide', 'Publica'],
    },
    { type: 'tendencia', from_ms: 22000, to_ms: 25000, value: '3x', style: 'sube', label: 'uso' },
    { type: 'device_frame', from_ms: 26000, to_ms: 28600, style: 'browser', text: 'kernel.ai' },
  ];

  const serveUrl = await bundle({
    entryPoint: path.join(pkgDir, 'src', 'entry.ts'),
    webpackOverride,
  });
  const composition = await selectComposition({ serveUrl, id: 'LongForm', inputProps: master });

  // intro 0-95, cuerpo con tarjeta y rótulo, outro al final
  const total = composition.durationInFrames;
  const frames: [string, number][] = [
    ['intro-10', 10],
    ['intro-34', 34],
    ['intro-56', 56],
    ['intro-80', 80],
    ['cuerpo-tarjeta', 108],
    ['cuerpo-rotulo', 132],
    ['fx-callout', 96 + 75],
    ['fx-stat', 96 + 180],
    ['fx-quote', 96 + 285],
    ['fx-versus', 96 + 425],
    ['fx-pasos', 96 + 575],
    ['fx-tendencia', 96 + 690],
    ['fx-device', 96 + 810],
    ['outro-a', total - 90],
    ['outro-b', total - 40],
  ];
  for (const [nombre, frame] of frames) {
    if (frame < 0 || frame >= total) continue;
    await renderStill({
      composition,
      serveUrl,
      output: path.join(outDir, `${nombre}.png`),
      frame,
      inputProps: master,
      overwrite: true,
    });
    console.log(`  ${nombre} (frame ${frame})`);
  }

  // Los clips: una intro se juzga por cómo se MUEVE, y un fotograma no dice si
  // el entramado se dibuja o simplemente aparece.
  if (process.argv.includes('--video')) {
    const clips: [string, number, number][] = [
      ['intro', 0, 95],
      ['tarjetas', 96 + 40, 96 + 900],
      ['outro', Math.max(0, total - 120), total - 1],
    ];
    for (const [nombre, desde, hasta] of clips) {
      await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation: path.join(outDir, `${nombre}.mp4`),
        frameRange: [desde, Math.min(hasta, total - 1)],
        inputProps: master,
        overwrite: true,
      });
      console.log(`  ${nombre}.mp4 (frames ${desde}-${hasta})`);
    }
  }

  console.log(`Marca en ${outDir}`);
}

await main();
