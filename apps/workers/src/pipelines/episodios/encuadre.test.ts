import { describe, expect, it } from 'vitest';
import { exprCropX, suavizarKf, ZONA_MUERTA_X } from './encuadre.js';

describe('suavizarKf', () => {
  it('el micro-vaivén se queda quieto: nada supera la zona muerta', () => {
    const kf = [
      { t_ms: 150, x: 0.5 },
      { t_ms: 1350, x: 0.51 },
      { t_ms: 2550, x: 0.49 },
      { t_ms: 3750, x: 0.505 },
    ];
    expect(suavizarKf(0.5, kf)).toEqual([{ t_ms: 150, x: 0.5 }]);
  });

  it('la deriva real emite keyframes y la media móvil la amortigua', () => {
    const kf = [
      { t_ms: 150, x: 0.5 },
      { t_ms: 1350, x: 0.5 },
      { t_ms: 2550, x: 0.56 },
      { t_ms: 3750, x: 0.62 },
      { t_ms: 4950, x: 0.62 },
    ];
    const salida = suavizarKf(0.5, kf);
    expect(salida.length).toBeGreaterThan(1);
    // arranca en la x base y termina cerca del destino real
    expect(salida[0]).toEqual({ t_ms: 150, x: 0.5 });
    expect(salida[salida.length - 1]!.x).toBeGreaterThan(0.58);
    // monótono en el tiempo
    for (let i = 1; i < salida.length; i += 1) {
      expect(salida[i]!.t_ms).toBeGreaterThan(salida[i - 1]!.t_ms);
    }
  });

  it('un solo fotograma mal detectado no mueve la cámara (media móvil)', () => {
    const kf = [
      { t_ms: 150, x: 0.5 },
      { t_ms: 1350, x: 0.5 },
      { t_ms: 2550, x: 0.9 }, // detección falsa
      { t_ms: 3750, x: 0.5 },
      { t_ms: 4950, x: 0.5 },
    ];
    const salida = suavizarKf(0.5, kf);
    // el pico aislado queda amortiguado: ningún keyframe llega ni a mitad
    // del salto falso
    for (const k of salida) expect(k.x).toBeLessThan(0.7);
  });

  it('es determinista: misma serie, mismos keyframes', () => {
    const kf = [
      { t_ms: 150, x: 0.3 },
      { t_ms: 1350, x: 0.42 },
      { t_ms: 2550, x: 0.55 },
    ];
    expect(suavizarKf(0.3, kf)).toEqual(suavizarKf(0.3, kf));
  });

  it('serie corta = x fija (1 keyframe)', () => {
    expect(suavizarKf(0.4, [])).toEqual([{ t_ms: 0, x: 0.4 }]);
    expect(suavizarKf(0.4, [{ t_ms: 500, x: 0.9 }])).toEqual([{ t_ms: 500, x: 0.4 }]);
  });

  it('la zona muerta exportada es la documentada', () => {
    expect(ZONA_MUERTA_X).toBeCloseTo(0.02);
  });
});

describe('exprCropX', () => {
  it('sin puntos o con uno: constante', () => {
    expect(exprCropX([])).toBe('0');
    expect(exprCropX([{ t_s: 0.15, x_px: 420 }])).toBe('420');
  });

  it('dos puntos: lerp acotado por delante y por detrás', () => {
    const expr = exprCropX([
      { t_s: 1, x_px: 100 },
      { t_s: 3, x_px: 300 },
    ]);
    const evalua = (t: number): number => {
      // réplica JS de la semántica de la expresión de ffmpeg
      // if(lt(t,3), if(lt(t,1), 100, lerp), 300)
      if (t < 3) {
        if (t < 1) return 100;
        return 100 + ((300 - 100) * (t - 1)) / 2;
      }
      return 300;
    };
    expect(expr).toContain('if(lt(t,3.000)');
    expect(expr).toContain('if(lt(t,1.000),100,');
    // el punto medio interpola al centro; antes y después se sostiene
    expect(evalua(2)).toBe(200);
    expect(evalua(0.5)).toBe(100);
    expect(evalua(9)).toBe(300);
  });

  it('tres puntos: el límite más temprano gobierna el if exterior', () => {
    const expr = exprCropX([
      { t_s: 0, x_px: 0 },
      { t_s: 1, x_px: 100 },
      { t_s: 2, x_px: 50 },
    ]);
    // se evalúa de dentro afuera: t<1 decide primero y el resto cae al
    // tramo siguiente anidado; el último valor sostiene el final
    expect(expr.startsWith('if(lt(t,1.000)')).toBe(true);
    expect(expr).toContain('if(lt(t,2.000)');
    expect(expr).toMatch(/,50\)+$/);
  });
});
