import { describe, expect, it } from 'vitest';
import type { Edit } from '@fabrica/shared';
import { aplicarCoberturas, recortarPorPalabra } from './index.js';

describe('recortarPorPalabra', () => {
  it('deja lo corto y corta por palabra entera lo largo', () => {
    expect(recortarPorPalabra('  hola   mundo ', 110)).toBe('hola mundo');
    const largo = 'una frase bastante larga que se corta sin partir palabras por la mitad nunca';
    const r = recortarPorPalabra(largo, 40);
    expect(r.length).toBeLessThanOrEqual(40);
    expect(largo.startsWith(r)).toBe(true);
    expect(largo[r.length]).toBe(' ');
  });
});

describe('aplicarCoberturas', () => {
  const ventana = { beat_idx: 3, from_ms: 10_000, to_ms: 15_000, text: 'lo que se dice' };
  const edits: Edit[] = [
    // dentro de la ventana: un overlay (cae) y un sfx (se queda — es audio)
    { type: 'text_callout', from_ms: 11_000, to_ms: 13_000, text: 'tapado' },
    { type: 'sfx', from_ms: 11_500, to_ms: 12_000, sfx: 'ding' },
    // fuera de la ventana: intacto
    { type: 'stat_card', from_ms: 20_000, to_ms: 23_000, value: '42' },
  ];

  it('retira los edits visibles que solapan y conserva audio y lo de fuera', () => {
    const out = aplicarCoberturas(edits, [ventana]);
    const tipos = out.map((e) => `${e.type}@${e.from_ms}`);
    expect(tipos).toContain('cobertura@10000');
    expect(tipos).toContain('sfx@11500');
    expect(tipos).toContain('stat_card@20000');
    expect(tipos).not.toContain('text_callout@11000');
  });

  it('sin ventanas devuelve los edits tal cual', () => {
    expect(aplicarCoberturas(edits, [])).toBe(edits);
  });

  it('la cobertura lleva su texto, beat y keyword opcional, y sale ordenada', () => {
    const out = aplicarCoberturas([], [{ ...ventana, keyword: 'dice' }]);
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.type).toBe('cobertura');
    expect('text' in c && c.text).toBe('lo que se dice');
    expect('keyword' in c && c.keyword).toBe('dice');
    expect(c.beat_idx).toBe(3);
  });
});
