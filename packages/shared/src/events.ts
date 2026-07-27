import { z } from 'zod';
import { videoStateSchema } from './states.js';

// Eventos que la API reemite por SSE (GET /events). Los workers los publican
// en Redis pub/sub (EVENTS_CHANNEL) y la API los reenvía al dashboard.

export const fabricaEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('video_state'),
    video_id: z.string(),
    state: videoStateSchema,
  }),
  z.object({
    type: z.literal('job_progress'),
    video_id: z.string(),
    queue: z.string(),
    // 0–100
    progress: z.number(),
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal('render_progress'),
    video_id: z.string(),
    progress: z.number(),
    rendered_frames: z.number().optional(),
    total_frames: z.number().optional(),
  }),
  z.object({
    type: z.literal('incident'),
    video_id: z.string().optional(),
    queue: z.string(),
    message: z.string(),
    suggested_action: z.enum(['reintentar', 'regenerar', 'descartar']).optional(),
  }),
  z.object({
    type: z.literal('ideas_updated'),
    channel_id: z.string(),
  }),
  z.object({
    type: z.literal('inbox_changed'),
  }),
]);

export type FabricaEvent = z.infer<typeof fabricaEventSchema>;
