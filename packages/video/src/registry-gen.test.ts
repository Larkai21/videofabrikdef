import { describe, expect, it } from 'vitest';
import {
  INTRO_BASICA_DURATION_FRAMES,
  OUTRO_BASICA_DURATION_FRAMES,
  generateMetaSource,
  generateRegistrySource,
  kitDirName,
  kitIdentifier,
} from './registry-gen';

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
    // la meta va en fichero HERMANO sin React (generateMetaSource): la consume
    // el worker de render para el offset de capítulos sin arrastrar componentes
    const src = generateMetaSource([]);
    expect(src).toContain('export const componentMeta');
    // se leen de las constantes: si no, cambiar una duración obliga a tocar el
    // test y es fácil olvidar regenerar el registry
    expect(src).toContain(
      `'intro-basica@0.1.0': { type: 'intro', fixed_duration_frames: ${INTRO_BASICA_DURATION_FRAMES} },`,
    );
    expect(src).toContain(
      `'outro-basica@0.1.0': { type: 'outro', fixed_duration_frames: ${OUTRO_BASICA_DURATION_FRAMES} },`,
    );
    expect(src).toContain("'subtitulos-basicos@0.1.0': { type: 'subtitle_theme' },");
    // y no arrastra ni un import: esa es su razón de existir
    expect(src).not.toContain('import ');
  });

  it('el registry re-exporta la meta en vez de duplicarla', () => {
    const src = generateRegistrySource([]);
    expect(src).toContain("from './registry.meta.generated'");
    expect(src).not.toContain('export const componentMeta');
  });

  it('propaga fixed_duration_frames del manifest al mapa de metadatos', () => {
    const src = generateMetaSource([
      { type: 'transition', name: 'cortina', version: '1.2.0', fixed_duration_frames: 24 },
      { type: 'lower_third', name: 'rotulo-a', version: '1.0.0' },
    ]);
    expect(src).toContain("'cortina@1.2.0': { type: 'transition', fixed_duration_frames: 24 },");
    expect(src).toContain("'rotulo-a@1.0.0': { type: 'lower_third' },");
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
    // una vez en el import y otra en el mapa (la meta vive en su fichero)
    expect(matches).toHaveLength(2);
    // y en la meta, una sola entrada pese al duplicado
    const meta = generateMetaSource([
      { type: 'lower_third', name: 'rotulo-a', version: '1.0.0' },
      { type: 'lower_third', name: 'rotulo-a', version: '1.0.0' },
    ]);
    expect(meta.match(/rotulo-a@1\.0\.0/g) ?? []).toHaveLength(1);
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
