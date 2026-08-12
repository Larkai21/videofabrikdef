import { describe, expect, it } from 'vitest';
import type { SttBlockResult } from '../../providers/stt.js';
import { aTokens, cruzarConPausas, PAUSA_FUERZA_MS, spansDePausas } from './tokens.js';

// La señal de la que cuelga el principio 1 con audio ajeno: puntuación de los
// segments re-repartida sobre los words, cruzada con las pausas acústicas.

function bloque(): SttBlockResult {
  // «hola mundo. qué tal estás» — palabras peladas, puntuación en el segmento
  return {
    text: 'Hola mundo. Qué tal, estás',
    words: [
      { text: 'Hola', from_ms: 0, to_ms: 400 },
      { text: 'mundo', from_ms: 450, to_ms: 900 },
      { text: 'Qué', from_ms: 1_500, to_ms: 1_800 },
      { text: 'tal', from_ms: 1_850, to_ms: 2_100 },
      { text: 'estás', from_ms: 2_200, to_ms: 2_600 },
    ],
    segments: [
      { text: 'Hola mundo.', from_ms: 0, to_ms: 900 },
      { text: 'Qué tal, estás', from_ms: 1_500, to_ms: 2_600 },
    ],
  };
}

describe('aTokens', () => {
  it('reparte la puntuación de los segments sobre los words pelados', () => {
    const tokens = aTokens(bloque(), 0);
    expect(tokens.map((t) => t.raw)).toEqual(['Hola', 'mundo.', 'Qué', 'tal,', 'estás']);
    expect(tokens[1]!.sentenceEnd).toBe(true);
    expect(tokens[3]!.clauseEnd).toBe(true);
    expect(tokens[4]!.sentenceEnd).toBe(false);
  });

  it('re-basa los tiempos con el offset del bloque troceado', () => {
    const tokens = aTokens(bloque(), 600_000);
    expect(tokens[0]!.from_ms).toBe(600_000);
    expect(tokens[4]!.to_ms).toBe(602_600);
  });
});

describe('cruzarConPausas', () => {
  it('el gate mide la puntuación del ASR confirmada por pausa', () => {
    const tokens = aTokens(bloque(), 0);
    // entre «mundo.» (900) y «Qué» (1500) hay 600 ms: confirma el punto
    const gate = cruzarConPausas(tokens, { fuerzaMs: 500 });
    expect(gate.forzadas).toBe(0);
    expect(gate.frases_asr).toBe(1);
    expect(gate.confirmadas).toBe(1);
    expect(gate.pct_confirmadas).toBe(100);
  });

  it('fuerza la frontera por silencio SIN inflar el gate', () => {
    const b = bloque();
    // quitar el punto: el segmento llega sin puntuación (ASR pobre)
    b.segments[0]!.text = 'Hola mundo';
    b.segments[1]!.text = 'Qué tal estás';
    const tokens = aTokens(b, 0);
    const gate = cruzarConPausas(tokens, { fuerzaMs: 500 });
    // la pausa de 600 ms entre mundo(900) y Qué(1500) fuerza el fin…
    expect(gate.forzadas).toBe(1);
    expect(tokens[1]!.sentenceEnd).toBe(true);
    // …pero el gate dice la verdad: el ASR no puntuó nada
    expect(gate.frases_asr).toBe(0);
    expect(gate.pct_confirmadas).toBe(0);
  });

  it('el umbral por defecto no fuerza pausas cortas de respiración', () => {
    const tokens = aTokens(bloque(), 0);
    const gate = cruzarConPausas(tokens);
    expect(PAUSA_FUERZA_MS).toBeGreaterThan(600);
    expect(gate.forzadas).toBe(0);
  });
});

describe('spansDePausas', () => {
  it('una pausa de turno parte el episodio en spans y estampa sceneIdx', () => {
    const b = bloque();
    // separa los dos segmentos 3 s: es un cambio de turno
    b.words[2]!.from_ms = 4_000;
    b.words[2]!.to_ms = 4_300;
    b.words[3]!.from_ms = 4_350;
    b.words[3]!.to_ms = 4_600;
    b.words[4]!.from_ms = 4_700;
    b.words[4]!.to_ms = 5_100;
    const tokens = aTokens(b, 0);
    const spans = spansDePausas(tokens, 6_000);
    expect(spans).toHaveLength(2);
    expect(tokens[0]!.sceneIdx).toBe(0);
    expect(tokens[4]!.sceneIdx).toBe(1);
    expect(spans[1]!.to_ms).toBe(6_000);
  });

  it('sin pausas largas: un único span que cubre todo', () => {
    const tokens = aTokens(bloque(), 0);
    const spans = spansDePausas(tokens, 3_000);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ idx: 0, from_ms: 0, to_ms: 3_000 });
  });
});
