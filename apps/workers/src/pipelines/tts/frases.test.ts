import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PAUSE_SENTENCE_MS } from '@fabrica/shared';
import { describe, expect, it } from 'vitest';
import type { TtsProvider } from '../../providers/tts.js';
import { probeDurationMs } from './audio.js';
import { frasesParaSintesis, synthesizeSceneConPausas } from './frases.js';

describe('frasesParaSintesis', () => {
  it('parte por puntuación fuerte (punto y coma incluido) y conserva el texto', () => {
    const frases = frasesParaSintesis(
      'La cadena empieza el lunes por la mañana. No admite prórroga de ningún tipo; el plazo es fijo desde el principio. ¿Quién la controla entonces?',
    );
    expect(frases).toEqual([
      'La cadena empieza el lunes por la mañana.',
      'No admite prórroga de ningún tipo;',
      'el plazo es fijo desde el principio.',
      '¿Quién la controla entonces?',
    ]);
  });

  it('pega los fragmentos muy cortos al anterior: tres palabras sueltas salen con prosodia rara', () => {
    const frases = frasesParaSintesis('El resultado sorprendió a todo el laboratorio. ¿Sí? Nadie lo esperaba de un modelo tan pequeño.');
    expect(frases).toEqual([
      'El resultado sorprendió a todo el laboratorio. ¿Sí?',
      'Nadie lo esperaba de un modelo tan pequeño.',
    ]);
  });

  it('una escena de una sola frase queda intacta', () => {
    expect(frasesParaSintesis('Todo en una sola frase sin puntos internos')).toEqual([
      'Todo en una sola frase sin puntos internos',
    ]);
  });
});

// proveedor falso: cada frase produce un «audio» de silencio de duración
// proporcional a sus caracteres, con una palabra por token del texto
function fakeTts(msPorChar: number): TtsProvider {
  return {
    name: 'mock',
    async synthesizeScene(text) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-tts-'));
      const audioPath = path.join(dir, 'out.wav');
      const durMs = Math.max(120, Math.round(text.length * msPorChar));
      const { execa } = await import('execa');
      await execa('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=44100:cl=mono',
        '-t',
        (durMs / 1000).toFixed(3),
        '-c:a',
        'pcm_s16le',
        audioPath,
      ]);
      const words = text.split(/\s+/).map((w, i) => ({
        offset_ms: i * 100,
        duration_ms: 90,
        text: w,
      }));
      return { audioPath, words };
    },
  };
}

describe('synthesizeSceneConPausas', () => {
  it('inserta la pausa entre frases y re-basa las palabras dentro de la escena', async () => {
    const tts = fakeTts(10);
    const texto = 'Primera frase con varias palabras aquí. Segunda frase igual de larga aquí.';
    const res = await synthesizeSceneConPausas(tts, texto, { voiceId: 'v', rate: '0%' }, 0);
    try {
      // duración total ≈ frase1 + PAUSA + frase2
      const total = await probeDurationMs(res.audioPath);
      const f1 = Math.max(120, Math.round('Primera frase con varias palabras aquí.'.length * 10));
      const f2 = Math.max(120, Math.round('Segunda frase igual de larga aquí.'.length * 10));
      expect(Math.abs(total - (f1 + PAUSE_SENTENCE_MS + f2))).toBeLessThan(60);
      // la primera palabra de la segunda frase arranca tras la primera + pausa
      const palabras = res.words.map((w) => w.text);
      const idxSegunda = palabras.indexOf('Segunda');
      expect(idxSegunda).toBeGreaterThan(0);
      const offSegunda = res.words[idxSegunda]!.offset_ms;
      expect(offSegunda).toBeGreaterThanOrEqual(f1 + PAUSE_SENTENCE_MS - 60);
      // y las palabras siguen ordenadas
      for (let i = 1; i < res.words.length; i++) {
        expect(res.words[i]!.offset_ms).toBeGreaterThanOrEqual(res.words[i - 1]!.offset_ms);
      }
    } finally {
      await fs.rm(path.dirname(res.audioPath), { recursive: true, force: true });
    }
  });

  it('una escena de una frase no toca el camino nuevo', async () => {
    const tts = fakeTts(10);
    const res = await synthesizeSceneConPausas(
      tts,
      'Una sola frase sin cortes internos',
      { voiceId: 'v', rate: '0%' },
      0,
    );
    expect(res.words[0]!.offset_ms).toBe(0);
    await fs.rm(path.dirname(res.audioPath), { recursive: true, force: true });
  });
});
