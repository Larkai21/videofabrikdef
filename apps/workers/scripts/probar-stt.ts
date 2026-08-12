/**
 * Banco de STT para el pipeline de clipping (podcasts/directos → shorts).
 *
 *   pnpm probar:stt <url|fichero.wav> [--max-min 20] [--uniforme]
 *
 * Por qué existe: computeBeats y buildCues viven de `sentenceEnd`, que hoy da
 * la puntuación del GUION propio. Con material ajeno esa señal hay que
 * ganársela: si la puntuación del ASR no marca fronteras de frase reales, se
 * cae el principio 1 (un short nunca parte una frase) y todo lo que se
 * construya encima es arena. Este banco mide ANTES de construir el director:
 *
 *   - % de fines de frase confirmados por pausa acústica ≥300 ms (GATE ≥80 %)
 *   - frases por minuto y p95 de longitud de frase (>30 s = puntuación pobre)
 *   - deriva temporal del último token contra la duración real del audio
 *   - coste por minuto medido, contra el presupuesto (~0,006 $/min)
 *
 * Es el molde de probar-voz.ts aplicado al problema inverso: allí se medía la
 * voz que fabricamos, aquí la transcripción de una voz ajena. No toca BD ni
 * ledger: es un banco, no un job.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import OpenAI from 'openai';
import { loadEnv } from '../src/lib/env.js';

const ejec = promisify(execFile);
const RAIZ = path.resolve(process.cwd(), '../..');
const BANCO = path.join(RAIZ, 'banco', 'stt');

const COSTE_POR_MIN = 0.006; // whisper-1, ago-2026
const BLOQUE_S = 600; // trocear en ~10 min: el endpoint admite 25 MB
const PAUSA_CONFIRMA_MS = 300;
const GATE_PCT = 80;

interface Palabra {
  text: string;
  from_ms: number;
  to_ms: number;
  sentenceEnd: boolean;
}

function esUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

/** Descarga SOLO el audio con yt-dlp (dos pasos: metadatos → bestaudio). */
async function descargarAudio(url: string, destDir: string): Promise<{ wav: string; titulo: string }> {
  const meta = await ejec('yt-dlp', ['-J', '--no-playlist', url], { maxBuffer: 64 * 1024 * 1024 });
  const info = JSON.parse(meta.stdout) as {
    title?: string;
    duration?: number;
    is_live?: boolean;
    live_status?: string;
  };
  if (info.is_live === true || info.live_status === 'is_live') {
    throw new Error('Es un directo en emisión: el pipeline trabaja con VOD');
  }
  if ((info.duration ?? 0) > 4 * 3600) {
    throw new Error(`Dura ${Math.round((info.duration ?? 0) / 60)} min: el tope son 4 h`);
  }
  console.log(`  «${info.title ?? url}» · ${Math.round((info.duration ?? 0) / 60)} min`);
  const salida = path.join(destDir, 'audio.%(ext)s');
  await ejec(
    'yt-dlp',
    ['--no-playlist', '-f', 'bestaudio/best', '-o', salida, url],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const fichero = fs.readdirSync(destDir).find((f) => f.startsWith('audio.'));
  if (fichero === undefined) throw new Error('yt-dlp no dejó ningún fichero de audio');
  return { wav: path.join(destDir, fichero), titulo: info.title ?? url };
}

/** A wav 16 kHz mono (lo que pide whisper), recortado a maxMin. */
async function aWav16k(entrada: string, destDir: string, maxMin: number): Promise<string> {
  const salida = path.join(destDir, 'stt.wav');
  await ejec('ffmpeg', [
    '-nostdin',
    '-loglevel',
    'error',
    '-i',
    entrada,
    '-t',
    String(maxMin * 60),
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-y',
    salida,
  ]);
  return salida;
}

async function duracionS(wav: string): Promise<number> {
  const r = await ejec('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    wav,
  ]);
  return Number.parseFloat(r.stdout.trim());
}

/** Corta un bloque [desde, hasta] a un wav propio (utilidad de ingesta). */
async function cortarBloque(wav: string, desdeS: number, durS: number, destino: string): Promise<void> {
  await ejec('ffmpeg', [
    '-nostdin',
    '-loglevel',
    'error',
    '-ss',
    desdeS.toFixed(2),
    '-i',
    wav,
    '-t',
    durS.toFixed(2),
    '-c',
    'copy',
    '-y',
    destino,
  ]);
}

interface RespuestaWhisper {
  text: string;
  words?: { word: string; start: number; end: number }[];
  segments?: { text: string; start: number; end: number }[];
}

async function transcribirBloque(
  client: OpenAI,
  wav: string,
  prompt: string,
): Promise<RespuestaWhisper> {
  const r = await client.audio.transcriptions.create({
    file: fs.createReadStream(wav),
    model: 'whisper-1',
    language: 'es',
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'],
    ...(prompt !== '' ? { prompt } : {}),
  });
  return r as unknown as RespuestaWhisper;
}

/**
 * De la respuesta de whisper a tokens con sentenceEnd. La puntuación viene en
 * los SEGMENTS (los words llegan pelados), así que se re-reparte: se recorre
 * el texto del segmento en paralelo a sus words y un token que en el texto
 * termina en [.?!…] marca fin de frase.
 */
function aTokens(r: RespuestaWhisper, offsetMs: number): Palabra[] {
  const words = r.words ?? [];
  const out: Palabra[] = words.map((w) => ({
    text: w.word.trim(),
    from_ms: offsetMs + Math.round(w.start * 1000),
    to_ms: offsetMs + Math.round(w.end * 1000),
    sentenceEnd: false,
  }));
  // reparto de puntuación: para cada segmento, sus frases terminan donde el
  // texto tiene puntuación fuerte; se marca el token cuyo texto coincide con
  // la última palabra de cada frase del segmento
  let cursor = 0;
  for (const seg of r.segments ?? []) {
    const frases = seg.text.split(/(?<=[.?!…])\s+/).filter((f) => f.trim() !== '');
    for (const frase of frases) {
      const palabras = frase
        .trim()
        .split(/\s+/)
        .filter((p) => p !== '');
      if (palabras.length === 0) continue;
      const n = palabras.length;
      const idxFin = cursor + n - 1;
      if (idxFin < out.length && /[.?!…]$/.test(frase.trim())) {
        out[idxFin]!.sentenceEnd = true;
      }
      cursor += n;
    }
  }
  return out;
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
  if (process.env.OPENAI_API_KEY === undefined || process.env.OPENAI_API_KEY === '') {
    console.error('Falta OPENAI_API_KEY (whisper-1 va por la API de OpenAI).');
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-'));
  let origen = entrada;
  let titulo = path.basename(entrada);
  if (esUrl(entrada)) {
    console.log('Descargando audio (yt-dlp, solo bestaudio)…');
    const d = await descargarAudio(entrada, tmp);
    origen = d.wav;
    titulo = d.titulo;
  }
  console.log(`Convirtiendo a wav 16 kHz mono (máx ${maxMin} min)…`);
  const wav = await aWav16k(origen, tmp, maxMin);
  const durS = await duracionS(wav);

  const client = new OpenAI();
  const tokens: Palabra[] = [];
  let prompt = '';
  const bloques = Math.max(1, Math.ceil(durS / BLOQUE_S));
  for (let b = 0; b < bloques; b += 1) {
    const desde = b * BLOQUE_S;
    const dur = Math.min(BLOQUE_S, durS - desde);
    const bloqueWav = path.join(tmp, `bloque-${b}.wav`);
    await cortarBloque(wav, desde, dur, bloqueWav);
    console.log(`Transcribiendo bloque ${b + 1}/${bloques} (${Math.round(dur)} s)…`);
    const r = await transcribirBloque(client, bloqueWav, prompt);
    tokens.push(...aTokens(r, desde * 1000));
    // encadenado: la cola del bloque anterior orienta el estilo del siguiente
    prompt = r.text.slice(-200);
  }

  if (tokens.length === 0) {
    console.error('Whisper no devolvió palabras.');
    process.exit(1);
  }

  // ---- el gate
  const fines = tokens.filter((t) => t.sentenceEnd);
  let confirmadas = 0;
  for (const t of fines) {
    const i = tokens.indexOf(t);
    const sig = tokens[i + 1];
    const gap = sig === undefined ? Number.POSITIVE_INFINITY : sig.from_ms - t.to_ms;
    if (gap >= PAUSA_CONFIRMA_MS) confirmadas += 1;
  }
  const pct = fines.length > 0 ? (100 * confirmadas) / fines.length : 0;

  const longitudes: number[] = [];
  let inicio = tokens[0]!.from_ms;
  for (const t of tokens) {
    if (t.sentenceEnd) {
      longitudes.push((t.to_ms - inicio) / 1000);
      inicio = t.to_ms;
    }
  }
  const ordenadas = [...longitudes].sort((a, b) => a - b);
  const p95 = ordenadas[Math.min(ordenadas.length - 1, Math.floor(ordenadas.length * 0.95))] ?? null;
  const frasesMin = durS > 0 ? fines.length / (durS / 60) : 0;
  const derivaS = Math.abs(durS - tokens[tokens.length - 1]!.to_ms / 1000);
  const costeUsd = (durS / 60) * COSTE_POR_MIN;

  const informe = {
    titulo,
    fuente: entrada,
    fecha: new Date().toISOString(),
    duracion_min: Number((durS / 60).toFixed(1)),
    palabras: tokens.length,
    frases: fines.length,
    frases_min: Number(frasesMin.toFixed(1)),
    pct_confirmadas_por_pausa: Number(pct.toFixed(1)),
    p95_longitud_frase_s: p95 !== null ? Number(p95.toFixed(1)) : null,
    deriva_ultimo_token_s: Number(derivaS.toFixed(2)),
    coste_usd: Number(costeUsd.toFixed(3)),
    gate: pct >= GATE_PCT ? 'GO' : 'NO-GO',
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

  console.log(`\n«${titulo}» · ${informe.duracion_min} min · ${tokens.length} palabras`);
  console.log(`  frases                 ${fines.length} (${informe.frases_min}/min)`);
  console.log(
    `  confirmadas por pausa  ${confirmadas}/${fines.length} (${informe.pct_confirmadas_por_pausa} %)  [gate ≥${GATE_PCT} %]`,
  );
  console.log(`  p95 longitud de frase  ${informe.p95_longitud_frase_s ?? '—'} s`);
  console.log(`  deriva último token    ${informe.deriva_ultimo_token_s} s`);
  console.log(`  coste                  ${informe.coste_usd} $ (${COSTE_POR_MIN} $/min)`);
  console.log(`  → ${informe.gate}`);
  console.log(`\nInforme: ${path.relative(RAIZ, destino)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
