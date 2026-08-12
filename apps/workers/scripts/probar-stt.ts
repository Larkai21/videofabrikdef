/**
 * Banco de STT para el pipeline de clipping (podcasts/directos → shorts).
 *
 *   pnpm probar:stt <url|fichero.wav> [--max-min 20]
 *
 * Por qué existe: computeBeats y buildCues viven de `sentenceEnd`, que hoy da
 * la puntuación del GUION propio. Con material ajeno esa señal hay que
 * ganársela o se cae el principio 1 (un short nunca parte una frase).
 *
 * Mide con EXACTAMENTE el mismo código que producción (providers/stt.ts +
 * pipelines/episodios/tokens.ts + silencios.ts), así el gate del banco y el
 * estampado en episodes.stt_meta no pueden divergir:
 *
 *   - fronteras FUERTES por minuto (respaldadas por silencio del AUDIO):
 *     la métrica operativa, ≥4/min para beats de 8-15 s
 *   - % de puntuación del ASR confirmada por pausa: se reporta, no gobierna
 *     (medido 7 % en un monólogo rápido — la ortografía del ASR no es señal)
 *   - deriva temporal del último token y coste/min real
 *
 * El proveedor lo decide STT_PROVIDER ('mlx' local Metal coste 0 | 'whisper'
 * API 0,006 $/min | 'mock'). No toca BD ni ledger: es un banco.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PRICES } from '@fabrica/shared';
import { loadEnv } from '../src/lib/env.js';
import { detectarSilencios } from '../src/pipelines/episodios/silencios.js';
import { aTokens, cruzarConPausas, spansDePausas } from '../src/pipelines/episodios/tokens.js';
import { createStt } from '../src/providers/stt.js';
import type { BeatToken } from '../src/pipelines/tts/beats.js';
import pino from 'pino';

const ejec = promisify(execFile);
const RAIZ = path.resolve(process.cwd(), '../..');
const BANCO = path.join(RAIZ, 'banco', 'stt');

const BLOQUE_S = 600;
const FUERTES_MIN_GATE = 4;

function esUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

async function descargarAudio(url: string, destDir: string): Promise<{ fichero: string; titulo: string }> {
  const meta = await ejec('yt-dlp', ['-J', '--no-playlist', url], { maxBuffer: 64 * 1024 * 1024 });
  const info = JSON.parse(meta.stdout) as { title?: string; duration?: number; is_live?: boolean };
  if (info.is_live === true) throw new Error('Es un directo en emisión: el pipeline trabaja con VOD');
  console.log(`  «${info.title ?? url}» · ${Math.round((info.duration ?? 0) / 60)} min`);
  await ejec('yt-dlp', ['--no-playlist', '-f', 'bestaudio/best', '-o', path.join(destDir, 'audio.%(ext)s'), url], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const fichero = fs.readdirSync(destDir).find((f) => f.startsWith('audio.'));
  if (fichero === undefined) throw new Error('yt-dlp no dejó ningún fichero de audio');
  return { fichero: path.join(destDir, fichero), titulo: info.title ?? url };
}

async function aWav16k(entrada: string, destDir: string, maxMin: number): Promise<string> {
  const salida = path.join(destDir, 'stt.wav');
  await ejec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', entrada, '-t', String(maxMin * 60), '-vn', '-ac', '1', '-ar', '16000', '-y', salida]);
  return salida;
}

async function duracionS(wav: string): Promise<number> {
  const r = await ejec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]);
  return Number.parseFloat(r.stdout.trim());
}

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const entrada = args[0];
  if (entrada === undefined) {
    console.error('Uso: pnpm probar:stt <url|fichero> [--max-min 20]');
    process.exit(1);
  }
  const maxIdx = process.argv.indexOf('--max-min');
  const maxMin = maxIdx >= 0 ? Number(process.argv[maxIdx + 1] ?? 20) : 20;

  const log = pino({ level: 'warn' });
  const stt = createStt(log);
  console.log(`Proveedor de STT: ${stt.name}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-'));
  let origen = entrada;
  let titulo = path.basename(entrada);
  if (esUrl(entrada)) {
    console.log('Descargando audio (yt-dlp, solo bestaudio)…');
    const d = await descargarAudio(entrada, tmp);
    origen = d.fichero;
    titulo = d.titulo;
  }
  console.log(`Convirtiendo a wav 16 kHz mono (máx ${maxMin} min)…`);
  const wav = await aWav16k(origen, tmp, maxMin);
  const durS = await duracionS(wav);

  const t0 = Date.now();
  const tokens: BeatToken[] = [];
  let prompt = '';
  const bloques = Math.max(1, Math.ceil(durS / BLOQUE_S));
  for (let b = 0; b < bloques; b += 1) {
    const desde = b * BLOQUE_S;
    const dur = Math.min(BLOQUE_S, durS - desde);
    const bloqueWav = path.join(tmp, `bloque-${b}.wav`);
    await ejec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-ss', desde.toFixed(2), '-i', wav, '-t', dur.toFixed(2), '-c', 'copy', '-y', bloqueWav]);
    console.log(`Transcribiendo bloque ${b + 1}/${bloques} (${Math.round(dur)} s)…`);
    const r = await stt.transcribe(bloqueWav, { lang: 'es', ...(prompt !== '' ? { prompt } : {}) });
    tokens.push(...aTokens(r, desde * 1000));
    prompt = r.text.slice(-200);
  }
  const sttS = (Date.now() - t0) / 1000;

  if (tokens.length === 0) {
    console.error('El STT no devolvió palabras.');
    process.exit(1);
  }

  // el MISMO cruce que producción: silencios del audio, no huecos de whisper
  const silencios = await detectarSilencios(wav);
  const gate = cruzarConPausas(tokens, { silencios });
  const spans = spansDePausas(tokens, Math.round(durS * 1000), silencios);
  const derivaS = Math.abs(durS - tokens[tokens.length - 1]!.to_ms / 1000);
  const costeUsd = stt.name === 'whisper' ? (durS / 60) * PRICES.openai.stt_per_minute : 0;

  const informe = {
    titulo,
    fuente: entrada,
    proveedor: stt.name,
    modelo: stt.name === 'mlx' ? (process.env.STT_MLX_MODEL ?? 'turbo') : stt.name,
    fecha: new Date().toISOString(),
    duracion_min: Number((durS / 60).toFixed(1)),
    stt_segundos: Number(sttS.toFixed(0)),
    velocidad_x_tiempo_real: Number((durS / Math.max(1, sttS)).toFixed(1)),
    palabras: tokens.length,
    silencios: silencios.length,
    turnos: spans.length,
    gate,
    deriva_ultimo_token_s: Number(derivaS.toFixed(2)),
    coste_usd: Number(costeUsd.toFixed(3)),
    veredicto: gate.fuertes_por_min >= FUERTES_MIN_GATE ? 'GO' : 'NO-GO',
  };

  mkdirSync(BANCO, { recursive: true });
  const slug = titulo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const destino = path.join(BANCO, `${slug || 'episodio'}.json`);
  writeFileSync(destino, JSON.stringify(informe, null, 2));

  console.log(`\n«${titulo}» · ${informe.duracion_min} min · ${tokens.length} palabras · ${stt.name}`);
  console.log(`  transcripción          ${informe.stt_segundos} s (${informe.velocidad_x_tiempo_real}× tiempo real)`);
  console.log(`  fronteras fuertes      ${gate.fuertes_por_min.toFixed(1)}/min  [gate ≥${FUERTES_MIN_GATE}/min]`);
  console.log(`  puntuación ASR         ${gate.frases_asr} frases, ${gate.pct_confirmadas.toFixed(0)} % con pausa (informativo)`);
  console.log(`  forzadas por silencio  ${gate.forzadas} · silencios ${silencios.length} · turnos ${spans.length}`);
  console.log(`  deriva último token    ${informe.deriva_ultimo_token_s} s`);
  console.log(`  coste                  ${informe.coste_usd} $`);
  console.log(`  → ${informe.veredicto}`);
  console.log(`\nInforme: ${path.relative(RAIZ, destino)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
