import { describe, expect, it } from 'vitest';
import { topByTitleCosine } from './index.js';

// La descripción de visión era el 77 % del coste de un vídeo. La criba por
// título es gratis (embeddings locales) y decide a quién vale la pena pagarle
// una: los que ya iban últimos con su propio texto no van a ganar por tener
// mejor descripción.

const item = (title: unknown): { meta: { title?: unknown } } => ({ meta: { title } });

describe('topByTitleCosine', () => {
  const q = [1, 0];

  it('se queda con los más parecidos a la query', () => {
    const items = [item('lejos'), item('cerca'), item('medio')];
    const vecs = [
      [0, 1], // cos 0
      [1, 0], // cos 1
      [0.7, 0.7], // cos ~0,7
    ];
    expect(topByTitleCosine(items, vecs, q, 2)).toEqual([items[1], items[2]]);
  });

  it('un candidato sin título puntúa cero y solo entra si no hay mejores', () => {
    const items = [item(''), item('bueno')];
    const vecs = [[1, 0], [1, 0]];
    expect(topByTitleCosine(items, vecs, q, 1)).toEqual([items[1]]);
    // con hueco de sobra sí entra: mejor un candidato mudo que ninguno
    expect(topByTitleCosine(items, vecs, q, 2)).toHaveLength(2);
  });

  it('un candidato sin vector no rompe el orden', () => {
    const items = [item('a'), item('b')];
    expect(topByTitleCosine(items, [undefined, [1, 0]], q, 1)).toEqual([items[1]]);
  });

  it('los empates se rompen por orden de llegada, así que es determinista', () => {
    const items = [item('a'), item('b'), item('c')];
    const vecs = [[1, 0], [1, 0], [1, 0]];
    expect(topByTitleCosine(items, vecs, q, 2)).toEqual([items[0], items[1]]);
    expect(topByTitleCosine(items, vecs, q, 2)).toEqual(topByTitleCosine(items, vecs, q, 2));
  });

  it('pedir más de los que hay devuelve todos', () => {
    const items = [item('a')];
    expect(topByTitleCosine(items, [[1, 0]], q, 5)).toHaveLength(1);
    expect(topByTitleCosine([], [], q, 5)).toEqual([]);
  });
});
