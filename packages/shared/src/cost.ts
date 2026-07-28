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
] as const;

export const costProviderSchema = z.enum(COST_PROVIDERS);
export type CostProvider = z.infer<typeof costProviderSchema>;

export const COST_OPERATIONS = [
  'script',
  'judge',
  'refine',
  'research',
  'idea_writeup',
  'profile_synthesis',
  'broll_director',
  'chapter_director',
  'vlm_caption',
  'tts',
  'search',
  'flux_schnell',
  'api',
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
  },
  fal: {
    flux_schnell_per_megapixel: 0.003,
  },
} as const;
