import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
// cues, beats) no distingue los dos caminos. Mismos caracteres facturados
// (ElevenLabs cobra por carácter), más peticiones HTTP.

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

export async function synthesizeSceneConPausas(
  tts: TtsProvider,
  sceneText: string,
  opts: { voiceId: string; rate: string },
  retries: number,
): Promise<TtsSceneAudio> {
  const synthOne = async (text: string): Promise<TtsSceneAudio> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
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
      const wav = path.join(workDir, `frase-${k}.wav`);
      await toWav(res.audioPath, wav);
      await fs.rm(path.dirname(res.audioPath), { recursive: true, force: true });
      if (k > 0) {
        parts.push(silencio);
        cursor += PAUSE_SENTENCE_MS;
      }
      // re-basado DENTRO de la escena: la palabra conserva su offset relativo
      // a la frase más el inicio de la frase en el audio de escena
      for (const w of res.words) {
        words.push({ ...w, offset_ms: w.offset_ms + cursor });
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
