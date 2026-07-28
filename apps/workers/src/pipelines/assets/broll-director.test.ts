import { describe, expect, it } from 'vitest';
import { brollResultSchema, buildDirectorPrompt } from './broll-director.js';
import { buildMockBroll } from './mocks.js';

const BEATS = [
  { idx: 0, text: 'En los últimos meses el capital rota hacia nuevas capas de la IA.', sceneQuery: 'city skyline business district' },
  { idx: 1, text: 'La cadena de valor empieza en el hardware y los aceleradores.', sceneQuery: 'server room cold blue lights' },
  { idx: 2, text: 'Después vienen los modelos y su coste de entrenamiento.', sceneQuery: 'server room cold blue lights' },
];

describe('buildDirectorPrompt', () => {
  it('incluye idioma, estilo y una línea por beat', () => {
    const { system, user } = buildDirectorPrompt({
      videoId: 'v1',
      channelId: 'c1',
      lang: 'en',
      styleSuffix: 'clean tech aesthetic',
      beats: BEATS,
    });
    expect(system).toContain('inglés');
    expect(system).toContain('clean tech aesthetic');
    // una línea de narración por beat en el user
    expect(user).toContain('0 · city skyline business district ·');
    expect(user.split('\n').filter((l) => /^\d+ · /.test(l))).toHaveLength(3);
  });

  it('sin sufijo de estilo no añade la línea de estilo', () => {
    const { system } = buildDirectorPrompt({
      videoId: 'v1',
      channelId: 'c1',
      lang: 'es',
      styleSuffix: '',
      beats: BEATS,
    });
    expect(system).toContain('español');
    expect(system).not.toContain('Estilo del canal');
  });
});

describe('buildMockBroll', () => {
  it('devuelve 1-3 sub-planos por beat, cada uno con consulta no vacía', () => {
    const result = buildMockBroll({ beats: BEATS });
    expect(brollResultSchema.parse(result)).toBeTruthy();
    expect(result.beats).toHaveLength(3);
    for (const b of result.beats) {
      expect(b.visuals.length).toBeGreaterThanOrEqual(1);
      expect(b.visuals.length).toBeLessThanOrEqual(3);
      for (const v of b.visuals) expect(v.visual_query.length).toBeGreaterThan(0);
    }
    expect(result.beats.map((b) => b.idx)).toEqual([0, 1, 2]);
  });

  it('ancla sub-planos a palabras de la narración (keyword)', () => {
    const result = buildMockBroll({
      beats: [{ idx: 0, text: 'bibliotecas y la industria en riesgo', sceneQuery: 'libros antiguos' }],
    });
    const kws = result.beats[0]!.visuals.map((v) => v.keyword);
    expect(kws).toContain('bibliotecas');
    expect(kws).toContain('industria');
  });

  it('sin beats devuelve lista vacía válida', () => {
    expect(brollResultSchema.parse(buildMockBroll({ beats: [] })).beats).toEqual([]);
  });
});
