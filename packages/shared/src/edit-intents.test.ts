import { describe, expect, it } from 'vitest';
import {
  figureBackedBy,
  normalizeWord,
  numericTokens,
  validateSceneIntents,
  wordInText,
  type EditIntent,
} from './edit-intents.js';

const CLAIMS = [{ text: 'el índice subió un 70% en enero' }, { text: 'ya son 2 millones de usuarios' }];

function escena(text: string, intents: EditIntent[], section: 'hook' | 'body' | 'cta' = 'body') {
  return { section, text, edit_intents: intents };
}

describe('normalizeWord y wordInText', () => {
  it('iguala mayúsculas, tildes y puntuación', () => {
    expect(normalizeWord('¿Jamás?')).toBe('jamas');
    expect(normalizeWord('GrapheneOS.')).toBe('grapheneos');
    expect(wordInText('esto jamás funciona', 'Jamás')).toBe(true);
    expect(wordInText('esto jamas funciona', 'jamás')).toBe(true);
  });

  it('exige token completo, no subcadena', () => {
    // sin esto, «no» casaría dentro de «nota» y el efecto entraría en el sitio
    // equivocado
    expect(wordInText('una nota al margen', 'no')).toBe(false);
    expect(wordInText('el modelo nuevo', 'model')).toBe(false);
    expect(wordInText('el modelo nuevo', 'modelo')).toBe(true);
  });

  it('una palabra vacía nunca casa', () => {
    expect(wordInText('lo que sea', '')).toBe(false);
    expect(wordInText('lo que sea', '·')).toBe(false);
  });
});

describe('numericTokens y figureBackedBy', () => {
  it('expande las magnitudes escritas con letra', () => {
    expect(numericTokens('2 millones')).toContain('2000000');
    expect(numericTokens('30 mil')).toContain('30000');
  });

  it('limpia separadores de millar y el signo de porcentaje', () => {
    expect(numericTokens('1.000.000')).toContain('1000000');
    expect(numericTokens('70%')).toContain('70');
  });

  it('respalda una cifra dicha con letra en la narración', () => {
    expect(figureBackedBy('2000000', ['ya son 2 millones de usuarios'])).toBe(true);
    expect(figureBackedBy('70', ['el índice subió un 70% en enero'])).toBe(true);
  });

  it('no respalda una cifra que no está en ninguna fuente', () => {
    expect(figureBackedBy('4500', ['no hay cifras aquí'])).toBe(false);
    expect(figureBackedBy('sin cifras', ['da igual'])).toBe(false);
  });
});

describe('validateSceneIntents', () => {
  it('conserva una intención cuyo disparador está en la escena', () => {
    const r = validateSceneIntents(
      escena('el coste real es otro', [
        { effect: 'callout', trigger_word: 'coste', card_text: 'coste real' },
      ]),
      CLAIMS,
    );
    expect(r.kept).toHaveLength(1);
    expect(r.dropped).toHaveLength(0);
  });

  it('descarta la intención cuyo disparador no está en el texto', () => {
    const r = validateSceneIntents(
      escena('el coste real es otro', [
        { effect: 'callout', trigger_word: 'inexistente', card_text: 'coste real' },
      ]),
      CLAIMS,
    );
    expect(r.kept).toHaveLength(0);
    expect(r.dropped[0]?.reason).toBe('trigger_ausente');
  });

  it('exige cifra y respaldo en las tarjetas de dato', () => {
    const sinValor = validateSceneIntents(
      escena('subió mucho el índice', [{ effect: 'stat', trigger_word: 'índice' }]),
      CLAIMS,
    );
    expect(sinValor.dropped[0]?.reason).toBe('sin_valor');

    const inventada = validateSceneIntents(
      escena('subió mucho el índice', [
        { effect: 'stat', trigger_word: 'índice', value: '4500' },
      ]),
      CLAIMS,
    );
    expect(inventada.dropped[0]?.reason).toBe('cifra_sin_respaldo');
  });

  it('acepta la cifra que sale del claim citado aunque la escena la diga con letra', () => {
    const r = validateSceneIntents(
      escena('ya son dos millones de usuarios', [
        { effect: 'stat', trigger_word: 'millones', value: '2000000', claim_idx: 1 },
      ]),
      CLAIMS,
    );
    expect(r.kept).toHaveLength(1);
  });

  it('la tipografía cinética solo va en el gancho', () => {
    const r = validateSceneIntents(
      escena('esto cambia todo', [{ effect: 'kinetic', trigger_word: 'cambia', card_text: 'todo cambia' }]),
      CLAIMS,
    );
    expect(r.dropped[0]?.reason).toBe('kinetic_fuera_hook');
  });

  it('rechaza el copy de más de cuatro palabras y el que falta', () => {
    const largo = validateSceneIntents(
      escena('el coste real', [
        { effect: 'callout', trigger_word: 'coste', card_text: 'uno dos tres cuatro cinco' },
      ]),
      CLAIMS,
    );
    expect(largo.dropped[0]?.reason).toBe('copy_largo');

    const sinCopy = validateSceneIntents(
      escena('el coste real', [{ effect: 'callout', trigger_word: 'coste' }]),
      CLAIMS,
    );
    expect(sinCopy.dropped[0]?.reason).toBe('sin_copy');
  });

  it('corta en el tope por escena', () => {
    const r = validateSceneIntents(
      escena('uno dos tres', [
        { effect: 'callout', trigger_word: 'uno', card_text: 'a b' },
        { effect: 'quote', trigger_word: 'dos', card_text: 'c d' },
        { effect: 'annotation', trigger_word: 'tres' },
      ]),
      CLAIMS,
    );
    expect(r.kept).toHaveLength(2);
    expect(r.dropped[0]?.reason).toBe('exceso');
  });

  it('una escena sin intenciones no produce nada', () => {
    expect(validateSceneIntents({ section: 'body', text: 'lo que sea' }, CLAIMS).kept).toEqual([]);
  });
});
