import { describe, expect, it } from 'vitest';
import { analizarShort, SHORT_TITULO_MAX_PALABRAS } from './calidad.js';
import { SHORT_HUECO_GRAFICO_MAX_MS } from './constants.js';
import { makeDemoShort } from './fixtures.js';
import type { ShortMasterJson } from './short-json.js';

// Los umbrales del informe del short auditan contra lo que la producción
// vertical YA usa (SHORT_PLANO_MAX_MS, la banda de cadencia derivada del
// ritmo), no contra los del largo: la banda 6-16/min marcaría el ritmo
// objetivo del formato como estroboscopio, y el hueco de 60 s es imposible
// en una pieza de ≤59 s.

type Beat = NonNullable<ShortMasterJson['beats']>[number];

function plano(from: number, to: number, id: string): NonNullable<Beat['visuals']>[number] {
  return {
    from_ms: from,
    to_ms: to,
    visual_query: 'q',
    asset: { id, kind: 'clip', path: `/x/${id}.mp4`, fit: { mode: 'trim', offset_ms: 0 } },
  };
}

/** Un short sintético con control total de duración, planos y edits. */
function short(p: {
  duracion_ms: number;
  planos_ms?: number;
  title?: string;
  edits?: ShortMasterJson['edits'];
  telemetry?: ShortMasterJson['short_telemetry'];
}): ShortMasterJson {
  const base = makeDemoShort();
  const paso = p.planos_ms ?? 2_500;
  const visuals: NonNullable<Beat['visuals']> = [];
  for (let t = 0, i = 0; t < p.duracion_ms; t += paso, i += 1) {
    visuals.push(plano(t, Math.min(t + paso, p.duracion_ms), `a${i}`));
  }
  const beat: Beat = {
    idx: 0,
    from_ms: 0,
    to_ms: p.duracion_ms,
    text: 'texto del beat',
    visual_query: 'q',
    status: 'locked',
    visuals,
  };
  return {
    ...base,
    beats: [beat],
    edits: p.edits ?? [],
    short: {
      ...base.short,
      duration_ms: p.duracion_ms,
      title: p.title ?? 'Cifra que cambia todo',
    },
    ...(p.telemetry !== undefined ? { short_telemetry: p.telemetry } : {}),
  };
}

/** Overlays repartidos para que ningún hueco pase del techo del formato. */
function overlaysCada(duracionMs: number, cadaMs: number): NonNullable<ShortMasterJson['edits']> {
  const out: NonNullable<ShortMasterJson['edits']> = [];
  for (let t = 0; t < duracionMs; t += cadaMs) {
    out.push({
      type: 'text_callout',
      from_ms: t,
      to_ms: Math.min(t + 1_500, duracionMs),
      text: 'un titular',
    });
  }
  return out;
}

describe('analizarShort', () => {
  it('el fixture de demo se analiza sin inventar códigos desconocidos', () => {
    const m = analizarShort(makeDemoShort());
    expect(m.duracion_s).toBeGreaterThan(0);
    expect(m.planos).toBeGreaterThan(0);
    const codigos = new Set(m.avisos.map((a) => a.codigo));
    for (const c of codigos) {
      expect([
        'cadencia',
        'plano_largo',
        'demasiada_imagen',
        'hueco_grafico',
        'titulo_largo',
        'palabra_vacia',
        'copy_largo',
        'cifra_sin_separador',
        'ancla_perdida',
        'solape',
      ]).toContain(c);
    }
  });

  it('audita la cadencia contra la banda del formato, no la del largo', () => {
    // 12 planos en 30 s = 24/min: sano en vertical, «estroboscopio» en el largo
    const sano = analizarShort(
      short({ duracion_ms: 30_000, planos_ms: 2_500, edits: overlaysCada(30_000, 6_000) }),
    );
    expect(sano.cadencia_planos_min).toBeCloseTo(24, 0);
    expect(sano.avisos.some((a) => a.codigo === 'cadencia')).toBe(false);

    // 3 planos en 30 s = 6/min: pasaría el informe del largo y aquí avisa
    const lento = analizarShort(
      short({ duracion_ms: 30_000, planos_ms: 10_000, edits: overlaysCada(30_000, 6_000) }),
    );
    expect(lento.avisos.some((a) => a.codigo === 'cadencia')).toBe(true);
    // y cada plano de 10 s también revienta el tope de plano del formato
    expect(lento.avisos.some((a) => a.codigo === 'plano_largo')).toBe(true);
  });

  it('el hueco gráfico usa el techo del formato (el del largo es inalcanzable en ≤59 s)', () => {
    const vacio = analizarShort(short({ duracion_ms: 30_000, edits: [] }));
    expect(vacio.hueco_grafico_s).toBeCloseTo(30);
    expect(vacio.avisos.some((a) => a.codigo === 'hueco_grafico')).toBe(true);

    const cubierto = analizarShort(
      short({
        duracion_ms: 30_000,
        edits: overlaysCada(30_000, SHORT_HUECO_GRAFICO_MAX_MS - 1_000),
      }),
    );
    expect(cubierto.avisos.some((a) => a.codigo === 'hueco_grafico')).toBe(false);
  });

  it('avisa del título que rompe la promesa del director (6 palabras)', () => {
    const largo = analizarShort(
      short({
        duracion_ms: 30_000,
        title: 'uno dos tres cuatro cinco seis siete ocho',
        edits: overlaysCada(30_000, 6_000),
      }),
    );
    expect(largo.titulo_palabras).toBe(8);
    expect(largo.avisos.some((a) => a.codigo === 'titulo_largo')).toBe(true);

    const corto = analizarShort(
      short({ duracion_ms: 30_000, edits: overlaysCada(30_000, 6_000) }),
    );
    expect(corto.titulo_palabras).toBeLessThanOrEqual(SHORT_TITULO_MAX_PALABRAS);
    expect(corto.avisos.some((a) => a.codigo === 'titulo_largo')).toBe(false);
  });

  it('lee quién eligió la ventana de la telemetría congelada', () => {
    const sin = analizarShort(short({ duracion_ms: 30_000, edits: overlaysCada(30_000, 6_000) }));
    expect(sin.director).toBeNull();

    const con = analizarShort(
      short({
        duracion_ms: 30_000,
        edits: overlaysCada(30_000, 6_000),
        telemetry: {
          planos_antes: 3,
          planos_despues: 12,
          segundos_por_plano: 2.5,
          efectos_heredados: 1,
          efectos_colocados: 5,
          director: 'fallback',
        },
      }),
    );
    expect(con.director).toBe('fallback');
  });

  it('la higiene del texto en pantalla es la misma que en el largo', () => {
    const m = analizarShort(
      short({
        duracion_ms: 30_000,
        edits: [
          { type: 'keyword_highlight', from_ms: 1_000, to_ms: 2_000, keyword: 'vez' },
          ...overlaysCada(30_000, 6_000),
        ],
      }),
    );
    expect(m.avisos.some((a) => a.codigo === 'palabra_vacia')).toBe(true);
  });
});
