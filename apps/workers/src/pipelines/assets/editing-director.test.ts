import { describe, expect, it } from 'vitest';
import type { Cue, Edit } from '@fabrica/shared';
import {
  dedupeAndCap,
  hacenFaltaMasTarjetas,
  intentEdits,
  microFxEdits,
  momentsToEdits,
  ruleEdits,
  spreadByWindows,
  type EditingParams,
} from './editing-director.js';

// Cue con una sola palabra en un instante dado (para anclar reglas al ms).
function cue(w: string, from_ms: number): Cue {
  return { from_ms, to_ms: from_ms + 400, text: w, words: [{ w, from_ms, to_ms: from_ms + 400 }] };
}

function params(over: Partial<EditingParams>): EditingParams {
  return {
    videoId: 'v1',
    channelId: 'c1',
    lang: 'es',
    beats: [],
    cues: [],
    scenes: [],
    segmentStartMs: [],
    seoTags: [],
    ...over,
  };
}

describe('ruleEdits', () => {
  it('el hook trae riser + zoom_punch en el primer beat', () => {
    const edits = ruleEdits(
      params({ beats: [{ idx: 0, from_ms: 0, to_ms: 10_000, text: 'hola mundo' }] }),
    );
    expect(edits.some((e) => e.type === 'sfx' && e.sfx === 'riser' && e.from_ms === 0)).toBe(true);
    expect(edits.some((e) => e.type === 'zoom_punch' && e.beat_idx === 0)).toBe(true);
  });

  it('cada inicio de sección (salvo el primero) dispara un whoosh', () => {
    const edits = ruleEdits(
      params({
        beats: [{ idx: 0, from_ms: 0, to_ms: 10_000, text: 'x' }],
        segmentStartMs: [0, 12_000, 24_000],
      }),
    );
    const whooshes = edits.filter((e) => e.type === 'sfx' && e.sfx === 'whoosh');
    expect(whooshes.map((e) => e.from_ms)).toEqual([12_000, 24_000]);
  });

  it('una cifra en la narración genera una tarjeta de dato + ding', () => {
    const edits = ruleEdits(
      params({
        beats: [
          { idx: 0, from_ms: 0, to_ms: 12_000, text: 'el modelo mejora un 70% en la prueba' },
        ],
      }),
    );
    const stat = edits.find((e) => e.type === 'stat_card');
    expect(stat?.value).toBe('70%');
    expect(edits.some((e) => e.type === 'sfx' && e.sfx === 'ding')).toBe(true);
  });

  it('el inicio de sección con beat dispara whoosh + zoom_punch', () => {
    const edits = ruleEdits(
      params({
        beats: [
          { idx: 0, from_ms: 0, to_ms: 12_000, text: 'a' },
          { idx: 1, from_ms: 12_000, to_ms: 24_000, text: 'b' },
        ],
        segmentStartMs: [0, 12_000],
      }),
    );
    expect(edits.some((e) => e.type === 'sfx' && e.sfx === 'whoosh' && e.from_ms === 12_000)).toBe(
      true,
    );
    expect(edits.some((e) => e.type === 'zoom_punch' && e.beat_idx === 1)).toBe(true);
  });

  it('detecta cifras con unidad/multiplicador (2 millones, 10x) para el stat', () => {
    const a = ruleEdits(
      params({
        beats: [{ idx: 0, from_ms: 0, to_ms: 12_000, text: 'ya son 2 millones de usuarios' }],
      }),
    );
    expect(a.find((e) => e.type === 'stat_card')?.value).toBe('2 millones');
    const b = ruleEdits(
      params({ beats: [{ idx: 0, from_ms: 0, to_ms: 12_000, text: 'es 10x más rápido' }] }),
    );
    expect(b.find((e) => e.type === 'stat_card')?.value).toBe('10x');
  });

  it('una cifra grande (3+ dígitos) se anima como odómetro, no tarjeta', () => {
    const edits = ruleEdits(
      params({ beats: [{ idx: 0, from_ms: 0, to_ms: 12_000, text: 'son 500 mil combinaciones' }] }),
    );
    expect(edits.find((e) => e.type === 'stat_odometer')?.value).toBe('500 mil');
    expect(edits.some((e) => e.type === 'stat_card')).toBe(false);
  });

  it('un dominio en la narración dispara un marco de navegador', () => {
    const edits = ruleEdits(
      params({
        beats: [{ idx: 0, from_ms: 0, to_ms: 12_000, text: 'entra en GrapheneOS.org y míralo' }],
      }),
    );
    const dev = edits.find((e) => e.type === 'device_frame');
    expect(dev?.text).toBe('grapheneos.org');
    expect(dev?.style).toBe('browser');
  });

  it('un tag del SEO pronunciado se resalta como keyword', () => {
    const edits = ruleEdits(
      params({
        beats: [{ idx: 0, from_ms: 0, to_ms: 12_000, text: 'hablamos de inferencia hoy' }],
        cues: [cue('inferencia', 3_000)],
        seoTags: ['inferencia'],
      }),
    );
    const kw = edits.find((e) => e.type === 'keyword_highlight');
    expect(kw?.keyword).toBe('inferencia');
    expect(kw?.from_ms).toBe(3_000);
  });
});

describe('momentsToEdits (capa IA)', () => {
  const beats = [
    { idx: 0, from_ms: 0, to_ms: 8_000, text: 'gancho' },
    { idx: 3, from_ms: 30_000, to_ms: 40_000, text: 'la cifra es 1000000 combinaciones' },
  ];
  // la IA debe declarar la palabra donde entra el efecto, y esa palabra tiene
  // que estar pronunciada dentro del beat
  const cues = [cue('gancho', 1_000), cue('cifra', 32_000), cue('grapheneos', 33_000)];
  const CLAIMS = [{ text: 'son 1000000 de combinaciones posibles' }];

  it('un momento kinetic produce kinetic_text al inicio del beat del gancho', () => {
    const edits = momentsToEdits(
      [{ beat_idx: 0, type: 'kinetic', text: 'se borra solo', keyword: 'gancho' }],
      beats,
      cues,
    );
    const k = edits.find((e) => e.type === 'kinetic_text');
    expect(k?.text).toBe('se borra solo');
    expect(k?.from_ms).toBe(0);
    expect(k?.beat_idx).toBe(0);
  });

  it('un stat grande va a odómetro y uno pequeño a tarjeta', () => {
    const big = momentsToEdits(
      [{ beat_idx: 3, type: 'stat', value: '1000000', label: 'combinaciones', keyword: 'cifra' }],
      beats,
      cues,
      CLAIMS,
    );
    expect(big.find((e) => e.type === 'stat_odometer')?.value).toBe('1000000');
    const small = momentsToEdits(
      [{ beat_idx: 3, type: 'stat', value: '25%', keyword: 'cifra' }],
      beats,
      cues,
      [{ text: 'subió un 25% el trimestre' }],
    );
    expect(small.find((e) => e.type === 'stat_card')?.value).toBe('25%');
  });

  it('un momento device produce device_frame con la URL', () => {
    const edits = momentsToEdits(
      [{ beat_idx: 3, type: 'device', text: 'grapheneos.org', keyword: 'grapheneos' }],
      beats,
      cues,
    );
    const dev = edits.find((e) => e.type === 'device_frame');
    expect(dev?.text).toBe('grapheneos.org');
    expect(dev?.style).toBe('browser');
  });

  it('un momento annotation produce annotation con estilo y etiqueta', () => {
    const edits = momentsToEdits(
      [{ beat_idx: 3, type: 'annotation', style: 'circle', text: 'aquí', keyword: 'cifra' }],
      beats,
      cues,
    );
    const an = edits.find((e) => e.type === 'annotation');
    expect(an?.style).toBe('circle');
    expect(an?.text).toBe('aquí');
  });

  // --- las garantías nuevas ---

  it('un momento cuya keyword no se pronuncia en el beat se DESCARTA', () => {
    // antes caía a beat.from_ms y el overlay salía desincronizado sin avisar
    const edits = momentsToEdits(
      [{ beat_idx: 3, type: 'callout', text: 'coste real', keyword: 'inexistente' }],
      beats,
      cues,
    );
    expect(edits).toEqual([]);
  });

  it('un momento sin keyword se descarta: la IA ya no puede colocar a ciegas', () => {
    expect(momentsToEdits([{ beat_idx: 0, type: 'callout', text: 'algo' }], beats, cues)).toEqual(
      [],
    );
  });

  it('una cifra que no está ni en el beat ni en el research no se pinta', () => {
    const edits = momentsToEdits(
      [{ beat_idx: 3, type: 'stat', value: '4500', keyword: 'cifra' }],
      beats,
      cues,
      CLAIMS,
    );
    expect(edits.filter((e) => e.type === 'stat_card' || e.type === 'stat_odometer')).toEqual([]);
  });

  it('un copy de más de cuatro palabras se descarta: es titular, no transcripción', () => {
    const edits = momentsToEdits(
      [{ beat_idx: 0, type: 'callout', text: 'una frase larga que no cabe', keyword: 'gancho' }],
      beats,
      cues,
    );
    expect(edits).toEqual([]);
  });

  it('el efecto se ancla al ms de la palabra, no al inicio del beat', () => {
    const edits = momentsToEdits(
      [{ beat_idx: 3, type: 'callout', text: 'coste real', keyword: 'cifra' }],
      beats,
      cues,
    );
    expect(edits.find((e) => e.type === 'text_callout')?.from_ms).toBe(32_000);
  });
});

describe('intentEdits (lo que el guion declara)', () => {
  const beats = [
    { idx: 0, from_ms: 0, to_ms: 10_000, text: 'el coste real es otro' },
    { idx: 1, from_ms: 10_000, to_ms: 20_000, text: 'y el margen se hunde' },
  ];
  const cues = [cue('coste', 4_300), cue('margen', 13_000)];
  const scenes = [
    {
      id: 'sc-body-1',
      section: 'body' as const,
      text: 'el coste real es otro y el margen se hunde',
      visual_query: 'x',
      edit_intents: [
        { effect: 'callout' as const, trigger_word: 'coste', card_text: 'coste real' },
      ],
    },
  ];

  it('ancla al ms EXACTO de la palabra, no al inicio del beat', () => {
    const r = intentEdits(params({ beats, cues, scenes }));
    const callout = r.edits.find((e) => e.type === 'text_callout');
    expect(callout?.from_ms).toBe(4_300);
    expect(callout?.beat_idx).toBe(0);
    expect(r.dropped).toBe(0);
  });

  it('DESCARTA el efecto cuya palabra no se pronuncia, en vez de colocarlo mal', () => {
    const malas = [
      {
        ...scenes[0]!,
        edit_intents: [
          { effect: 'callout' as const, trigger_word: 'coste', card_text: 'coste real' },
        ],
      },
    ];
    const r = intentEdits(params({ beats, cues: [cue('otra', 1_000)], scenes: malas }));
    expect(r.edits.filter((e) => e.type === 'text_callout')).toEqual([]);
    expect(r.dropped).toBe(1);
  });

  it('cada intención cae en el beat que le toca aunque la escena abarque varios', () => {
    const dos = [
      {
        ...scenes[0]!,
        edit_intents: [
          { effect: 'callout' as const, trigger_word: 'coste', card_text: 'coste real' },
          { effect: 'quote' as const, trigger_word: 'margen', card_text: 'sin margen' },
        ],
      },
    ];
    const r = intentEdits(params({ beats, cues, scenes: dos }));
    expect(r.edits.find((e) => e.type === 'text_callout')?.beat_idx).toBe(0);
    expect(r.edits.find((e) => e.type === 'quote_card')?.beat_idx).toBe(1);
    expect([...r.covered].sort()).toEqual([0, 1]);
  });

  it('effect keyword produce keyword_highlight, que antes era imposible generar', () => {
    const kw = [
      { ...scenes[0]!, edit_intents: [{ effect: 'keyword' as const, trigger_word: 'coste' }] },
    ];
    const r = intentEdits(params({ beats, cues, scenes: kw }));
    expect(r.edits.find((e) => e.type === 'keyword_highlight')?.keyword).toBe('coste');
  });
});

describe('microFxEdits', () => {
  it('dispara con la palabra del catálogo, con y sin tilde', () => {
    const edits = microFxEdits(params({ cues: [cue('jamás', 5_000)] }));
    expect(edits.find((e) => e.type === 'annotation')?.style).toBe('strike');
    expect(edits.some((e) => e.type === 'sfx' && e.sfx === 'clic')).toBe(true);
  });

  it('cada efecto entra UNA sola vez por vídeo', () => {
    const edits = microFxEdits(
      params({ cues: [cue('nunca', 1_000), cue('jamas', 40_000), cue('error', 80_000)] }),
    );
    expect(edits.filter((e) => e.type === 'annotation')).toHaveLength(1);
  });

  it('una palabra corriente no dispara nada', () => {
    expect(microFxEdits(params({ cues: [cue('modelo', 1_000)] }))).toEqual([]);
  });
});

describe('spreadByWindows', () => {
  const at = (n: number): number => n;

  it('reparte en el tiempo en vez de amontonar donde hay material', () => {
    // 40 candidatos TODOS en el primer minuto de un vídeo de 10: con el recorte
    // por prioridad anterior sobrevivían doce apelotonados
    const items = Array.from({ length: 40 }, (_, i) => i * 1_000);
    const { kept } = spreadByWindows(items, {
      budget: 12,
      durationMs: 600_000,
      sepMs: 20_000,
      at,
      score: () => 0,
    });
    expect(kept.length).toBeLessThanOrEqual(2);
  });

  it('con candidatos repartidos llena el presupuesto', () => {
    const items = Array.from({ length: 40 }, (_, i) => i * 15_000);
    const { kept } = spreadByWindows(items, {
      budget: 12,
      durationMs: 600_000,
      sepMs: 20_000,
      at,
      score: () => 0,
    });
    expect(kept.length).toBeGreaterThanOrEqual(10);
  });

  it('respeta la separación mínima', () => {
    const { kept } = spreadByWindows([0, 3_000, 6_000], {
      budget: 3,
      durationMs: 60_000,
      sepMs: 20_000,
      at,
      score: () => 0,
    });
    expect(kept).toHaveLength(1);
  });

  it('es determinista', () => {
    const items = Array.from({ length: 30 }, (_, i) => i * 7_000);
    const opts = { budget: 8, durationMs: 300_000, sepMs: 10_000, at, score: () => 0 };
    expect(spreadByWindows(items, opts).kept).toEqual(spreadByWindows(items, opts).kept);
  });
});

// La propiedad que justifica toda la arquitectura de intenciones declaradas
// (docs/edicion.md §1): cuanto mejor declara el guion, menos IA se llama.
describe('hacenFaltaMasTarjetas', () => {
  const tarjeta = (from: number): Edit => ({
    type: 'text_callout',
    from_ms: from,
    to_ms: from + 1_500,
    text: 'un titular',
  });

  it('no pide IA cuando lo ya colocado llena el presupuesto', () => {
    // 7 min × 1,2 tarjetas/min ≈ 8
    const puestas = Array.from({ length: 8 }, (_, i) => tarjeta(i * 30_000));
    expect(hacenFaltaMasTarjetas(puestas, 7 * 60_000)).toBe(false);
  });

  it('pide IA cuando el guion declaró poco', () => {
    expect(hacenFaltaMasTarjetas([tarjeta(0)], 7 * 60_000)).toBe(true);
    expect(hacenFaltaMasTarjetas([], 7 * 60_000)).toBe(true);
  });

  // La puerta vieja miraba beats sin cubrir: con 41 beats y 8 tarjetas de
  // presupuesto siempre quedaban huecos, así que la IA se llamaba SIEMPRE.
  it('los SFX y los subrayados no cuentan como tarjeta: no compiten por la pantalla', () => {
    const ruido: Edit[] = [
      { type: 'sfx', from_ms: 0, to_ms: 500, sfx: 'whoosh' },
      { type: 'keyword_highlight', from_ms: 1_000, to_ms: 1_900, keyword: 'contratos' },
      { type: 'annotation', from_ms: 2_000, to_ms: 3_000, style: 'circle' },
    ];
    expect(hacenFaltaMasTarjetas(ruido, 2 * 60_000)).toBe(true);
  });
});

describe('palabras que se subrayan', () => {
  // Se llegó a resaltar «vez»: el filtro era «longitud ≥ 4», que deja pasar
  // cualquier palabra funcional larga. Ahora productor y medidor comparten
  // regla, así que el informe de calidad no puede señalar algo que el director
  // siga produciendo.
  it('los tags de SEO funcionales no llegan a pantalla', () => {
    const beats = [{ idx: 0, from_ms: 0, to_ms: 10_000, text: 'hablamos de contratos esta vez' }];
    const cues = [cue('contratos', 1_000), cue('vez', 4_000), cue('cuando', 6_000)];
    const edits = ruleEdits(params({ beats, cues, seoTags: ['contratos', 'vez', 'cuando'] }));
    const subrayadas = edits
      .filter((e) => e.type === 'keyword_highlight')
      .map((e) => (e as { keyword: string }).keyword);
    expect(subrayadas).toContain('contratos');
    expect(subrayadas).not.toContain('vez');
    expect(subrayadas).not.toContain('cuando');
  });
});

describe('lo declarado por el guion gana al efecto inferido', () => {
  const beat = (idx: number, from: number) => ({ from_ms: from, to_ms: from + 10_000, idx });

  it('una tarjeta declarada sobrevive a un zoom en el mismo beat', () => {
    // El bug: `zoom_punch` tiene prioridad 4 y `text_callout` 2, así que el
    // zoom que genera la regla de `emphasis` mataba la tarjeta que pidió el
    // guion ANTES de llegar al reparto, donde el +10 de declarado la habría
    // salvado. Medido en un vídeo real: 8 intenciones ancladas, 6 zoom_punch
    // en el maestro y UNA tarjeta.
    const tarjeta: Edit = {
      type: 'text_callout',
      from_ms: 1_000,
      to_ms: 3_000,
      beat_idx: 0,
      text: 'dato clave',
    };
    const zoom: Edit = { type: 'zoom_punch', from_ms: 1_000, to_ms: 2_000, beat_idx: 0 };
    const out = dedupeAndCap([zoom, tarjeta], 60_000, new Set([tarjeta]));
    expect(out.map((e) => e.type)).toContain('text_callout');
    expect(out.map((e) => e.type)).not.toContain('zoom_punch');
  });

  it('sin nada declarado, sigue mandando la prioridad de tipo', () => {
    const tarjeta: Edit = {
      type: 'text_callout',
      from_ms: 1_000,
      to_ms: 3_000,
      beat_idx: 0,
      text: 'x',
    };
    const zoom: Edit = { type: 'zoom_punch', from_ms: 1_000, to_ms: 2_000, beat_idx: 0 };
    const out = dedupeAndCap([tarjeta, zoom], 60_000);
    expect(out.map((e) => e.type)).toContain('zoom_punch');
  });

  it('varias tarjetas declaradas, repartidas en el tiempo, sobreviven todas', () => {
    // Una por ventana de reparto: a 5 min el presupuesto son 6 ventanas de 50 s,
    // así que van a 10, 60, 110 y 160 s. Amontonarlas dentro de una ventana las
    // mataría igual, y con razón: eso es lo que `spreadByWindows` viene a evitar.
    const decl: Edit[] = [0, 1, 2, 3].map((i) => ({
      type: 'text_callout' as const,
      from_ms: i * 50_000 + 10_000,
      to_ms: i * 50_000 + 12_000,
      beat_idx: i,
      text: `t${i}`,
    }));
    const zooms: Edit[] = [0, 1, 2, 3].map((i) => ({
      type: 'zoom_punch' as const,
      from_ms: i * 50_000 + 10_000,
      to_ms: i * 50_000 + 11_000,
      beat_idx: i,
    }));
    const out = dedupeAndCap([...zooms, ...decl], 300_000, new Set(decl));
    expect(out.filter((e) => e.type === 'text_callout')).toHaveLength(4);
    expect(out.filter((e) => e.type === 'zoom_punch')).toHaveLength(0);
  });
});
