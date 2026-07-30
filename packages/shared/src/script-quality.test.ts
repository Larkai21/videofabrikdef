import { describe, expect, it } from 'vitest';
import { blockingSceneIds, lintScenes } from './script-quality.js';

const CLAIMS = [{ text: 'el índice subió un 70% en enero' }, { text: 'ya son 2 millones de usuarios' }];

const LEXICO = ['dato', 'coste', 'equipo', 'modelo', 'informe', 'plazo', 'cambio', 'motivo'];

/**
 * Relleno neutro: sin dígitos (el linter los leería como cifras) y partido en
 * frases de ocho palabras para no disparar el aviso de frase larga.
 */
function relleno(n: number): string {
  const palabras = Array.from({ length: n }, (_, i) => LEXICO[i % LEXICO.length] ?? 'dato');
  const frases: string[] = [];
  for (let i = 0; i < palabras.length; i += 8) frases.push(palabras.slice(i, i + 8).join(' '));
  return `${frases.join('. ')}.`;
}

const kinds = (hits: ReturnType<typeof lintScenes>): string[] => hits.map((h) => h.kind);

describe('lintScenes', () => {
  it('no marca nada en una escena limpia con una cifra respaldada', () => {
    // el control de falsos positivos es lo que decide si un linter así sirve
    const texto = `El índice subió un 70% en enero y eso cambia el cálculo. ${relleno(35)}`;
    expect(lintScenes([{ id: 'sc-1', text: texto }], { claims: CLAIMS })).toEqual([]);
  });

  it('detecta muletillas de texto generado', () => {
    const hits = lintScenes(
      [{ id: 'sc-1', text: `En un mundo donde todo cambia, esto importa. ${relleno(35)}` }],
      { claims: CLAIMS },
    );
    expect(kinds(hits)).toContain('cliche');
    // el detalle conserva la capitalización original para que el humano
    // encuentre la frase tal cual está escrita
    expect(hits[0]?.detail).toContain('En un mundo donde');
  });

  it('detecta exclamaciones y frases kilométricas', () => {
    const exclama = lintScenes([{ id: 'sc-1', text: `Esto es enorme. ${relleno(45)}!` }], { claims: CLAIMS });
    expect(kinds(exclama)).toContain('exclamacion');

    const frase30 = Array.from({ length: 30 }, () => 'coste').join(' ');
    const larga = lintScenes([{ id: 'sc-1', text: `${frase30}. ${relleno(25)}` }], { claims: CLAIMS });
    expect(kinds(larga)).toContain('frase_larga');
  });

  it('avisa de escenas fuera del rango de palabras', () => {
    expect(kinds(lintScenes([{ id: 'sc-1', text: relleno(20) }], { claims: CLAIMS }))).toContain(
      'escena_corta',
    );
    const largaHits = lintScenes([{ id: 'sc-1', text: `${relleno(20)}. ${relleno(20)}. ${relleno(50)}.` }], {
      claims: CLAIMS,
    });
    expect(kinds(largaHits)).toContain('escena_larga');
  });

  it('marca la cifra que no está en el research', () => {
    const hits = lintScenes(
      [{ id: 'sc-1', text: `El coste bajó un 45% este trimestre. ${relleno(35)}` }],
      { claims: CLAIMS },
    );
    const cifra = hits.filter((h) => h.kind === 'cifra_sin_claim');
    expect(cifra).toHaveLength(1);
    expect(cifra[0]?.detail).toContain('45');
  });

  it('acepta la cifra dicha con letra cuando el claim la trae en dígitos', () => {
    const texto = `Ya son 2 millones de usuarios y sigue subiendo. ${relleno(35)}`;
    const hits = lintScenes([{ id: 'sc-1', text: texto }], { claims: CLAIMS });
    expect(kinds(hits)).not.toContain('cifra_sin_claim');
  });
});

describe('blockingSceneIds', () => {
  it('solo bloquean el cliché y la cifra sin claim', () => {
    const hits = lintScenes(
      [
        { id: 'sc-1', text: `En la era de los datos todo cambia. ${relleno(35)}` },
        { id: 'sc-2', text: relleno(20) },
      ],
      { claims: CLAIMS },
    );
    expect(blockingSceneIds(hits)).toEqual(['sc-1']);
  });
});
