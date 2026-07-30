import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { makeDemoMaster } from '@fabrica/shared';
import { webpackOverride } from '../src/bundling';
import {
  INTRO_BASICA_DURATION_FRAMES,
  OUTRO_BASICA_DURATION_FRAMES,
} from '../src/registry-gen';

// Render de humo autónomo y OFFLINE (pnpm render:smoke): genera medios de
// color con ffmpeg en public/demo/, monta el maestro de demo compartido y
// renderiza los frames 0–59 de LongForm a out/smoke.mp4. Sirve de validación
// del entry, del bundler y de los tres modos de encaje (trim, loop, kenburns).
// Segunda pasada: el mismo maestro con la intro y la outro integradas activas
// verifica el montaje del brand kit (durationInFrames = intro + audio + outro,
// beats desplazados) y renderiza el cruce intro→cuerpo a out/smoke-kit.mp4.

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = path.join(pkgDir, 'public', 'demo');
const outDir = path.join(pkgDir, 'out');

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('error', (err) => {
      reject(
        new Error(
          `No se pudo ejecutar ffmpeg (${err.message}). Instálalo para el render de humo.`,
        ),
      );
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg terminó con código ${code} (args: ${args.join(' ')})`));
    });
  });
}

async function ensureDemoMedia(): Promise<void> {
  mkdirSync(demoDir, { recursive: true });
  const clip1 = path.join(demoDir, 'clip-1.mp4');
  const clip2 = path.join(demoDir, 'clip-2.mp4');
  const image = path.join(demoDir, 'image.png');
  const wav = path.join(demoDir, 'silence.wav');
  if (!existsSync(clip1)) {
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'color=c=0x1c3f6e:size=1920x1080:rate=30:duration=12',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip1,
    ]);
  }
  if (!existsSync(clip2)) {
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'color=c=0x5e2a6e:size=1920x1080:rate=30:duration=12',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip2,
    ]);
  }
  if (!existsSync(image)) {
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'color=c=0x2a6e4f:size=1920x1080', '-frames:v', '1', image,
    ]);
  }
  if (!existsSync(wav)) {
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '43', wav,
    ]);
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  await ensureDemoMedia();

  // rutas relativas → staticFile dentro de la composición (contrato en
  // src/media-src.ts); así el render no depende de la API ni de la red
  const master = makeDemoMaster({
    audioPath: 'demo/silence.wav',
    clipPath: 'demo/clip-1.mp4',
    imagePath: 'demo/image.png',
  });
  // cobertura de los tres modos: beat 0 pasa a trim con offset, beat 2 usa el
  // segundo clip en loop, beats 1 y 3 siguen en kenburns
  const beat0 = master.beats?.[0];
  if (beat0?.asset) beat0.asset.fit = { mode: 'trim', offset_ms: 500 };
  const beat2 = master.beats?.[2];
  if (beat2?.asset) beat2.asset.path = 'demo/clip-2.mp4';

  await ensureBrowser();
  console.log('Empaquetando la composición…');
  const serveUrl = await bundle({
    entryPoint: path.join(pkgDir, 'src', 'entry.ts'),
    publicDir: path.join(pkgDir, 'public'),
    webpackOverride,
  });

  const composition = await selectComposition({
    serveUrl,
    id: 'LongForm',
    inputProps: master,
  });

  mkdirSync(outDir, { recursive: true });
  const outputLocation = path.join(outDir, 'smoke.mp4');
  console.log('Renderizando frames 0–59…');
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf: 18,
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    audioBitrate: '192k',
    frameRange: [0, 59],
    inputProps: master,
    outputLocation,
    onProgress: ({ progress }) => {
      if (progress === 1) console.log('Codificación terminada');
    },
  });

  if (!existsSync(outputLocation)) {
    throw new Error(`El render de humo no produjo ${outputLocation}`);
  }
  const size = statSync(outputLocation).size;
  if (size <= 0) {
    throw new Error(`El render de humo produjo un archivo vacío: ${outputLocation}`);
  }

  // ---- segunda pasada: brand kit (intro + outro integradas) montado sobre
  // el MISMO maestro; el maestro de demo compartido no se toca, solo esta
  // copia local activa los componentes
  const masterKit = makeDemoMaster({
    audioPath: 'demo/silence.wav',
    clipPath: 'demo/clip-1.mp4',
    imagePath: 'demo/image.png',
  });
  masterKit.brand = {
    // sin channel_name el humo no ejercitaba el texto de intro ni outro: el
    // monograma caía a «·» y «Señal y ruido» nunca se pintaba
    channel_name: 'Canal de ejemplo',
    components: {
      subtitle_theme: masterKit.brand?.components.subtitle_theme ?? 'subtitulos-basicos@0.1.0',
      intro: 'intro-basica@0.1.0',
      outro: 'outro-basica@0.1.0',
      // las cuatro piezas integradas a la vez: la tarjeta y el rótulo se montan
      // sobre el b-roll y su legibilidad solo se juzga en el montaje real
      title_card: 'titulo-seccion@0.1.0',
      lower_third: 'rotulo-basico@0.1.0',
    },
  };
  const kitComposition = await selectComposition({
    serveUrl,
    id: 'LongForm',
    inputProps: masterKit,
  });
  const audioMs = masterKit.audio?.duration_ms ?? 0;
  const expectedFrames =
    INTRO_BASICA_DURATION_FRAMES +
    Math.ceil((audioMs / 1000) * kitComposition.fps) +
    OUTRO_BASICA_DURATION_FRAMES;
  if (kitComposition.durationInFrames !== expectedFrames) {
    throw new Error(
      `El montaje del brand kit no cuadra: durationInFrames=${kitComposition.durationInFrames}, ` +
        `esperado intro (${INTRO_BASICA_DURATION_FRAMES}) + audio + outro (${OUTRO_BASICA_DURATION_FRAMES}) = ${expectedFrames}`,
    );
  }
  const kitFrames = INTRO_BASICA_DURATION_FRAMES + 30;
  const kitOutput = path.join(outDir, 'smoke-kit.mp4');
  console.log(`Renderizando el cruce intro→cuerpo (frames 0–${kitFrames - 1})…`);
  await renderMedia({
    composition: kitComposition,
    serveUrl,
    codec: 'h264',
    crf: 18,
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    audioBitrate: '192k',
    frameRange: [0, kitFrames - 1],
    inputProps: masterKit,
    outputLocation: kitOutput,
    onProgress: ({ progress }) => {
      if (progress === 1) console.log('Codificación del kit terminada');
    },
  });
  if (!existsSync(kitOutput) || statSync(kitOutput).size <= 0) {
    throw new Error(`El render de humo del brand kit no produjo ${kitOutput}`);
  }

  // ---- tercera pasada: el cruce cuerpo→outro, que no se probaba nunca
  const outroOutput = path.join(outDir, 'smoke-outro.mp4');
  const outroFrom = Math.max(0, expectedFrames - OUTRO_BASICA_DURATION_FRAMES - 15);
  console.log(`Renderizando el cruce cuerpo→outro (frames ${outroFrom}–${expectedFrames - 1})…`);
  await renderMedia({
    composition: kitComposition,
    serveUrl,
    codec: 'h264',
    crf: 18,
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    audioBitrate: '192k',
    frameRange: [outroFrom, expectedFrames - 1],
    inputProps: masterKit,
    outputLocation: outroOutput,
    onProgress: ({ progress }) => {
      if (progress === 1) console.log('Codificación del outro terminada');
    },
  });
  if (!existsSync(outroOutput) || statSync(outroOutput).size <= 0) {
    throw new Error(`El render de humo del outro no produjo ${outroOutput}`);
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `Render de humo correcto: ${outputLocation} (${size} bytes) y ${kitOutput} ` +
      `(${statSync(kitOutput).size} bytes, montaje ${expectedFrames} frames) en ${elapsed} s`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
