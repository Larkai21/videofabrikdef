import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import type pino from 'pino';
import type { Db } from '@fabrica/db';
import { PRICES } from '@fabrica/shared';
import { closeCost, failCost, openCost } from '../lib/ledger.js';
import { mockHash } from './llm.js';

// Flux Schnell en fal.ai (docs/assets-y-biblioteca.md §5): último recurso de
// la cascada. 1280×720 (≤1 MP), 4 steps, semilla determinista por vídeo+beat.
// Sin FAL_API_KEY → PNG de color sólido derivado de la semilla (modo mock).

const FLUX_WIDTH = 1280;
const FLUX_HEIGHT = 720;
const FLUX_STEPS = 4;

export interface FluxParams {
  videoId: string;
  channelId: string | null;
  beatIdx: number;
  prompt: string;
  // varía la semilla determinista (p. ej. tras un descarte humano, para no
  // regenerar la misma imagen)
  seedSalt?: string;
  // fuerza una semilla exacta (regeneración idéntica en la ingesta)
  seed?: number;
}

export interface FluxImage {
  path: string;
  seed: number;
}

async function tmpPngPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fabrica-flux-'));
  return path.join(dir, `${randomUUID()}.png`);
}

async function generateMock(seed: number): Promise<string> {
  const color = `0x${(seed % 0xffffff).toString(16).padStart(6, '0')}`;
  const out = await tmpPngPath();
  await execa('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=${FLUX_WIDTH}x${FLUX_HEIGHT}`,
    '-frames:v',
    '1',
    out,
  ]);
  return out;
}

async function generateReal(apiKey: string, prompt: string, seed: number): Promise<string> {
  const res = await fetch('https://fal.run/fal-ai/flux/schnell', {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: { width: FLUX_WIDTH, height: FLUX_HEIGHT },
      num_inference_steps: FLUX_STEPS,
      num_images: 1,
      seed,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`fal.ai respondió HTTP ${res.status}`);
  const json = (await res.json()) as { images?: { url?: string }[] };
  const url = json.images?.[0]?.url;
  if (!url) throw new Error('fal.ai no devolvió ninguna imagen');
  const imgRes = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!imgRes.ok) throw new Error(`Descarga de imagen Flux fallida: HTTP ${imgRes.status}`);
  const out = await tmpPngPath();
  await fs.writeFile(out, Buffer.from(await imgRes.arrayBuffer()));
  return out;
}

export async function generateFluxImage(
  db: Db,
  logger: pino.Logger,
  params: FluxParams,
): Promise<FluxImage> {
  const seed = params.seed ?? mockHash(params.videoId + params.beatIdx + (params.seedSalt ?? ''));
  const apiKey = process.env.FAL_API_KEY;
  // megapíxeles facturados redondeando hacia arriba
  const megapixels = Math.ceil((FLUX_WIDTH * FLUX_HEIGHT) / 1_000_000);

  const handle = await openCost(db, {
    videoId: params.videoId,
    channelId: params.channelId,
    provider: 'fal',
    operation: 'flux_schnell',
    meta: { prompt: params.prompt.slice(0, 200), seed, mock: !apiKey },
  });
  try {
    const filePath = apiKey
      ? await generateReal(apiKey, params.prompt, seed)
      : await generateMock(seed);
    await closeCost(db, handle, {
      units: megapixels,
      unitCost: apiKey ? PRICES.fal.flux_schnell_per_megapixel : 0,
    });
    logger.info({ videoId: params.videoId, beatIdx: params.beatIdx, seed, mock: !apiKey }, 'Imagen Flux generada');
    return { path: filePath, seed };
  } catch (err) {
    await failCost(db, handle, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
