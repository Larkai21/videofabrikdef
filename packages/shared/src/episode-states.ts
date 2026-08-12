import { z } from 'zod';

// Máquina de estados de un EPISODIO externo (podcast/directo de terceros del
// que se recortan clips). Espejo de la de shorts: toda transición pasa por la
// API, los workers piden transiciones y nunca las deciden.
//
// Un episodio NO es un vídeo de la fábrica: no nace de una idea del radar, no
// tiene guion ni SEO, y su material no entra en `assets` (la cascada y su
// semántica de licencia son para material licenciado reutilizable; un clip
// ajeno no lo es). Por eso tabla y máquina propias en vez de aflojar
// videos.idea_id.

export const EPISODE_STATES = [
  'nuevo',
  'descargando',
  'transcribiendo',
  // descargado + transcrito + beats calculados: listo para proponer clips
  'listo',
  // el mp4 grande se purga (quedan wav + transcript); los clips ya propuestos
  // conservan su segmento pre-cortado, así que archivar no los rompe
  'archivado',
  'incidencia',
] as const;

export const episodeStateSchema = z.enum(EPISODE_STATES);
export type EpisodeState = z.infer<typeof episodeStateSchema>;

export const EPISODE_TRANSITIONS: Record<EpisodeState, readonly EpisodeState[]> = {
  nuevo: ['descargando', 'incidencia'],
  descargando: ['transcribiendo', 'incidencia'],
  transcribiendo: ['listo', 'incidencia'],
  listo: ['archivado', 'incidencia'],
  archivado: [],
  // reintentar = volver al estado en el que se falló (state_before_incident)
  incidencia: ['nuevo', 'descargando', 'transcribiendo', 'listo'],
};

export function canTransitionEpisode(from: EpisodeState, to: EpisodeState): boolean {
  return EPISODE_TRANSITIONS[from].includes(to);
}

export const EPISODE_PLATFORMS = ['youtube', 'twitch'] as const;
export const episodePlatformSchema = z.enum(EPISODE_PLATFORMS);
export type EpisodePlatform = z.infer<typeof episodePlatformSchema>;

/**
 * Estado de derechos del material. `ajeno_sin_acuerdo` es el defecto honesto
 * del modelo de canal de clips: se convive con reclamaciones (Content ID), se
 * atribuye SIEMPRE en la descripción y se retira si el creador lo pide.
 * Explícitamente no existe ninguna mecánica anti-detección.
 */
export const EPISODE_LICENSES = ['ajeno_sin_acuerdo', 'permiso', 'propio'] as const;
export const episodeLicenseSchema = z.enum(EPISODE_LICENSES);
export type EpisodeLicense = z.infer<typeof episodeLicenseSchema>;

/** Una reclamación registrada a mano: el historial de defensa del episodio. */
export const episodeClaimSchema = z.object({
  date: z.string(),
  kind: z.enum(['content_id', 'manual', 'peticion_creador']),
  short_id: z.string().optional(),
  action: z.string(),
  note: z.string().optional(),
});
export type EpisodeClaim = z.infer<typeof episodeClaimSchema>;
