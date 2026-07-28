import { describe, expect, it } from 'vitest';
import { generateRegistrySource, kitDirName, kitIdentifier } from './registry-gen';

describe('generateRegistrySource', () => {
  it('sin entradas emite solo los integrados', () => {
    const src = generateRegistrySource([]);
    expect(src).toContain("import { SubtitlesBasicos } from './themes/SubtitlesBasicos';");
    expect(src).toContain("'subtitulos-basicos@0.1.0': SubtitlesBasicos");
    expect(src).toContain("import { IntroBasica } from './themes/IntroBasica';");
    expect(src).toContain("import { OutroBasica } from './themes/OutroBasica';");
    expect(src).toContain('export function resolveComponent');
    expect(src).not.toContain('./kit/');
  });

  it('emite el mapa de metadatos con las duraciones fijas de los integrados', () => {
    const src = generateRegistrySource([]);
    expect(src).toContain('export const componentMeta');
    expect(src).toContain("'intro-basica@0.1.0': { fixed_duration_frames: 80 },");
    expect(src).toContain("'outro-basica@0.1.0': { fixed_duration_frames: 90 },");
    expect(src).toContain("'subtitulos-basicos@0.1.0': {},");
  });

  it('propaga fixed_duration_frames del manifest al mapa de metadatos', () => {
    const src = generateRegistrySource([
      { type: 'transition', name: 'cortina', version: '1.2.0', fixed_duration_frames: 24 },
      { type: 'lower_third', name: 'rotulo-a', version: '1.0.0' },
    ]);
    expect(src).toContain("'cortina@1.2.0': { fixed_duration_frames: 24 },");
    expect(src).toContain("'rotulo-a@1.0.0': {},");
  });

  it('rechaza duraciones fijas que no son enteros positivos', () => {
    expect(() =>
      generateRegistrySource([
        { type: 'intro', name: 'intro-x', version: '1.0.0', fixed_duration_frames: 0 },
      ]),
    ).toThrowError(/fixed_duration_frames inválido/);
    expect(() =>
      generateRegistrySource([
        { type: 'intro', name: 'intro-x', version: '1.0.0', fixed_duration_frames: 1.5 },
      ]),
    ).toThrowError(/fixed_duration_frames inválido/);
  });

  it('emite un import relativo a src/kit y la entrada del mapa por componente', () => {
    const src = generateRegistrySource([
      { type: 'lower_third', name: 'rotulo-ejemplo', version: '1.0.0' },
    ]);
    expect(src).toContain(
      "import Kit_rotulo_ejemplo_1_0_0 from './kit/rotulo-ejemplo@1.0.0/Component';",
    );
    expect(src).toContain(
      "'rotulo-ejemplo@1.0.0': Kit_rotulo_ejemplo_1_0_0 as unknown as RegisteredComponent,",
    );
    // el integrado sigue presente
    expect(src).toContain("'subtitulos-basicos@0.1.0': SubtitlesBasicos");
  });

  it('es determinista: mismo listado en distinto orden produce el mismo archivo', () => {
    const a = generateRegistrySource([
      { type: 'lower_third', name: 'rotulo-a', version: '1.0.0' },
      { type: 'intro', name: 'intro-b', version: '2.0.0' },
    ]);
    const b = generateRegistrySource([
      { type: 'intro', name: 'intro-b', version: '2.0.0' },
      { type: 'lower_third', name: 'rotulo-a', version: '1.0.0' },
    ]);
    expect(a).toBe(b);
  });

  it('deduplica entradas repetidas nombre@versión', () => {
    const src = generateRegistrySource([
      { type: 'lower_third', name: 'rotulo-a', version: '1.0.0' },
      { type: 'lower_third', name: 'rotulo-a', version: '1.0.0' },
    ]);
    const matches = src.match(/rotulo-a@1\.0\.0/g) ?? [];
    // una vez en el import, otra en el mapa y otra en componentMeta
    expect(matches).toHaveLength(3);
  });

  it('rechaza nombres o versiones fuera del contrato (protección de ruta)', () => {
    expect(() =>
      generateRegistrySource([{ type: 'intro', name: '../escape', version: '1.0.0' }]),
    ).toThrowError(/Nombre de componente inválido/);
    expect(() =>
      generateRegistrySource([{ type: 'intro', name: 'ok', version: '1.0' }]),
    ).toThrowError(/Versión de componente inválida/);
  });
});

describe('kitIdentifier / kitDirName', () => {
  it('sanea el identificador y conserva el directorio nombre@versión', () => {
    expect(kitIdentifier('rotulo-ejemplo', '1.0.0')).toBe('Kit_rotulo_ejemplo_1_0_0');
    expect(kitDirName('rotulo-ejemplo', '1.0.0')).toBe('rotulo-ejemplo@1.0.0');
  });
});
