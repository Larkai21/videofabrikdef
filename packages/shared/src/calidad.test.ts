import { describe, expect, it } from 'vitest';
import { analizarMaster, cifraSinSeparador, palabraResaltable } from './calidad.js';
import type { MasterVideoJson } from './master-json.js';

const BASE = {
  version: '1',
  video: { id: 'v1', channel_id: 'c1', idea_id: 'i1', fps: 30, width: 1920, height: 1080 },
} as const;

function master(p: Partial<MasterVideoJson>): MasterVideoJson {
  return { ...BASE, ...p } as MasterVideoJson;
}

type Beat = NonNullable<MasterVideoJson['beats']>[number];
type Asset = NonNullable<Beat['asset']>;

function beat(idx: number, from: number, to: number, extra: Partial<Beat> = {}): Beat {
  return {
    idx,
    from_ms: from,
    to_ms: to,
    text: 'texto del beat',
    visual_query: 'q',
    status: 'locked',
    ...extra,
  };
}

function asset(id: string, fit?: Asset['fit']): Asset {
  return { id, kind: 'clip', path: `/x/${id}.mp4`, fit: fit ?? { mode: 'kenburns' } };
}

describe('palabraResaltable', () => {
  it('rechaza las palabras que no aportan significado en pantalla', () => {
    // el caso que la motivó: se estaba resaltando «vez»
    for (const w of ['vez', 'que', 'como', 'esto', 'también', 'aquí', 'todo']) {
      expect(palabraResaltable(w), w).toBe(false);
    }
  });

  it('acepta sustantivos y siglas, rechaza palabras cortas normales', () => {
    for (const w of ['contratos', 'anonimato', 'digitalización']) {
      expect(palabraResaltable(w), w).toBe(true);
    }
    expect(palabraResaltable('IA')).toBe(true);
    expect(palabraResaltable('API')).toBe(true);
    expect(palabraResaltable('sol')).toBe(false);
  });
});

describe('cifraSinSeparador', () => {
  it('marca las cifras largas sin separador y deja pasar las legibles', () => {
    expect(cifraSinSeparador('10000')).toBe(true);
    expect(cifraSinSeparador('1000000')).toBe(true);
    expect(cifraSinSeparador('9999')).toBe(false);
    expect(cifraSinSeparador('1.000.000')).toBe(false);
    expect(cifraSinSeparador('25 %')).toBe(false);
  });
});

describe('analizarMaster', () => {
  it('reporta cuánto se recorta de los clips, sin tratarlo como defecto', () => {
    const m = analizarMaster(
      master({
        beats: [
          beat(0, 0, 10_000, { asset: asset('a', { mode: 'trim', offset_ms: 8_000 }) }),
          beat(1, 10_000, 20_000, { asset: asset('b', { mode: 'trim', offset_ms: 500 }) }),
        ],
      }),
    );
    expect(m.recortes).toBe(2);
    expect(m.recortes_desfasados).toBe(1);
    expect(m.desfase_mediana_s).toBeCloseTo(4.25);
    // el encaje centra el recorte y la descripción sale del punto medio, así
    // que un recorte grande es información, no un fallo
    expect(m.avisos.some((a) => a.codigo === 'encuadre')).toBe(false);
  });

  // Este es el aviso que el reparto total NO puede dar: 4 efectos en 4 minutos
  // parece bien hasta que ves que están todos en el primero.
  it('detecta minutos sin ningún efecto aunque el total parezca sano', () => {
    const edits = [0, 10_000, 20_000, 30_000].map((from) => ({
      type: 'text_callout' as const,
      from_ms: from,
      to_ms: from + 1_500,
      text: 'un titular',
    }));
    const m = analizarMaster(
      master({ beats: [beat(0, 0, 240_000, { asset: asset('a') })], edits }),
    );
    expect(m.efectos).toBe(4);
    expect(m.reparto_por_minuto).toEqual([4, 0, 0, 0]);
    expect(m.minutos_mudos).toBe(3);
    expect(m.avisos.find((a) => a.codigo === 'minuto_mudo')?.gravedad).toBe('alta');
  });

  it('cuenta los planos repetidos dentro del mismo vídeo', () => {
    const m = analizarMaster(
      master({
        beats: [
          beat(0, 0, 10_000, { asset: asset('a') }),
          beat(1, 10_000, 20_000, { asset: asset('a') }),
          beat(2, 20_000, 30_000, { asset: asset('b') }),
        ],
      }),
    );
    expect(m.planos_repetidos).toBe(1);
  });

  it('avisa si una palabra se resalta donde no se pronuncia', () => {
    const cues = [
      {
        from_ms: 0,
        to_ms: 3_000,
        text: 'hablamos de contratos',
        words: [{ from_ms: 1_000, to_ms: 1_400, w: 'contratos' }],
      },
    ];
    const m = analizarMaster(
      master({
        beats: [beat(0, 0, 60_000, { asset: asset('a') })],
        cues,
        edits: [
          { type: 'keyword_highlight', from_ms: 900, to_ms: 1_800, keyword: 'contratos' },
          { type: 'keyword_highlight', from_ms: 30_000, to_ms: 31_000, keyword: 'contratos' },
        ],
      }),
    );
    const perdidas = m.avisos.filter((a) => a.codigo === 'ancla_perdida');
    expect(perdidas).toHaveLength(1);
    expect(perdidas[0]?.at_ms).toBe(30_000);
  });

  it('no inventa avisos en un vídeo sano', () => {
    // beats de 8 s: desde el tope de clip (CLIP_MAX_S), un plano continuo de
    // 10 s ya NO es un vídeo sano — el fixture cambió con la definición
    const beats = Array.from({ length: 12 }, (_, i) =>
      beat(i, i * 8_000, (i + 1) * 8_000, {
        asset: asset(`a${i}`, { mode: 'trim', offset_ms: 500 }),
      }),
    );
    const edits = [15_000, 75_000].map((from) => ({
      type: 'text_callout' as const,
      from_ms: from,
      to_ms: from + 1_500,
      text: 'dos palabras',
    }));
    const m = analizarMaster(master({ beats, edits }));
    expect(m.avisos).toEqual([]);
  });
});

describe('proporción de imágenes fijas', () => {
  function conKinds(kinds: Array<'clip' | 'image'>) {
    return analizarMaster(
      master({
        beats: kinds.map((k, i) =>
          beat(i, i * 10_000, (i + 1) * 10_000, {
            asset: { id: `a${i}`, kind: k, path: `/x/${i}`, fit: { mode: 'trim', offset_ms: 500 } },
          }),
        ),
      }),
    );
  }

  it('avisa cuando el vídeo se convierte en una presentación', () => {
    // 6 de 10 fijas: por encima de la mitad, aviso grave
    const m = conKinds([
      'image',
      'image',
      'image',
      'image',
      'image',
      'image',
      'clip',
      'clip',
      'clip',
      'clip',
    ]);
    expect(m.imagenes).toBe(6);
    expect(m.ratio_imagenes).toBeCloseTo(0.6);
    expect(m.avisos.find((a) => a.codigo === 'demasiada_imagen')?.gravedad).toBe('alta');
  });

  it('no avisa con una proporción sana de imágenes', () => {
    const m = conKinds([
      'image',
      'clip',
      'clip',
      'clip',
      'clip',
      'clip',
      'clip',
      'clip',
      'clip',
      'clip',
    ]);
    expect(m.ratio_imagenes).toBeCloseTo(0.1);
    expect(m.avisos.some((a) => a.codigo === 'demasiada_imagen')).toBe(false);
  });
});

describe('topes de duración por plano', () => {
  // El caso real que motiva los avisos: un vídeo congeló imágenes de 14 s con
  // IMAGE_MAX_S en 5, porque el troceo solo existía en el matching y el juez de
  // planos y la curación humana eligen después. El informe audita contra los
  // MISMOS topes con los que se produce.
  const img = (id: string): Asset => ({
    id,
    kind: 'image',
    path: `/x/${id}.jpg`,
    fit: { mode: 'kenburns' },
  });

  it('avisa de la imagen que pasa del tope', () => {
    const m = analizarMaster(master({ beats: [beat(0, 0, 14_000, { asset: img('a') })] }));
    expect(m.avisos.some((a) => a.codigo === 'imagen_larga')).toBe(true);
  });

  it('avisa del clip que aguanta más de CLIP_MAX_S sin corte', () => {
    const m = analizarMaster(
      master({
        beats: [beat(0, 0, 12_000, { asset: asset('a', { mode: 'trim', offset_ms: 0 }) })],
      }),
    );
    expect(m.avisos.some((a) => a.codigo === 'plano_largo')).toBe(true);
  });

  it('mide el tramo del SUB-PLANO, no el beat entero', () => {
    const m = analizarMaster(
      master({
        beats: [
          beat(0, 0, 12_000, {
            visuals: [
              { from_ms: 0, to_ms: 3_000, visual_query: 'q', asset: img('a') },
              { from_ms: 3_000, to_ms: 6_000, visual_query: 'q', asset: img('b') },
              {
                from_ms: 6_000,
                to_ms: 12_000,
                visual_query: 'q',
                asset: asset('c', { mode: 'trim', offset_ms: 0 }),
              },
            ],
          }),
        ],
      }),
    );
    expect(m.avisos.some((a) => a.codigo === 'imagen_larga')).toBe(false);
    expect(m.avisos.some((a) => a.codigo === 'plano_largo')).toBe(false);
  });

  it('marca la cámara lenta perceptible y deja pasar la imperceptible', () => {
    const lento = analizarMaster(
      master({
        beats: [
          beat(0, 0, 10_000, {
            asset: asset('a', { mode: 'stretch', playback_rate: 0.85, offset_ms: 0 }),
          }),
        ],
      }),
    );
    expect(lento.avisos.some((a) => a.codigo === 'camara_lenta')).toBe(true);
    const casi = analizarMaster(
      master({
        beats: [
          beat(0, 0, 8_300, {
            asset: asset('a', { mode: 'stretch', playback_rate: 0.97, offset_ms: 0 }),
          }),
        ],
      }),
    );
    expect(casi.avisos.some((a) => a.codigo === 'camara_lenta')).toBe(false);
  });
});
