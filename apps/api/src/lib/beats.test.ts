import path from 'node:path';
import type { BeatCandidate } from '@fabrica/shared';
import { describe, expect, it } from 'vitest';
import { candidateForDto } from './beats.js';
import { resolveDataDir } from './env.js';

function candidato(meta?: Record<string, unknown>): BeatCandidate {
  return {
    ref: 'library:abc',
    provider: 'library',
    score: 0.8,
    ...(meta !== undefined ? { meta } : {}),
  };
}

describe('candidateForDto', () => {
  it('deriva preview_url para una ruta bajo LIBRARY_DIR', () => {
    const abs = path.join(resolveDataDir('LIBRARY_DIR'), 'assets', 'ch', 'clip', 'x.mp4');
    expect(candidateForDto(candidato({ path: abs })).preview_url).toBe(
      '/files/library/assets/ch/clip/x.mp4',
    );
  });

  it('no expone nada si la ruta cae fuera de las raíces publicadas', () => {
    // toFileUrl devuelve la ruta cruda en ese caso: no debe filtrarse al DTO
    const c = candidateForDto(candidato({ path: '/etc/passwd' }));
    expect(c.preview_url).toBeUndefined();
    expect(c).toEqual(candidato({ path: '/etc/passwd' }));
  });

  it('deja intactos los candidatos sin meta.path (los de stock ya traen thumb_url)', () => {
    expect(candidateForDto(candidato()).preview_url).toBeUndefined();
    expect(candidateForDto(candidato({ download_url: 'https://x/y.mp4' })).preview_url).toBeUndefined();
    expect(candidateForDto(candidato({ path: '' })).preview_url).toBeUndefined();
  });
});
