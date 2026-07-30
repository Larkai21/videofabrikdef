import { describe, expect, it } from 'vitest';
import type { MasterVideoJson } from '@fabrica/shared';
import { resolveDataDir } from './env.js';
import { masterWithFileUrls, videoTitle } from './master.js';

// El maestro guarda rutas ABSOLUTAS de disco; el dashboard solo puede cargar
// URLs de /files. Este es el punto donde se traduce, y ya se ha escapado dos
// veces por el mismo sitio: los sub-planos.
// la raíz real: toFileUrl solo traduce lo que cae bajo ella
const RAIZ = resolveDataDir('LIBRARY_DIR');

function asset(nombre: string) {
  return { id: nombre, fit: { mode: 'kenburns' as const }, path: `${RAIZ}/assets/c/${nombre}.mp4` };
}

function master(p: Partial<MasterVideoJson>): MasterVideoJson {
  return {
    version: '1',
    video: { id: 'v', channel_id: 'c', idea_id: 'i', fps: 30, width: 1920, height: 1080 },
    ...p,
  } as MasterVideoJson;
}

describe('masterWithFileUrls', () => {
  it('traduce también los sub-planos, no solo el plano principal', () => {
    const out = masterWithFileUrls(
      master({
        beats: [
          {
            idx: 0,
            from_ms: 0,
            to_ms: 8_000,
            text: 't',
            visual_query: 'q',
            status: 'locked',
            asset: asset('principal'),
            visuals: [
              { from_ms: 0, to_ms: 4_000, visual_query: 'q', asset: asset('sub-a') },
              { from_ms: 4_000, to_ms: 8_000, visual_query: 'q', asset: asset('sub-b') },
            ],
          },
        ],
      }),
    );
    const beat = out.beats![0]!;
    // la composición usa la lista de sub-planos cuando existe: si estos no se
    // traducen, el Player pinta negro con los subtítulos encima — que es
    // exactamente «se ven los textos y no el vídeo»
    for (const v of beat.visuals!) {
      expect(v.asset!.path).toMatch(/^\/files\//);
    }
    expect(beat.asset!.path).toMatch(/^\/files\//);
  });

  it('deja intacto lo que no es una ruta bajo las carpetas de datos', () => {
    const out = masterWithFileUrls(
      master({
        beats: [
          {
            idx: 0,
            from_ms: 0,
            to_ms: 1_000,
            text: 't',
            visual_query: 'q',
            status: 'pending',
          },
        ],
      }),
    );
    expect(out.beats![0]!.asset).toBeUndefined();
  });

  it('no rompe un maestro sin beats ni audio', () => {
    expect(masterWithFileUrls(master({})).beats).toBeUndefined();
  });
});

describe('videoTitle', () => {
  it('prefiere el título elegido por el humano', () => {
    const m = master({
      seo: {
        titles: ['a', 'b', 'c'],
        chosen_idx: 1,
        description: '',
        tags: [],
        thumbnails: [],
      },
    });
    expect(videoTitle({ id: 'v', titleChosen: 'el mío', master: m })).toBe('el mío');
    expect(videoTitle({ id: 'v', titleChosen: null, master: m })).toBe('b');
    expect(videoTitle({ id: 'v', titleChosen: null, master: master({}) })).toBe('Vídeo v');
  });
});
