import type { ShortMasterJson } from '@fabrica/shared';
import type { ComponentType } from 'react';

// El player del short monta la MISMA composición que el render SSR (Pieza,
// registrada como 'ShortForm'): lo que cambia el formato es el tamaño del
// lienzo que se le pasa, no el componente. Así lo que se previsualiza y lo que
// se renderiza no pueden divergir.
export type ShortFormProps = ShortMasterJson;

export function loadShortForm(): Promise<{ default: ComponentType<ShortFormProps> }> {
  return import('@fabrica/video').then((mod) => ({
    default: mod.Pieza as unknown as ComponentType<ShortFormProps>,
  }));
}
