import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { PAUSE_SENTENCE_MS, sentences } from '@fabrica/shared';
import type { TtsProvider, TtsSceneAudio, TtsWord } from '../../providers/tts.js';
import { concatWavs, makeSilence, probeDurationMs, toWav } from './audio.js';

// Síntesis POR FRASE dentro de la escena, con pausa de respiración entre
// frases (PAUSE_SENTENCE_MS). El TTS lee una escena de 60 palabras de un
// tirón, con pausas de puntuación mínimas: a formato largo el ritmo plano se
// nota. Sintetizar cada frase por separado e insertar el silencio nosotros da
// la cadencia de alguien que respira.
//
// El contrato de salida es EL MISMO TtsSceneAudio que la síntesis de escena
// entera: un audio por escena y palabras con offsets relativos a su inicio.
// Todo lo de aguas abajo (sceneOffsets, alignSceneTokens y sus invariantes,
// cues, beats) no distingue los dos caminos. Mismos caracteres por frase, más
// peticiones HTTP; los caracteres REALES facturados (con reintentos) se
// cuentan con `contabiliza`.

/** Frases para sintetizar: los fragmentos muy cortos («¿Sí?») se pegan al
 * anterior — una llamada TTS de tres palabras sale con prosodia rara. */
export function frasesParaSintesis(text: string, minChars = 20): string[] {
  const frases = sentences(text);
  const out: string[] = [];
  for (const f of frases) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (f.length < minChars || prev.length < minChars)) {
      out[out.length - 1] = `${prev} ${f}`;
    } else {
      out.push(f);
    }
  }
  return out;
}

/** Umbral y duración mínima para considerar «silencio» los bordes del WAV. */
const SILENCIO_DB = '-45dB';
const SILENCIO_MIN_S = 0.05;
/** Margen que se CONSERVA al recortar: un corte a hueso suena amputado. */
const MARGEN_S = 0.05;

/**
 * Recorta el silencio de cabecera y cola que el sintetizador añade a cada
 * locución. Sin esto, la «pausa de 180 ms» entre frases salía de ~1,4 s en el
 * audio real (edge-tts acolcha cada petición) y el ritmo quedaba PEOR que
 * sintetizando la escena entera. Devuelve cuánto se recortó de cabecera, que
 * es lo que hay que restar a los offsets de palabra de esa frase.
 */
export async function recortarSilencios(
  inputWav: string,
  outputWav: string,
): Promise<{ headMs: number }> {
  const durS = (await probeDurationMs(inputWav)) / 1000;
  const { stderr } = await execa('ffmpeg', [
    '-hide_banner',
    '-i',
    inputWav,
    '-af',
    `silencedetect=n=${SILENCIO_DB}:d=${SILENCIO_MIN_S}`,
    '-f',
    'null',
    '-',
  ]);
  const tramos: Array<{ start: number; end: number }> = [];
  let pendiente: number | null = null;
  for (const linea of stderr.split('\n')) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(linea);
    if (s) pendiente = Number.parseFloat(s[1]!);
    const e = /silence_end:\s*(-?[\d.]+)/.exec(linea);
    if (e && pendiente !== null) {
      tramos.push({ start: pendiente, end: Number.parseFloat(e[1]!) });
      pendiente = null;
    }
  }
  // silencio abierto al final del archivo (sin silence_end)
  if (pendiente !== null) tramos.push({ start: pendiente, end: durS });

  const cabeza = tramos.find((t) => t.start <= 0.01);
  const cola = [...tramos].reverse().find((t) => t.end >= durS - 0.01);
  const desde = cabeza ? Math.max(0, cabeza.end - MARGEN_S) : 0;
  const hasta = cola ? Math.min(durS, Math.max(desde + 0.1, cola.start + MARGEN_S)) : durS;
  if (desde <= 0.005 && hasta >= durS - 0.005) {
    // nada que recortar: se copia tal cual
    await fs.copyFile(inputWav, outputWav);
    return { headMs: 0 };
  }
  await execa('ffmpeg', [
    '-y',
    '-i',
    inputWav,
    '-af',
    `atrim=start=${desde.toFixed(3)}:end=${hasta.toFixed(3)},asetpts=PTS-STARTPTS`,
    '-c:a',
    'pcm_s16le',
    outputWav,
  ]);
  return { headMs: Math.round(desde * 1000) };
}

export async function synthesizeSceneConPausas(
  tts: TtsProvider,
  sceneText: string,
  opts: { voiceId: string; rate: string },
  retries: number,
  /** caracteres REALMENTE enviados al proveedor, reintentos incluidos (ledger) */
  contabiliza?: (chars: number) => void,
): Promise<TtsSceneAudio> {
  const synthOne = async (text: string): Promise<TtsSceneAudio> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      contabiliza?.(text.length);
      try {
        return await tts.synthesizeScene(text, opts);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };

  const frases = frasesParaSintesis(sceneText);
  if (frases.length <= 1) return synthOne(sceneText);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fabrica-frases-'));
  try {
    const parts: string[] = [];
    const words: TtsWord[] = [];
    const silencio = path.join(workDir, 'pausa.wav');
    await makeSilence(PAUSE_SENTENCE_MS, silencio);
    let cursor = 0;
    for (let k = 0; k < frases.length; k++) {
      const frase = frases[k]!;
      const res = await synthOne(frase);
      const crudo = path.join(workDir, `frase-${k}-cruda.wav`);
      const wav = path.join(workDir, `frase-${k}.wav`);
      let headMs = 0;
      try {
        await toWav(res.audioPath, crudo);
        // el sintetizador acolcha cada locución con silencio: sin recortarlo,
        // la pausa de 180 ms salía de ~1,4 s y el ritmo quedaba peor que antes
        headMs = (await recortarSilencios(crudo, wav)).headMs;
      } finally {
        // el directorio temporal del proveedor no debe sobrevivir ni al fallo
        await fs.rm(path.dirname(res.audioPath), { recursive: true, force: true });
      }
      if (k > 0) {
        parts.push(silencio);
        cursor += PAUSE_SENTENCE_MS;
      }
      // re-basado DENTRO de la escena: offset relativo a la frase, menos el
      // silencio de cabecera recortado, más el inicio de la frase en la escena
      for (const w of res.words) {
        words.push({ ...w, offset_ms: Math.max(0, w.offset_ms - headMs) + cursor });
      }
      parts.push(wav);
      cursor += await probeDurationMs(wav);
    }
    // el audio de escena vive en su propio directorio temporal, como el que
    // devuelve el proveedor: el llamador hace rm(dirname) al consumirlo
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fabrica-escena-'));
    const outPath = path.join(outDir, 'escena.wav');
    await concatWavs(parts, outPath);
    return { audioPath: outPath, words };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
