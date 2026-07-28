import { describe, expect, it } from 'vitest';
import type { ComponentManifest } from '@fabrica/shared';
import {
  buildDeterminismEslintConfig,
  buildHarnessSource,
  buildHarnessTsconfig,
  contractTsType,
  schemaImportPathFor,
} from './harness.js';

function manifestWith(propsSchema: string): ComponentManifest {
  return {
    version: '1',
    type: 'lower_third',
    name: 'rotulo-ejemplo',
    component_version: '1.0.0',
    props_schema: propsSchema,
    assets: [],
  };
}

describe('schemaImportPathFor', () => {
  it('convierte la ruta del manifest en import relativo sin extensión', () => {
    expect(schemaImportPathFor(manifestWith('./schema.ts'))).toBe('./component/schema');
    expect(schemaImportPathFor(manifestWith('props/schema.ts'))).toBe('./component/props/schema');
  });

  it('rechaza rutas que salen del zip o no son módulos TS', () => {
    expect(schemaImportPathFor(manifestWith('../fuera.ts'))).toBeNull();
    expect(schemaImportPathFor(manifestWith('./a/../../fuera.ts'))).toBeNull();
    expect(schemaImportPathFor(manifestWith('/abs/schema.ts'))).toBeNull();
    expect(schemaImportPathFor(manifestWith('./schema.json'))).toBeNull();
  });
});

describe('contractTsType', () => {
  it('cubre los tipos con contrato mínimo definido', () => {
    expect(contractTsType('lower_third')).toContain('fromFrame: number');
    expect(contractTsType('subtitle_theme')).toContain('cues: unknown[]');
    expect(contractTsType('thumbnail_template')).toContain("variant: 'a' | 'b'");
    expect(contractTsType('intro')).toContain('channel_name: string');
    expect(contractTsType('outro')).toContain('channel_name: string');
    // contratos mínimos de S3 (docs/contratos.md §3)
    expect(contractTsType('title_card')).toBe('{ title: string; fromFrame: number; design?: DesignTokens }');
    expect(contractTsType('transition')).toBe('{ durationInFrames: number; design?: DesignTokens }');
    // todos los contratos exponen los tokens de diseño del canal
    expect(contractTsType('lower_third')).toContain('design?: DesignTokens');
    expect(contractTsType('subtitle_theme')).toContain('design?: DesignTokens');
  });
});

describe('buildHarnessSource', () => {
  it('importa componente y schema y comprueba el contrato del tipo', () => {
    const src = buildHarnessSource('lower_third', './component/schema');
    expect(src).toContain("import Component from './component/Component';");
    expect(src).toContain("import schema from './component/schema';");
    expect(src).toContain('const zodSchema: z.ZodType = schema;');
    expect(src).toContain('type ContractProps = { title: string; subtitle?: string; fromFrame: number; design?: DesignTokens };');
    expect(src).toContain('ComponentType<ContractProps>');
    // el harness importa el tipo de tokens de diseño para el contrato
    expect(src).toContain("import type { DesignTokens } from '@fabrica/shared';");
  });

  it('title_card y transition compilan contra su contrato mínimo', () => {
    const titleCard = buildHarnessSource('title_card', './component/schema');
    expect(titleCard).toContain('type ContractProps = { title: string; fromFrame: number; design?: DesignTokens };');
    const transition = buildHarnessSource('transition', './component/schema');
    expect(transition).toContain('type ContractProps = { durationInFrames: number; design?: DesignTokens };');
  });
});

describe('buildDeterminismEslintConfig', () => {
  it('importa el eslint.config.js real de packages/video y re-apunta files al zip', () => {
    const src = buildDeterminismEslintConfig('/repo/packages/video/eslint.config.js');
    expect(src).toContain("import base from 'file:///repo/packages/video/eslint.config.js';");
    expect(src).toContain("files: ['component/**/*.ts', 'component/**/*.tsx']");
    expect(src).toContain('export default base.map');
    // las entradas sin `files` (ignores, recommended) quedan intactas
    expect(src).toContain('Array.isArray(entry.files)');
  });
});

describe('buildHarnessTsconfig', () => {
  it('extiende el tsconfig de packages/video y limita el include', () => {
    const raw = buildHarnessTsconfig('/repo/packages/video/tsconfig.json');
    const parsed = JSON.parse(raw) as {
      extends: string;
      compilerOptions: { noEmit: boolean };
      include: string[];
    };
    expect(parsed.extends).toBe('/repo/packages/video/tsconfig.json');
    expect(parsed.compilerOptions.noEmit).toBe(true);
    expect(parsed.include).toContain('harness.ts');
    expect(parsed.include).toContain('component/**/*.tsx');
  });
});
