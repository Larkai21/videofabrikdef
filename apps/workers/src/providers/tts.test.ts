import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTts,
  elevenLabsAlignmentToWords,
  rateToSpeed,
  type ElevenLabsAlignment,
} from './tts.js';

const logger = pino({ level: 'silent' });

// Fixture con la forma real de la respuesta with-timestamps de ElevenLabs:
// alineación por carácter de la frase "Hola mundo.\nAdiós" (espacios y saltos
// de línea separan palabras; la puntuación queda pegada a su palabra).
function fixtureAlignment(): ElevenLabsAlignment {
  const chars = ['H', 'o', 'l', 'a', ' ', 'm', 'u', 'n', 'd', 'o', '.', '\n', 'A', 'd', 'i', 'ó', 's'];
  const starts = chars.map((_, i) => i * 0.05);
  const ends = chars.map((_, i) => i * 0.05 + 0.05);
  return {
    characters: chars,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

describe('elevenLabsAlignmentToWords', () => {
  it('agrupa los caracteres en palabras con offset y duración en ms', () => {
    const words = elevenLabsAlignmentToWords(fixtureAlignment());
    expect(words.map((w) => w.text)).toEqual(['Hola', 'mundo.', 'Adiós']);
    // 'Hola': chars 0-3 → 0 ms a 200 ms
    expect(words[0]).toEqual({ offset_ms: 0, duration_ms: 200, text: 'Hola' });
    // 'mundo.': chars 5-10 → 250 ms a 550 ms (la puntuación cuenta en la duración)
    expect(words[1]).toEqual({ offset_ms: 250, duration_ms: 300, text: 'mundo.' });
    // 'Adiós': chars 12-16 → 600 ms a 850 ms
    expect(words[2]).toEqual({ offset_ms: 600, duration_ms: 250, text: 'Adiós' });
  });

  it('tolera espacios múltiples, espacios al borde y entrada vacía', () => {
    const chars = [' ', 'a', ' ', ' ', 'b', ' '];
    const words = elevenLabsAlignmentToWords({
      characters: chars,
      character_start_times_seconds: chars.map((_, i) => i * 0.1),
      character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.1),
    });
    expect(words.map((w) => w.text)).toEqual(['a', 'b']);
    expect(words[0]?.offset_ms).toBe(100);
    expect(words[1]?.offset_ms).toBe(400);

    expect(
      elevenLabsAlignmentToWords({
        characters: [],
        character_start_times_seconds: [],
        character_end_times_seconds: [],
      }),
    ).toEqual([]);
  });
});

describe('rateToSpeed', () => {
  it('convierte el rate estilo edge al speed de ElevenLabs con límites', () => {
    expect(rateToSpeed('-8%')).toBeCloseTo(0.92);
    expect(rateToSpeed('+15%')).toBeCloseTo(1.15);
    expect(rateToSpeed('0%')).toBe(1);
    // fuera de rango se acota a lo que acepta la API
    expect(rateToSpeed('-40%')).toBe(0.7);
    expect(rateToSpeed('+80%')).toBe(1.2);
    // entrada ilegible → velocidad normal
    expect(rateToSpeed('rápido')).toBe(1);
  });
});

describe('createTts (factoría por canal)', () => {
  const saved = {
    TTS_PROVIDER: process.env.TTS_PROVIDER,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  };

  beforeEach(() => {
    delete process.env.TTS_PROVIDER;
    delete process.env.ELEVENLABS_API_KEY;
  });

  afterEach(() => {
    if (saved.TTS_PROVIDER === undefined) delete process.env.TTS_PROVIDER;
    else process.env.TTS_PROVIDER = saved.TTS_PROVIDER;
    if (saved.ELEVENLABS_API_KEY === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = saved.ELEVENLABS_API_KEY;
  });

  it('sin ELEVENLABS_API_KEY el canal elevenlabs degrada al proveedor base', () => {
    process.env.TTS_PROVIDER = 'edge';
    const factory = createTts(logger);
    expect(factory.base.name).toBe('edge');
    expect(factory.providerFor('elevenlabs').name).toBe('edge');
    expect(factory.providerFor('edge').name).toBe('edge');
    expect(factory.providerFor(undefined).name).toBe('edge');
  });

  it('con clave, el canal elevenlabs recibe el proveedor elevenlabs', () => {
    process.env.TTS_PROVIDER = 'edge';
    process.env.ELEVENLABS_API_KEY = 'clave-de-prueba';
    const factory = createTts(logger);
    const provider = factory.providerFor('elevenlabs');
    expect(provider.name).toBe('elevenlabs');
    expect(provider.model).toBeTruthy();
    // la instancia se reutiliza entre escenas
    expect(factory.providerFor('elevenlabs')).toBe(provider);
  });

  it('en modo mock global nunca se sale a red aunque el canal pida elevenlabs', () => {
    process.env.TTS_PROVIDER = 'mock';
    process.env.ELEVENLABS_API_KEY = 'clave-de-prueba';
    const factory = createTts(logger);
    expect(factory.providerFor('elevenlabs').name).toBe('mock');
  });
});
