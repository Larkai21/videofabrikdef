import { CLIP_MAX_S, IMAGE_MAX_S, TROCEO_PARTE_MIN_MS } from '@fabrica/shared';
import { describe, expect, it } from 'vitest';
import { trocearCongelado } from './trocear.js';

// El caso que motiva el módulo: un vídeo real congeló imágenes de 14 s con el
// tope en 5, porque el troceo solo existía en el matching y el juez de planos
// y la curación humana eligen después.

describe('trocearCongelado — imágenes', () => {
  const base = {
    kind: 'image' as const,
    fit: { mode: 'kenburns' as const },
    assetDurationMs: null,
  };

  it('la imagen de 14 s del vídeo real queda en partes ≤3 s', () => {
    const partes = trocearCongelado({ ...base, from_ms: 10_000, to_ms: 24_071, seed: 7 });
    expect(partes.length).toBeGreaterThanOrEqual(5);
    for (const p of partes) {
      expect(p.to_ms - p.from_ms).toBeLessThanOrEqual(IMAGE_MAX_S * 1000 + 50);
      expect(p.to_ms - p.from_ms).toBeGreaterThanOrEqual(TROCEO_PARTE_MIN_MS - 50);
    }
  });

  it('las partes cubren el tramo exacto, sin huecos ni solapes', () => {
    const partes = trocearCongelado({ ...base, from_ms: 5_000, to_ms: 15_000, seed: 3 });
    expect(partes[0]!.from_ms).toBe(5_000);
    expect(partes.at(-1)!.to_ms).toBe(15_000);
    for (let i = 1; i < partes.length; i++) {
      expect(partes[i]!.from_ms).toBe(partes[i - 1]!.to_ms);
    }
  });

  it('dos partes consecutivas nunca repiten dirección de Ken Burns', () => {
    const partes = trocearCongelado({ ...base, from_ms: 0, to_ms: 12_000, seed: 11 });
    for (let i = 1; i < partes.length; i++) {
      expect(partes[i]!.effect).not.toBe(partes[i - 1]!.effect);
    }
  });

  it('una imagen corta no se toca, y una apenas pasada tampoco se parte en parpadeos', () => {
    expect(trocearCongelado({ ...base, from_ms: 0, to_ms: 2_500, seed: 1 })).toHaveLength(1);
    // 3,1 s: partirla daría trozos de 1,55 s (< TROCEO_PARTE_MIN_MS) → se deja
    expect(trocearCongelado({ ...base, from_ms: 0, to_ms: 3_100, seed: 1 })).toHaveLength(1);
  });

  it('es determinista: misma semilla, mismas partes', () => {
    const a = trocearCongelado({ ...base, from_ms: 0, to_ms: 9_000, seed: 5 });
    const b = trocearCongelado({ ...base, from_ms: 0, to_ms: 9_000, seed: 5 });
    expect(a).toEqual(b);
  });
});

describe('trocearCongelado — clips', () => {
  it('el clip de 16 s del vídeo real se parte con saltos hacia delante', () => {
    // fuente de 30 s, tramo de 16: sobran 14 s para saltar
    const partes = trocearCongelado({
      kind: 'clip',
      from_ms: 0,
      to_ms: 16_090,
      fit: { mode: 'trim', offset_ms: 6_955 },
      assetDurationMs: 30_000,
      seed: 2,
    });
    expect(partes.length).toBeGreaterThanOrEqual(2);
    for (const p of partes) {
      expect(p.to_ms - p.from_ms).toBeLessThanOrEqual(CLIP_MAX_S * 1000 + 50);
      expect(p.fit.mode).toBe('trim');
    }
    // los offsets AVANZAN más de lo que avanza la pantalla: eso es el salto
    for (let i = 1; i < partes.length; i++) {
      const avancePantalla = partes[i]!.from_ms - partes[i - 1]!.from_ms;
      const avanceFuente =
        (partes[i]!.fit as { offset_ms: number }).offset_ms -
        (partes[i - 1]!.fit as { offset_ms: number }).offset_ms;
      expect(avanceFuente).toBeGreaterThanOrEqual(avancePantalla + 500);
    }
  });

  it('el material usado nunca se sale de la fuente', () => {
    const len = 25_000;
    const partes = trocearCongelado({
      kind: 'clip',
      from_ms: 0,
      to_ms: 18_000,
      fit: { mode: 'trim', offset_ms: 3_500 },
      assetDurationMs: len,
      seed: 9,
    });
    for (const p of partes) {
      const off = (p.fit as { offset_ms: number }).offset_ms;
      expect(off).toBeGreaterThanOrEqual(0);
      expect(off + (p.to_ms - p.from_ms)).toBeLessThanOrEqual(len);
    }
  });

  it('sin material sobrante para un salto legible, el clip se queda entero', () => {
    // la fuente apenas cubre el tramo: un salto de <500 ms es un tirón, no un corte
    const partes = trocearCongelado({
      kind: 'clip',
      from_ms: 0,
      to_ms: 12_000,
      fit: { mode: 'trim', offset_ms: 100 },
      assetDurationMs: 12_400,
      seed: 4,
    });
    expect(partes).toHaveLength(1);
  });

  it('loop y stretch no se trocean: partir una repetición no añade nada', () => {
    expect(
      trocearCongelado({
        kind: 'clip',
        from_ms: 0,
        to_ms: 12_000,
        fit: { mode: 'loop', loops: 2 },
        assetDurationMs: 6_000,
        seed: 1,
      }),
    ).toHaveLength(1);
    expect(
      trocearCongelado({
        kind: 'clip',
        from_ms: 0,
        to_ms: 10_000,
        fit: { mode: 'stretch', playback_rate: 0.9, offset_ms: 0 },
        assetDurationMs: 9_000,
        seed: 1,
      }),
    ).toHaveLength(1);
  });

  it('un clip dentro del tope no se toca', () => {
    expect(
      trocearCongelado({
        kind: 'clip',
        from_ms: 0,
        to_ms: 7_500,
        fit: { mode: 'trim', offset_ms: 0 },
        assetDurationMs: 20_000,
        seed: 1,
      }),
    ).toHaveLength(1);
  });
});

describe('hallazgos de la revisión adversarial', () => {
  it('la última parte de un clip deja cola de seguridad: el render la extiende', () => {
    // el render alarga la última parte con el solape de transición y el
    // crossfade lee ~400 ms extra: sin cola, leía más allá del EOF
    const len = 20_000;
    const partes = trocearCongelado({
      kind: 'clip',
      from_ms: 0,
      to_ms: 14_000,
      fit: { mode: 'trim', offset_ms: 3_000 },
      assetDurationMs: len,
      seed: 3,
    });
    const ultima = partes.at(-1)!;
    const finFuente =
      (ultima.fit as { offset_ms: number }).offset_ms + (ultima.to_ms - ultima.from_ms);
    expect(finFuente).toBeLessThanOrEqual(len - 600);
  });

  it('las partes de imagen son solo variantes «in», alternando lado', () => {
    // 'out' termina en escala 1,0 e 'in' empieza en 1,0: un empalme out→in
    // encuadra idéntico y el corte se vuelve invisible — la imagen seguiría
    // >3 s efectivos en pantalla
    const partes = trocearCongelado({
      kind: 'image',
      from_ms: 0,
      to_ms: 12_000,
      fit: { mode: 'kenburns' },
      assetDurationMs: null,
      seed: 8,
    });
    for (const p of partes) expect(p.effect).toMatch(/^kenburns-in-(left|right)$/);
    for (let i = 1; i < partes.length; i++)
      expect(partes[i]!.effect).not.toBe(partes[i - 1]!.effect);
  });
});
