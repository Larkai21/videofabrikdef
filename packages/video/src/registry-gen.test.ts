import { describe, expect, it } from 'vitest';
import { generateRegistrySource, kitDirName, kitIdentifier } from './registry-gen';

describe('generateRegistrySource', () => {
  it('sin entradas emite solo los integrados', () => {
    const src = generateRegistrySource([]);
    expect(src).toContain("import { SubtitlesBasicos } from './themes/SubtitlesBasicos';");
    expect(src).toContain("'subtitulos-basicos@0.1.0': SubtitlesBasicos");
    expect(src).toContain('export function resolveComponent');
    expect(src).not.toContain('./kit/');
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
    // una vez en el import y otra en el mapa
    expect(matches).toHaveLength(2);
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
