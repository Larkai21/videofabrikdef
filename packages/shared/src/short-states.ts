import { z } from 'zod';

// Máquina de estados de un SHORT. Es propia y no una extensión de la del vídeo:
// `VIDEO_TRANSITIONS.hecho = []` es la garantía de que un vídeo entregado no se
// vuelve a mover, y un short existe justamente DESPUÉS de esa entrega. Darle
// salidas a `hecho` para dar cabida a los shorts destruiría esa garantía para
// todo el pipeline.

export const SHORT_STATES = [
  'propuesto',
  'aprobado',
  'render',
  'hecho',
  'descartado',
  'incidencia',
] as const;

export const shortStateSchema = z.enum(SHORT_STATES);
export type ShortState = z.infer<typeof shortStateSchema>;

export const SHORT_TRANSITIONS: Record<ShortState, readonly ShortState[]> = {
  propuesto: ['aprobado', 'descartado', 'incidencia'],
  aprobado: ['render', 'descartado', 'incidencia'],
  render: ['hecho', 'incidencia'],
  // terminales los dos: un short entregado no se mueve, y uno descartado se
  // sustituye pidiendo otra propuesta, no resucitando la anterior
  hecho: [],
  descartado: [],
  incidencia: ['aprobado', 'render', 'descartado'],
};

export function canTransitionShort(from: ShortState, to: ShortState): boolean {
  return SHORT_TRANSITIONS[from].includes(to);
}
