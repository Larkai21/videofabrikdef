import { describe, expect, it } from 'vitest';
import { T_REV, type Fit } from '@fabrica/shared';
import { cosEfectivo, selectPick, type PoolEntry } from './pick.js';

function entry(
  ref: string,
  cos: number,
  kind: 'clip' | 'image' = 'clip',
  provider: 'pexels' | 'library' = 'pexels',
): PoolEntry {
  return {
    cand: { ref, provider, score: cos, meta: { kind } },
    kind,
    durationMs: 30_000,
    cos,
    composite: cos,
    altRefs: [],
    vec: [],
  };
}

const TRIM: Fit = { mode: 'trim', offset_ms: 0 };
const LOOP: Fit = { mode: 'loop', loops: 3 };

// selectPick espera el pool ya ordenado por coseno efectivo, igual que en el worker
function ordenar(
  items: { entry: PoolEntry; fit: Fit }[],
  h?: number,
): { entry: PoolEntry; fit: Fit }[] {
  return [...items].sort((a, b) => cosEfectivo(b.entry, h) - cosEfectivo(a.entry, h));
}

const SIN_USAR = new Set<string>();

describe('cosEfectivo', () => {
  it('penaliza la imagen fija menos de lo que el margen de banda permite recuperar', () => {
    // el handicap y PICK_COS_MARGIN se suman: si el handicap se acercara al
    // margen, la preferencia por movimiento pasaría a ser un veto
    const clip = entry('c', 0.84);
    const imagen = entry('i', 0.84, 'image');
    expect(cosEfectivo(clip) - cosEfectivo(imagen)).toBeCloseTo(0.02, 6);
  });

  it('una imagen de biblioteca arrastra los dos handicaps', () => {
    expect(cosEfectivo(entry('l', 0.9, 'image', 'library'))).toBeCloseTo(0.85, 6);
  });
});

describe('selectPick', () => {
  it('prefiere el clip a la imagen cuando empatan en coseno', () => {
    const pick = selectPick(
      ordenar([
        { entry: entry('imagen', 0.85, 'image'), fit: { mode: 'kenburns' } },
        { entry: entry('clip', 0.85), fit: TRIM },
      ]),
      SIN_USAR,
      null,
    );
    expect(pick?.entry.cand.ref).toBe('clip');
  });

  it('la imagen gana igualmente si es claramente mejor', () => {
    // es una preferencia, no una prohibición: el b-roll relevante manda
    const pick = selectPick(
      ordenar([
        { entry: entry('imagen', 0.92, 'image'), fit: { mode: 'kenburns' } },
        { entry: entry('clip', 0.85), fit: TRIM },
      ]),
      SIN_USAR,
      null,
    );
    expect(pick?.entry.cand.ref).toBe('imagen');
  });

  it('NO elige por debajo de T_REV habiendo un candidato por encima', () => {
    // esta es la que compra Flux sin necesidad: la banda se ancla en el coseno
    // efectivo pero la puerta de Flux mira el crudo, y el orden intra-banda
    // antepone «sin bucle» al coseno, así que el de 0,775 ganaba al de 0,81
    const pick = selectPick(
      ordenar([
        { entry: entry('bueno', 0.81), fit: LOOP },
        { entry: entry('flojo', 0.775), fit: TRIM },
      ]),
      SIN_USAR,
      null,
    );
    expect(pick?.entry.cand.ref).toBe('bueno');
    expect(pick!.entry.cos).toBeGreaterThanOrEqual(T_REV);
  });

  it('si NADIE llega a T_REV sigue eligiendo el mejor, no se queda sin plano', () => {
    const pick = selectPick(
      ordenar([
        { entry: entry('malo', 0.7), fit: LOOP },
        { entry: entry('peor', 0.65), fit: TRIM },
      ]),
      SIN_USAR,
      null,
    );
    expect(pick?.entry.cand.ref).toBe('malo');
  });

  it('sigue evitando el bucle entre candidatos viables', () => {
    const pick = selectPick(
      ordenar([
        { entry: entry('conbucle', 0.85), fit: LOOP },
        { entry: entry('limpio', 0.83), fit: TRIM },
      ]),
      SIN_USAR,
      null,
    );
    expect(pick?.entry.cand.ref).toBe('limpio');
  });

  it('no repite un plano ya usado en el vídeo si hay alternativa', () => {
    const pick = selectPick(
      ordenar([
        { entry: entry('repetido', 0.88), fit: TRIM },
        { entry: entry('nuevo', 0.82), fit: TRIM },
      ]),
      new Set(['repetido']),
      null,
    );
    expect(pick?.entry.cand.ref).toBe('nuevo');
  });

  it('con handicap de imagen desactivado vuelve a decidir solo el coseno', () => {
    // es lo que hace la palanca del canal cuando se pide mezcla libre
    const pick = selectPick(
      ordenar(
        [
          { entry: entry('imagen', 0.85, 'image'), fit: { mode: 'kenburns' } },
          { entry: entry('clip', 0.85), fit: TRIM },
        ],
        0,
      ),
      SIN_USAR,
      null,
      0,
    );
    expect(pick?.entry.cand.ref).toBe('imagen');
  });
});
