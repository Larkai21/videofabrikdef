import { describe, expect, it } from 'vitest';
import { suficienciaResearch } from './suficiencia.js';
import type { Research } from './master-json.js';

const RANGO = { min: 5, max: 12 };

function research(textos: string[]): Research {
  return {
    sources: [{ url: 'https://x', title: 't', domain: 'x', published_at: null }],
    summary: 's',
    claims: textos.map((text) => ({ text, source_idx: 0 })),
    angles: [],
  } as Research;
}

/** n claims con dato, para mover la palanca sin escribir cuarenta frases */
function conDatos(n: number): Research {
  return research(Array.from({ length: n }, (_, i) => `Nvidia publicó el dato ${i + 1} en 2026`));
}

describe('suficienciaResearch', () => {
  // Los cuatro casos son de los briefs REALES del banco, con sus cifras.
  it('el research más rico se va al máximo del canal', () => {
    // JBbfvawGXzsXdA92L1zcH: 46 claims con dato, 12 653 caracteres de HuggingFace
    const v = suficienciaResearch(conDatos(46), 12_653, RANGO);
    expect(v.nivel).toBe('suficiente');
    expect(v.minutos).toBe(12);
  });

  it('la noticia intermedia manda, y cae DENTRO del rango', () => {
    // OIC6LvB17pOtsK3tOkbqx: 7 datos, 2 707 caracteres de computing.es
    const v = suficienciaResearch(conDatos(7), 2_707, RANGO);
    expect(v.nivel).toBe('suficiente');
    expect(v.minutos).toBe(5.5);
    expect(v.motivo).toContain('dentro del rango');
  });

  it('lo justo se publica al mínimo, sin rellenar hasta el objetivo viejo', () => {
    // zZ0X0SRh7OusaNdtPK8dd: 4 datos pero 9 404 caracteres
    const v = suficienciaResearch(conDatos(4), 9_404, RANGO);
    expect(v.nivel).toBe('justo');
    expect(v.minutos).toBe(5);
    expect(v.minutosPorMaterial).toBeLessThan(5);
  });

  it('un tuit sin texto descargado NO es un vídeo', () => {
    // uVkNtcYIrYqEX8D3dG1Ah: 1 claim, 0 caracteres (Twitter bloquea al bot).
    // Antes se le pedían 875 palabras y salían mil de generalidades.
    const v = suficienciaResearch(conDatos(1), 0, RANGO);
    expect(v.nivel).toBe('insuficiente');
    expect(v.minutos).toBe(0);
    expect(v.motivo).toContain('Revisa la fuente');
  });

  it('muchos claims con poco texto detrás NO alargan el vídeo', () => {
    // El research puede sacar diez claims de un titular; sin texto no hay con
    // qué desarrollarlos, así que el techo lo pone lo descargado.
    const v = suficienciaResearch(conDatos(20), 600, RANGO);
    expect(v.minutosPorMaterial).toBe(4);
    expect(v.nivel).toBe('justo');
  });

  it('la longitud VARÍA con el material: eso es todo el cambio', () => {
    const largos = [1, 4, 7, 11, 20, 46].map(
      (n) => suficienciaResearch(conDatos(n), 5_000, RANGO).minutos,
    );
    // sin repetir siempre el mismo número, y monótono
    expect(new Set(largos).size).toBeGreaterThan(3);
    for (let i = 1; i < largos.length; i++) expect(largos[i]!).toBeGreaterThanOrEqual(largos[i - 1]!);
  });

  it('nunca se sale del rango que fija el canal', () => {
    for (const n of [0, 1, 5, 20, 100]) {
      const v = suficienciaResearch(conDatos(n), 50_000, RANGO);
      if (v.nivel === 'insuficiente') continue;
      expect(v.minutos).toBeGreaterThanOrEqual(RANGO.min);
      expect(v.minutos).toBeLessThanOrEqual(RANGO.max);
    }
  });

  it('un rango de un solo valor se comporta como el número fijo de antes', () => {
    const v = suficienciaResearch(conDatos(20), 8_000, { min: 7, max: 7 });
    expect(v.minutos).toBe(7);
  });
});
