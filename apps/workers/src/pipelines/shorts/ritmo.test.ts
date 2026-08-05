import { describe, expect, it } from 'vitest';
import { makeDemoShort, renderableShortV1, type RenderableShort } from '@fabrica/shared';
import { densificarRitmo, type DuracionesPorRuta } from './ritmo.js';

// Un short cuyo único plano dura toda la pieza: el caso que se midió en
// producción (11,3 s de plano fijo sobre 34 s de short).
function shortDeUnPlano(kind: 'clip' | 'image', durMs: number): RenderableShort {
  const base = makeDemoShort();
  const asset = {
    id: 'a1',
    kind,
    path: 'demo/uno.mp4',
    fit:
      kind === 'clip'
        ? ({ mode: 'trim' as const } as const)
        : ({ mode: 'kenburns' as const } as const),
  };
  return renderableShortV1.parse({
    ...base,
    short: { ...base.short, duration_ms: durMs },
    audio: { ...base.audio, duration_ms: durMs },
    beats: [
      {
        idx: 0,
        from_ms: 0,
        to_ms: durMs,
        text: 'texto',
        visual_query: 'q',
        status: 'locked',
        asset,
      },
    ],
    cues: (base.cues ?? []).filter((c) => c.to_ms <= durMs),
  });
}

const SIN_DURACIONES: DuracionesPorRuta = new Map();

describe('densificarRitmo', () => {
  it('parte una imagen larga en re-encuadres hasta el ritmo del formato', () => {
    const m = shortDeUnPlano('image', 12_000);
    const { master, resumen } = densificarRitmo(m, SIN_DURACIONES);

    expect(resumen.planosAntes).toBe(1);
    expect(resumen.planosDespues).toBeGreaterThanOrEqual(4);
    expect(resumen.segundosPorPlano).toBeLessThanOrEqual(3);
    // cada parte lleva su propio Ken Burns, o el corte sería invisible
    const efectos = master.beats[0]!.visuals!.map((v) => v.asset?.effect);
    expect(new Set(efectos).size).toBeGreaterThan(1);
  });

  it('los tramos cubren el beat sin huecos ni solapes', () => {
    const { master } = densificarRitmo(shortDeUnPlano('image', 12_000), SIN_DURACIONES);
    const visuals = master.beats[0]!.visuals!;
    expect(visuals[0]!.from_ms).toBe(0);
    expect(visuals[visuals.length - 1]!.to_ms).toBe(12_000);
    for (let i = 1; i < visuals.length; i += 1) {
      expect(visuals[i]!.from_ms).toBe(visuals[i - 1]!.to_ms);
    }
  });

  // Un jump cut necesita metraje sobrante en la fuente: sin saber cuánto dura,
  // no se puede saltar sin arriesgar leer más allá del final del fichero.
  it('un clip sin duración conocida no se trocea', () => {
    const { resumen } = densificarRitmo(shortDeUnPlano('clip', 12_000), SIN_DURACIONES);
    expect(resumen.planosDespues).toBe(1);
  });

  it('un clip con fuente larga sí se parte en jump cuts', () => {
    const m = shortDeUnPlano('clip', 12_000);
    const duraciones: DuracionesPorRuta = new Map([['demo/uno.mp4', 40_000]]);
    const { master, resumen } = densificarRitmo(m, duraciones);

    expect(resumen.planosDespues).toBeGreaterThanOrEqual(4);
    // cada parte entra MÁS adentro de la fuente: eso es el salto
    const offsets = master.beats[0]!.visuals!.map((v) => v.asset?.fit.offset_ms ?? 0);
    for (let i = 1; i < offsets.length; i += 1) {
      expect(offsets[i]!).toBeGreaterThan(offsets[i - 1]!);
    }
  });

  it('un plano que ya está en ritmo se deja en paz', () => {
    const { master, resumen } = densificarRitmo(shortDeUnPlano('image', 2_500), SIN_DURACIONES);
    expect(resumen.planosDespues).toBe(1);
    expect(master.beats[0]!.visuals).toBeUndefined();
  });

  it('el resultado sigue siendo un short renderizable', () => {
    const { master } = densificarRitmo(shortDeUnPlano('image', 12_000), SIN_DURACIONES);
    expect(() => renderableShortV1.parse(master)).not.toThrow();
  });

  it('es determinista', () => {
    const m = shortDeUnPlano('image', 12_000);
    const a = densificarRitmo(m, SIN_DURACIONES).master;
    const b = densificarRitmo(m, SIN_DURACIONES).master;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
