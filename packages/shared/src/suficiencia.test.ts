import { describe, expect, it } from 'vitest';
import { suficienciaResearch } from './suficiencia.js';
import type { Research } from './master-json.js';

function research(textos: string[]): Research {
  return {
    sources: [{ url: 'https://x', title: 't', domain: 'x', published_at: null }],
    summary: 's',
    claims: textos.map((text) => ({ text, source_idx: 0 })),
    angles: [],
  } as Research;
}

describe('suficienciaResearch', () => {
  it('un artículo de verdad da para los siete minutos', () => {
    // JBbfvawGXzsXdA92L1zcH: 12 653 caracteres de HuggingFace
    const v = suficienciaResearch(
      research([
        'Kimi-K3 declara 1 billón de parámetros',
        'Moonshot AI publica los pesos bajo licencia propia',
        'MoonViT-V2 integra visión con 400M de parámetros',
      ]),
      12_653,
      7,
    );
    expect(v.nivel).toBe('suficiente');
    expect(v.minutosMax).toBe(7);
  });

  it('un tuit sin texto descargado NO da siete minutos', () => {
    // uVkNtcYIrYqEX8D3dG1Ah: 1 claim, 0 caracteres (Twitter bloquea al bot).
    // El sistema le pidió 875 palabras y salieron mil de generalidades.
    const v = suficienciaResearch(research(['AI companies are shredding rare books']), 0, 7);
    expect(v.nivel).toBe('justo');
    expect(v.minutosMax).toBe(2);
    expect(v.motivo).toContain('más corto y más denso');
  });

  it('un claim que solo dice que existe un artículo no cuenta como dato', () => {
    // el claim REAL de OIC6 antes de arreglar el fetcher
    const v = suficienciaResearch(
      research(['Existe un artículo titulado sobre los modelos de pesos abiertos']),
      0,
      7,
    );
    // «Existe» va al principio de frase, así que no cuenta como nombre propio
    expect(v.claimsConDato).toBe(0);
    expect(v.minutosMax).toBe(2);
  });

  it('sin claims y sin texto no hay vídeo, y se dice', () => {
    const v = suficienciaResearch(research([]), 0, 7);
    expect(v.nivel).toBe('insuficiente');
    expect(v.minutosMax).toBe(0);
    expect(v.motivo).toContain('revisa la fuente');
  });

  it('NUNCA se alarga el vídeo por encima de lo pedido', () => {
    // el material puede dar para más; la duración la manda el canal
    const v = suficienciaResearch(
      research(Array.from({ length: 40 }, (_, i) => `Dato ${i} con Nombre Propio y 30 %`)),
      50_000,
      7,
    );
    expect(v.minutosMax).toBe(7);
  });

  it('no exige dos fuentes: eso apagaría la fábrica', () => {
    // los once vídedos del corpus tienen UNA sola fuente
    const v = suficienciaResearch(
      research(['El índice subió un 70 % según Gartner', 'Nvidia vendió 3 millones de chips']),
      4_085,
      7,
    );
    expect(v.nivel).toBe('suficiente');
  });
});
