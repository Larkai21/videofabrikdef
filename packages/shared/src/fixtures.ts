import type { ChannelProfile } from './channel-profile.js';
import { RATIO_IMAGENES_MAX } from './constants.js';
import { renderableMasterV1, type Beat, type Cue, type MasterVideoJson } from './master-json.js';
import { recortarMaster } from './short-cut.js';
import type { ShortMasterJson } from './short-json.js';

// Fixtures compartidas: el render de humo de packages/video, los tests de
// contrato y el modo demo del dashboard usan el mismo maestro de ejemplo.

export const demoProfile: ChannelProfile = {
  version: '1',
  identity: {
    name: 'Señal y ruido',
    positioning: 'Qué acaba de salir en IA y qué puedes hacer tú con ello',
    audience: 'Profesionales curiosos sin tiempo para leer papers',
    tone: ['explicativo', 'sin hipérbole', 'concreto'],
  },
  language: 'es',
  pillars: [
    {
      name: 'Actualidad IA',
      description: 'Lanzamientos y movimientos de la semana con lectura práctica',
      example_queries: ['nuevo modelo lenguaje', 'lanzamiento openai anthropic'],
    },
    {
      name: 'Explicadores',
      description: 'Conceptos evergreen: cómo funciona X, por qué importa Y',
      example_queries: ['mixture of experts', 'coste inferencia'],
    },
  ],
  style: {
    visual_prompt_suffix: 'clean tech aesthetic, cinematic lighting, no text',
    stock_query_lang: 'en',
    banned: ['clickbait vacío', 'AGI mañana'],
    broll_imagenes_max_pct: RATIO_IMAGENES_MAX,
  },
  voice: { provider: 'edge', voice_id: 'es-ES-AlvaroNeural', rate: '-8%' },
  title_patterns: [
    {
      template: 'Por qué {X} está {verbo}',
      example: 'Por qué todos copian a DeepSeek',
      source: 'mined',
    },
    {
      template: 'El {cosa} que {consecuencia}',
      example: 'El modelo que abarató la inteligencia',
      source: 'mined',
    },
  ],
  high_cpm_topics: ['herramientas empresa', 'productividad', 'cloud'],
  flags: { packaging_first: false, ai_disclosure: true },
};

const demoScenes = [
  {
    id: 'sc-hook',
    section: 'hook' as const,
    text: 'En enero, un laboratorio chino publicó un modelo que igualaba a los grandes por una fracción del presupuesto. La noticia no fue el modelo. Fue el precio.',
    visual_query: 'server room aisle cold blue lights',
  },
  {
    id: 'sc-body-1',
    section: 'body' as const,
    text: 'Para entenderlo basta con mirar dos números. Uno explica quién puede entrenar un modelo; el otro, quién puede permitirse ejecutarlo todos los días.',
    visual_query: 'data chart on screen close up',
  },
  {
    id: 'sc-body-2',
    section: 'body' as const,
    text: 'Cuando el precio por millón de tokens cae un orden de magnitud, dejan de existir productos imposibles y empiezan a existir productos aburridos y rentables.',
    visual_query: 'hands typing code macro keyboard',
  },
  {
    id: 'sc-cta',
    section: 'cta' as const,
    text: 'Si te ha servido, suscríbete. La semana que viene: quién paga la factura de todo esto.',
    visual_query: 'city night timelapse traffic lights',
  },
];

function demoCuesFor(beats: Beat[]): Cue[] {
  const cues: Cue[] = [];
  for (const beat of beats) {
    const words = beat.text.split(/\s+/).filter(Boolean);
    const chunkSize = 6;
    const chunks: string[][] = [];
    for (let i = 0; i < words.length; i += chunkSize) chunks.push(words.slice(i, i + chunkSize));
    const per = (beat.to_ms - beat.from_ms) / Math.max(1, chunks.length);
    chunks.forEach((chunk, ci) => {
      const from = Math.round(beat.from_ms + ci * per);
      const to = Math.round(beat.from_ms + (ci + 1) * per);
      const wordDur = (to - from) / chunk.length;
      cues.push({
        from_ms: from,
        to_ms: to,
        text: chunk.join(' '),
        words: chunk.map((w, wi) => ({
          from_ms: Math.round(from + wi * wordDur),
          to_ms: Math.round(from + (wi + 1) * wordDur),
          w,
        })),
      });
    });
  }
  return cues;
}

export interface DemoMasterOptions {
  audioPath?: string;
  // rutas a un clip y una imagen locales para los beats; sin ellas los beats
  // quedan sin asset (válido para el maestro progresivo, no para render)
  clipPath?: string;
  imagePath?: string;
}

export function makeDemoMaster(opts: DemoMasterOptions = {}): MasterVideoJson {
  const durations = [11_000, 12_500, 10_000, 9_500];
  let t = 0;
  const beats: Beat[] = demoScenes.map((scene, idx) => {
    const from = t;
    const to = t + (durations[idx] ?? 10_000);
    t = to;
    const useImage = idx % 2 === 1;
    const path = useImage ? opts.imagePath : opts.clipPath;
    return {
      idx,
      from_ms: from,
      to_ms: to,
      text: scene.text,
      visual_query: scene.visual_query,
      status: path ? 'locked' : 'pending',
      ...(path
        ? {
            asset: {
              id: `demo-asset-${idx}`,
              kind: useImage ? ('image' as const) : ('clip' as const),
              path,
              fit: useImage ? { mode: 'kenburns' as const } : { mode: 'loop' as const, loops: 3 },
            },
          }
        : {}),
    };
  });

  const totalMs = t;

  return {
    version: '1',
    video: {
      id: 'demo-video',
      channel_id: 'demo-channel',
      idea_id: 'demo-idea',
      fps: 30,
      width: 1920,
      height: 1080,
    },
    script: {
      scenes: demoScenes,
      hook_notes: 'Abre con el precio, paga con quién cobra al final.',
    },
    seo: {
      titles: [
        'Por qué todos copian a DeepSeek',
        'El modelo que abarató la inteligencia',
        'Copiar ya no es trampa: es la estrategia',
      ],
      chosen_idx: 0,
      description:
        'El precio por token cayó un orden de magnitud y cambió quién puede competir.\n\nCapítulos:\n{timestamps}',
      tags: ['deepseek', 'ia', 'modelos de lenguaje', 'coste por token'],
      thumbnails: [
        { text: 'Todos copian', visual: 'logo partido en dos con fondo de sala de servidores' },
        { text: '10× más barato', visual: 'gráfico cayendo con luz azul' },
      ],
    },
    ...(opts.audioPath ? { audio: { path: opts.audioPath, duration_ms: totalMs, lufs: -16 } } : {}),
    cues: demoCuesFor(beats),
    beats,
    brand: { components: { subtitle_theme: 'subtitulos-basicos@0.1.0' } },
    costs: { total_usd: 0, by_provider: {} },
  };
}

export interface DemoShortOptions extends DemoMasterOptions {
  /** ventana a recortar; por defecto los beats 1 y 2 del maestro de demo */
  from_ms?: number;
  to_ms?: number;
}

/**
 * Maestro de SHORT de ejemplo, recortado del maestro largo de demo con el
 * mismo `recortarMaster` que usa producción. Es dogfooding a propósito: si el
 * contrato del recorte se rompe, el humo del render vertical se entera.
 */
export function makeDemoShort(opts: DemoShortOptions = {}): ShortMasterJson {
  // rutas por defecto: un short SIN assets resueltos no pasa renderableShortV1,
  // y esta fixture existe para ser un short válido (la usan el humo vertical,
  // los defaultProps de la composición y los tests de la tabla)
  const master = makeDemoMaster({
    audioPath: opts.audioPath ?? 'demo-audio.wav',
    clipPath: opts.clipPath ?? 'demo-clip.mp4',
    imagePath: opts.imagePath ?? 'demo-image.jpg',
  });
  const beats = master.beats ?? [];
  const from = opts.from_ms ?? beats[1]?.from_ms ?? 0;
  const to = opts.to_ms ?? beats[2]?.to_ms ?? 30_000;
  return recortarMaster(renderableMasterV1.parse(master), {
    id: 'demo-short',
    from_ms: from,
    to_ms: to,
    title: 'El precio que lo cambió',
    hook: 'El coste por token cayó un orden de magnitud en un año',
    reason: 'Cifra concreta y contraintuitiva, se entiende sin el contexto anterior',
    score: 82,
  });
}
