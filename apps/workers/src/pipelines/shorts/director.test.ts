import { describe, expect, it } from 'vitest';
import { SHORT_MAX_S, SHORT_MIN_S } from '@fabrica/shared';
import {
  buildShortPrompt,
  efectosPorBeat,
  fallbackShorts,
  toCandidatos,
  type ShortDirectorBeat,
} from './director.js';

// Beats de 10 s: cuatro llenan justo 40 s, dentro de la ventana permitida.
const BEATS: ShortDirectorBeat[] = Array.from({ length: 8 }, (_, i) => ({
  idx: i,
  from_ms: i * 10_000,
  to_ms: (i + 1) * 10_000,
  text: `Narración del beat ${i}`,
  edits: i % 3 === 0 ? 2 : 0,
}));

const crudo = (start: number, end: number, score = 80, extra: Partial<{ title: string }> = {}) => ({
  start_beat_idx: start,
  end_beat_idx: end,
  title: extra.title ?? `Título ${start}-${end}`,
  hook: 'El gancho',
  reason: 'La razón',
  score,
});

describe('buildShortPrompt', () => {
  it('da una línea por beat con duración y efectos', () => {
    const { system, user } = buildShortPrompt({
      videoId: 'v1',
      channelId: 'c1',
      videoTitle: 'Por qué los chips cambian el coste',
      beats: BEATS,
      fronteras: [],
    });
    expect(system).toContain(`${SHORT_MIN_S}`);
    expect(system).toContain(`${SHORT_MAX_S}`);
    expect(user).toContain('Por qué los chips cambian el coste');
    expect(user.split('\n').filter((l) => /^\d+ · \d+ s · \d+ fx · /.test(l))).toHaveLength(8);
  });

  it('le dice al modelo qué ventanas ya se descartaron', () => {
    const { user } = buildShortPrompt({
      videoId: 'v1',
      channelId: 'c1',
      videoTitle: 'T',
      beats: BEATS,
      fronteras: [],
      excluir: [{ from_ms: 0, to_ms: 30_000 }],
    });
    expect(user).toContain('0-30 s');
  });
});

describe('toCandidatos', () => {
  it('acepta un fragmento que ya cabe en la ventana', () => {
    const out = toCandidatos([crudo(0, 3)], BEATS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      from_ms: 0,
      to_ms: 40_000,
      start_beat_idx: 0,
      end_beat_idx: 3,
      beat_idxs: [0, 1, 2, 3],
    });
  });

  it('descarta índices fuera de rango o invertidos', () => {
    expect(toCandidatos([crudo(0, 99)], BEATS)).toHaveLength(0);
    expect(toCandidatos([crudo(99, 100)], BEATS)).toHaveLength(0);
    expect(toCandidatos([crudo(4, 2)], BEATS)).toHaveLength(0);
  });

  it('estira por beats enteros un fragmento demasiado corto', () => {
    // un solo beat son 10 s, por debajo del mínimo
    const out = toCandidatos([crudo(1, 1)], BEATS);
    expect(out).toHaveLength(1);
    expect(out[0]!.to_ms - out[0]!.from_ms).toBeGreaterThanOrEqual(SHORT_MIN_S * 1000);
    // ha crecido por el final, sin tocar el principio
    expect(out[0]!.start_beat_idx).toBe(1);
    expect(out[0]!.end_beat_idx).toBeGreaterThan(1);
  });

  it('recorta por el final un fragmento demasiado largo', () => {
    // 8 beats son 80 s, por encima del máximo
    const out = toCandidatos([crudo(0, 7)], BEATS);
    expect(out).toHaveLength(1);
    expect(out[0]!.to_ms - out[0]!.from_ms).toBeLessThanOrEqual(SHORT_MAX_S * 1000);
    expect(out[0]!.start_beat_idx).toBe(0);
  });

  it('descarta el que no cabe ni estirando', () => {
    const cortos: ShortDirectorBeat[] = [
      { idx: 0, from_ms: 0, to_ms: 5_000, text: 'a', edits: 0 },
      { idx: 1, from_ms: 5_000, to_ms: 9_000, text: 'b', edits: 0 },
    ];
    expect(toCandidatos([crudo(0, 1)], cortos)).toHaveLength(0);
  });

  it('ajusta los bordes a la frontera fuerte más cercana', () => {
    // la frontera está 200 ms dentro del límite del beat: cae en tolerancia
    const out = toCandidatos([crudo(0, 3)], BEATS, { fronteras: [0, 39_800] });
    expect(out[0]!.to_ms).toBe(39_800);
  });

  it('no mueve el borde si la frontera queda lejos', () => {
    const out = toCandidatos([crudo(0, 3)], BEATS, { fronteras: [0, 35_000] });
    expect(out[0]!.to_ms).toBe(40_000);
  });

  it('entre dos candidatos solapados gana el de más score', () => {
    const out = toCandidatos([crudo(0, 3, 40), crudo(1, 4, 90)], BEATS);
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBe(90);
  });

  it('conserva dos candidatos que no se pisan', () => {
    const out = toCandidatos([crudo(0, 2, 90), crudo(4, 6, 70)], BEATS);
    expect(out.map((c) => c.start_beat_idx).sort()).toEqual([0, 4]);
  });

  it('filtra una ventana que el humano ya descartó', () => {
    const out = toCandidatos([crudo(0, 3)], BEATS, {
      excluir: [{ from_ms: 0, to_ms: 40_000 }],
    });
    expect(out).toHaveLength(0);
  });

  it('corta al número pedido, empezando por el mejor', () => {
    const out = toCandidatos([crudo(0, 2, 50), crudo(3, 5, 95)], BEATS, { cuantos: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBe(95);
  });

  it('sin beats no propone nada', () => {
    expect(toCandidatos([crudo(0, 1)], [])).toEqual([]);
  });
});

describe('fallbackShorts', () => {
  it('propone el arranque del vídeo cuando el director falla', () => {
    const out = fallbackShorts(BEATS, 'Título del vídeo');
    expect(out).toHaveLength(1);
    expect(out[0]!.start_beat_idx).toBe(0);
    expect(out[0]!.from_ms).toBe(0);
    const duracion = out[0]!.to_ms - out[0]!.from_ms;
    expect(duracion).toBeGreaterThanOrEqual(SHORT_MIN_S * 1000);
    expect(duracion).toBeLessThanOrEqual(SHORT_MAX_S * 1000);
  });

  it('un vídeo demasiado corto no admite ningún short', () => {
    const cortos: ShortDirectorBeat[] = [{ idx: 0, from_ms: 0, to_ms: 9_000, text: 'a', edits: 0 }];
    expect(fallbackShorts(cortos, 'T')).toEqual([]);
  });
});

describe('efectosPorBeat', () => {
  it('cuenta los efectos que solapan cada beat', () => {
    const beats = [
      {
        idx: 0,
        from_ms: 0,
        to_ms: 10_000,
        text: 'a',
        visual_query: 'q',
        status: 'locked' as const,
      },
      {
        idx: 1,
        from_ms: 10_000,
        to_ms: 20_000,
        text: 'b',
        visual_query: 'q',
        status: 'locked' as const,
      },
    ];
    const out = efectosPorBeat(beats, [
      { from_ms: 1_000, to_ms: 2_000 },
      { from_ms: 3_000, to_ms: 4_000 },
      { from_ms: 15_000, to_ms: 16_000 },
    ]);
    expect(out.map((b) => b.edits)).toEqual([2, 1]);
  });
});
