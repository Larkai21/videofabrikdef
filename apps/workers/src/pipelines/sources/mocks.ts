import { channelProfileV1, type ChannelProfile } from '@fabrica/shared';
import { mockHash, registerMockOp } from '../../providers/llm.js';

// Mock determinista de profile_synthesis: mismo nicho → mismo perfil.

const TONES: string[][] = [
  ['claro', 'directo', 'curioso'],
  ['analítico', 'sobrio', 'práctico'],
  ['cercano', 'concreto', 'riguroso'],
];

export function buildMockProfile(opts: {
  niche: string;
  language: 'es' | 'en';
}): ChannelProfile {
  const seed = mockHash(opts.niche);
  const tone = TONES[seed % TONES.length] ?? ['claro', 'directo'];
  const nicheShort = opts.niche.replace(/\s+/g, ' ').trim().split(' ').slice(0, 4).join(' ');
  const isEs = opts.language === 'es';
  return channelProfileV1.parse({
    version: '1',
    identity: {
      name: `Canal de ${nicheShort}`,
      positioning: `Novedades de ${nicheShort} explicadas con lectura práctica`,
      audience: 'Profesionales curiosos sin tiempo para seguir cada anuncio',
      tone,
    },
    language: opts.language,
    pillars: [
      {
        name: 'Actualidad',
        description: `Lanzamientos y movimientos recientes en ${nicheShort}`,
        example_queries: ['latest release announcement', 'new tool launch'],
      },
      {
        name: 'Explicadores',
        description: `Conceptos evergreen de ${nicheShort} contados desde cero`,
        example_queries: ['how it works explained', 'cost comparison analysis'],
      },
    ],
    style: {
      visual_prompt_suffix: 'clean tech aesthetic, cinematic lighting, no text',
      stock_query_lang: 'en',
      banned: ['clickbait vacío', 'promesas absolutas'],
    },
    voice: {
      provider: 'edge',
      voice_id: isEs ? 'es-ES-AlvaroNeural' : 'en-US-GuyNeural',
      rate: '-8%',
    },
    title_patterns: [
      {
        template: 'Por qué {X} está {verbo}',
        example: `Por qué ${nicheShort} está cambiando`,
        source: 'mined',
      },
      {
        template: 'El {cosa} que {consecuencia}',
        example: 'El cambio que nadie esperaba',
        source: 'mined',
      },
    ],
    high_cpm_topics: ['herramientas empresa', 'productividad', 'cloud'],
    flags: { packaging_first: false, ai_disclosure: true },
  });
}

export function registerSourcesMocks(): void {
  registerMockOp('profile_synthesis', ({ mockContext }) =>
    buildMockProfile({
      niche: typeof mockContext.niche === 'string' ? mockContext.niche : 'tecnología',
      language: mockContext.language === 'en' ? 'en' : 'es',
    }),
  );
}
