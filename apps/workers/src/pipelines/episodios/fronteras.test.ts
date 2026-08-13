import { describe, expect, it } from 'vitest';
import type { BeatToken } from '../tts/beats.js';
import { ajustarVentanaAFrase } from './fronteras.js';

// frase de 3 palabras cada 500 ms, fin de frase en la tercera
function frases(n: number): BeatToken[] {
  const out: BeatToken[] = [];
  for (let f = 0; f < n; f += 1) {
    for (let p = 0; p < 3; p += 1) {
      const from = (f * 3 + p) * 500;
      out.push({
        from_ms: from,
        to_ms: from + 400,
        raw: `p${f}-${p}`,
        sentenceEnd: p === 2,
        clauseEnd: false,
        sceneIdx: 0,
      });
    }
  }
  return out;
}

describe('ajustarVentanaAFrase', () => {
  it('ventana ya alineada no se toca', () => {
    const t = frases(4);
    // frase 1 completa: 1500-2900 (fin del token 5)
    expect(ajustarVentanaAFrase({ from_ms: 1500, to_ms: 2900 }, t)).toEqual({
      from_ms: 1500,
      to_ms: 2900,
    });
  });

  it('el final a mitad de frase se EXTIENDE al fin de frase', () => {
    const t = frases(4);
    // corta tras la primera palabra de la frase 1 (token 3, to=1900)
    const v = ajustarVentanaAFrase({ from_ms: 0, to_ms: 2000 }, t);
    expect(v.to_ms).toBe(2900); // fin del token 5, que cierra la frase 1
  });

  it('si la frase no cierra cerca, el final se RETRAE al último cierre', () => {
    const t = frases(2);
    // solo la palabra 4 marca fin muy lejos: simulamos frase larguísima
    const largos: BeatToken[] = [
      { from_ms: 0, to_ms: 400, raw: 'a', sentenceEnd: true, clauseEnd: false, sceneIdx: 0 },
      { from_ms: 500, to_ms: 900, raw: 'b', sentenceEnd: false, clauseEnd: false, sceneIdx: 0 },
      // el siguiente fin de frase queda a >3 s del corte
      { from_ms: 6000, to_ms: 6400, raw: 'c', sentenceEnd: true, clauseEnd: false, sceneIdx: 0 },
    ];
    void t;
    const v = ajustarVentanaAFrase({ from_ms: 0, to_ms: 1000 }, largos);
    expect(v.to_ms).toBe(400); // retrae al último cierre dentro de la ventana
  });

  it('el arranque a mitad de frase salta a la frase siguiente', () => {
    const t = frases(4);
    // arranca en la palabra 2 de la frase 0 (from=500): frase venía empezada
    const v = ajustarVentanaAFrase({ from_ms: 500, to_ms: 5900 }, t);
    expect(v.from_ms).toBe(1500); // arranque de la frase 1
  });

  it('el arranque en inicio de frase no se mueve', () => {
    const t = frases(4);
    const v = ajustarVentanaAFrase({ from_ms: 1500, to_ms: 5900 }, t);
    expect(v.from_ms).toBe(1500);
  });

  it('con retraer:false un run-on sin cierre conserva el final del encargo', () => {
    const largos: BeatToken[] = [
      { from_ms: 0, to_ms: 400, raw: 'a', sentenceEnd: true, clauseEnd: false, sceneIdx: 0 },
      { from_ms: 500, to_ms: 900, raw: 'b', sentenceEnd: false, clauseEnd: false, sceneIdx: 0 },
      { from_ms: 6000, to_ms: 6400, raw: 'c', sentenceEnd: true, clauseEnd: false, sceneIdx: 0 },
    ];
    const v = ajustarVentanaAFrase({ from_ms: 0, to_ms: 1000 }, largos, { retraer: false });
    expect(v.to_ms).toBe(1000);
  });
});
