import { describe, expect, it } from 'vitest';
import { computeFit, kenburnsEffect } from './fit.js';

describe('computeFit', () => {
  it('clip más largo que el beat: trim con offset centrado', () => {
    const result = computeFit({ kind: 'clip', assetDurationMs: 20_000, beatDurationMs: 10_000 });
    expect(result?.fit).toEqual({ mode: 'trim', offset_ms: 5_000 });
  });

  it('clip de duración exacta: trim con offset cero', () => {
    const result = computeFit({ kind: 'clip', assetDurationMs: 10_000, beatDurationMs: 10_000 });
    expect(result?.fit).toEqual({ mode: 'trim', offset_ms: 0 });
  });

  it('clip algo más corto: una sola pasada ralentizada (stretch)', () => {
    // 9000/10000 = 0,9 ≥ MIN_PLAYBACK_RATE → estira, no repite
    const result = computeFit({ kind: 'clip', assetDurationMs: 9_000, beatDurationMs: 10_000 });
    expect(result?.fit).toEqual({ mode: 'stretch', playback_rate: 0.9, offset_ms: 0 });
  });

  it('justo en el umbral de ralentización sigue siendo stretch', () => {
    // 7500/10000 = 0,75 = MIN_PLAYBACK_RATE → stretch (límite inclusivo)
    const result = computeFit({ kind: 'clip', assetDurationMs: 7_500, beatDurationMs: 10_000 });
    expect(result?.fit).toEqual({ mode: 'stretch', playback_rate: 0.75, offset_ms: 0 });
  });

  it('justo por debajo del umbral: bucle en vez de cámara lenta', () => {
    // 7400/10000 = 0,74 < 0,75 → loop (2×7400 − 300 = 14500 ≥ 10000)
    const result = computeFit({ kind: 'clip', assetDurationMs: 7_400, beatDurationMs: 10_000 });
    expect(result?.fit).toEqual({ mode: 'loop', loops: 2 });
  });

  it('clip corto que cubre con dos reproducciones y crossfade', () => {
    // 2×6000 − 300 = 11700 ≥ 10000
    const result = computeFit({ kind: 'clip', assetDurationMs: 6_000, beatDurationMs: 10_000 });
    expect(result?.fit).toEqual({ mode: 'loop', loops: 2 });
  });

  it('el crossfade cuenta: 2×5100 − 300 no llega a 10000 y hacen falta 3', () => {
    const result = computeFit({ kind: 'clip', assetDurationMs: 5_100, beatDurationMs: 10_000 });
    expect(result?.fit).toEqual({ mode: 'loop', loops: 3 });
  });

  it('descarta el candidato si ni el máximo de loops cubre el beat', () => {
    // 3×3000 − 600 = 8400 < 10000
    const result = computeFit({ kind: 'clip', assetDurationMs: 3_000, beatDurationMs: 10_000 });
    expect(result).toBeNull();
  });

  it('en modo clamp (ingesta) nunca descarta: deja el máximo de loops', () => {
    const result = computeFit(
      { kind: 'clip', assetDurationMs: 3_000, beatDurationMs: 10_000 },
      { clampLoops: true },
    );
    expect(result?.fit).toEqual({ mode: 'loop', loops: 3 });
  });

  it('imagen: siempre kenburns', () => {
    const result = computeFit({ kind: 'image', assetDurationMs: null, beatDurationMs: 12_000 });
    expect(result?.fit).toEqual({ mode: 'kenburns' });
  });

  it('clip sin duración conocida se descarta salvo en modo clamp', () => {
    expect(computeFit({ kind: 'clip', assetDurationMs: null, beatDurationMs: 8_000 })).toBeNull();
    expect(
      computeFit({ kind: 'clip', assetDurationMs: null, beatDurationMs: 8_000 }, { clampLoops: true }),
    ).not.toBeNull();
  });
});

describe('kenburnsEffect', () => {
  it('es determinista para la misma semilla', () => {
    expect(kenburnsEffect(12345)).toBe(kenburnsEffect(12345));
  });

  it('devuelve una dirección conocida', () => {
    for (const seed of [0, 1, 2, 3, 999]) {
      expect(kenburnsEffect(seed)).toMatch(/^kenburns-(in|out)-(left|right)$/);
    }
  });
});
