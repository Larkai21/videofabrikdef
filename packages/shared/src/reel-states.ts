import { z } from 'zod';

// Máquina de estados de un REEL: A-roll propio + guion de dirección JSON que
// el módulo editor (apps/editor: plantillas HTML+GSAP rasterizadas con
// Playwright y compuestas con ffmpeg) convierte en un vertical terminado.
//
// Un reel NO es un vídeo de la fábrica ni un clip de episodio: el material es
// PROPIO (no hay licencia que registrar), no hay TTS ni assets de stock, y el
// motor de render es otro (Playwright+ffmpeg, no Remotion). Por eso tabla y
// máquina propias — el mismo argumento que separó episodes de videos.

export const REEL_STATES = [
  'nuevo',
  // transcripción del A-roll + análisis de rostro + plan desde el guion:
  // todo lo que la máquina hace sola antes de necesitar una firma
  'preparando',
  // el plan existe y espera revisión humana: es LA puerta del pipeline
  // (editar capas del plan y aprobar; el render no arranca solo)
  'plan_listo',
  'render',
  'hecho',
  'incidencia',
] as const;

export const reelStateSchema = z.enum(REEL_STATES);
export type ReelState = z.infer<typeof reelStateSchema>;

export const REEL_TRANSITIONS: Record<ReelState, readonly ReelState[]> = {
  nuevo: ['preparando', 'incidencia'],
  preparando: ['plan_listo', 'incidencia'],
  // volver a preparando permite regenerar el plan (p. ej. tras cambiar el guion)
  plan_listo: ['render', 'preparando', 'incidencia'],
  render: ['hecho', 'incidencia'],
  hecho: [],
  // reintentar = volver al estado en el que se falló (state_before_incident)
  incidencia: ['nuevo', 'preparando', 'plan_listo', 'render'],
};

export function canTransitionReel(from: ReelState, to: ReelState): boolean {
  return REEL_TRANSITIONS[from].includes(to);
}

/** Formatos de lienzo que el motor del editor sabe rasterizar. */
export const REEL_FORMATS = ['9:16', '16:9', '1:1'] as const;
export const reelFormatSchema = z.enum(REEL_FORMATS);
export type ReelFormat = z.infer<typeof reelFormatSchema>;
