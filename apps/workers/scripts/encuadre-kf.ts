// Banco de REGRESIÓN del tracking de encuadre (kf) sobre planos con vaivén
// real: tres cortes del episodio de referencia (Cranston en Conan) con
// gestos amplios, giros y brazos. No hay verdad etiquetada a mano — etiquetar
// trayectorias a ojo sería inventársela —: el golden es la salida CONGELADA
// del sidecar, y el banco vigila que el determinismo se mantenga (principio
// 6: mismo vídeo → mismos tramos y mismas series). Si un cambio del sidecar
// mueve los goldens A PROPÓSITO, se regeneran con --regenerar y el diff del
// commit enseña exactamente qué cambió.
//
// Uso:  pnpm encuadre:kf [--regenerar]

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const ejec = promisify(execFile);
const RAIZ = path.resolve(process.cwd(), '../..');
const DIR = path.join(RAIZ, 'calibracion', 'vaiven');
const CASOS = ['gas-gestos', 'mueca-giro', 'pistola-brazos'];
const regenerar = process.argv.includes('--regenerar');

const python =
  process.env.STT_MLX_PYTHON ?? path.join(RAIZ, 'apps', 'editor', '.venv', 'bin', 'python');
const script = path.join(RAIZ, 'apps', 'workers', 'scripts', 'encuadre-clip.py');

let fallos = 0;
for (const caso of CASOS) {
  const video = path.join(DIR, `${caso}.mp4`);
  const goldenPath = path.join(DIR, `${caso}.golden.json`);
  const probe = await ejec('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    video,
  ]);
  const dur = probe.stdout.trim();
  const r = await ejec(python, [script, '--input', video, '--from', '0', '--to', dur], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const actual = JSON.stringify(JSON.parse(r.stdout), null, 1);
  if (regenerar) {
    writeFileSync(goldenPath, actual);
    console.log(`${caso}: golden regenerado`);
    continue;
  }
  const golden = JSON.stringify(JSON.parse(readFileSync(goldenPath, 'utf8')), null, 1);
  if (actual === golden) {
    console.log(`${caso}: OK (idéntico al golden)`);
  } else {
    fallos += 1;
    console.error(`${caso}: DIFIERE del golden — el sidecar dejó de ser determinista o cambió`);
  }
}
process.exit(fallos > 0 ? 1 : 0);
