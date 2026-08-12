import { describe, expect, it } from 'vitest';
import { makeDemoMaster, type MasterVideoJson } from '@fabrica/shared';
import {
  beatWindow,
  computeBrandKitLayout,
  computeBrollTrack,
  computeEffectsTrack,
  DEFAULT_DURATION_FRAMES,
  DEFAULT_LOWER_THIRD_FRAMES,
  DEFAULT_TITLE_CARD_FRAMES,
  kitSfxCues,
  kitViewFrom,
  type KitView,
} from './brand-kit';
import { INTRO_BASICA_DURATION_FRAMES, OUTRO_BASICA_DURATION_FRAMES } from './registry-gen';

// Maestro de demo (INTOCABLE en shared): 4 beats de 43 000 ms → 1290 frames a
// 30 fps. Los fixtures de intro/outro/title_card/lower_third se registran en
// una vista de prueba, nunca en makeDemoMaster.
const BASE_FRAMES = 1290;

function testView(): KitView {
  return kitViewFrom(
    {
      intro: { 'intro-test@1.0.0': {} },
      outro: { 'outro-test@1.0.0': {} },
      title_card: { 'portada-test@1.0.0': {} },
      lower_third: { 'rotulo-test@1.0.0': {} },
      subtitle_theme: { 'subtitulos-basicos@0.1.0': {} },
    },
    {
      'intro-test@1.0.0': { type: 'intro', fixed_duration_frames: 60 },
      'outro-test@1.0.0': { type: 'outro', fixed_duration_frames: 90 },
      'portada-test@1.0.0': { type: 'title_card' },
      'rotulo-test@1.0.0': { type: 'lower_third' },
      'subtitulos-basicos@0.1.0': { type: 'subtitle_theme' },
    },
  );
}

function masterWithKit(components: Record<string, string>): MasterVideoJson {
  const master = makeDemoMaster({ audioPath: 'demo/silence.wav' });
  master.brand = {
    components: { subtitle_theme: 'subtitulos-basicos@0.1.0', ...components },
  };
  return master;
}

describe('computeBrandKitLayout', () => {
  it('sin componentes activos el montaje es el de siempre (offset 0)', () => {
    const layout = computeBrandKitLayout(makeDemoMaster());
    expect(layout.introFrames).toBe(0);
    expect(layout.outroFrames).toBe(0);
    expect(layout.baseFrames).toBe(BASE_FRAMES);
    expect(layout.totalFrames).toBe(BASE_FRAMES);
    expect(layout.intro).toBeNull();
    expect(layout.outro).toBeNull();
    expect(layout.titleCard).toBeNull();
    expect(layout.lowerThird).toBeNull();
  });

  it('con intro y outro la duración total es intro + audio + outro', () => {
    const layout = computeBrandKitLayout(
      masterWithKit({ intro: 'intro-test@1.0.0', outro: 'outro-test@1.0.0' }),
      testView(),
    );
    expect(layout.introFrames).toBe(60);
    expect(layout.outroFrames).toBe(90);
    expect(layout.totalFrames).toBe(60 + BASE_FRAMES + 90);
    expect(layout.intro).toEqual({ ref: 'intro-test@1.0.0', from: 0, durationInFrames: 60 });
    // la outro arranca tras el último beat (fin del cuerpo desplazado)
    expect(layout.outro).toEqual({
      ref: 'outro-test@1.0.0',
      from: 60 + BASE_FRAMES,
      durationInFrames: 90,
    });
  });

  it('la intro desplaza los beats, el audio y los subtítulos intro frames', () => {
    const master = masterWithKit({ intro: 'intro-test@1.0.0' });
    const layout = computeBrandKitLayout(master, testView());
    // el offset común de las tres capas es introFrames
    expect(layout.introFrames).toBe(60);
    const beats = master.beats ?? [];
    const first = beatWindow(beats[0]!, {
      fps: 30,
      offsetFrames: layout.introFrames,
      isLast: false,
      bodyEndFrames: layout.introFrames + layout.baseFrames,
    });
    // beat 0: 0–11 000 ms → frames 60–390 con la intro delante
    expect(first.from).toBe(60);
    expect(first.durationInFrames).toBe(330);
    // la ley temporal no cambia: misma duración que sin intro
    const sinIntro = beatWindow(beats[0]!, {
      fps: 30,
      offsetFrames: 0,
      isLast: false,
      bodyEndFrames: BASE_FRAMES,
    });
    expect(first.durationInFrames).toBe(sinIntro.durationInFrames);
  });

  it('se degrada a sin componente si falta la ref en el registry o la duración fija', () => {
    // ref no registrada
    const noRegistrada = computeBrandKitLayout(
      masterWithKit({ intro: 'intro-fantasma@1.0.0' }),
      testView(),
    );
    expect(noRegistrada.intro).toBeNull();
    expect(noRegistrada.introFrames).toBe(0);
    expect(noRegistrada.totalFrames).toBe(BASE_FRAMES);
    // registrada pero sin fixed_duration_frames en el manifest
    const sinDuracion = kitViewFrom(
      { intro: { 'intro-test@1.0.0': {} } },
      { 'intro-test@1.0.0': { type: 'intro' } },
    );
    const layout = computeBrandKitLayout(masterWithKit({ intro: 'intro-test@1.0.0' }), sinDuracion);
    expect(layout.intro).toBeNull();
    expect(layout.totalFrames).toBe(BASE_FRAMES);
  });

  it('resuelve las duraciones fijas de los integrados desde el registry generado', () => {
    // vista por defecto = registry.generated.ts: intro/outro básicas de S3
    const layout = computeBrandKitLayout(
      masterWithKit({ intro: 'intro-basica@0.1.0', outro: 'outro-basica@0.1.0' }),
    );
    // contra las constantes, no contra literales: así este test comprueba que
    // registry.generated.ts se regeneró tras cambiarlas, en vez de romperse
    expect(layout.introFrames).toBe(INTRO_BASICA_DURATION_FRAMES);
    expect(layout.outroFrames).toBe(OUTRO_BASICA_DURATION_FRAMES);
    expect(layout.totalFrames).toBe(
      INTRO_BASICA_DURATION_FRAMES + BASE_FRAMES + OUTRO_BASICA_DURATION_FRAMES,
    );
  });

  it('monta el title_card al inicio del hook con el título elegido', () => {
    const master = masterWithKit({
      intro: 'intro-test@1.0.0',
      title_card: 'portada-test@1.0.0',
    });
    const layout = computeBrandKitLayout(master, testView());
    expect(layout.titleCard).toEqual({
      ref: 'portada-test@1.0.0',
      from: 60, // inicio del hook = inicio del cuerpo, desplazado por la intro
      durationInFrames: DEFAULT_TITLE_CARD_FRAMES,
      title: 'Por qué todos copian a DeepSeek',
    });
  });

  it('con segmentos monta una tarjeta de sección por segmento y no la portada', () => {
    const master = masterWithKit({ title_card: 'portada-test@1.0.0' });
    master.segments = [
      { title: 'Uno', beat_idx: 0, from_ms: 0 },
      { title: 'Dos', beat_idx: 2, from_ms: 23_500 },
    ];
    const layout = computeBrandKitLayout(master, testView());
    // con segmentos la portada única no se pinta
    expect(layout.titleCard).toBeNull();
    expect(layout.sectionCards).toEqual([
      {
        ref: 'portada-test@1.0.0',
        from: 0,
        durationInFrames: DEFAULT_TITLE_CARD_FRAMES,
        title: 'Uno',
      },
      {
        ref: 'portada-test@1.0.0',
        from: 705,
        durationInFrames: DEFAULT_TITLE_CARD_FRAMES,
        title: 'Dos',
      },
    ]);
  });

  it('la tarjeta de sección no se solapa con la siguiente (duración acotada)', () => {
    const master = masterWithKit({ title_card: 'portada-test@1.0.0' });
    // dos segmentos muy juntos: 0 ms y 1000 ms (30 frames) → la primera dura 30
    master.segments = [
      { title: 'Uno', beat_idx: 0, from_ms: 0 },
      { title: 'Dos', beat_idx: 1, from_ms: 1_000 },
    ];
    const layout = computeBrandKitLayout(master, testView());
    expect(layout.sectionCards[0]?.durationInFrames).toBe(30);
  });

  it('monta el lower_third en el arranque del primer beat de sección body', () => {
    const master = masterWithKit({
      intro: 'intro-test@1.0.0',
      lower_third: 'rotulo-test@1.0.0',
    });
    const layout = computeBrandKitLayout(master, testView());
    // primer beat body del demo: 11 000 ms → frame 330 + offset 60
    expect(layout.lowerThird).toEqual({
      ref: 'rotulo-test@1.0.0',
      from: 60 + 330,
      durationInFrames: DEFAULT_LOWER_THIRD_FRAMES,
      title: 'Por qué todos copian a DeepSeek',
    });
  });

  it('sin paquete SEO no se montan rótulos (falta el título elegido)', () => {
    const master = masterWithKit({
      title_card: 'portada-test@1.0.0',
      lower_third: 'rotulo-test@1.0.0',
    });
    delete master.seo;
    const layout = computeBrandKitLayout(master, testView());
    expect(layout.titleCard).toBeNull();
    expect(layout.lowerThird).toBeNull();
  });

  it('sin audio ni beats mantiene los frames por defecto del maestro recién creado', () => {
    const master = masterWithKit({});
    delete master.audio;
    master.beats = [];
    const layout = computeBrandKitLayout(master, testView());
    expect(layout.baseFrames).toBe(DEFAULT_DURATION_FRAMES);
    expect(layout.totalFrames).toBe(DEFAULT_DURATION_FRAMES);
  });
});

describe('computeEffectsTrack', () => {
  it('convierte edits (ms) a frames aplicando el offset de la intro', () => {
    const master = makeDemoMaster({ audioPath: 'demo/silence.wav' });
    master.edits = [
      { type: 'stat_card', from_ms: 2000, to_ms: 4000, beat_idx: 0, value: '70%', label: 'x' },
      { type: 'sfx', from_ms: 0, to_ms: 1000, sfx: 'riser' },
    ];
    // offset de intro arbitrario de 80 frames (no el de ningún integrado), 30 fps
    const effects = computeEffectsTrack(master, 30, 80);
    expect(effects[0]).toEqual({
      type: 'stat_card',
      from: 80 + 60, // 2000 ms → 60 frames + offset
      durationInFrames: 60, // 2000 ms de duración → 60 frames
      beatIdx: 0,
      value: '70%',
      label: 'x',
    });
    expect(effects[1]).toEqual({ type: 'sfx', from: 80, durationInFrames: 30, sfx: 'riser' });
  });

  it('sin edits devuelve una pista vacía', () => {
    expect(computeEffectsTrack(makeDemoMaster(), 30, 0)).toEqual([]);
  });

  it('los efectos de lista llegan al render con sus items', () => {
    // `items` es el único campo del contrato que no es un escalar, y el mapeo
    // se hace campo a campo: si alguien añade un efecto de lista y olvida la
    // línea, el gráfico se pinta vacío sin que falle nada. Esto lo caza.
    const master = makeDemoMaster({ audioPath: 'demo/silence.wav' });
    master.edits = [
      {
        type: 'split_versus',
        from_ms: 0,
        to_ms: 3400,
        items: ['Pesos abiertos', 'API cerrada'],
      },
      { type: 'pasos_flow', from_ms: 4000, to_ms: 8200, items: ['Descarga', 'Ajusta', 'Mide'] },
      { type: 'tendencia', from_ms: 9000, to_ms: 12000, value: '70%', style: 'sube', label: 'uso' },
    ];
    const effects = computeEffectsTrack(master, 30, 0);
    expect(effects[0]).toMatchObject({
      type: 'split_versus',
      items: ['Pesos abiertos', 'API cerrada'],
    });
    expect(effects[1]).toMatchObject({ type: 'pasos_flow', items: ['Descarga', 'Ajusta', 'Mide'] });
    expect(effects[2]).toMatchObject({ type: 'tendencia', value: '70%', style: 'sube' });
  });

  it('mapea los efectos nuevos (kinetic_text, stat_odometer) por passthrough', () => {
    const master = makeDemoMaster({ audioPath: 'demo/silence.wav' });
    master.edits = [
      { type: 'kinetic_text', from_ms: 0, to_ms: 2200, text: 'se borra solo' },
      {
        type: 'stat_odometer',
        from_ms: 3000,
        to_ms: 5600,
        value: '1000000',
        label: 'combinaciones',
      },
      { type: 'annotation', from_ms: 6000, to_ms: 7800, style: 'circle', text: 'aquí' },
    ];
    const effects = computeEffectsTrack(master, 30, 0);
    expect(effects[0]).toEqual({
      type: 'kinetic_text',
      from: 0,
      durationInFrames: 66,
      text: 'se borra solo',
    });
    expect(effects[1]).toMatchObject({
      type: 'stat_odometer',
      value: '1000000',
      label: 'combinaciones',
    });
    // el campo style pasa por passthrough para annotation/device_frame
    expect(effects[2]).toMatchObject({ type: 'annotation', style: 'circle', text: 'aquí' });
  });
});

describe('computeBrollTrack', () => {
  const demoBeats = [
    { idx: 0, from_ms: 0, to_ms: 11_000 },
    { idx: 1, from_ms: 11_000, to_ms: 23_500 },
    { idx: 2, from_ms: 23_500, to_ms: 33_500 },
    { idx: 3, from_ms: 33_500, to_ms: 43_000 },
  ];

  it('la suma de secuencias menos los solapes es exactamente baseFrames (sincronía)', () => {
    const track = computeBrollTrack(demoBeats, { fps: 30, baseFrames: 1290, transitionFrames: 12 });
    const seqTotal = track.sequences.reduce((s, x) => s + x.durationInFrames, 0);
    const transTotal = track.transitions.reduce((s, x) => s + x.durationInFrames, 0);
    expect(seqTotal - transTotal).toBe(1290);
    expect(track.transitions).toHaveLength(3);
  });

  it('un solo beat no lleva transiciones y ocupa todo el cuerpo', () => {
    const track = computeBrollTrack([{ idx: 0, from_ms: 0, to_ms: 43_000 }], {
      fps: 30,
      baseFrames: 1290,
    });
    expect(track.transitions).toHaveLength(0);
    expect(track.sequences[0]?.durationInFrames).toBe(1290);
  });

  it('marca como sección la transición hacia el beat que abre un segmento', () => {
    const track = computeBrollTrack(demoBeats, {
      fps: 30,
      baseFrames: 1290,
      segmentStartIdxs: new Set([2]),
    });
    // transición i corresponde a la entrada del beat i+1
    expect(track.transitions[1]?.kind).toBe('section'); // entra el beat 2
    // los cortes normales ya no son un tipo único: son duro/fundido/slide
    expect(track.transitions[0]?.kind).not.toBe('section');
    expect(track.transitions[2]?.kind).not.toBe('section');
  });

  it('el corte duro domina y no consume frames de solape', () => {
    // muchos límites para que el reparto 60/30/10 se vea sin depender de una
    // semilla concreta
    const muchos = Array.from({ length: 41 }, (_, i) => ({
      idx: i,
      from_ms: i * 10_000,
      to_ms: (i + 1) * 10_000,
    }));
    const track = computeBrollTrack(muchos, { fps: 30, baseFrames: 12_300, seed: 7 });
    const porTipo = new Map<string, number>();
    for (const t of track.transitions) porTipo.set(t.kind, (porTipo.get(t.kind) ?? 0) + 1);
    const duras = porTipo.get('dura') ?? 0;
    expect(duras).toBeGreaterThan(track.transitions.length / 2 - 4);
    for (const t of track.transitions) {
      if (t.kind === 'dura') expect(t.durationInFrames).toBe(0);
      else expect(t.durationInFrames).toBeGreaterThan(0);
    }
    // la sincronía se conserva con duraciones desiguales
    const seqTotal = track.sequences.reduce((s, x) => s + x.durationInFrames, 0);
    const transTotal = track.transitions.reduce((s, x) => s + x.durationInFrames, 0);
    expect(seqTotal - transTotal).toBe(12_300);
  });

  it('la semilla decide de verdad: semillas distintas, cortes distintos', () => {
    // comparar dos llamadas idénticas no prueba nada (cualquier función pura
    // pasa); lo que hay que probar es que opts.seed LLEGA a la decisión
    const muchos = Array.from({ length: 41 }, (_, i) => ({
      idx: i,
      from_ms: i * 10_000,
      to_ms: (i + 1) * 10_000,
    }));
    const a = computeBrollTrack(muchos, { fps: 30, baseFrames: 12_300, seed: 1 });
    const b = computeBrollTrack(muchos, { fps: 30, baseFrames: 12_300, seed: 2 });
    expect(a.transitions.map((t) => t.kind)).not.toEqual(b.transitions.map((t) => t.kind));
    // y la misma semilla reproduce exactamente
    const a2 = computeBrollTrack(muchos, { fps: 30, baseFrames: 12_300, seed: 1 });
    expect(a2.transitions).toEqual(a.transitions);
  });
});

describe('beatWindow', () => {
  it('replica la extensión del último beat hasta el fin del cuerpo', () => {
    const beat = { from_ms: 33_500, to_ms: 43_000 };
    // total con ceil = 1290, round(43 000 ms) = 1290: sin fracción no cambia
    const exact = beatWindow(beat, {
      fps: 30,
      offsetFrames: 0,
      isLast: true,
      bodyEndFrames: 1290,
    });
    expect(exact.from).toBe(1005);
    expect(exact.durationInFrames).toBe(285);
    // con fracción de frame (43 016 ms → round 1290, ceil 1291) se extiende
    const fraccion = beatWindow(
      { from_ms: 33_500, to_ms: 43_016 },
      { fps: 30, offsetFrames: 0, isLast: true, bodyEndFrames: 1291 },
    );
    expect(fraccion.durationInFrames).toBe(286);
  });

  it('no extiende los beats intermedios', () => {
    const beat = { from_ms: 11_000, to_ms: 23_500 };
    const window = beatWindow(beat, {
      fps: 30,
      offsetFrames: 60,
      isLast: false,
      bodyEndFrames: 9_999,
    });
    expect(window.from).toBe(60 + 330);
    expect(window.durationInFrames).toBe(375);
  });
});

describe('kitSfxCues', () => {
  // La intro empezaba en silencio DIGITAL: −91 dB medidos sobre los tres
  // primeros segundos de un vídeo real. El único audio del montaje es la voz,
  // que arranca en introFrames, así que la pieza de apertura no sonaba.
  const intro = { from: 0, durationInFrames: 96 };
  const outro = { from: 1400, durationInFrames: 120 };

  it('la intro suena desde el frame 0', () => {
    const cues = kitSfxCues({ intro, outro: null });
    expect(cues.some((c) => c.from === 0 && c.sfx === 'riser')).toBe(true);
  });

  it('el golpe cae donde aterriza el nombre, no en una pantalla vacía', () => {
    const golpe = kitSfxCues({ intro, outro: null }).find((c) => c.sfx === 'impacto');
    expect(golpe?.from).toBe(27);
    expect(golpe?.from).toBeGreaterThan(0);
  });

  it('la outro arranca su sonido donde arranca la pieza', () => {
    const cues = kitSfxCues({ intro: null, outro });
    expect(cues.find((c) => c.sfx === 'resolucion')?.from).toBe(1400);
    expect(cues.find((c) => c.sfx === 'pop')?.from).toBe(1434);
  });

  it('sin piezas no suena nada: un vídeo sin kit no cambia', () => {
    expect(kitSfxCues({ intro: null, outro: null })).toEqual([]);
  });

  it('una outro más corta que el rebote no programa el pop fuera de su ventana', () => {
    const corta = kitSfxCues({ intro: null, outro: { from: 100, durationInFrames: 20 } });
    expect(corta.every((c) => c.from + c.durationInFrames <= 120)).toBe(true);
  });

  // El short no tiene intro por construcción (short-json.ts) y arrancaba en el
  // mismo silencio digital que este módulo existe para arreglar.
  it('en vertical la cartela hace de intro sonora: golpe al aterrizar, destello al salir', () => {
    const cues = kitSfxCues({ intro: null, outro: null }, { aterriza: 12, sale: 87 });
    expect(cues.find((c) => c.sfx === 'impacto')?.from).toBe(12);
    expect(cues.find((c) => c.sfx === 'destello')?.from).toBe(87);
    // sin riser: no hay pantalla que dibujar, la voz ya suena en el frame 0
    expect(cues.some((c) => c.sfx === 'riser')).toBe(false);
  });

  it('con intro presente la cartela no añade sonidos: son excluyentes', () => {
    const cues = kitSfxCues({ intro, outro: null }, { aterriza: 12, sale: 87 });
    expect(cues.filter((c) => c.sfx === 'impacto')).toHaveLength(1);
    expect(cues.find((c) => c.sfx === 'impacto')?.from).toBe(27);
  });
});
