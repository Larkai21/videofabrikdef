import { describe, expect, it } from 'vitest';
import {
  canTransition,
  channelProfileV1,
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
