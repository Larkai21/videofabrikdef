import { describe, expect, it } from 'vitest';
import { ciclo, clamp, Ease, mix, noise, pulse, reposo, span, typed } from './motion';

describe('Ease', () => {
  it('todas las curvas anclan en 0→0 y 1→1', () => {
    for (const [name, fn] of Object.entries(Ease)) {
      expect(fn(0), `${name}(0)`).toBeCloseTo(0, 6);
      expect(fn(1), `${name}(1)`).toBeCloseTo(1, 6);
    }
  });

  it('las curvas "out" son monótonas crecientes en su tramo principal', () => {
    for (const name of ['linear', 'outCubic', 'outExpo', 'inOutCubic'] as const) {
      const fn = Ease[name];
      let prev = fn(0);
      for (let p = 0.1; p <= 1; p += 0.1) {
        const cur = fn(p);
        expect(cur, `${name} en ${p}`).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = cur;
      }
    }
  });

  it('outBack se pasa por encima de 1 antes de asentarse (overshoot)', () => {
    const peak = Math.max(...Array.from({ length: 20 }, (_, i) => Ease.outBack(0.8 + i * 0.01)));
    expect(peak).toBeGreaterThan(1);
  });
});

describe('span', () => {
  it('clampa fuera del tramo', () => {
    expect(span(0, 1, 2)).toBe(0);
    expect(span(5, 1, 2)).toBe(1);
  });

  it('progresa linealmente dentro del tramo por defecto', () => {
    expect(span(2, 1, 2)).toBeCloseTo(0.5, 6);
  });

  it('con dur<=0 es un escalón en `inicio`', () => {
    expect(span(0.9, 1, 0)).toBe(0);
    expect(span(1, 1, 0)).toBe(1);
  });

  it('aplica el easing dado', () => {
    expect(span(1.5, 1, 1, Ease.outExpo)).toBeCloseTo(Ease.outExpo(0.5), 6);
  });
});

describe('pulse', () => {
  it('vale 0 fuera del intervalo', () => {
    expect(pulse(0, 1, 3, 0.5, 0.5)).toBe(0);
    expect(pulse(4, 1, 3, 0.5, 0.5)).toBe(0);
  });

  it('sube a ~1 en la meseta y baja al final', () => {
    expect(pulse(2, 1, 3, 0.5, 0.5)).toBeGreaterThan(0.9);
    expect(pulse(1, 1, 3, 0.5, 0.5)).toBeCloseTo(0, 6);
    expect(pulse(3, 1, 3, 0.5, 0.5)).toBeCloseTo(0, 6);
  });
});

describe('noise', () => {
  it('es determinista y está en 0..1', () => {
    for (let i = 0; i < 10; i++) {
      const v = noise(i, 7);
      expect(v).toBe(noise(i, 7));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('distingue índices y semillas', () => {
    expect(noise(0, 0)).not.toBe(noise(1, 0));
    expect(noise(0, 0)).not.toBe(noise(0, 1));
  });
});

describe('typed', () => {
  it('revela caracteres a `cps` y clampa a la longitud', () => {
    expect(typed('hola', 0, 1, 28)).toBe('');
    expect(typed('hola', 1 + 2.5 / 28, 1, 28)).toBe('ho');
    expect(typed('hola', 100, 1, 28)).toBe('hola');
  });
});

describe('helpers', () => {
  it('clamp acota', () => {
    expect(clamp(-1, 0, 1)).toBe(0);
    expect(clamp(2, 0, 1)).toBe(1);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });

  it('mix interpola', () => {
    expect(mix(0, 10, 0.5)).toBe(5);
    expect(mix(4, 8, 0)).toBe(4);
    expect(mix(4, 8, 1)).toBe(8);
  });
});

// El catálogo de origen fija el sobrepaso máximo en el 6 % y comprueba el valor
// resolviéndolo, no leyéndolo. Se hace igual aquí: si alguien toca la constante
// de `outBack6`, esto se entera.
describe('calibración del rebote', () => {
  const pico = (f: (t: number) => number): number =>
    Math.max(...Array.from({ length: 1001 }, (_, i) => f(i / 1000)));

  it('outBack6 se pasa un 6 %, ni más ni menos', () => {
    const p = pico(Ease.outBack6);
    expect(p).toBeGreaterThan(1.05);
    expect(p).toBeLessThanOrEqual(1.065);
  });

  it('el outBack clásico se pasa un 10 %: por eso existe outBack6', () => {
    expect(pico(Ease.outBack)).toBeGreaterThan(1.09);
  });

  it('inCubic arranca quieto y acelera', () => {
    expect(Ease.inCubic(0.25)).toBeLessThan(0.25);
    expect(Ease.inCubic(0)).toBe(0);
    expect(Ease.inCubic(1)).toBe(1);
  });
});

describe('ciclo y reposo', () => {
  it('el overlay entra, se queda y sale', () => {
    expect(ciclo(0, 4, 0.4, 0.4).v).toBeCloseTo(0, 5);
    expect(ciclo(2, 4, 0.4, 0.4).v).toBeCloseTo(1, 5);
    expect(ciclo(4, 4, 0.4, 0.4).v).toBeCloseTo(0, 5);
  });

  it('sin salida se queda hasta el final', () => {
    expect(ciclo(4, 4, 0.4, 0).v).toBeCloseTo(1, 5);
  });

  it('reposo recorre el tramo entre entrada y salida', () => {
    expect(reposo(0.2, 0.4, 4, 0.4)).toBeCloseTo(0, 5);
    expect(reposo(4, 0.4, 4, 0.4)).toBeCloseTo(1, 5);
  });
});
