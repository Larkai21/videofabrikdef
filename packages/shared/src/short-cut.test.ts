import { describe, expect, it } from 'vitest';
import { SHORT_HEIGHT, SHORT_WIDTH } from './constants.js';
import { makeDemoMaster } from './fixtures.js';
import {
  masterVideoJsonV1,
  renderableMasterV1,
  type Edit,
  type RenderableMaster,
} from './master-json.js';
import { encuadreDe, fronterasFuertes, recortarMaster, type CutInput } from './short-cut.js';
import { renderableShortV1, shortMasterV1 } from './short-json.js';

const CLIP = 'demo-clip.mp4';
const IMG = 'demo-img.jpg';

function master(edits: Edit[] = []): RenderableMaster {
  const demo = makeDemoMaster({ audioPath: 'voz.wav', clipPath: CLIP, imagePath: IMG });
  return renderableMasterV1.parse({ ...demo, ...(edits.length > 0 ? { edits } : {}) });
}

function cut(
  m: RenderableMaster,
  from: number,
  to: number,
  extra: Partial<CutInput> = {},
): CutInput {
  void m;
  return {
    id: 'short-1',
    from_ms: from,
    to_ms: to,
    title: 'Título del short',
    hook: 'El gancho',
    reason: 'La razón',
    score: 80,
    ...extra,
  };
}

describe('encuadreDe', () => {
  it('una captura no se recorta: llevaría texto ilegible', () => {
    expect(encuadreDe({ kind: 'screenshot', width: 1920, height: 1080 })).toBe('entero');
  });

  it('un asset ya vertical llena el lienzo', () => {
    expect(encuadreDe({ kind: 'clip', width: 1080, height: 1920 })).toBe('cover');
  });

  // El fallo medido sobre material real: una foto de stock de una terminal sale
  // ILEGIBLE recortada al 31 % del ancho, y su `kind` es `image`, así que la
  // comprobación por tipo no la cogía. La biblioteca ya lo sabe por el caption.
  it('un plano que ES una pantalla no se recorta, aunque su tipo sea image', () => {
    expect(
      encuadreDe({
        kind: 'image',
        width: 1880,
        height: 1253,
        caption: 'Monitor en un entorno oscuro mostrando múltiples terminales con código.',
        tags: ['terminal', 'monitor', 'tech'],
      }),
    ).toBe('entero');
  });

  it('lo detecta por una tag inequívoca aunque no haya caption', () => {
    expect(encuadreDe({ kind: 'image', tags: ['dashboard', 'datos'] })).toBe('entero');
    expect(encuadreDe({ kind: 'image', tags: ['screenshot'] })).toBe('entero');
  });

  // El falso positivo medido: 2 de cada 3 disparos de la primera versión eran
  // planos con una pantalla de ATREZO al fondo.
  it('una pantalla de atrezo al fondo no cuenta', () => {
    expect(
      encuadreDe({
        kind: 'clip',
        width: 1920,
        height: 1080,
        caption:
          'Mano escribiendo y marcando casillas en una libreta con un checklist, teclado y monitor desenfocados al fondo.',
        tags: ['mano', 'libreta', 'monitor', 'teclado'],
      }),
    ).toBe('recorte');
  });

  it('un rack de servidores tampoco es una pantalla', () => {
    expect(
      encuadreDe({
        kind: 'image',
        width: 1920,
        height: 1080,
        caption: 'Técnico ajustando y probando cables de red en un rack de servidores.',
        tags: ['tecnico', 'cables', 'rack', 'servidores'],
      }),
    ).toBe('recorte');
  });

  // Disparar de más manda a la banda con losa planos que se recortarían
  // perfectamente, así que se buscan sustantivos de pantalla y no «texto».
  it('no se dispara con un plano normal que casualmente lleve texto', () => {
    expect(
      encuadreDe({
        kind: 'image',
        width: 1920,
        height: 1080,
        caption: 'Persona escribiendo un texto a mano en un cuaderno sobre una mesa.',
        tags: ['texto', 'cuaderno', 'oficina'],
      }),
    ).toBe('recorte');
  });

  it('lo demás se recorta, incluso sin dimensiones conocidas', () => {
    expect(encuadreDe({ kind: 'clip', width: 1920, height: 1080 })).toBe('recorte');
    expect(encuadreDe({})).toBe('recorte');
    expect(encuadreDe({ width: null, height: null, kind: null })).toBe('recorte');
  });
});

describe('fronterasFuertes', () => {
  it('el arranque siempre es frontera', () => {
    expect(fronterasFuertes(master())).toContain(0);
  });

  it('todas las fronteras son límites de beat', () => {
    const m = master();
    const limites = new Set(m.beats.flatMap((b) => [b.from_ms, b.to_ms]));
    for (const f of fronterasFuertes(m)) expect(limites.has(f)).toBe(true);
  });

  it('vienen ordenadas y sin repetir', () => {
    const f = fronterasFuertes(master());
    expect([...f]).toEqual([...new Set(f)].sort((a, b) => a - b));
  });
});

describe('recortarMaster', () => {
  it('produce un maestro vertical válido', () => {
    const m = master();
    const b1 = m.beats[1]!;
    const b2 = m.beats[2]!;
    const short = recortarMaster(m, cut(m, b1.from_ms, b2.to_ms));

    expect(() => shortMasterV1.parse(short)).not.toThrow();
    expect(() => renderableShortV1.parse(short)).not.toThrow();
    expect(short.video.width).toBe(SHORT_WIDTH);
    expect(short.video.height).toBe(SHORT_HEIGHT);
    expect(short.video.video_id).toBe(m.video.id);
    expect(short.video.id).toBe('short-1');
  });

  // Los dos contratos no se pueden confundir: es lo que impide que un maestro
  // vertical entre por error en el render largo, y al revés.
  it('un short NO valida como maestro largo', () => {
    const m = master();
    const short = recortarMaster(m, cut(m, m.beats[1]!.from_ms, m.beats[2]!.to_ms));
    expect(masterVideoJsonV1.safeParse(short).success).toBe(false);
    expect(shortMasterV1.safeParse(m).success).toBe(false);
  });

  it('rebasa todo a cero y no deja ni un milisegundo negativo', () => {
    const m = master();
    const desde = m.beats[1]!.from_ms;
    const short = recortarMaster(m, cut(m, desde, m.beats[2]!.to_ms));

    expect(short.beats[0]!.from_ms).toBe(0);
    for (const b of short.beats) {
      expect(b.from_ms).toBeGreaterThanOrEqual(0);
      expect(b.to_ms).toBeGreaterThan(b.from_ms);
      expect(b.to_ms).toBeLessThanOrEqual(short.short.duration_ms);
    }
    for (const c of short.cues) {
      expect(c.from_ms).toBeGreaterThanOrEqual(0);
      for (const w of c.words) expect(w.from_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it('re-indexa los beats desde cero y recuerda su origen', () => {
    const m = master();
    const short = recortarMaster(m, cut(m, m.beats[1]!.from_ms, m.beats[2]!.to_ms));
    expect(short.beats.map((b) => b.idx)).toEqual([0, 1]);
    expect(short.short.source_beat_idxs).toEqual([1, 2]);
  });

  it('conserva el audio entero y solo recalcula su duración', () => {
    const m = master();
    const desde = m.beats[1]!.from_ms;
    const hasta = m.beats[2]!.to_ms;
    const short = recortarMaster(m, cut(m, desde, hasta));

    // el WAV no se corta: lo desplaza el render con trimBefore
    expect(short.audio.path).toBe(m.audio.path);
    expect(short.audio.duration_ms).toBe(hasta - desde);
    expect(short.short.source_from_ms).toBe(desde);
  });

  it('quita los capítulos y los slots del brand kit', () => {
    const m = master();
    const short = recortarMaster(m, cut(m, 0, m.beats[1]!.to_ms));
    expect('segments' in short).toBe(false);
    expect('components' in short.brand).toBe(false);
  });

  it('vacía los candidatos de cada beat', () => {
    const m = master();
    const conCandidatos = renderableMasterV1.parse({
      ...m,
      beats: m.beats.map((b) => ({
        ...b,
        candidates: [{ ref: 'pexels:1', provider: 'pexels' as const, score: 0.9 }],
      })),
    });
    const short = recortarMaster(conCandidatos, cut(conCandidatos, 0, m.beats[1]!.to_ms));
    for (const b of short.beats) expect(b.candidates).toBeUndefined();
  });

  it('estampa el encuadre de cada asset', () => {
    const m = master();
    const encuadres = new Map([[IMG, 'entero' as const]]);
    const short = recortarMaster(m, cut(m, 0, m.beats[1]!.to_ms, { encuadres }));
    const porRuta = new Map(short.beats.map((b) => [b.asset?.path, b.asset?.encuadre]));
    expect(porRuta.get(IMG)).toBe('entero');
    expect(porRuta.get(CLIP)).toBe('recorte');
  });

  // Si el beat se recorta por delante, el clip tiene que entrar más adentro o
  // el plano se ve desde su principio y no desde donde estaba.
  it('avanza el offset del fit cuando el beat se corta por delante', () => {
    const m = master();
    const b0 = m.beats[0]!;
    const dentro = b0.from_ms + 3_000;
    const short = recortarMaster(m, cut(m, dentro, m.beats[1]!.to_ms));
    // el beat 0 usa loop, que sí acepta offset
    expect(short.beats[0]!.asset?.fit.offset_ms).toBe(3_000);
  });

  it('kenburns no lleva offset: su paneo se recalcula por duración', () => {
    const m = master();
    const b1 = m.beats[1]!; // el impar usa imagen con kenburns
    const short = recortarMaster(m, cut(m, b1.from_ms + 2_000, m.beats[2]!.to_ms));
    expect(short.beats[0]!.asset?.fit.mode).toBe('kenburns');
    expect(short.beats[0]!.asset?.fit.offset_ms).toBeUndefined();
  });

  describe('efectos de edición', () => {
    const zoom = (beatIdx: number, from: number, to: number): Edit => ({
      type: 'zoom_punch',
      beat_idx: beatIdx,
      from_ms: from,
      to_ms: to,
    });

    it('remapea el beat_idx y descarta el efecto cuyo beat se quedó fuera', () => {
      const base = master();
      const b1 = base.beats[1]!;
      const b2 = base.beats[2]!;
      const b3 = base.beats[3]!;
      const m = master([
        zoom(2, b2.from_ms + 100, b2.from_ms + 900),
        zoom(3, b3.from_ms + 100, b3.from_ms + 900),
      ]);
      const short = recortarMaster(m, cut(m, b1.from_ms, b2.to_ms));

      expect(short.edits).toHaveLength(1);
      // el beat 2 del largo es el 1 del short
      expect(short.edits![0]!.beat_idx).toBe(1);
    });

    it('descarta el efecto truncado por el borde y conserva el que apenas roza', () => {
      const base = master();
      const b2 = base.beats[2]!;
      const corte = b2.to_ms;
      const m = master([
        // 30 % dentro: se cae
        { type: 'text_callout', text: 'muy cortado', from_ms: corte - 300, to_ms: corte + 700 },
        // 90 % dentro: se conserva y se clampa
        { type: 'text_callout', text: 'casi entero', from_ms: corte - 2_700, to_ms: corte + 300 },
      ]);
      const short = recortarMaster(m, cut(m, base.beats[1]!.from_ms, corte));

      expect(short.edits!.map((e) => ('text' in e ? e.text : ''))).toEqual(['casi entero']);
      const superviviente = short.edits![0]!;
      expect(superviviente.to_ms).toBe(short.short.duration_ms);
    });

    it('descarta los efectos que no caben en vertical', () => {
      const base = master();
      const b1 = base.beats[1]!;
      const m = master([
        {
          // el marco de navegador es 16:9 por definición: no hay maquetación
          // vertical que lo salve, al contrario que los tres de enumerar, que
          // ahora se apilan en columna y sí viajan
          type: 'device_frame',
          text: 'grapheneos.org',
          from_ms: b1.from_ms + 100,
          to_ms: b1.from_ms + 3_100,
        },
        { type: 'stat_card', value: '10×', from_ms: b1.from_ms + 100, to_ms: b1.from_ms + 3_100 },
      ]);
      const short = recortarMaster(m, cut(m, b1.from_ms, base.beats[2]!.to_ms));
      expect(short.edits!.map((e) => e.type)).toEqual(['stat_card']);
    });
  });

  // La identidad es la prueba de que el recorte no deforma nada por el camino.
  it('cortar la pieza entera conserva todos los beats y sus tiempos', () => {
    const m = master();
    const short = recortarMaster(m, cut(m, 0, m.audio.duration_ms));

    expect(short.beats).toHaveLength(m.beats.length);
    expect(short.beats.map((b) => [b.from_ms, b.to_ms])).toEqual(
      m.beats.map((b) => [b.from_ms, b.to_ms]),
    );
    expect(short.cues).toHaveLength(m.cues.length);
    expect(short.audio.duration_ms).toBe(m.audio.duration_ms);
  });
});
