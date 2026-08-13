import { describe, expect, it } from 'vitest';
import type { BeatToken } from '../tts/beats.js';
import { calcularKeeps, remapear } from './apretar.js';
import { filtrarQuitar, frasesDe, RELLENO_MAX_PCT } from './relleno.js';

function tokens(frases: [string, number, number][]): BeatToken[] {
  // cada tupla es una FRASE [texto, from_ms, to_ms]: palabras repartidas y
  // sentenceEnd en la última
  const out: BeatToken[] = [];
  for (const [texto, from, to] of frases) {
    const palabras = texto.split(' ');
    const paso = (to - from) / palabras.length;
    palabras.forEach((raw, i) => {
      out.push({
        raw,
        from_ms: Math.round(from + i * paso),
        to_ms: Math.round(from + (i + 1) * paso),
        sentenceEnd: i === palabras.length - 1,
        clauseEnd: i === palabras.length - 1,
        sceneIdx: 0,
      });
    });
  }
  return out;
}

const CINCO_FRASES: [string, number, number][] = [
  ['el gancho que abre', 0, 2000],
  ['una idea que importa', 2500, 4500],
  ['bueno pues eso que os decía vaya', 5000, 7000],
  ['el argumento central', 7500, 9500],
  ['y el cierre que remata', 10000, 12000],
];

describe('frasesDe', () => {
  it('corta por sentenceEnd y no pierde la cola sin frontera', () => {
    const ts = tokens(CINCO_FRASES);
    // se quita la marca de la última palabra: la cola cuenta igual
    ts[ts.length - 1]!.sentenceEnd = false;
    const frases = frasesDe(ts);
    expect(frases).toHaveLength(5);
    expect(frases[2]!.texto).toBe('bueno pues eso que os decía vaya');
    expect(frases[0]!.from_ms).toBe(0);
    expect(frases[4]!.to_ms).toBe(12000);
  });
});

describe('filtrarQuitar', () => {
  const frases = frasesDe(tokens(CINCO_FRASES));

  it('ni la primera ni la última, ni índices inventados, ni duplicados', () => {
    const out = filtrarQuitar(frases, [0, 4, 99, 2, 2, -1]);
    expect(out.map((f) => f.idx)).toEqual([2]);
  });

  it('el techo corta la lista en orden de llegada', () => {
    // ventana de 12 s → techo 3 s (25 %): la primera petición de 2 s entra,
    // la segunda de 2 s ya no cabe
    expect(RELLENO_MAX_PCT).toBeCloseTo(0.25);
    const out = filtrarQuitar(frases, [2, 3]);
    expect(out.map((f) => f.idx)).toEqual([2]);
  });
});

describe('calcularKeeps con quitar (silencio sintético)', () => {
  it('la frase quitada se cae del reloj igual que un silencio', () => {
    const ts = tokens(CINCO_FRASES);
    const frases = frasesDe(ts);
    const relleno = frases[2]!; // «bueno pues eso…», 5000-7000
    const keeps = calcularKeeps(ts, 0, 12000, {
      quitar: [{ from_ms: relleno.from_ms, to_ms: relleno.to_ms }],
    });
    // dentro del relleno → null (cortado); a ambos lados sigue habiendo reloj
    expect(remapear(6000, keeps)).toBeNull();
    expect(remapear(1000, keeps)).not.toBeNull();
    expect(remapear(8000, keeps)).not.toBeNull();
    // el reloj de salida es contiguo: sin huecos ni solapes
    for (let i = 1; i < keeps.length; i += 1) {
      expect(keeps[i]!.out_from_ms).toBe(keeps[i - 1]!.out_to_ms);
    }
    // y la salida dura menos que sin quitar
    const sinQuitar = calcularKeeps(ts, 0, 12000);
    const durCon = keeps[keeps.length - 1]!.out_to_ms;
    const durSin = sinQuitar[sinQuitar.length - 1]!.out_to_ms;
    expect(durCon).toBeLessThan(durSin);
  });

  it('un resto más corto que el mínimo no sobrevive como parpadeo', () => {
    const ts = tokens([['una frase larga de prueba', 0, 5000]]);
    const keeps = calcularKeeps(ts, 0, 5000, {
      // deja un resto de 100 ms al principio: se descarta
      quitar: [{ from_ms: 100, to_ms: 4000 }],
    });
    for (const k of keeps) {
      expect(k.src_to_ms - k.src_from_ms).toBeGreaterThanOrEqual(150);
    }
  });
});
