import { describe, expect, it } from 'vitest';
import { componentManifestV1 } from '@fabrica/shared';

// Parseo del manifest.json del zip (docs/contratos.md §3): el mismo formato
// que emite packages/video/scripts/make-example-component.ts.

const valid = {
  version: '1',
  type: 'lower_third',
  name: 'rotulo-ejemplo',
  component_version: '1.0.0',
  props_schema: './schema.ts',
  assets: [],
};

describe('componentManifestV1', () => {
  it('acepta el manifest del zip de ejemplo', () => {
    const parsed = componentManifestV1.parse(valid);
    expect(parsed.type).toBe('lower_third');
    expect(parsed.name).toBe('rotulo-ejemplo');
    expect(parsed.component_version).toBe('1.0.0');
  });

  it('acepta fixed_duration_frames para intro/outro/transition', () => {
    expect(() =>
      componentManifestV1.parse({
        ...valid,
        type: 'intro',
        name: 'intro-basica',
        fixed_duration_frames: 90,
      }),
    ).not.toThrow();
  });

  it('rechaza tipos fuera del catálogo', () => {
    expect(componentManifestV1.safeParse({ ...valid, type: 'sticker' }).success).toBe(false);
  });

  it('rechaza nombres que no son kebab-case (protección de ruta en disco)', () => {
    expect(componentManifestV1.safeParse({ ...valid, name: 'Rotulo Ejemplo' }).success).toBe(false);
    expect(componentManifestV1.safeParse({ ...valid, name: '../escape' }).success).toBe(false);
  });

  it('rechaza versiones que no son semver X.Y.Z', () => {
    expect(componentManifestV1.safeParse({ ...valid, component_version: '1.0' }).success).toBe(false);
    expect(componentManifestV1.safeParse({ ...valid, component_version: 'v1.0.0' }).success).toBe(
      false,
    );
  });

  it('rechaza manifest sin props_schema', () => {
    const { props_schema: _omitted, ...rest } = valid;
    expect(componentManifestV1.safeParse(rest).success).toBe(false);
  });
});
