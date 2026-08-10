import type { BeatCandidate } from '@fabrica/shared';
import { describe, expect, it } from 'vitest';
import { aplicarVeredicto, buildRerankPrompt, type RerankPlano } from './rerank.js';

function cand(ref: string, caption: string): BeatCandidate {
  return { ref, provider: 'pexels', score: 0.82, meta: { kind: 'clip', caption } };
}

const PLANO: RerankPlano = {
  beatIdx: 1,
  vIdx: 0,
  text: 'Un informe repasa el Reglamento Europeo de IA y advierte de las sanciones.',
  query: 'open legal report on desk',
  candidates: [
    cand('a', 'Estudio de grabación con micrófono y letrero ON AIR'),
    cand('b', 'Sello de madera sobre un documento legal abierto'),
    cand('c', 'Mano firmando documentos junto a un mazo de juez'),
  ],
};

describe('aplicarVeredicto', () => {
  it('mueve el elegido al frente y conserva el resto como alternativas', () => {
    const { orden } = aplicarVeredicto([PLANO], [{ idx: 0, elegido: 3 }]);
    expect(orden.get('1:0')?.map((c) => c.ref)).toEqual(['c', 'a', 'b']);
  });

  it('no reescribe el plano cuyo elegido ya estaba primero', () => {
    expect(aplicarVeredicto([PLANO], [{ idx: 0, elegido: 1 }]).orden.has('1:0')).toBe(false);
  });

  it('el 0 significa «ninguno pega» y no reordena nada', () => {
    const { orden, sinPlano } = aplicarVeredicto([PLANO], [{ idx: 0, elegido: 0 }]);
    expect(sinPlano.has('1:0')).toBe(true);
    expect(orden.has('1:0')).toBe(false);
  });

  it('un número fuera de rango se ignora: el juez se lo inventó', () => {
    const { orden, sinPlano } = aplicarVeredicto([PLANO], [{ idx: 0, elegido: 9 }]);
    expect(orden.size).toBe(0);
    expect(sinPlano.size).toBe(0);
  });

  it('un plano que el juez no menciona se queda como estaba', () => {
    const r = aplicarVeredicto([PLANO], [{ idx: 7, elegido: 2 }]);
    expect(r.orden.size).toBe(0);
    expect(r.sinPlano.size).toBe(0);
  });

  it('distingue los sub-planos DEL MISMO beat, que es de lo que va la clave', () => {
    // un beat de 10 s lleva hasta tres planos con consultas distintas; juzgar
    // por beat y aplicar al primero sería decidir sobre una estructura y
    // escribir en otra, que es como se rompió la puerta de curación
    const segundo: RerankPlano = { ...PLANO, vIdx: 1, query: 'otra cosa' };
    const { orden } = aplicarVeredicto(
      [PLANO, segundo],
      [
        { idx: 0, elegido: 2 },
        { idx: 1, elegido: 3 },
      ],
    );
    expect(orden.get('1:0')?.[0]?.ref).toBe('b');
    expect(orden.get('1:1')?.[0]?.ref).toBe('c');
  });
});

describe('buildRerankPrompt', () => {
  it('numera los candidatos desde 1, que es como se piden de vuelta', () => {
    const { user } = buildRerankPrompt([PLANO]);
    expect(user).toContain('1. [clip] Estudio de grabación');
    expect(user).toContain('3. [clip] Mano firmando');
  });

  it('numera los planos por su posición en la lista, no por el idx del beat', () => {
    // dos planos del beat 1: si se numeraran por beat, el modelo devolvería el
    // mismo idx para los dos y solo se aplicaría uno
    const { user } = buildRerankPrompt([PLANO, { ...PLANO, vIdx: 1 }]);
    expect(user).toContain('PLANO 0');
    expect(user).toContain('PLANO 1');
  });

  it('le dice al juez que responder 0 es una respuesta válida', () => {
    // sin esto el modelo elige siempre algo, y «algo» sobre un plano que no
    // tiene candidato bueno es exactamente el defecto que se quiere quitar
    expect(buildRerankPrompt([PLANO]).system).toContain('responde 0');
  });

  it('la narración va literal: es la señal, no la consulta inventada', () => {
    expect(buildRerankPrompt([PLANO]).user).toContain('Reglamento Europeo de IA');
  });
});

describe('confirmados', () => {
  // La señal positiva de la fase 2: con broll_juez_aprueba, un plano
  // CONFIRMADO por el juez (y con coseno ≥ T_REV) pasa a verde. Confirmar es
  // afirmar un candidato válido — incluido «dejar el primero»; un índice
  // inventado o un veto no confirman nada.
  it('afirmar un candidato confirma, incluido dejar el primero', () => {
    expect(aplicarVeredicto([PLANO], [{ idx: 0, elegido: 1 }]).confirmados.has('1:0')).toBe(true);
    expect(aplicarVeredicto([PLANO], [{ idx: 0, elegido: 3 }]).confirmados.has('1:0')).toBe(true);
  });

  it('ni el veto ni un índice inventado confirman', () => {
    expect(aplicarVeredicto([PLANO], [{ idx: 0, elegido: 0 }]).confirmados.size).toBe(0);
    expect(aplicarVeredicto([PLANO], [{ idx: 0, elegido: 9 }]).confirmados.size).toBe(0);
  });

  it('un plano no mencionado no queda confirmado', () => {
    expect(aplicarVeredicto([PLANO], [{ idx: 7, elegido: 1 }]).confirmados.size).toBe(0);
  });
});
