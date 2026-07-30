import { describe, expect, it } from 'vitest';
import type { StockResult } from '../../providers/stock.js';
import { interleaveByProvider, pickFinalists, repartirPlazas } from './finalists.js';

function res(
  ref: string,
  kind: 'clip' | 'image',
  provider: 'pexels' | 'pixabay' = 'pexels',
  durationMs = 30_000,
): StockResult {
  return {
    ref,
    provider,
    thumb_url: `https://x/${ref}.jpg`,
    meta: {
      download_url: `https://x/${ref}`,
      width: 1920,
      height: 1080,
      duration_ms: durationMs,
      title: ref,
      kind,
    },
  };
}

const VACIO = new Set<string>();

describe('repartirPlazas', () => {
  it('respeta el techo de imágenes cuando sobra material de los dos tipos', () => {
    expect(repartirPlazas(10, 10, 6, 1)).toEqual({ clips: 5, imagenes: 1 });
  });

  it('rellena con imágenes si no hay clips suficientes', () => {
    // el techo es un techo, no una cuota: sin clips no se devuelven 2 finalistas
    expect(repartirPlazas(2, 10, 6, 1)).toEqual({ clips: 2, imagenes: 4 });
  });

  it('rellena con clips si no hay imágenes', () => {
    expect(repartirPlazas(10, 0, 6, 1)).toEqual({ clips: 6, imagenes: 0 });
  });

  it('no inventa plazas cuando no hay material', () => {
    expect(repartirPlazas(1, 2, 6, 1)).toEqual({ clips: 1, imagenes: 2 });
  });
});

describe('interleaveByProvider', () => {
  it('agrupa solo por proveedor, no por tipo', () => {
    // el reparto entre clip e imagen es editorial y lo decide pickFinalists;
    // meterlo aquí es lo que le regalaba a las fotos un tercio de las plazas
    const out = interleaveByProvider([
      res('a', 'clip', 'pexels'),
      res('b', 'image', 'pexels'),
      res('c', 'clip', 'pixabay'),
    ]);
    expect(out.map((r) => r.ref)).toEqual(['a', 'c', 'b']);
  });
});

describe('pickFinalists', () => {
  const muchos = [
    ...Array.from({ length: 8 }, (_, i) => res(`c${i}`, 'clip')),
    ...Array.from({ length: 8 }, (_, i) => res(`i${i}`, 'image')),
  ];

  it('deja una sola plaza a las imágenes cuando hay clips de sobra', () => {
    const out = pickFinalists(muchos, {
      total: 6,
      imagenesMax: 1,
      spanMs: 11_500,
      vetoedRefs: VACIO,
    });
    expect(out).toHaveLength(6);
    expect(out.filter((r) => r.meta.kind === 'image')).toHaveLength(1);
  });

  it('NUNCA se queda sin imágenes aunque el techo sea cero: eso es lo que compra Flux', () => {
    // con imagenesMax=0 no hay red cuando ningún clip supera T_REV. El techo
    // cero es legítimo como preferencia, pero la reserva la pone quien llama.
    const out = pickFinalists(muchos, {
      total: 6,
      imagenesMax: 0,
      spanMs: 11_500,
      vetoedRefs: VACIO,
    });
    expect(out.filter((r) => r.meta.kind === 'image')).toHaveLength(0);
    expect(out).toHaveLength(6);
  });

  it('veta ANTES de repartir, para no desperdiciar plazas', () => {
    const vetados = new Set(['c0', 'c1', 'c2']);
    const out = pickFinalists(muchos, {
      total: 6,
      imagenesMax: 1,
      spanMs: 11_500,
      vetoedRefs: vetados,
    });
    expect(out).toHaveLength(6);
    expect(out.some((r) => vetados.has(r.ref))).toBe(false);
    // y sigue habiendo 5 clips: el veto no se come plazas de clip
    expect(out.filter((r) => r.meta.kind === 'clip')).toHaveLength(5);
  });

  it('devuelve vacío si TODO está vetado, en vez de colar un repetido', () => {
    // La cascada tiene que enterarse de que no queda nada nuevo para poder tirar
    // de su reserva. Desde que no hay generación de imagen al final, este es el
    // único camino que evita que un beat se quede literalmente sin plano.
    const out = pickFinalists(muchos, {
      total: 6,
      imagenesMax: 1,
      spanMs: 11_500,
      vetoedRefs: new Set(muchos.map((r) => r.ref)),
    });
    expect(out).toEqual([]);
  });

  it('no gasta plazas de clip en clips que no cubren el tramo', () => {
    const cortos = [
      ...Array.from({ length: 5 }, (_, i) => res(`corto${i}`, 'clip', 'pexels', 500)),
      res('largo', 'clip', 'pexels', 30_000),
      ...Array.from({ length: 8 }, (_, i) => res(`i${i}`, 'image')),
    ];
    const out = pickFinalists(cortos, {
      total: 6,
      imagenesMax: 1,
      spanMs: 11_500,
      vetoedRefs: VACIO,
    });
    // 500 ms no cubre 11,5 s ni con el máximo de bucles: esos clips morirían
    // luego en computeFit habiendo desplazado ya a otro candidato
    expect(out.filter((r) => r.meta.kind === 'clip').map((r) => r.ref)).toEqual(['largo']);
    expect(out).toHaveLength(6);
  });
});
