import { describe, expect, it } from 'vitest';
import { MAX_QUERY_CHARS } from '@fabrica/shared';
import { brollResultSchema, buildDirectorPrompt, recortarConsulta } from './broll-director.js';
import { buildMockBroll } from './mocks.js';

const BEATS = [
  {
    idx: 0,
    text: 'En los últimos meses el capital rota hacia nuevas capas de la IA.',
    sceneQuery: 'city skyline business district',
  },
  {
    idx: 1,
    text: 'La cadena de valor empieza en el hardware y los aceleradores.',
    sceneQuery: 'server room cold blue lights',
  },
  {
    idx: 2,
    text: 'Después vienen los modelos y su coste de entrenamiento.',
    sceneQuery: 'server room cold blue lights',
  },
];

describe('buildDirectorPrompt', () => {
  it('incluye idioma, el tope de longitud y una línea por beat', () => {
    const { system, user } = buildDirectorPrompt({
      videoId: 'v1',
      channelId: 'c1',
      lang: 'en',
      beats: BEATS,
    });
    expect(system).toContain('inglés');
    expect(system).toContain(`${MAX_QUERY_CHARS} caracteres`);
    // una línea de narración por beat en el user
    expect(user).toContain('0 · city skyline business district ·');
    expect(user.split('\n').filter((l) => /^\d+ · /.test(l))).toHaveLength(3);
  });

  // El sufijo de estilo del canal es para los prompts de IMAGEN. Metido en la
  // consulta tumbaba Pixabay (400 por pasar de 100 caracteres) y añadía una
  // componente idéntica a todos los vectores de consulta.
  it('nunca mete el sufijo de estilo del canal en la consulta', () => {
    const { system } = buildDirectorPrompt({
      videoId: 'v1',
      channelId: 'c1',
      lang: 'es',
      beats: BEATS,
    });
    expect(system).toContain('español');
    expect(system).not.toContain('Estilo del canal');
    expect(system).not.toContain('clean tech aesthetic');
  });
});

describe('alt_query en el contrato del director', () => {
  it('el prompt pide la segunda consulta y el esquema la acepta', () => {
    const { system } = buildDirectorPrompt({
      videoId: 'v1',
      channelId: 'c1',
      lang: 'en',
      beats: BEATS,
    });
    expect(system).toContain('alt_query');
    const parsed = brollResultSchema.parse({
      beats: [
        {
          idx: 0,
          visuals: [{ visual_query: 'server room aisle', alt_query: 'data center racks closeup' }],
        },
      ],
    });
    expect(parsed.beats[0]!.visuals[0]!.alt_query).toBe('data center racks closeup');
  });

  it('el esquema no exige alt_query (opcional de verdad)', () => {
    const parsed = brollResultSchema.parse({
      beats: [{ idx: 0, visuals: [{ visual_query: 'server room aisle' }] }],
    });
    expect(parsed.beats[0]!.visuals[0]!.alt_query).toBeUndefined();
  });
});

describe('recortarConsulta', () => {
  it('deja intactas las consultas cortas y normaliza los espacios', () => {
    expect(recortarConsulta('  server   room  ')).toBe('server room');
  });

  it('corta por palabra entera al llegar al tope de Pixabay', () => {
    const entrada =
      'warehouse shelving with stacked boxes and a conveyor belt under industrial lighting at night, plus more words that will not fit';
    const r = recortarConsulta(entrada);
    expect(r.length).toBeLessThanOrEqual(MAX_QUERY_CHARS);
    // es un prefijo de la entrada y no parte ninguna palabra por la mitad
    expect(entrada.startsWith(r)).toBe(true);
    expect(entrada[r.length]).toMatch(/[\s,]/);
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
      beats: [
        { idx: 0, text: 'bibliotecas y la industria en riesgo', sceneQuery: 'libros antiguos' },
      ],
    });
    const kws = result.beats[0]!.visuals.map((v) => v.keyword);
    expect(kws).toContain('bibliotecas');
    expect(kws).toContain('industria');
  });

  it('sin beats devuelve lista vacía válida', () => {
    expect(brollResultSchema.parse(buildMockBroll({ beats: [] })).beats).toEqual([]);
  });
});
