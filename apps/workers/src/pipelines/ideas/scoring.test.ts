import { describe, expect, it } from 'vitest';
import {
  centroid,
  logistic01,
  meanStd,
  metricValue,
  pickSourceRefs,
  scoreCluster,
  zScore,
} from './scoring.js';

const WEIGHTS = {
  external: 30,
  fit: 25,
  freshness: 15,
  saturation: 20,
  commercial: 10,
  freshness_tau_hours: 48,
};

describe('scoreCluster', () => {
  it('un cluster ideal se acerca a 100', () => {
    const { score, parts } = scoreCluster(
      { externalZ: 10, fitCos: 1, ageHours: 0, saturationCos: 0, commercialFit: 1 },
      WEIGHTS,
    );
    expect(parts.external).toBeCloseTo(30, 1);
    expect(parts.fit).toBe(25);
    expect(parts.freshness).toBe(15);
    expect(parts.saturation).toBe(20);
    expect(parts.commercial).toBe(10);
    expect(score).toBeGreaterThan(99);
  });

  it('un cluster viejo, saturado y sin encaje se acerca a 0', () => {
    const { score } = scoreCluster(
      { externalZ: -10, fitCos: 0, ageHours: 480, saturationCos: 1, commercialFit: 0 },
      WEIGHTS,
    );
    expect(score).toBeLessThan(1);
  });

  it('la frescura decae exponencialmente con tau', () => {
    const { parts } = scoreCluster(
      { externalZ: 0, fitCos: 0, ageHours: 48, saturationCos: 1, commercialFit: 0 },
      WEIGHTS,
    );
    expect(parts.freshness).toBeCloseTo(15 / Math.E, 2);
  });

  it('la saturación resta: cubierto al máximo pierde los 20 puntos del hueco', () => {
    const libre = scoreCluster(
      { externalZ: 0, fitCos: 0.5, ageHours: 24, saturationCos: 0, commercialFit: 0 },
      WEIGHTS,
    );
    const saturado = scoreCluster(
      { externalZ: 0, fitCos: 0.5, ageHours: 24, saturationCos: 1, commercialFit: 0 },
      WEIGHTS,
    );
    expect(libre.score - saturado.score).toBeCloseTo(20, 5);
  });
});

describe('estadística', () => {
  it('meanStd y zScore', () => {
    const { mean, std } = meanStd([10, 20, 30]);
    expect(mean).toBe(20);
    expect(std).toBeCloseTo(8.165, 3);
    expect(zScore(30, mean, std)).toBeCloseTo(1.2247, 3);
    expect(zScore(5, 5, 0)).toBe(0);
  });

  it('logistic01 mapea z a 0..1 con 0,5 en el centro', () => {
    expect(logistic01(0)).toBe(0.5);
    expect(logistic01(10)).toBeGreaterThan(0.99);
    expect(logistic01(-10)).toBeLessThan(0.01);
  });
});

describe('metricValue', () => {
  it('prefiere points, después views, después score', () => {
    expect(metricValue({ points: 300, comments: 12 })).toBe(300);
    expect(metricValue({ views: 4500 })).toBe(4500);
    expect(metricValue({ score: '77' })).toBe(77);
    expect(metricValue({})).toBe(0);
    expect(metricValue(null)).toBe(0);
  });
});

describe('centroid', () => {
  it('normaliza la media de los vectores', () => {
    const c = centroid([
      [1, 0],
      [0, 1],
    ]);
    expect(c[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(c[1]).toBeCloseTo(Math.SQRT1_2, 6);
  });
});

describe('pickSourceRefs', () => {
  it('prioriza señal y diversidad de dominio, máximo 5', () => {
    const refs = pickSourceRefs([
      { url: 'https://a.com/1', title: 'a1', metric: 100 },
      { url: 'https://a.com/2', title: 'a2', metric: 90 },
      { url: 'https://b.com/1', title: 'b1', metric: 50 },
      { url: 'https://c.com/1', title: 'c1', metric: 10 },
    ]);
    expect(refs[0]?.domain).toBe('a.com');
    expect(refs[1]?.domain).toBe('b.com');
    expect(refs[2]?.domain).toBe('c.com');
    expect(refs[3]?.url).toBe('https://a.com/2');
    expect(refs).toHaveLength(4);
  });
});
