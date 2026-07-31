import type { Scene } from '@fabrica/shared';
import { describe, expect, it } from 'vitest';
import { MAX_INTENTS_PER_SCENE } from '@fabrica/shared';
import { countIntents, intentWarning, keepValidIntents, sweepIntents } from './intents.js';

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
    // el efecto viaja con el motivo: «se cayó un callout por palabra ausente»
    // dice qué arreglar; «se cayó uno» no
    expect(r.dropped).toEqual([
      { sceneId: 'sc-body-2', effect: 'callout', reason: 'trigger_ausente' },
    ]);
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
      { sceneId: 'a', effect: 'callout', reason: 'trigger_ausente' },
      { sceneId: 'b', effect: 'keyword', reason: 'trigger_ausente' },
      { sceneId: 'c', effect: 'stat', reason: 'sin_valor' },
    ]);
    expect(aviso).toContain('3 efectos');
    expect(aviso).toContain('no está en el texto de la escena');
    expect(aviso).not.toContain('{');
    expect(aviso).not.toContain('trigger_ausente');
  });

  it('concuerda el singular', () => {
    expect(intentWarning([{ sceneId: 'a', effect: 'callout', reason: 'sin_copy' }])).toContain(
      'un efecto',
    );
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

describe('countIntents', () => {
  it('suma las intenciones de todas las escenas y trata la ausencia como cero', () => {
    expect(countIntents([])).toBe(0);
    expect(countIntents([{}, { edit_intents: [] }])).toBe(0);
    expect(
      countIntents([
        { edit_intents: [{ effect: 'keyword', trigger_word: 'a' }] },
        {},
        {
          edit_intents: [
            { effect: 'keyword', trigger_word: 'b' },
            { effect: 'stat', trigger_word: 'c' },
          ],
        },
      ]),
    ).toBe(3);
  });
});

describe('lectura tolerante de las intenciones del LLM', () => {
  // El esquema con el que se LEE la salida del modelo llevaba
  // `.max(MAX_INTENTS_PER_SCENE)`, y una escena con tres intenciones tumbaba el
  // guion entero: 12 generaciones perdidas de 152 en seis tandas del banco. En
  // producción sería un vídeo en incidencia por una etiqueta de más.
  it('acepta más intenciones de las permitidas y las recorta después', () => {
    const escena: Scene = {
      id: 'sc-hook',
      section: 'hook',
      text: 'Nvidia levantó 300 millones y el mercado cambió de golpe esta semana.',
      visual_query: 'chips',
      edit_intents: [
        { effect: 'kinetic', trigger_word: 'Nvidia', card_text: 'Nvidia' },
        { effect: 'kinetic', trigger_word: 'mercado', card_text: 'Mercado' },
        { effect: 'kinetic', trigger_word: 'semana', card_text: 'Semana' },
      ],
    };
    // el esquema de lectura NO rechaza las tres…
    expect(escena.edit_intents).toHaveLength(3);
    // …y el barrido deja como mucho MAX_INTENTS_PER_SCENE, con motivo
    const barrido = sweepIntents([escena], []);
    expect(barrido.scenes[0]!.edit_intents?.length ?? 0).toBeLessThanOrEqual(MAX_INTENTS_PER_SCENE);
    expect(barrido.dropped.some((d) => d.reason === 'exceso')).toBe(true);
  });
});
