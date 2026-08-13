// El contrato COMPARTIDO del reloj origen→salida, contra el MISMO fixture que
// pytest del módulo editor (apps/editor/tests/fixtures/reloj/casos.json):
// dos implementaciones del mismo concepto que tienen que mapear IGUAL dentro
// de un keep. Aquí se asierta la columna `out_ms` — la semántica del worker:
// fuera de un keep, remapear devuelve null (un token cortado se cae). La
// columna `clamp_ms` (llevar al borde) es la del editor y se asierta allí.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { remapear, type Keep } from './apretar.js';

interface CasoReloj {
  nombre: string;
  keep: { src_start_ms: number; src_end_ms: number; out_start_ms: number }[];
  sondas: { t_ms: number; out_ms: number | null; clamp_ms: number }[];
}

const fixture = new URL(
  '../../../../editor/tests/fixtures/reloj/casos.json',
  import.meta.url,
);
const { casos } = JSON.parse(readFileSync(fixture, 'utf8')) as { casos: CasoReloj[] };

describe('reloj compartido editor↔fábrica', () => {
  for (const caso of casos) {
    it(caso.nombre, () => {
      const keeps: Keep[] = caso.keep.map((k) => ({
        src_from_ms: k.src_start_ms,
        src_to_ms: k.src_end_ms,
        out_from_ms: k.out_start_ms,
        out_to_ms: k.out_start_ms + (k.src_end_ms - k.src_start_ms),
      }));
      for (const sonda of caso.sondas) {
        expect(remapear(sonda.t_ms, keeps), `t=${sonda.t_ms} ms`).toBe(sonda.out_ms);
      }
    });
  }
});
