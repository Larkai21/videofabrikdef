import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import type pino from 'pino';

// Proveedor de TTS tras interfaz (docs/voz-y-beats.md §1). Edge devuelve
// audio + WordBoundary por escena; el mock genera silencio con ffmpeg y
// boundaries equiespaciados para que todo el pipeline corra sin red.

export interface TtsWord {
  offset_ms: number;
  duration_ms: number;
  text: string;
}

export interface TtsSceneAudio {
  // archivo temporal (mp3/wav); el pipeline lo convierte, concatena y borra
  audioPath: string;
  words: TtsWord[];
}

export interface TtsProvider {
  readonly name: 'edge' | 'mock';
  synthesizeScene(text: string, opts: { voiceId: string; rate: string }): Promise<TtsSceneAudio>;
}

const SYNTH_TIMEOUT_MS = 120_000;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function tmpFile(ext: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fabrica-tts-'));
  return path.join(dir, `${randomUUID()}.${ext}`);
}

interface EdgeMetadataChunk {
  Metadata?: {
    Type?: string;
    Data?: {
      Offset?: number;
      Duration?: number;
      text?: { Text?: string };
    };
  }[];
}

export class EdgeTtsProvider implements TtsProvider {
  readonly name = 'edge' as const;

  constructor(private logger: pino.Logger) {
    // fallo temprano si el paquete no está instalable/resoluble
    const require = createRequire(import.meta.url);
    require.resolve('msedge-tts');
  }

  async synthesizeScene(
    text: string,
    opts: { voiceId: string; rate: string },
  ): Promise<TtsSceneAudio> {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(opts.voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
        wordBoundaryEnabled: true,
      });
      const { audioStream, metadataStream } = tts.toStream(escapeXml(text), { rate: opts.rate });

      const audioPath = await tmpFile('mp3');
      const words: TtsWord[] = [];

      metadataStream?.on('data', (chunk: Buffer) => {
        try {
          const parsed = JSON.parse(chunk.toString()) as EdgeMetadataChunk;
          for (const item of parsed.Metadata ?? []) {
            if (item.Type !== 'WordBoundary' || !item.Data) continue;
            // Offset/Duration llegan en ticks de 100 ns
            words.push({
              offset_ms: Math.round((item.Data.Offset ?? 0) / 10_000),
              duration_ms: Math.round((item.Data.Duration ?? 0) / 10_000),
              text: item.Data.text?.Text ?? '',
            });
          }
        } catch (err) {
          this.logger.warn({ err }, 'Metadato de edge-tts ilegible; se ignora el chunk');
        }
      });
      metadataStream?.on('error', () => {
        // el error real llega por audioStream; aquí solo evitamos un unhandled
      });

      await new Promise<void>((resolve, reject) => {
        const file = createWriteStream(audioPath);
        const timer = setTimeout(() => {
          audioStream.destroy(new Error('Tiempo de espera agotado en la síntesis edge-tts'));
        }, SYNTH_TIMEOUT_MS);
        audioStream.pipe(file);
        file.once('finish', () => {
          clearTimeout(timer);
          resolve();
        });
        audioStream.once('error', (err) => {
          clearTimeout(timer);
          file.destroy();
          reject(err);
        });
        file.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      if (words.length === 0) {
        throw new Error('edge-tts no devolvió word boundaries');
      }
      return { audioPath, words };
    } finally {
      try {
        tts.close();
      } catch {
        // la conexión puede estar ya cerrada
      }
    }
  }
}

const MOCK_WORDS_PER_SECOND = 2.5;

export class MockTtsProvider implements TtsProvider {
  readonly name = 'mock' as const;

  async synthesizeScene(text: string): Promise<TtsSceneAudio> {
    const tokens = text.split(/\s+/).filter(Boolean);
    const count = Math.max(1, tokens.length);
    const durationS = count / MOCK_WORDS_PER_SECOND;
    const audioPath = await tmpFile('wav');
    await execa('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=mono',
      '-t',
      durationS.toFixed(3),
      '-c:a',
      'pcm_s16le',
      audioPath,
    ]);
    const perWordMs = (durationS * 1000) / count;
    const words: TtsWord[] = tokens.map((token, i) => ({
      offset_ms: Math.round(i * perWordMs),
      duration_ms: Math.round(perWordMs * 0.9),
      text: token,
    }));
    return { audioPath, words };
  }
}

export function createTts(logger: pino.Logger): TtsProvider {
  const provider = process.env.TTS_PROVIDER ?? 'mock';
  if (provider === 'edge') {
    try {
      return new EdgeTtsProvider(logger);
    } catch (err) {
      logger.warn({ err }, 'edge-tts no disponible; degradando a TTS mock');
      return new MockTtsProvider();
    }
  }
  return new MockTtsProvider();
}
