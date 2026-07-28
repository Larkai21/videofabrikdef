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
  it('devuelve una consulta por beat, distinta entre beats de la misma escena', () => {
    const result = buildMockBroll({ beats: BEATS });
    expect(brollResultSchema.parse(result)).toBeTruthy();
    expect(result.beats).toHaveLength(3);
    // beats 1 y 2 comparten sceneQuery pero deben salir distintos
    expect(result.beats[1]!.visual_query).not.toBe(result.beats[2]!.visual_query);
    // conserva los idx
    expect(result.beats.map((b) => b.idx)).toEqual([0, 1, 2]);
  });

  it('sin beats devuelve lista vacía válida', () => {
    expect(brollResultSchema.parse(buildMockBroll({ beats: [] })).beats).toEqual([]);
  });
});
