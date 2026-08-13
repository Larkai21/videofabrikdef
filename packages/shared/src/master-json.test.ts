import { describe, expect, it } from 'vitest';
import { EDIT_RENDER_KIND, EDIT_TYPES } from './master-json.js';

describe('EDIT_RENDER_KIND', () => {
  // Este bloque existe por un fallo concreto: `pasos_flow` llegó al máster con
  // sus items, tenía componente, rama en EditOverlay y etiqueta en la timeline,
  // y no salió en pantalla. El render decidía qué montar con una lista de
  // literales escrita a mano, y un tipo nuevo no rompía nada: se caía después
  // del render, en silencio, cuando ya era un MP4.
  it('clasifica TODOS los tipos del contrato, sin sobras', () => {
    expect(Object.keys(EDIT_RENDER_KIND).sort()).toEqual([...EDIT_TYPES].sort());
  });

  it('las formas que dibujan una relación cubren pantalla', () => {
    expect(EDIT_RENDER_KIND.split_versus).toBe('overlay');
    expect(EDIT_RENDER_KIND.pasos_flow).toBe('overlay');
    expect(EDIT_RENDER_KIND.tendencia).toBe('overlay');
    expect(EDIT_RENDER_KIND.barras).toBe('overlay');
  });

  it('lo que no se ve no se cuenta como visual', () => {
    expect(EDIT_RENDER_KIND.sfx).toBe('audio');
    expect(EDIT_RENDER_KIND.zoom_punch).toBe('camara');
    expect(EDIT_RENDER_KIND.keyword_highlight).toBe('subtitulo');
  });
});
