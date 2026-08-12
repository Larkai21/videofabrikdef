import { z } from 'zod';

// Ledger de costes (docs/contratos.md §5). El worker escribe la fila ANTES de
// la llamada (status pending) y la completa con la respuesta.

export const COST_PROVIDERS = [
  'openai',
  'openrouter',
  'edge-tts',
  'elevenlabs',
  'pexels',
  'pixabay',
  'fal',
  'youtube',
  // binario del sistema para descargar episodios externos (clipping); coste 0,
  // se apunta para vigilar bytes/disco igual que tts vigila caracteres
  'yt-dlp',
] as const;

export const costProviderSchema = z.enum(COST_PROVIDERS);
export type CostProvider = z.infer<typeof costProviderSchema>;

export const COST_OPERATIONS = [
  'script',
  // paquete SEO (títulos, descripción, tags, miniaturas) en llamada aparte del
  // guion: son dos oficios distintos y mezclarlos restaba foco a los dos
  'packaging',
  'judge',
  'refine',
  'research',
  'idea_writeup',
  'profile_synthesis',
  'broll_director',
  // relectura de los finalistas por un modelo que LEE los pies de foto: el
  // coseno mete los seis candidatos de un beat en 0,037 y no los separa
  'broll_rerank',
  // qué buscar en lugar de una consulta cuyo pool entero vetó el juez; llamada
  // aparte del veredicto para no volverlo veto-feliz (medido en el banco)
  'broll_requery',
  'chapter_director',
  'editing_director',
  // elige qué fragmentos del vídeo largo funcionan solos como short vertical
  'shorts_director',
  'vlm_caption',
  'component_author',
  'thumbnail_brief',
  'tts',
  'search',
  'flux_schnell',
  'api',
  // ---- clipping (episodios externos) ----
  // descarga del episodio: unidades = MB, coste 0 (vigila disco y red)
  'download',
  // transcripción con word timestamps: unidades = minutos de audio
  'stt',
  // re-puntuación LLM por bloques, SOLO si el gate de probar:stt falla
  'punctuate',
  // map-reduce que elige qué ventanas del episodio funcionan como clip
  'highlights_director',
] as const;

export const costOperationSchema = z.enum(COST_OPERATIONS);
export type CostOperation = z.infer<typeof costOperationSchema>;

// Precios de referencia (SPEC §12, verificados jul-2026)
export const PRICES = {
  openai: {
    // gpt-5-mini, USD por token
    input_per_token: 0.25 / 1_000_000,
    output_per_token: 2 / 1_000_000,
    vlm_caption_per_image: 0.0005,
    // whisper-1, USD por minuto de audio (verificado ago-2026)
    stt_per_minute: 0.006,
  },
  fal: {
    flux_schnell_per_megapixel: 0.003,
  },
} as const;
