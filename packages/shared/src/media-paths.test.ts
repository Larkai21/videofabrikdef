import { describe, expect, it } from 'vitest';
import { mapMasterMediaPaths } from './media-paths.js';
import type { MasterVideoJson } from './master-json.js';

// La regla que este test fija: TODA ruta de medio del maestro pasa por la
// reescritura. Se incumplió tres veces —beats[].visuals[].asset.path (los
// beats multi-plano salían en negro), y edits[].image_path dos veces (worker y
// script)— porque la lista vivía copiada en tres funciones distintas. El test
// recorre el maestro y exige que no quede NINGUNA ruta sin transformar, así
// que un campo de medio nuevo sin añadir a la lista lo rompe.

const MASTER = {
  version: '1',
  video: { id: 'v1', channel_id: 'c1', idea_id: 'i1', fps: 30, width: 1920, height: 1080 },
  audio: { path: '/abs/audio/voice.wav', duration_ms: 1000 },
  brand: { avatar_path: '/abs/library/avatar.png', components: {} },
  beats: [
    {
      idx: 0,
      from_ms: 0,
      to_ms: 5000,
      text: 't',
      visual_query: 'q',
      status: 'locked',
      asset: { id: 'a', kind: 'clip', path: '/abs/library/a.mp4', fit: { mode: 'kenburns' } },
      visuals: [
        {
          from_ms: 0,
          to_ms: 5000,
          visual_query: 'q',
          asset: { id: 'b', kind: 'clip', path: '/abs/library/b.mp4', fit: { mode: 'kenburns' } },
        },
      ],
    },
  ],
  edits: [
    {
      type: 'imagen_apoyo',
      from_ms: 100,
      to_ms: 3100,
      image_path: '/abs/library/musk.jpg',
      text: 'Elon Musk',
    },
    { type: 'text_callout', from_ms: 200, to_ms: 2600, text: 'un titular' },
  ],
} as unknown as MasterVideoJson;

/** Todas las cadenas del maestro que parecen una ruta de fichero local. */
function rutasLocales(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') {
    if (x.startsWith('/abs/')) out.push(x);
  } else if (Array.isArray(x)) {
    for (const v of x) rutasLocales(v, out);
  } else if (x !== null && typeof x === 'object') {
    for (const v of Object.values(x)) rutasLocales(v, out);
  }
  return out;
}

describe('mapMasterMediaPaths', () => {
  it('no deja NINGUNA ruta de medio sin transformar', () => {
    const original = rutasLocales(MASTER);
    // el fixture tiene que traer todos los campos de medio del contrato
    expect(original).toHaveLength(5);
    const out = mapMasterMediaPaths(MASTER, (p) => `https://files.test${p}`);
    expect(rutasLocales(out)).toEqual([]);
  });

  it('transforma el image_path del inserto: el campo que se olvidó dos veces', () => {
    const out = mapMasterMediaPaths(MASTER, (p) => `URL${p}`);
    const inserto = (out.edits ?? []).find((e) => e.type === 'imagen_apoyo');
    expect(inserto && 'image_path' in inserto ? inserto.image_path : null).toBe(
      'URL/abs/library/musk.jpg',
    );
  });

  it('no muta el maestro original: se congela con sus rutas locales', () => {
    mapMasterMediaPaths(MASTER, () => 'CAMBIADO');
    expect(MASTER.audio?.path).toBe('/abs/audio/voice.wav');
    expect(rutasLocales(MASTER)).toHaveLength(5);
  });

  it('deja en paz los edits que no llevan imagen', () => {
    const out = mapMasterMediaPaths(MASTER, () => 'CAMBIADO');
    const callout = (out.edits ?? []).find((e) => e.type === 'text_callout');
    expect(callout && 'text' in callout ? callout.text : null).toBe('un titular');
  });
});
