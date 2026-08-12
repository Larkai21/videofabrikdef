import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import OpenAI from 'openai';
import type pino from 'pino';

const ejec = promisify(execFile);

// Proveedor de STT para episodios externos (clipping). La voz PROPIA no pasa
// por aquí jamás: sus boundaries los da el TTS y son la verdad
// (docs/voz-y-beats.md §Whisper). Esto existe solo porque el audio ajeno no
// trae guion del que recuperar la puntuación.
//
// whisper-1 por API: el SDK openai ya está instalado, da word+segment
// timestamps y cuesta 0,006 $/min (0,72 $ por episodio de 2 h). Un whisper
// local sería un segundo backend sin banco que lo respalde — v2 si el coste
// lo pide. Mock determinista, como todo proveedor del repo.

export interface SttWord {
  text: string;
  from_ms: number;
  to_ms: number;
}

export interface SttSegment {
  /** texto CON puntuación: es de donde se reparte sentenceEnd a los words */
  text: string;
  from_ms: number;
  to_ms: number;
}

export interface SttBlockResult {
  text: string;
  words: SttWord[];
  segments: SttSegment[];
}

export interface SttProvider {
  readonly name: 'whisper' | 'mock';
  /** Transcribe UN bloque de audio (≤ ~10 min: el endpoint admite 25 MB). */
  transcribe(wavPath: string, opts: { lang: string; prompt?: string }): Promise<SttBlockResult>;
}

class WhisperSttProvider implements SttProvider {
  readonly name = 'whisper' as const;
  private client = new OpenAI();

  async transcribe(
    wavPath: string,
    opts: { lang: string; prompt?: string },
  ): Promise<SttBlockResult> {
    const r = (await this.client.audio.transcriptions.create({
      file: fs.createReadStream(wavPath),
      model: 'whisper-1',
      language: opts.lang,
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
      ...(opts.prompt !== undefined && opts.prompt !== '' ? { prompt: opts.prompt } : {}),
    })) as unknown as {
      text: string;
      words?: { word: string; start: number; end: number }[];
      segments?: { text: string; start: number; end: number }[];
    };
    return {
      text: r.text,
      words: (r.words ?? []).map((w) => ({
        text: w.word.trim(),
        from_ms: Math.round(w.start * 1000),
        to_ms: Math.round(w.end * 1000),
      })),
      segments: (r.segments ?? []).map((s) => ({
        text: s.text,
        from_ms: Math.round(s.start * 1000),
        to_ms: Math.round(s.end * 1000),
      })),
    };
  }
}

/**
 * Mock determinista: frases de 8 palabras a ~150 wpm que llenan la duración
 * real del wav (ffprobe), con pausa de 500 ms entre frases — suficiente para
 * que tokens, fronteras por pausa, beats y candidatos corran sin red.
 */
class MockSttProvider implements SttProvider {
  readonly name = 'mock' as const;

  async transcribe(wavPath: string): Promise<SttBlockResult> {
    const r = await ejec('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'csv=p=0',
      wavPath,
    ]);
    const durMs = Math.round(Number.parseFloat(r.stdout.trim()) * 1000);
    const PALABRA_MS = 400;
    const PAUSA_MS = 500;
    const POR_FRASE = 8;
    const BASE = ['esto', 'es', 'una', 'frase', 'de', 'prueba', 'del', 'mock'];
    const words: SttWord[] = [];
    const segments: SttSegment[] = [];
    let t = 0;
    let frase = 0;
    while (t + POR_FRASE * PALABRA_MS <= durMs) {
      const iniFrase = t;
      const trozos: string[] = [];
      for (let i = 0; i < POR_FRASE; i += 1) {
        const texto = BASE[i % BASE.length]!;
        words.push({ text: texto, from_ms: t, to_ms: t + PALABRA_MS - 50 });
        trozos.push(texto);
        t += PALABRA_MS;
      }
      const textoFrase = `${trozos.join(' ')}.`;
      segments.push({ text: textoFrase, from_ms: iniFrase, to_ms: t });
      t += PAUSA_MS;
      frase += 1;
    }
    return { text: segments.map((s) => s.text).join(' '), words, segments };
  }
}

export function createStt(logger: pino.Logger): SttProvider {
  const provider = process.env.STT_PROVIDER ?? 'whisper';
  if (provider === 'mock') {
    logger.info('Proveedor de STT en modo mock: no se sale a red');
    return new MockSttProvider();
  }
  if (process.env.OPENAI_API_KEY === undefined || process.env.OPENAI_API_KEY === '') {
    logger.warn('Falta OPENAI_API_KEY; el STT degrada a mock (transcripción sintética)');
    return new MockSttProvider();
  }
  return new WhisperSttProvider();
}
