import type { BeatCandidate } from '@fabrica/shared';
import { describe, expect, it } from 'vitest';
import { aplicarVeredicto, buildRerankPrompt, type RerankBeat } from './rerank.js';

function cand(ref: string, caption: string): BeatCandidate {
  return { ref, provider: 'pexels', score: 0.82, meta: { kind: 'clip', caption } };
}

const BEAT: RerankBeat = {
  idx: 1,
  text: 'Un informe repasa el Reglamento Europeo de IA y advierte de las sanciones.',
  candidates: [
    cand('a', 'Estudio de grabación con micrófono y letrero ON AIR'),
    cand('b', 'Sello de madera sobre un documento legal abierto'),
    cand('c', 'Mano firmando documentos junto a un mazo de juez'),
  ],
};

describe('aplicarVeredicto', () => {
  it('mueve el elegido al frente y conserva el resto como alternativas', () => {
    const { orden } = aplicarVeredicto([BEAT], [{ idx: 1, elegido: 3 }]);
    expect(orden.get(1)?.map((c) => c.ref)).toEqual(['c', 'a', 'b']);
  });

  it('no reescribe el beat cuyo elegido ya estaba primero', () => {
    const { orden } = aplicarVeredicto([BEAT], [{ idx: 1, elegido: 1 }]);
    expect(orden.has(1)).toBe(false);
  });

  it('el 0 significa «ninguno pega» y no reordena nada', () => {
    const { orden, sinPlano } = aplicarVeredicto([BEAT], [{ idx: 1, elegido: 0 }]);
    expect(sinPlano.has(1)).toBe(true);
    expect(orden.has(1)).toBe(false);
  });

  it('un número fuera de rango se ignora: el juez se lo inventó', () => {
    const { orden, sinPlano } = aplicarVeredicto([BEAT], [{ idx: 1, elegido: 9 }]);
    expect(orden.has(1)).toBe(false);
    expect(sinPlano.has(1)).toBe(false);
  });

  it('un beat que el juez no menciona se queda como estaba', () => {
    const { orden, sinPlano } = aplicarVeredicto([BEAT], [{ idx: 7, elegido: 2 }]);
    expect(orden.size).toBe(0);
    expect(sinPlano.size).toBe(0);
  });
});

describe('buildRerankPrompt', () => {
  it('numera los candidatos desde 1, que es como se piden de vuelta', () => {
    const { user } = buildRerankPrompt([BEAT]);
    expect(user).toContain('1. [clip] Estudio de grabación');
    expect(user).toContain('3. [clip] Mano firmando');
  });

  it('le dice al juez que responder 0 es una respuesta válida', () => {
    // sin esto el modelo elige siempre algo, y «algo» sobre un beat que no
    // tiene plano bueno es exactamente el defecto que se quiere quitar
    expect(buildRerankPrompt([BEAT]).system).toContain('responde 0');
  });

  it('la narración va literal: es la señal, no la consulta inventada', () => {
    expect(buildRerankPrompt([BEAT]).user).toContain('Reglamento Europeo de IA');
  });
});
