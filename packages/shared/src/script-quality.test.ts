import { describe, expect, it } from 'vitest';
import {
  BLOCKING_LINT_KINDS,
  blockingSceneIds,
  escenasEncabezadas,
  lintScenes,
} from './script-quality.js';

const CLAIMS = [
  { text: 'el índice subió un 70% en enero' },
  { text: 'ya son 2 millones de usuarios' },
];

const LEXICO = ['dato', 'coste', 'equipo', 'modelo', 'informe', 'plazo', 'cambio', 'motivo'];

/**
 * Relleno neutro: sin dígitos (el linter los leería como cifras) y partido en
 * frases de ocho palabras para no disparar el aviso de frase larga.
 */
function relleno(n: number): string {
  const palabras = Array.from({ length: n }, (_, i) => LEXICO[i % LEXICO.length] ?? 'dato');
  const frases: string[] = [];
  for (let i = 0; i < palabras.length; i += 8) frases.push(palabras.slice(i, i + 8).join(' '));
  return `${frases.join('. ')}.`;
}

const kinds = (hits: ReturnType<typeof lintScenes>): string[] => hits.map((h) => h.kind);

describe('lintScenes', () => {
  it('no marca nada en una escena limpia con una cifra respaldada', () => {
    // el control de falsos positivos es lo que decide si un linter así sirve
    const texto = `El índice subió un 70% en enero y eso cambia el cálculo. ${relleno(35)}`;
    expect(lintScenes([{ id: 'sc-1', text: texto }], { claims: CLAIMS })).toEqual([]);
  });

  it('detecta muletillas de texto generado', () => {
    const hits = lintScenes(
      [{ id: 'sc-1', text: `En un mundo donde todo cambia, esto importa. ${relleno(35)}` }],
      { claims: CLAIMS },
    );
    expect(kinds(hits)).toContain('cliche');
    // el detalle conserva la capitalización original para que el humano
    // encuentre la frase tal cual está escrita
    expect(hits[0]?.detail).toContain('En un mundo donde');
  });

  it('detecta exclamaciones y frases kilométricas', () => {
    const exclama = lintScenes([{ id: 'sc-1', text: `Esto es enorme. ${relleno(45)}!` }], {
      claims: CLAIMS,
    });
    expect(kinds(exclama)).toContain('exclamacion');

    const frase30 = Array.from({ length: 30 }, () => 'coste').join(' ');
    const larga = lintScenes([{ id: 'sc-1', text: `${frase30}. ${relleno(25)}` }], {
      claims: CLAIMS,
    });
    expect(kinds(larga)).toContain('frase_larga');
  });

  it('avisa de escenas fuera del rango de palabras', () => {
    expect(kinds(lintScenes([{ id: 'sc-1', text: relleno(20) }], { claims: CLAIMS }))).toContain(
      'escena_corta',
    );
    const largaHits = lintScenes(
      [{ id: 'sc-1', text: `${relleno(20)}. ${relleno(20)}. ${relleno(50)}.` }],
      {
        claims: CLAIMS,
      },
    );
    expect(kinds(largaHits)).toContain('escena_larga');
  });

  it('marca la cifra que no está en el research', () => {
    const hits = lintScenes(
      [{ id: 'sc-1', text: `El coste bajó un 45% este trimestre. ${relleno(35)}` }],
      { claims: CLAIMS },
    );
    const cifra = hits.filter((h) => h.kind === 'cifra_sin_claim');
    expect(cifra).toHaveLength(1);
    expect(cifra[0]?.detail).toContain('45');
  });

  it('acepta la cifra dicha con letra cuando el claim la trae en dígitos', () => {
    const texto = `Ya son 2 millones de usuarios y sigue subiendo. ${relleno(35)}`;
    const hits = lintScenes([{ id: 'sc-1', text: texto }], { claims: CLAIMS });
    expect(kinds(hits)).not.toContain('cifra_sin_claim');
  });
});

describe('blockingSceneIds', () => {
  it('solo bloquean el cliché y la cifra sin claim', () => {
    const hits = lintScenes(
      [
        { id: 'sc-1', text: `En la era de los datos todo cambia. ${relleno(35)}` },
        { id: 'sc-2', text: relleno(20) },
      ],
      { claims: CLAIMS },
    );
    expect(blockingSceneIds(hits)).toEqual(['sc-1']);
  });
});

describe('andamiaje del prompt locutado', () => {
  // Frases LITERALES de vídeos ya publicados. No son ejemplos inventados: cada
  // una está en el audio de un MP4 que salió de la fábrica.
  const reales = [
    'PUNTO MEDIO: estas herramientas funcionan, pero no son cajas negras perfectas.',
    'GIRO: lo más valioso no es ahorrar tiempo leyendo; es cambiar la tarea.',
    'Sí, pero: no todos los nichos pagan igual.',
    'Caso: Marta, 38 años, gestora de proyectos.',
    'Contexto social: muchas personas en tu situación están en riesgo económico.',
    'Giro: aunque exista evidencia sectorial del 25%, tu retorno puede variar.',
    'Primera idea: mapear lo que ya sabes.',
    'Paso tres: vectorizar. Cada fragmento se transforma en un vector.',
  ];

  it('marca las formas del andamiaje que se colaron en los vídeos reales', () => {
    for (const text of reales) {
      const hits = lintScenes([{ id: 'sc-body-1', text }], { claims: [] });
      expect(
        hits.some((h) => h.kind === 'andamiaje'),
        `no detectado: ${text}`,
      ).toBe(true);
    }
  });

  it('bloquea: no basta con avisar, el guion no puede salir así', () => {
    expect(BLOCKING_LINT_KINDS).toContain('andamiaje');
  });

  it('NO bloquea los dos puntos retóricos, que son buena escritura', () => {
    // «No fue un fallo: fue el diseño» está bien escrito. Bloquear esto sería
    // cambiar un defecto por otro peor: guiones que no pueden usar el recurso.
    const hits = lintScenes([{ id: 's2', text: 'No fue un fallo: fue el diseño.' }], {
      claims: [],
    });
    expect(hits.some((h) => h.kind === 'andamiaje')).toBe(false);
  });

  it('mide los encabezados aunque no los bloquee: 12 de 16 es un índice locutado', () => {
    const escenas = [
      { text: 'Hardware: las entradas de capital apuntan a aceleradores.' },
      { text: 'Modelos: hay apuestas en modelos base y optimización.' },
      { text: 'Un contenedor sale de Shanghái y llega a Róterdam en treinta días.' },
    ];
    expect(escenasEncabezadas(escenas)).toBe(2);
  });

  it('no marca una escena que simplemente empieza por una palabra normal', () => {
    const sanas = [
      'Marta llevaba ocho años en la misma empresa cuando cerraron su departamento.',
      'El coste oculto de la reconversión no es técnico, es psicológico.',
      'Las entradas de capital apuntan a aceleradores y centros de datos.',
      'Un contenedor sale de Shanghái y llega a Róterdam en treinta días.',
    ];
    for (const text of sanas) {
      const hits = lintScenes([{ id: 'sc-body-1', text }], { claims: [] });
      expect(
        hits.some((h) => h.kind === 'andamiaje'),
        `falso positivo: ${text}`,
      ).toBe(false);
    }
  });
});

describe('cifra_sin_claim: solo las cifras que afirman algo', () => {
  const claims = [{ text: 'el índice subió un 70% en enero' }];
  const salta = (text: string): boolean =>
    lintScenes([{ id: 's', text }], { claims }).some((h) => h.kind === 'cifra_sin_claim');

  it('marca la cifra que de verdad afirma algo sin respaldo', () => {
    expect(salta('El 45% de las empresas ya lo usa.')).toBe(true);
    expect(salta('Levantaron 300 millones de dólares.')).toBe(true);
    expect(salta('Son 12.000 modelos publicados este año.')).toBe(true);
  });

  it('no marca la cifra que está en los claims', () => {
    expect(salta('El índice subió un 70% en enero, según el informe.')).toBe(false);
  });

  it('no marca números instructivos ni narrativos', () => {
    // Los cuatro son literales de guiones reales. Antes disparaban los 29
    // avisos del corpus, y NINGUNO era una cifra inventada: el juez suspendió
    // tres vídeos por esto y el refinado gastó su presupuesto entero en
    // quitarle la edad al personaje en vez de arreglar la estructura.
    expect(salta('1) mapea en qué capa operas; 2) identifica dependencias; 3) prioriza.')).toBe(
      false,
    );
    expect(salta('Caso: Marta, 38 años, gestora de proyectos.')).toBe(false);
    expect(salta('Redacta un email de 150 palabras y prueba 20 contactos.')).toBe(false);
    expect(salta('Checklist para las primeras ocho semanas: 1) línea de base; 2) piloto.')).toBe(
      false,
    );
  });

  // Laguna conocida y anterior a esto: numericTokens solo ve dígitos, así que
  // «uno de cada cuatro adultos» no se comprueba contra el research en absoluto.
  it.todo('las cifras escritas con letra no se comprueban');
});
