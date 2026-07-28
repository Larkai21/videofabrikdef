import { describe, expect, it } from 'vitest';
import { makeDemoMaster } from '@fabrica/shared';
import { rewriteMasterMedia, rewriteMediaPath } from './media-rewrite.js';

const opts = {
  libraryDir: '/data/library',
  outputsDir: '/data/outputs',
  baseUrl: 'http://127.0.0.1:3001/files',
};

describe('rewriteMediaPath', () => {
  it('convierte rutas bajo LIBRARY_DIR en URLs /files/library', () => {
    expect(rewriteMediaPath('/data/library/assets/ch/clips/a.mp4', opts)).toBe(
      'http://127.0.0.1:3001/files/library/assets/ch/clips/a.mp4',
    );
  });

  it('convierte rutas bajo OUTPUTS_DIR en URLs /files/outputs', () => {
    expect(rewriteMediaPath('/data/outputs/vid-1/audio.wav', opts)).toBe(
      'http://127.0.0.1:3001/files/outputs/vid-1/audio.wav',
    );
  });

  it('codifica segmentos con espacios o caracteres especiales', () => {
    expect(rewriteMediaPath('/data/library/clips/sala fría.mp4', opts)).toBe(
      'http://127.0.0.1:3001/files/library/clips/sala%20fr%C3%ADa.mp4',
    );
  });

  it('tolera baseUrl con barra final', () => {
    expect(
      rewriteMediaPath('/data/library/a.mp4', { ...opts, baseUrl: `${opts.baseUrl}/` }),
    ).toBe('http://127.0.0.1:3001/files/library/a.mp4');
  });

  it('deja pasar URLs http(s) y rutas relativas (staticFile del bundle)', () => {
    expect(rewriteMediaPath('https://cdn.example.com/x.mp4', opts)).toBe(
      'https://cdn.example.com/x.mp4',
    );
    expect(rewriteMediaPath('demo/clip-1.mp4', opts)).toBe('demo/clip-1.mp4');
  });

  it('no mapea rutas absolutas fuera de los directorios servidos', () => {
    expect(rewriteMediaPath('/etc/passwd', opts)).toBe('/etc/passwd');
    expect(rewriteMediaPath('/data/library-otro/a.mp4', opts)).toBe('/data/library-otro/a.mp4');
  });
});

describe('rewriteMasterMedia', () => {
  it('reescribe audio y assets de beats sin mutar el original', () => {
    const master = makeDemoMaster({
      audioPath: '/data/outputs/vid-1/audio.wav',
      clipPath: '/data/library/clips/a.mp4',
      imagePath: '/data/library/images/b.png',
    });
    const rewritten = rewriteMasterMedia(master, opts);
    expect(rewritten.audio?.path).toBe('http://127.0.0.1:3001/files/outputs/vid-1/audio.wav');
    expect(rewritten.beats?.[0]?.asset?.path).toBe(
      'http://127.0.0.1:3001/files/library/clips/a.mp4',
    );
    expect(rewritten.beats?.[1]?.asset?.path).toBe(
      'http://127.0.0.1:3001/files/library/images/b.png',
    );
    // el maestro original conserva las rutas locales (se congela en master.json)
    expect(master.audio?.path).toBe('/data/outputs/vid-1/audio.wav');
    expect(master.beats?.[0]?.asset?.path).toBe('/data/library/clips/a.mp4');
  });

  it('reescribe también las rutas de los sub-planos (beat.visuals)', () => {
    const master = makeDemoMaster({ clipPath: '/data/library/clips/a.mp4' });
    master.beats![0]!.visuals = [
      {
        from_ms: 0,
        to_ms: 4000,
        visual_query: 'x',
        asset: { id: 's1', kind: 'image', path: '/data/library/images/s1.png', fit: { mode: 'kenburns' } },
      },
      {
        from_ms: 4000,
        to_ms: 8000,
        visual_query: 'y',
        asset: { id: 's2', kind: 'clip', path: '/data/library/clips/s2.mp4', fit: { mode: 'trim', offset_ms: 0 } },
      },
    ];
    const rewritten = rewriteMasterMedia(master, opts);
    expect(rewritten.beats?.[0]?.visuals?.[0]?.asset?.path).toBe(
      'http://127.0.0.1:3001/files/library/images/s1.png',
    );
    expect(rewritten.beats?.[0]?.visuals?.[1]?.asset?.path).toBe(
      'http://127.0.0.1:3001/files/library/clips/s2.mp4',
    );
    // original intacto
    expect(master.beats?.[0]?.visuals?.[0]?.asset?.path).toBe('/data/library/images/s1.png');
  });
});
