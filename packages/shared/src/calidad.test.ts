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
    const beats = Array.from({ length: 12 }, (_, i) =>
      beat(i, i * 10_000, (i + 1) * 10_000, {
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
