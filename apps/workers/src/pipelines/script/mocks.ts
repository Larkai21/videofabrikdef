import { WORDS_PER_MIN } from '@fabrica/shared';
import { mockHash, registerMockOp } from '../../providers/llm.js';

// Mocks deterministas del pipeline de guion. El guion mock respeta la duración
// objetivo (~150 palabras/min, escenas de 40-70 palabras) para que TTS y beats
// funcionen de verdad en el E2E sin claves.

const WORD_BANK = [
  'modelo', 'datos', 'coste', 'equipo', 'sistema', 'herramienta', 'mercado', 'señal',
  'cambio', 'producto', 'industria', 'resultado', 'proceso', 'contexto', 'límite',
  'ventaja', 'riesgo', 'uso', 'práctica', 'detalle', 'medida', 'impacto', 'ejemplo',
  'caso', 'cifra', 'fuente', 'análisis', 'tendencia', 'plataforma', 'servicio',
];

const CONNECTORS = ['además', 'entonces', 'después', 'mientras', 'aquí', 'también', 'ahora', 'pero'];

const VISUAL_QUERY_POOL = [
  'server room aisle cold blue lights',
  'close up circuit board macro',
  'developer typing code at night',
  'data center corridor wide shot',
  'robot arm assembly line factory',
  'city skyline night timelapse traffic',
  'abstract network visualization on screen',
  'engineer whiteboard diagram discussion',
  'hands holding smartphone dark room',
  'stock chart rising on monitor',
];

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

// texto en español con EXACTAMENTE `count` palabras, determinista por semilla
export function mockWords(seedText: string, count: number): string {
  const seed = mockHash(seedText) % 100_000;
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const bank = i % 9 === 0 ? CONNECTORS : WORD_BANK;
    const idx = (seed + i * 31 + i * i) % bank.length;
    words.push(bank[idx] ?? 'dato');
  }
  const sentences: string[] = [];
  for (let i = 0; i < words.length; i += 10) {
    const chunk = words.slice(i, i + 10);
    if (chunk[0]) chunk[0] = capitalize(chunk[0]);
    sentences.push(`${chunk.join(' ')}.`);
  }
  return sentences.join(' ');
}

export function pickVisualQuery(seedText: string, index: number): string {
  const idx = (mockHash(seedText) + index * 13) % VISUAL_QUERY_POOL.length;
  return VISUAL_QUERY_POOL[idx] ?? VISUAL_QUERY_POOL[0]!;
}

export interface MockScriptOptions {
  ideaTitle: string;
  targetMinutes: number;
  aiDisclosure: boolean;
}

export interface MockScriptPayload {
  script: {
    scenes: Array<{
      id: string;
      section: 'hook' | 'body' | 'cta';
      text: string;
      visual_query: string;
      emphasis?: boolean;
    }>;
    hook_notes: string;
  };
  seo: {
    titles: string[];
    description: string;
    tags: string[];
    thumbnails: Array<{ text: string; visual: string }>;
  };
}

export function mockScriptPayload(opts: MockScriptOptions): MockScriptPayload {
  const target = Math.round(opts.targetMinutes * WORDS_PER_MIN);
  const hookWords = 60;
  const ctaWords = 45;
  const bodyBase = 55;
  const bodyCount = Math.max(1, Math.round((target - hookWords - ctaWords) / bodyBase));
  let diff = target - (hookWords + ctaWords + bodyCount * bodyBase);

  const scenes: MockScriptPayload['script']['scenes'] = [];
  scenes.push({
    id: 'sc-hook',
    section: 'hook',
    text: mockWords(`${opts.ideaTitle}:hook`, hookWords),
    visual_query: pickVisualQuery(opts.ideaTitle, 0),
    emphasis: true,
  });
  for (let i = 0; i < bodyCount; i++) {
    // reparte la diferencia manteniendo cada escena en 40-70 palabras
    let sceneWords = bodyBase;
    if (diff !== 0) {
      const delta = Math.max(-15, Math.min(15, diff));
      sceneWords += delta;
      diff -= delta;
    }
    scenes.push({
      id: `sc-body-${i + 1}`,
      section: 'body',
      text: mockWords(`${opts.ideaTitle}:body:${i}`, sceneWords),
      visual_query: pickVisualQuery(opts.ideaTitle, i + 1),
    });
  }
  scenes.push({
    id: 'sc-cta',
    section: 'cta',
    text: mockWords(`${opts.ideaTitle}:cta`, ctaWords),
    visual_query: pickVisualQuery(opts.ideaTitle, bodyCount + 1),
  });

  const topic = opts.ideaTitle.replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
  const titles = [
    `Por qué ${topic} importa ahora`.slice(0, 70),
    `${capitalize(topic)}: lo que nadie te cuenta`.slice(0, 70),
    `El cambio real detrás de ${topic}`.slice(0, 70),
  ];
  const description = [
    `${capitalize(topic)} explicado sin ruido: qué acaba de pasar, qué dicen las fuentes y qué significa para quien lo usa a diario.`,
    'Primero el contexto, después los datos disponibles y al final una lectura práctica con los límites de lo que sabemos hoy.',
    'Capítulos:\n{timestamps}',
    ...(opts.aiDisclosure ? ['Contenido producido con asistencia de IA y revisión humana.'] : []),
  ].join('\n\n');
  const tags = [
    'inteligencia artificial',
    'tecnología',
    'análisis tech',
    'noticias de ia',
    'herramientas ia',
    'productividad',
    'modelos de lenguaje',
    'software',
    'innovación',
    'explicado en español',
    `${topic} explicado`.toLowerCase(),
    `qué es ${topic}`.toLowerCase(),
  ];

  return {
    script: {
      scenes,
      hook_notes: `Abre prometiendo la lectura práctica de ${topic} y la paga en el cierre con la recomendación final.`,
    },
    seo: {
      titles,
      description,
      tags,
      thumbnails: [
        { text: 'El cambio real', visual: 'primer plano de un chip con luz azul sobre fondo oscuro' },
        { text: 'Nadie lo vio', visual: 'gráfico ascendente en una pantalla dentro de una sala en penumbra' },
      ],
    },
  };
}

export function buildMockResearch(mockContext: Record<string, unknown>): unknown {
  const refs = Array.isArray(mockContext.refs)
    ? (mockContext.refs as Array<{ url?: unknown; title?: unknown; domain?: unknown }>)
    : [];
  const ideaTitle = typeof mockContext.ideaTitle === 'string' ? mockContext.ideaTitle : 'la idea';
  const sources = refs
    .filter((r): r is { url: string; title?: string; domain?: string } => typeof r.url === 'string')
    .map((r) => ({
      url: r.url,
      title: typeof r.title === 'string' ? r.title : 'Fuente del cluster',
      domain: typeof r.domain === 'string' ? r.domain : safeDomain(r.url),
      published_at: null,
    }));
  const claims = sources.slice(0, 3).map((_, i) => ({
    text: `Afirmación verificable ${i + 1} recogida en las fuentes sobre ${ideaTitle}.`,
    source_idx: i,
  }));
  return {
    sources,
    summary: mockWords(`${ideaTitle}:summary`, 320),
    claims,
    angles: [
      `Qué cambia en la práctica con ${ideaTitle}`,
      `A quién afecta primero ${ideaTitle}`,
      `Cómo aprovechar hoy ${ideaTitle}`,
    ],
  };
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'desconocido';
  }
}

export function buildMockRefine(mockContext: Record<string, unknown>): unknown {
  const scenes = Array.isArray(mockContext.scenes)
    ? (mockContext.scenes as Array<{ id?: unknown; seed?: unknown; words?: unknown }>)
    : [];
  return {
    scenes: scenes
      .filter((s): s is { id: string; seed?: string; words?: number } => typeof s.id === 'string')
      .map((s) => ({
        id: s.id,
        text: mockWords(
          typeof s.seed === 'string' ? s.seed : `${s.id}:refine`,
          typeof s.words === 'number' && s.words > 0 ? s.words : 55,
        ),
      })),
  };
}

export function registerScriptMocks(): void {
  registerMockOp('research', ({ mockContext }) => buildMockResearch(mockContext));
  registerMockOp('script', ({ mockContext }) =>
    mockScriptPayload({
      ideaTitle:
        typeof mockContext.ideaTitle === 'string' ? mockContext.ideaTitle : 'una novedad del sector',
      targetMinutes:
        typeof mockContext.targetMinutes === 'number' && mockContext.targetMinutes > 0
          ? mockContext.targetMinutes
          : 7,
      aiDisclosure: mockContext.aiDisclosure === true,
    }),
  );
  registerMockOp('judge', () => ({
    verdict: 'aligned',
    reasons: ['La promesa del título coincide con el gancho y el cierre'],
    patch_targets: [],
  }));
  registerMockOp('refine', ({ mockContext }) => buildMockRefine(mockContext));
}
