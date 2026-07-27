import { describe, expect, it } from 'vitest';
import type { ComponentManifest } from '@fabrica/shared';
import {
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
  });

  it('devuelve null para tipos sin contrato', () => {
    expect(contractTsType('title_card')).toBeNull();
    expect(contractTsType('transition')).toBeNull();
  });
});

describe('buildHarnessSource', () => {
  it('importa componente y schema y comprueba el contrato del tipo', () => {
    const src = buildHarnessSource('lower_third', './component/schema');
    expect(src).toContain("import Component from './component/Component';");
    expect(src).toContain("import schema from './component/schema';");
    expect(src).toContain('const zodSchema: z.ZodType = schema;');
    expect(src).toContain('type ContractProps = { title: string; subtitle?: string; fromFrame: number };');
    expect(src).toContain('ComponentType<ContractProps>');
  });

  it('para tipos sin contrato omite la asignación del contrato', () => {
    const src = buildHarnessSource('title_card', './component/schema');
    expect(src).not.toContain('ContractProps');
    expect(src).toContain('aún no tiene contrato mínimo');
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
