import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Sintetiza un pack mínimo de SFX con ffmpeg (sin sourcing ni licencias) en
// packages/video/public/sfx/. Se commitean y se referencian como staticFile
// ('sfx/whoosh.wav') desde LongForm. Todo con lavfi determinista.
//
//   pnpm --filter @fabrica/video exec tsx scripts/make-sfx.ts

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(pkgDir, 'public', 'sfx');

function ff(name: string, args: string[]): boolean {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
    return true;
  } catch {
    console.error(`ffmpeg falló para ${name}`);
    return false;
  }
}

function main(): void {
  mkdirSync(outDir, { recursive: true });
  const ok: string[] = [];

  // whoosh: ruido rosa filtrado + fades (transición de sección)
  if (
    ff('whoosh', [
      '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.5:duration=0.6',
      '-af',
      'highpass=f=300,lowpass=f=6000,volume=0.5,afade=t=in:st=0:d=0.05,afade=t=out:st=0.35:d=0.25',
      '-ar', '44100', '-ac', '2',
      path.join(outDir, 'whoosh.wav'),
    ])
  ) ok.push('whoosh.wav');

  // pop: seno corto con caída rápida (callouts/tarjetas)
  if (
    ff('pop', [
      '-f', 'lavfi', '-i', 'sine=frequency=520:duration=0.14',
      '-af', 'volume=0.35,afade=t=out:st=0.02:d=0.12',
      '-ar', '44100', '-ac', '2',
      path.join(outDir, 'pop.wav'),
    ])
  ) ok.push('pop.wav');

  // riser: chirp ascendente (frecuencia sube con t) para el hook
  if (
    ff('riser', [
      '-f', 'lavfi', '-i', 'aevalsrc=0.28*sin(2*PI*(180*t+160*t*t)):d=1.0:s=44100',
      '-af', 'afade=t=in:st=0:d=0.1,afade=t=out:st=0.85:d=0.15',
      '-ac', '2',
      path.join(outDir, 'riser.wav'),
    ])
  ) ok.push('riser.wav');

  // ding: dos senos (acorde) con caída (énfasis de dato)
  if (
    ff('ding', [
      '-f', 'lavfi', '-i', 'aevalsrc=0.3*(sin(2*PI*880*t)+0.5*sin(2*PI*1320*t)):d=0.45:s=44100',
      '-af', 'afade=t=out:st=0.05:d=0.4',
      '-ac', '2',
      path.join(outDir, 'ding.wav'),
    ])
  ) ok.push('ding.wav');

  console.log(JSON.stringify({ ok: ok.length === 4, dir: outDir, files: ok }));
}

main();
