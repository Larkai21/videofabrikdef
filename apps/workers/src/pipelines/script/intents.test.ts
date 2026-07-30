import type { Scene } from '@fabrica/shared';
import { describe, expect, it } from 'vitest';
import { intentWarning, keepValidIntents, sweepIntents } from './intents.js';

const CLAIMS = [{ text: 'ya son 2 millones de usuarios' }];

function escena(over: Partial<Scene> & { id: string; text: string }): Scene {
  return { section: 'body', visual_query: 'server room', ...over } as Scene;
}

describe('sweepIntents', () => {
  it('conserva lo que valida y descarta lo que no, con su motivo', () => {
    const scenes = [
      escena({
        id: 'sc-body-1',
        text: 'el coste real es otro',
        edit_intents: [{ effect: 'callout', trigger_word: 'coste', card_text: 'coste real' }],
      }),
      escena({
        id: 'sc-body-2',
        text: 'aquí no hay nada de eso',
        edit_intents: [{ effect: 'callout', trigger_word: 'inexistente', card_text: 'algo' }],
      }),
    ];
    const r = sweepIntents(scenes, CLAIMS);
    expect(r.scenes[0]?.edit_intents).toHaveLength(1);
    // la escena que se queda sin intenciones no arrastra un array vacío
    expect(r.scenes[1]?.edit_intents).toBeUndefined();
    expect(r.dropped).toEqual([{ sceneId: 'sc-body-2', reason: 'trigger_ausente' }]);
  });

  it('deja intactas las escenas sin intenciones', () => {
    const scenes = [escena({ id: 'sc-body-1', text: 'sin nada' })];
    const r = sweepIntents(scenes, CLAIMS);
    expect(r.scenes).toEqual(scenes);
    expect(r.dropped).toEqual([]);
  });

  it('descarta la cifra que no sale del research', () => {
    const scenes = [
      escena({
        id: 'sc-body-1',
        text: 'el índice llegó a niveles altos',
        edit_intents: [{ effect: 'stat', trigger_word: 'índice', value: '9999' }],
      }),
    ];
    expect(sweepIntents(scenes, CLAIMS).dropped[0]?.reason).toBe('cifra_sin_respaldo');
  });
});

describe('intentWarning', () => {
  it('sin descartes no hay aviso', () => {
    expect(intentWarning([])).toBeNull();
  });

  it('escribe en español y sin estructura cruda', () => {
    const aviso = intentWarning([
      { sceneId: 'a', reason: 'trigger_ausente' },
      { sceneId: 'b', reason: 'trigger_ausente' },
      { sceneId: 'c', reason: 'sin_valor' },
    ]);
    expect(aviso).toContain('3 efectos');
    expect(aviso).toContain('no está en el texto de la escena');
    expect(aviso).not.toContain('{');
    expect(aviso).not.toContain('trigger_ausente');
  });

  it('concuerda el singular', () => {
    expect(intentWarning([{ sceneId: 'a', reason: 'sin_copy' }])).toContain('un efecto');
  });
});

describe('keepValidIntents', () => {
  it('tira las intenciones cuya palabra ya no está en el texto reescrito', () => {
    const scene = {
      edit_intents: [
        { effect: 'callout' as const, trigger_word: 'coste', card_text: 'coste real' },
        { effect: 'quote' as const, trigger_word: 'margen', card_text: 'sin margen' },
      ],
    };
    expect(keepValidIntents(scene, 'ahora hablamos del coste y ya').edit_intents).toHaveLength(1);
    expect(keepValidIntents(scene, 'texto completamente distinto')).toEqual({});
  });
});
