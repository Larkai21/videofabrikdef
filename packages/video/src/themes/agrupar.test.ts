import { describe, expect, it } from 'vitest';
import type { Word } from '@fabrica/shared';
import {
  agruparPalabras,
  cuerpoDeGrupo,
  GRUPO_MAX_CARACTERES,
  GRUPO_MAX_PALABRAS,
  GRUPO_MIN_MS,
} from './agrupar.js';

// palabras seguidas de `dur` ms cada una, sin huecos
function seguidas(textos: string[], dur = 400): Word[] {
  let t = 0;
  return textos.map((w) => {
    const word = { from_ms: t, to_ms: t + dur, w };
    t += dur;
    return word;
  });
}

const textos = (g: { words: Word[] }[]): string[][] => g.map((x) => x.words.map((w) => w.w));

describe('agruparPalabras', () => {
  it('sin palabras no hay grupos', () => {
    expect(agruparPalabras([])).toEqual([]);
  });

  it('nunca pone más de tres palabras en pantalla', () => {
    const g = agruparPalabras(seguidas(['a', 'b', 'c', 'd', 'e', 'f']));
    for (const grupo of g) expect(grupo.words.length).toBeLessThanOrEqual(GRUPO_MAX_PALABRAS);
  });

  it('corta por caracteres aunque quepan tres palabras', () => {
    const g = agruparPalabras(seguidas(['infraestructura', 'especializada', 'hoy']));
    for (const grupo of g) {
      const largo = grupo.words.reduce((a, w) => a + w.w.length, 0) + grupo.words.length - 1;
      expect(largo).toBeLessThanOrEqual(GRUPO_MAX_CARACTERES);
    }
    expect(textos(g)[0]).toEqual(['infraestructura']);
  });

  it('una respiración corta el grupo', () => {
    const words: Word[] = [
      { from_ms: 0, to_ms: 400, w: 'uno' },
      { from_ms: 400, to_ms: 800, w: 'dos' },
      // 500 ms de silencio: el grupo se cierra aunque cupieran tres
      { from_ms: 1_300, to_ms: 1_700, w: 'tres' },
    ];
    expect(textos(agruparPalabras(words))).toEqual([['uno', 'dos'], ['tres']]);
  });

  it('fusiona el grupo que parpadearía', () => {
    const words: Word[] = [
      // 120 ms: por debajo del mínimo
      { from_ms: 0, to_ms: 120, w: 'y' },
      { from_ms: 900, to_ms: 1_400, w: 'entonces' },
    ];
    const g = agruparPalabras(words);
    expect(g).toHaveLength(1);
    expect(textos(g)[0]).toEqual(['y', 'entonces']);
  });

  it('los grupos cubren todas las palabras y en orden', () => {
    const entrada = seguidas(['el', 'coste', 'por', 'token', 'cayó', 'un', 'orden']);
    const g = agruparPalabras(entrada);
    expect(g.flatMap((x) => x.words.map((w) => w.w))).toEqual(entrada.map((w) => w.w));
  });

  it('el tiempo de cada grupo es el de sus palabras', () => {
    const g = agruparPalabras(seguidas(['uno', 'dos', 'tres', 'cuatro']));
    for (const grupo of g) {
      expect(grupo.from_ms).toBe(grupo.words[0]!.from_ms);
      expect(grupo.to_ms).toBe(grupo.words[grupo.words.length - 1]!.to_ms);
      expect(grupo.to_ms).toBeGreaterThan(grupo.from_ms);
    }
  });

  it('ningún grupo dura menos del mínimo salvo que no haya con quién fusionar', () => {
    const g = agruparPalabras(seguidas(['uno', 'dos', 'tres', 'cuatro', 'cinco'], 500));
    for (const grupo of g) expect(grupo.to_ms - grupo.from_ms).toBeGreaterThanOrEqual(GRUPO_MIN_MS);
  });
});

// La puerta de contención del catálogo de origen mide la caja con el navegador;
// aquí se hace con aritmética para que corra en CI sin abrir Chromium.
describe('cuerpoDeGrupo', () => {
  const ANCHO_UTIL = 1080 - 2 * 96;

  it('una palabra corta llega al cuerpo máximo', () => {
    expect(cuerpoDeGrupo('ya', ANCHO_UTIL)).toBe(128);
  });

  it('nunca se sale del ancho útil', () => {
    for (const t of ['ya', 'coste', 'el coste', 'infraestructura', 'pesos abiertos ya']) {
      const cuerpo = cuerpoDeGrupo(t, ANCHO_UTIL);
      expect(t.length * 0.55 * cuerpo).toBeLessThanOrEqual(ANCHO_UTIL + 1);
    }
  });

  it('es mucho mayor en relativo que los 54 px del tema apaisado', () => {
    // 54 sobre 1920 es el 2,8 % del ancho; esto tiene que superar el 10 %
    expect(cuerpoDeGrupo('el coste', ANCHO_UTIL) / 1080).toBeGreaterThan(0.1);
  });
});
