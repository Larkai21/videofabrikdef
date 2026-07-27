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
  readonly name: 'edge' | 'elevenlabs' | 'mock';
  // modelo remoto usado (para meta del ledger); solo lo informa elevenlabs
  readonly model?: string;
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

// ---- ElevenLabs (docs/voz-y-beats.md §5) ----
// Endpoint with-timestamps: devuelve audio en base64 + alineación por carácter.
// Se convierte a WordBoundary {offset_ms, duration_ms, text} agrupando por
// palabras (los espacios separan) para que el resto del pipeline no cambie.

export const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_flash_v2_5';

export interface ElevenLabsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface ElevenLabsTimestampsResponse {
  audio_base64?: string;
  alignment?: ElevenLabsAlignment | null;
  normalized_alignment?: ElevenLabsAlignment | null;
}

// Agrupa la alineación por carácter en palabras: cualquier espacio en blanco
// separa; la puntuación queda pegada a su palabra (alignSceneTokens ya la
// normaliza al alinear con el guion). Pura, testeable con fixture.
export function elevenLabsAlignmentToWords(alignment: ElevenLabsAlignment): TtsWord[] {
  const words: TtsWord[] = [];
  let current = '';
  let startS: number | null = null;
  let endS = 0;

  const flush = () => {
    if (current === '' || startS === null) return;
    const offsetMs = Math.round(startS * 1000);
    words.push({
      offset_ms: offsetMs,
      duration_ms: Math.max(0, Math.round(endS * 1000) - offsetMs),
      text: current,
    });
    current = '';
    startS = null;
  };

  for (let i = 0; i < alignment.characters.length; i++) {
    const ch = alignment.characters[i] ?? '';
    if (/\s/.test(ch) || ch === '') {
      flush();
      continue;
    }
    if (startS === null) startS = alignment.character_start_times_seconds[i] ?? 0;
    endS = alignment.character_end_times_seconds[i] ?? endS;
    current += ch;
  }
  flush();
  return words;
}

// El rate estilo edge ('-8%') se traduce al speed de ElevenLabs (1.0 = normal),
// acotado al rango que acepta la API (0.7–1.2). Entrada ilegible → 1.0.
export function rateToSpeed(rate: string): number {
  const match = /^([+-]?\d+(?:\.\d+)?)%$/.exec(rate.trim());
  if (!match) return 1;
  const pct = Number.parseFloat(match[1] ?? '0');
  if (!Number.isFinite(pct)) return 1;
  return Math.min(1.2, Math.max(0.7, 1 + pct / 100));
}

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = 'elevenlabs' as const;
  readonly model = ELEVENLABS_MODEL_ID;

  constructor(
    private logger: pino.Logger,
    private apiKey: string,
  ) {}

  async synthesizeScene(
    text: string,
    opts: { voiceId: string; rate: string },
  ): Promise<TtsSceneAudio> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(opts.voiceId)}/with-timestamps?output_format=mp3_44100_128`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: this.model,
        voice_settings: { speed: rateToSpeed(opts.rate) },
      }),
      signal: AbortSignal.timeout(SYNTH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ElevenLabs respondió ${res.status}: ${body.slice(0, 300)}`);
    }
    const payload = (await res.json()) as ElevenLabsTimestampsResponse;
    if (!payload.audio_base64) {
      throw new Error('ElevenLabs no devolvió audio_base64');
    }
    // la alineación del texto original conserva la puntuación del guion;
    // la normalizada es el respaldo si la primera falta
    const alignment = payload.alignment ?? payload.normalized_alignment;
    if (!alignment || alignment.characters.length === 0) {
      throw new Error('ElevenLabs no devolvió alineación por carácter');
    }
    const words = elevenLabsAlignmentToWords(alignment);
    if (words.length === 0) {
      throw new Error('La alineación de ElevenLabs no produjo palabras');
    }
    const audioPath = await tmpFile('mp3');
    await fs.writeFile(audioPath, Buffer.from(payload.audio_base64, 'base64'));
    this.logger.debug({ chars: text.length, words: words.length }, 'Escena sintetizada con ElevenLabs');
    return { audioPath, words };
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

// Factoría por canal: TTS_PROVIDER de env fija el proveedor base (mock apaga
// toda red); profile.voice.provider === 'elevenlabs' activa ElevenLabs por
// canal si hay ELEVENLABS_API_KEY. Sin clave → warn y cae al proveedor base.
export interface TtsFactory {
  readonly base: TtsProvider;
  providerFor(voiceProvider?: 'edge' | 'elevenlabs'): TtsProvider;
}

function createBaseProvider(logger: pino.Logger): TtsProvider {
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

export function createTts(logger: pino.Logger): TtsFactory {
  const base = createBaseProvider(logger);
  let elevenlabs: ElevenLabsTtsProvider | null = null;
  return {
    base,
    providerFor(voiceProvider) {
      if (voiceProvider !== 'elevenlabs') return base;
      // en modo mock global no se sale a red aunque el canal pida elevenlabs
      if (base.name === 'mock') return base;
      const apiKey = process.env.ELEVENLABS_API_KEY;
      if (!apiKey) {
        logger.warn(
          'El canal pide ElevenLabs pero falta ELEVENLABS_API_KEY; degradando a edge-tts',
        );
        return base;
      }
      if (!elevenlabs) elevenlabs = new ElevenLabsTtsProvider(logger, apiKey);
      return elevenlabs;
    },
  };
}
