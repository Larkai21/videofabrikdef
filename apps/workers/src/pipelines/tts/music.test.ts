import { describe, expect, it } from 'vitest';
import {
  buildMusicMixFilter,
  MUSIC_FADE_S,
  MUSIC_GAIN_DB,
  pickMusicTrack,
} from './music.js';

describe('pickMusicTrack', () => {
  const tracks = [{ id: 'm-01' }, { id: 'm-02' }, { id: 'm-03' }, { id: 'm-04' }];

  it('sin pistas devuelve null (el flujo sigue sin música)', () => {
    expect(pickMusicTrack('video-1', [])).toBeNull();
  });

  it('es determinista: mismo videoId → misma pista', () => {
    const a = pickMusicTrack('video-abc', tracks);
    const b = pickMusicTrack('video-abc', tracks);
    expect(a).not.toBeNull();
    expect(a?.id).toBe(b?.id);
  });

  it('no depende del orden de llegada de las filas', () => {
    const shuffled = [tracks[2]!, tracks[0]!, tracks[3]!, tracks[1]!];
    expect(pickMusicTrack('video-abc', tracks)?.id).toBe(pickMusicTrack('video-abc', shuffled)?.id);
    expect(pickMusicTrack('video-xyz', tracks)?.id).toBe(pickMusicTrack('video-xyz', shuffled)?.id);
  });

  it('reparte entre pistas según el videoId', () => {
    const chosen = new Set(
      ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'].map((v) => pickMusicTrack(v, tracks)?.id),
    );
    // con 8 vídeos y 4 pistas el hash debe tocar más de una pista
    expect(chosen.size).toBeGreaterThan(1);
  });

  it('con una sola pista siempre la elige', () => {
    expect(pickMusicTrack('cualquiera', [{ id: 'única' }])?.id).toBe('única');
  });
});

describe('buildMusicMixFilter', () => {
  it('mezcla a -22 dB, con fade out de 2 s pegado al final de la voz', () => {
    const filter = buildMusicMixFilter(10_000);
    expect(filter).toContain(`volume=${MUSIC_GAIN_DB}dB`);
    expect(filter).toContain(`afade=t=out:st=8.000:d=${MUSIC_FADE_S}`);
    // la duración la manda la voz y la voz no se atenúa al mezclar
    expect(filter).toContain('amix=inputs=2:duration=first');
    expect(filter).toContain('normalize=0');
  });

  it('con voz más corta que el fade el inicio del fade no es negativo', () => {
    expect(buildMusicMixFilter(1_000)).toContain('afade=t=out:st=0.000');
  });
});
