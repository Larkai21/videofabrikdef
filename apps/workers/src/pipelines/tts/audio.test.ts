import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { describe, expect, it } from 'vitest';
import { measureLoudness, measureLufs } from './audio.js';

// El caso que motiva estos tests: `measureLufs` devolvía null en TODOS los
// vídeos producidos y nadie se enteró — el bloque JSON de loudnorm no es lo
// último que imprime ffmpeg (detrás van el resumen de muxing y `frame=…`), así
// que parsear desde el último '{' hasta el final del stderr fallaba siempre.
// Consecuencias silenciosas: master.audio.lufs vacío y la ganancia de entrega
// a −14 LUFS sin aplicarse nunca. Un fallback silencioso convierte un bug en
// una ausencia de dato, que es mucho más difícil de ver.

async function tonoWav(dbfs: number): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lufs-test-'));
  const out = path.join(dir, 'tono.wav');
  await execa('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100:duration=4',
    '-af',
    `volume=${dbfs}dB`,
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    out,
  ]);
  return out;
}

describe('measureLoudness', () => {
  it('mide de verdad un archivo real: ni null ni un valor inventado', async () => {
    const wav = await tonoWav(-20);
    try {
      const m = await measureLoudness(wav);
      expect(m).not.toBeNull();
      // Banda amplia a propósito: lo que se comprueba es que hay MEDIDA, no
      // un valor concreto. Un tono senoidal puro mide bastante por debajo de
      // su amplitud (el K-weighting de la norma pesa poco un 440 Hz solo):
      // −20 dBFS sale sobre −42 LUFS, no cerca de −20.
      expect(m!.lufs).toBeGreaterThan(-70);
      expect(m!.lufs).toBeLessThan(0);
      expect(m!.truePeakDb).toBeGreaterThan(-40);
      expect(m!.truePeakDb).toBeLessThan(6);
    } finally {
      await fs.rm(path.dirname(wav), { recursive: true, force: true });
    }
  });

  it('un tono más alto mide más alto: el valor sigue la señal', async () => {
    const bajo = await tonoWav(-30);
    const alto = await tonoWav(-10);
    try {
      const mb = await measureLoudness(bajo);
      const ma = await measureLoudness(alto);
      expect(mb).not.toBeNull();
      expect(ma).not.toBeNull();
      expect(ma!.lufs).toBeGreaterThan(mb!.lufs + 10);
    } finally {
      await fs.rm(path.dirname(bajo), { recursive: true, force: true });
      await fs.rm(path.dirname(alto), { recursive: true, force: true });
    }
  });

  it('measureLufs devuelve el mismo integrado', async () => {
    const wav = await tonoWav(-20);
    try {
      const [lufs, m] = await Promise.all([measureLufs(wav), measureLoudness(wav)]);
      expect(lufs).not.toBeNull();
      expect(lufs).toBeCloseTo(m!.lufs, 5);
    } finally {
      await fs.rm(path.dirname(wav), { recursive: true, force: true });
    }
  });
});
