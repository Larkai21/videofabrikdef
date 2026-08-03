import { z } from 'zod';

// Telemetría de rendimiento de un vídeo YA PUBLICADO, importada a mano del CSV
// de YouTube Studio (el MVP no toca la YouTube API — principio 7). Sin esto,
// todo lo que produce la fábrica se itera a ciegas: es la pieza que convierte
// el gusto en datos. La forma es deliberadamente pequeña: las cinco cifras que
// cambian decisiones (¿el gancho retiene? ¿el título atrae?) y nada más.

export const videoMetricsSchema = z.object({
  /** cuándo se importó (ISO); el CSV no trae fecha de corte fiable */
  imported_at: z.string(),
  source: z.literal('yt-studio-csv'),
  views: z.number().nonnegative().optional(),
  impressions: z.number().nonnegative().optional(),
  /** CTR de impresiones, en % (0-100) */
  ctr_pct: z.number().nonnegative().optional(),
  /** duración media de visualización, en segundos */
  avg_view_duration_s: z.number().nonnegative().optional(),
  /** % medio del vídeo visto (0-100), si el export lo trae */
  avg_pct_viewed: z.number().nonnegative().optional(),
  watch_hours: z.number().nonnegative().optional(),
  subscribers_gained: z.number().optional(),
});
export type VideoMetrics = z.infer<typeof videoMetricsSchema>;
