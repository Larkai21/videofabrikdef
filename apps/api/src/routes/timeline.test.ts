import type { BeatCandidate, StoredSubvisual } from '@fabrica/shared';
import { describe, expect, it } from 'vitest';
import { elegirEnSubplano } from './timeline.js';

function candidato(
  ref: string,
  provider: BeatCandidate['provider'] = 'pexels',
  score = 0.8,
): BeatCandidate {
  return { ref, provider, score, meta: { kind: 'clip', duration_ms: 12_000 } };
}

function subplano(over: Partial<StoredSubvisual> = {}): StoredSubvisual {
  return {
    from_ms: 0,
    to_ms: 6_000,
    visual_query: 'courtroom gavel',
    status: 'review',
    candidates: [candidato('pixabay:video:192778', 'pixabay'), candidato('pexels:video:6101367')],
    fit: null,
    chosen_origin: 'Pixabay · clip 192778',
    chosen_score: 0.81,
    asset_id: null,
    ...over,
  };
}

// El bug que motiva esta función: el humano elegía en la ficha del beat, la API
// contestaba {ok:true}, el beat guardaba el origen correcto… y la ingesta
// descargaba `visuals[0].candidates[0]`, que seguía siendo el candidato de la
// máquina. Los 25 planos que curé a mano en un vídeo real se perdieron así.
describe('elegirEnSubplano', () => {
  const elegido = candidato('pexels:video:6101367');

  it('pone lo elegido primero en el sub-plano, que es de donde tira la ingesta', () => {
    const r = elegirEnSubplano([subplano()], elegido, 6_000);
    expect(r?.[0]?.candidates[0]?.ref).toBe('pexels:video:6101367');
    expect(r?.[0]?.status).toBe('locked');
    expect(r?.[0]?.chosen_origin).toContain('6101367');
  });

  it('no duplica el candidato elegido si ya estaba en la lista', () => {
    const r = elegirEnSubplano([subplano()], elegido, 6_000);
    expect(r?.[0]?.candidates.filter((c) => c.ref === elegido.ref)).toHaveLength(1);
    expect(r?.[0]?.candidates).toHaveLength(2);
  });

  it('admite un candidato de la búsqueda libre, que no estaba entre los del beat', () => {
    const nuevo = candidato('pexels:video:99999');
    const r = elegirEnSubplano([subplano()], nuevo, 6_000);
    expect(r?.[0]?.candidates[0]?.ref).toBe('pexels:video:99999');
    expect(r?.[0]?.candidates).toHaveLength(3);
  });

  it('solo toca el primer sub-plano: los demás son momentos que el humano no ha visto', () => {
    const segundo = subplano({ from_ms: 6_000, to_ms: 12_000, visual_query: 'otra cosa' });
    const r = elegirEnSubplano([subplano(), segundo], elegido, 12_000);
    expect(r?.[1]).toEqual(segundo);
  });

  it('el fit se calcula contra el tramo del SUB-PLANO, no contra el beat entero', () => {
    const corto = subplano({ from_ms: 0, to_ms: 3_000 });
    const r = elegirEnSubplano([corto], elegido, 12_000);
    expect(r?.[0]?.fit).not.toBeNull();
  });

  it('un beat sin sub-planos se queda como está', () => {
    expect(elegirEnSubplano(null, elegido, 6_000)).toBeNull();
    expect(elegirEnSubplano([], elegido, 6_000)).toEqual([]);
  });
});
