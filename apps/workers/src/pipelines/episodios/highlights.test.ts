import { describe, expect, it } from 'vitest';
import type { Candidato, ShortDirectorBeat } from '../shorts/director.js';
import { recortarAlRemate } from './highlights.js';

// beats de 10 s cada uno: idx 0 → 0-10 s, idx 1 → 10-20 s…
function beat(idx: number, risa?: number): ShortDirectorBeat {
  return {
    idx,
    from_ms: idx * 10_000,
    to_ms: (idx + 1) * 10_000,
    text: `beat ${idx}`,
    edits: 0,
    ...(risa !== undefined ? { risa_despues_ms: risa } : {}),
  };
}

function candidato(start: number, end: number): Candidato {
  return {
    from_ms: start * 10_000,
    to_ms: (end + 1) * 10_000,
    start_beat_idx: start,
    end_beat_idx: end,
    beat_idxs: Array.from({ length: end - start + 1 }, (_, i) => start + i),
    title: 't',
    hook: 'h',
    reason: 'r',
    score: 80,
  };
}

describe('recortarAlRemate', () => {
  it('recorta al PRIMER golpe válido, no al último', () => {
    // carcajadas en los beats 2 y 4; el clip 0-5 debe acabar en el 2
    const beats = [beat(0), beat(1), beat(2, 1500), beat(3), beat(4, 2000), beat(5)];
    const out = recortarAlRemate(candidato(0, 5), beats);
    expect(out.end_beat_idx).toBe(2);
    expect(out.to_ms).toBe(30_000);
    expect(out.beat_idxs).toEqual([0, 1, 2]);
  });

  it('una risa que dejaría el clip por debajo del mínimo no vale como remate', () => {
    // risa en el beat 0 (a 10 s del arranque, < SHORT_MIN_S): se salta y usa la del 3
    const beats = [beat(0, 1500), beat(1), beat(2), beat(3, 1200), beat(4)];
    const out = recortarAlRemate(candidato(0, 4), beats);
    expect(out.end_beat_idx).toBe(3);
  });

  it('sin carcajadas dentro, el candidato no se toca', () => {
    const beats = [beat(0), beat(1), beat(2)];
    const out = recortarAlRemate(candidato(0, 2), beats);
    expect(out).toEqual(candidato(0, 2));
  });

  it('una sonrisa corta (<800 ms) no es remate', () => {
    const beats = [beat(0), beat(1), beat(2, 400), beat(3)];
    const out = recortarAlRemate(candidato(0, 3), beats);
    expect(out.end_beat_idx).toBe(3);
  });

  it('si el golpe ya es el final del clip, no cambia nada', () => {
    const beats = [beat(0), beat(1), beat(2, 1500)];
    const out = recortarAlRemate(candidato(0, 2), beats);
    expect(out.end_beat_idx).toBe(2);
    expect(out.to_ms).toBe(30_000);
  });
});
