import { describe, expect, it } from 'vitest';
import {
  AUTHOR_ALL_TYPES,
  authoredComponentName,
  authoredTemplateOutput,
  buildComponentAuthorPrompt,
  buildComponentRepairPrompt,
  canTransition,
  channelProfileV1,
  COMPONENT_TYPES,
  editSchema,
  componentAuthorOutputSchema,
  componentManifestV1,
  defaultDesign,
  designTokensSchema,
  demoProfile,
  hexToRgba,
  makeDemoMaster,
  masterVideoJsonV1,
  parseComponentRef,
  renderableMasterV1,
  VIDEO_TRANSITIONS,
  countInvalidEdits,
  editPayloadText,
  editsFieldSchema,
} from './index.js';

describe('ChannelProfile v1', () => {
  it('acepta el perfil de demostración', () => {
    expect(() => channelProfileV1.parse(demoProfile)).not.toThrow();
  });

  it('rechaza un perfil sin versión', () => {
    const { version: _v, ...rest } = demoProfile;
    expect(channelProfileV1.safeParse(rest).success).toBe(false);
  });
});

describe('MasterVideoJson v1', () => {
  it('acepta un maestro progresivo sin audio ni assets', () => {
    const master = makeDemoMaster();
    expect(() => masterVideoJsonV1.parse(master)).not.toThrow();
  });

  it('un maestro sin assets resueltos NO es renderizable', () => {
    const master = makeDemoMaster({ audioPath: '/tmp/a.wav' });
    expect(renderableMasterV1.safeParse(master).success).toBe(false);
  });

  it('un maestro completo con assets y audio es renderizable', () => {
    const master = makeDemoMaster({
      audioPath: '/tmp/a.wav',
      clipPath: '/tmp/clip.mp4',
      imagePath: '/tmp/img.png',
    });
    const parsed = renderableMasterV1.safeParse(master);
    expect(parsed.success).toBe(true);
  });

  it('los beats cubren el audio sin huecos', () => {
    const master = makeDemoMaster({ audioPath: '/tmp/a.wav' });
    const beats = master.beats ?? [];
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i]!.from_ms).toBe(beats[i - 1]!.to_ms);
    }
    expect(master.audio?.duration_ms).toBe(beats.at(-1)?.to_ms);
  });
});

describe('ComponentManifest v1', () => {
  const manifest = {
    version: '1',
    type: 'lower_third',
    name: 'rotulo-basico',
    component_version: '1.2.0',
    props_schema: './schema.ts',
    assets: ['assets/font.woff2'],
  };

  it('acepta un manifest válido', () => {
    expect(() => componentManifestV1.parse(manifest)).not.toThrow();
  });

  it('rechaza versiones no semver y nombres con mayúsculas', () => {
    expect(componentManifestV1.safeParse({ ...manifest, component_version: '1.2' }).success).toBe(
      false,
    );
    expect(componentManifestV1.safeParse({ ...manifest, name: 'Rotulo' }).success).toBe(false);
  });

  it('parsea referencias name@version', () => {
    expect(parseComponentRef('rotulo-basico@1.2.0')).toEqual({
      name: 'rotulo-basico',
      version: '1.2.0',
    });
    expect(parseComponentRef('sin-version')).toBeNull();
  });
});

describe('Edits (director de edición)', () => {
  it('acepta un edit válido y rechaza un tipo desconocido', () => {
    expect(() =>
      editSchema.parse({ type: 'stat_card', from_ms: 1000, to_ms: 3000, value: '70%' }),
    ).not.toThrow();
    expect(editSchema.safeParse({ type: 'nope', from_ms: 0, to_ms: 1 }).success).toBe(false);
  });

  it('acepta los efectos estrella nuevos: kinetic_text y stat_odometer', () => {
    expect(
      editSchema.safeParse({ type: 'kinetic_text', from_ms: 0, to_ms: 2200, text: 'se borra solo' })
        .success,
    ).toBe(true);
    expect(
      editSchema.safeParse({
        type: 'stat_odometer',
        from_ms: 5000,
        to_ms: 7600,
        value: '1.000.000',
        label: 'combinaciones',
      }).success,
    ).toBe(true);
  });

  it('acepta annotation y device_frame con el campo style', () => {
    expect(
      editSchema.safeParse({
        type: 'annotation',
        from_ms: 3000,
        to_ms: 4800,
        style: 'circle',
        text: 'aquí',
      }).success,
    ).toBe(true);
    expect(
      editSchema.safeParse({
        type: 'device_frame',
        from_ms: 6000,
        to_ms: 8600,
        style: 'browser',
        text: 'grapheneos.org',
      }).success,
    ).toBe(true);
  });

  it('edits es opcional: el maestro parsea con y sin ellos, y no bloquea el render', () => {
    const master = makeDemoMaster({
      audioPath: '/tmp/a.wav',
      clipPath: '/tmp/c.mp4',
      imagePath: '/tmp/i.png',
    });
    // sin edits, un maestro completo sigue siendo renderizable
    expect(renderableMasterV1.safeParse(master).success).toBe(true);
    // con edits válidos también
    const withEdits = {
      ...master,
      edits: [{ type: 'sfx' as const, from_ms: 0, to_ms: 500, sfx: 'whoosh' as const }],
    };
    expect(masterVideoJsonV1.safeParse(withEdits).success).toBe(true);
    expect(renderableMasterV1.safeParse(withEdits).success).toBe(true);
  });
});

describe('Máquina de estados', () => {
  it('sigue el camino feliz completo', () => {
    const happy = [
      'idea',
      'idea_aprobada',
      'guion_borrador',
      'guion_ok',
      'audio',
      'assets',
      'timeline_ok',
      'render',
      'hecho',
    ] as const;
    for (let i = 1; i < happy.length; i++) {
      expect(canTransition(happy[i - 1]!, happy[i]!)).toBe(true);
    }
  });

  it('prohíbe saltarse puertas humanas', () => {
    expect(canTransition('guion_borrador', 'audio')).toBe(false);
    expect(canTransition('assets', 'render')).toBe(false);
    expect(canTransition('idea', 'guion_borrador')).toBe(false);
  });

  it('hecho es terminal', () => {
    expect(VIDEO_TRANSITIONS.hecho).toHaveLength(0);
  });
});

describe('DesignTokens', () => {
  it('defaultDesign es un conjunto de tokens válido', () => {
    expect(() => designTokensSchema.parse(defaultDesign())).not.toThrow();
  });

  it('rechaza colores que no son hex', () => {
    expect(designTokensSchema.safeParse({ ...defaultDesign(), accent: 'rojo' }).success).toBe(false);
    expect(designTokensSchema.safeParse({ ...defaultDesign(), background: '#12' }).success).toBe(
      false,
    );
  });

  it('acepta hex de 3 y 6 dígitos', () => {
    expect(designTokensSchema.safeParse({ ...defaultDesign(), accent: '#abc' }).success).toBe(true);
    expect(designTokensSchema.safeParse({ ...defaultDesign(), accent: '#aabbcc' }).success).toBe(
      true,
    );
  });

  it('el perfil de canal admite brand_design opcional', () => {
    expect(() =>
      channelProfileV1.parse({ ...demoProfile, brand_design: defaultDesign() }),
    ).not.toThrow();
    // sin brand_design sigue siendo válido (fallback a defaultDesign en el render)
    expect(channelProfileV1.safeParse(demoProfile).success).toBe(true);
  });

  it('hexToRgba expande #rgb y aplica el alpha acotado', () => {
    expect(hexToRgba('#000000', 0.5)).toBe('rgba(0, 0, 0, 0.5)');
    expect(hexToRgba('#fff', 1)).toBe('rgba(255, 255, 255, 1)');
    expect(hexToRgba('#7aa2ff', 0.16)).toBe('rgba(122, 162, 255, 0.16)');
    // alpha fuera de rango se recorta a [0, 1]
    expect(hexToRgba('#000', 2)).toBe('rgba(0, 0, 0, 1)');
    expect(hexToRgba('#000', -1)).toBe('rgba(0, 0, 0, 0)');
  });
});

describe('Autoría de componentes por IA', () => {
  it('la plantilla de cada tipo cumple el esquema de salida', () => {
    for (const type of COMPONENT_TYPES) {
      const out = authoredTemplateOutput(type);
      expect(() => componentAuthorOutputSchema.parse(out)).not.toThrow();
      // export default + lectura de tokens (FALLBACK/design) en el componente
      expect(out.component_tsx).toContain('export default');
      expect(out.component_tsx).toContain('design');
      expect(out.schema_ts).toContain('export default');
      expect(out.name).toBe(authoredComponentName(type));
    }
  });

  it('intro/outro/transition traen fixed_duration_frames; muestran el avatar', () => {
    for (const type of ['intro', 'outro', 'transition'] as const) {
      expect(authoredTemplateOutput(type).fixed_duration_frames).toBeGreaterThan(0);
    }
    // intro y outro pintan el logo (avatar del canal)
    expect(authoredTemplateOutput('intro').component_tsx).toContain('logo');
    expect(authoredTemplateOutput('outro').component_tsx).toContain('logo');
    expect(authoredTemplateOutput('thumbnail_template').component_tsx).toContain('image_path');
  });

  it('las plantillas no usan APIs no deterministas', () => {
    const banned = ['Math.random', 'Date.now', 'setTimeout', 'setInterval', 'fetch(', 'new Date('];
    for (const type of COMPONENT_TYPES) {
      const src = authoredTemplateOutput(type).component_tsx;
      for (const term of banned) expect(src).not.toContain(term);
    }
  });

  it('el prompt de autoría incluye el contrato de props, el design y el avatar', () => {
    const prompt = buildComponentAuthorPrompt(
      'intro',
      { channel_name: 'MilkyGoblinNews', language: 'es' },
      { design: defaultDesign() as unknown as Record<string, string>, character: { name: 'Milky Goblin', description: 'duende lechoso' } },
    );
    expect(prompt).toContain('channel_name');
    expect(prompt).toContain('design');
    expect(prompt).toContain('Milky Goblin');
    expect(prompt).toContain('fixed_duration_frames');
    expect(prompt).toContain('schema_ts');
    expect(prompt).toContain('component_tsx');
  });

  it('los tipos sin duración fija NO piden fixed_duration_frames ni emiten null', () => {
    for (const t of ['title_card', 'lower_third', 'subtitle_theme', 'thumbnail_template'] as const) {
      const p = buildComponentAuthorPrompt(t, { channel_name: 'X', language: 'es' });
      // el bug: el ejemplo emitía "fixed_duration_frames": null y el schema
      // .optional() lo rechazaba → el LLM fallaba antes de crear la fila
      expect(p).not.toContain('"fixed_duration_frames"');
      expect(p).not.toContain('"fixed_duration_frames": null');
    }
    // los de duración fija SÍ la piden (con un número, no null)
    expect(buildComponentAuthorPrompt('intro', { channel_name: 'X', language: 'es' })).toMatch(
      /"fixed_duration_frames": \d+/,
    );
  });

  it('el schema de salida tolera fixed_duration_frames null (nullish)', () => {
    const base = authoredTemplateOutput('title_card');
    expect(
      componentAuthorOutputSchema.safeParse({ ...base, fixed_duration_frames: null }).success,
    ).toBe(true);
  });

  it('el prompt de reparación incluye el log del fallo, los ficheros y el formato JSON', () => {
    const p = buildComponentRepairPrompt('intro', {
      prevSchemaTs: 'export default zObjeto',
      prevComponentTsx: 'const X = 1;',
      failureLog: "[determinismo] 'fps' is assigned a value but never used",
    });
    expect(p).toContain('FALLÓ la validación');
    expect(p).toContain('never used'); // el log exacto del fallo
    expect(p).toContain('export default zObjeto'); // el schema previo
    expect(p).toContain('const X = 1;'); // el componente previo
    expect(p).toContain('schema_ts');
  });

  it('el lote de "generar todas" excluye transition (no se monta hoy)', () => {
    expect(AUTHOR_ALL_TYPES).not.toContain('transition');
    expect(AUTHOR_ALL_TYPES).toContain('intro');
    expect(AUTHOR_ALL_TYPES).toContain('subtitle_theme');
  });
});

describe('editSchema como unión discriminada', () => {
  const base = { from_ms: 0, to_ms: 1000 };

  it('exige el campo sin el cual el render pinta un hueco', () => {
    // con el objeto plano anterior estos cuatro parseaban y llegaban al render
    expect(editSchema.safeParse({ ...base, type: 'stat_card' }).success).toBe(false);
    expect(editSchema.safeParse({ ...base, type: 'text_callout' }).success).toBe(false);
    expect(editSchema.safeParse({ ...base, type: 'keyword_highlight' }).success).toBe(false);
    expect(editSchema.safeParse({ ...base, type: 'sfx' }).success).toBe(false);
    expect(editSchema.safeParse({ ...base, type: 'zoom_punch' }).success).toBe(false);
  });

  it('acepta los efectos bien formados', () => {
    expect(editSchema.safeParse({ ...base, type: 'stat_card', value: '70%' }).success).toBe(true);
    expect(editSchema.safeParse({ ...base, type: 'sfx', sfx: 'clic' }).success).toBe(true);
    expect(editSchema.safeParse({ ...base, type: 'zoom_punch', beat_idx: 0 }).success).toBe(true);
    expect(editSchema.safeParse({ ...base, type: 'micro_fx', style: 'spark_up' }).success).toBe(true);
    // annotation es la única sin payload obligatorio: es una marca sobre el b-roll
    expect(editSchema.safeParse({ ...base, type: 'annotation' }).success).toBe(true);
  });

  it('rechaza un sonido que no existe en el pack', () => {
    expect(editSchema.safeParse({ ...base, type: 'sfx', sfx: 'inventado' }).success).toBe(false);
  });

  it('la lectura del maestro DESCARTA lo malformado en vez de fallar entera', () => {
    // sin esto, un solo efecto viejo dejaría el vídeo sin render y sin preview
    const parsed = editsFieldSchema.parse([
      { type: 'stat_card', from_ms: 0, to_ms: 1 },
      { type: 'sfx', from_ms: 0, to_ms: 400, sfx: 'pop' },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.type).toBe('sfx');
  });

  it('countInvalidEdits cuenta lo descartado para poder avisar', () => {
    expect(countInvalidEdits([{ type: 'stat_card', from_ms: 0, to_ms: 1 }])).toBe(1);
    expect(countInvalidEdits([{ type: 'sfx', from_ms: 0, to_ms: 1, sfx: 'pop' }])).toBe(0);
    expect(countInvalidEdits('no es una lista')).toBe(0);
  });

  it('editPayloadText saca el texto sin estrechar el tipo a mano', () => {
    expect(editPayloadText({ ...base, type: 'text_callout', text: 'coste real' })).toBe('coste real');
    expect(editPayloadText({ ...base, type: 'stat_card', value: '70%' })).toBe('70%');
    expect(editPayloadText({ ...base, type: 'sfx', sfx: 'clic' })).toBe('clic');
    expect(editPayloadText({ ...base, type: 'zoom_punch', beat_idx: 0 })).toBeUndefined();
  });
});
