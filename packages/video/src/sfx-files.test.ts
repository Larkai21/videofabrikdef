import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX_NAMES } from '@fabrica/shared';
import { describe, expect, it } from 'vitest';

// Los .wav están versionados, así que este test corre sin ffmpeg. Cruza el enum
// del contrato con el disco en LOS DOS sentidos: un nombre sin fichero produce
// un 404 mudo en el render, y un fichero sin nombre es peso muerto en el bundle.

const sfxDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sfx');

describe('ficheros de SFX', () => {
  const enDisco = readdirSync(sfxDir).filter((f) => f.endsWith('.wav'));

  it('cada nombre del contrato tiene su fichero con contenido', () => {
    for (const name of SFX_NAMES) {
      const file = path.join(sfxDir, `${name}.wav`);
      expect(enDisco, `falta ${name}.wav — ejecuta pnpm sfx`).toContain(`${name}.wav`);
      expect(statSync(file).size, `${name}.wav está vacío`).toBeGreaterThan(1024);
    }
  });

  it('no hay ficheros huérfanos sin entrada en el contrato', () => {
    const huerfanos = enDisco.filter((f) => !SFX_NAMES.includes(f.replace('.wav', '') as never));
    expect(huerfanos).toEqual([]);
  });

  it('el número de ficheros cuadra con el enum', () => {
    expect(enDisco).toHaveLength(SFX_NAMES.length);
  });
});
