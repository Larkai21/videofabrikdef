import { z } from 'zod';

// Máquina de estados del vídeo (SPEC §6). Toda transición pasa por la API;
// los workers piden transiciones, nunca las deciden.

export const VIDEO_STATES = [
  'idea',
  'idea_aprobada',
  'guion_borrador',
  'guion_ok',
  'audio',
  'assets',
  'timeline_ok',
  'render',
  'hecho',
  'incidencia',
] as const;

export const videoStateSchema = z.enum(VIDEO_STATES);
export type VideoState = z.infer<typeof videoStateSchema>;

// `incidencia` guarda aparte el estado en el que se falló (state_before_incident);
// reintentar = volver a ese estado y re-encolar su job.
export const VIDEO_TRANSITIONS: Record<VideoState, readonly VideoState[]> = {
  idea: ['idea_aprobada'],
  idea_aprobada: ['guion_borrador', 'incidencia'],
  // regenerar guion = guion_borrador → guion_borrador (nuevo borrador)
  guion_borrador: ['guion_borrador', 'guion_ok', 'incidencia'],
  guion_ok: ['audio', 'incidencia'],
  audio: ['assets', 'incidencia'],
  assets: ['timeline_ok', 'incidencia'],
  timeline_ok: ['render', 'incidencia'],
  render: ['hecho', 'incidencia'],
  hecho: [],
  incidencia: [
    'idea_aprobada',
    'guion_borrador',
    'guion_ok',
    'audio',
    'assets',
    'timeline_ok',
    'render',
  ],
};

export function canTransition(from: VideoState, to: VideoState): boolean {
  return VIDEO_TRANSITIONS[from].includes(to);
}

export const IDEA_STATUSES = ['new', 'approved', 'discarded', 'snoozed'] as const;
export const ideaStatusSchema = z.enum(IDEA_STATUSES);
export type IdeaStatus = z.infer<typeof ideaStatusSchema>;

export const BEAT_STATUSES = ['pending', 'auto_ok', 'review', 'locked'] as const;
export const beatStatusSchema = z.enum(BEAT_STATUSES);
export type BeatStatus = z.infer<typeof beatStatusSchema>;

export const ASSET_KINDS = ['clip', 'image', 'music', 'screenshot', 'upload'] as const;
export const assetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof assetKindSchema>;

// 'flux' es LEGADO: ya no se generan imágenes, pero hay assets y beats
// guardados con ese origen y el enum tiene que seguir aceptándolos.
// 'wikimedia' = Wikimedia Commons, la fuente de los insertos de referencia
// (imágenes reales de entidades con nombre; licencia y atribución por asset).
export const ASSET_SOURCES = ['pexels', 'pixabay', 'flux', 'playwright', 'upload', 'wikimedia'] as const;
export const assetSourceSchema = z.enum(ASSET_SOURCES);
export type AssetSource = z.infer<typeof assetSourceSchema>;

export const SOURCE_KINDS = [
  'rss',
  'hn',
  'reddit',
  'news',
  'web',
  'youtube',
  'arxiv',
  'github',
] as const;
export const sourceKindSchema = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof sourceKindSchema>;
