import { z } from 'zod';
import { shortStateSchema } from './short-states.js';
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
    // Presente solo si lo que se renderiza es un SHORT. El dashboard indexa el
    // progreso por video_id y pinta esa barra en la tarjeta del vídeo largo:
    // reutilizar video_id para un short encendería la barra de un vídeo ya
    // entregado. Con el id aparte, el consumidor decide y los viejos ni se
    // enteran.
    short_id: z.string().optional(),
    progress: z.number(),
    rendered_frames: z.number().optional(),
    total_frames: z.number().optional(),
  }),
  z.object({
    type: z.literal('short_state'),
    short_id: z.string(),
    video_id: z.string(),
    state: shortStateSchema,
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
    // ideas nuevas que dejó el último scoring (0 = ranking sin cambios)
    nuevas: z.number().int().min(0).optional(),
  }),
  z.object({
    type: z.literal('inbox_changed'),
  }),
  // un poll de fuente terminó: alimenta el feed en vivo del radar de ideas
  z.object({
    type: z.literal('source_poll'),
    source_id: z.string(),
    kind: z.string(),
    // null = fuente compartida entre canales
    channel_id: z.string().nullable(),
    items: z.number().int().min(0),
    nuevos: z.number().int().min(0),
    error: z.string().optional(),
  }),
]);

export type FabricaEvent = z.infer<typeof fabricaEventSchema>;
