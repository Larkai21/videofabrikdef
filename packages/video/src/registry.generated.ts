// GENERADO por packages/video/scripts/generate-registry.ts — NO EDITAR A MANO.
// Mecanismo (docs/render.md §2): el validador de zips copia cada componente
// validado desde library/components/<canal>/<tipo>/<nombre>@<versión>/ a
// src/kit/<nombre>@<versión>/ (gitignorado, regenerable desde library/) y
// regenera este archivo con un import estático relativo por entrada. El
// bundle() de @remotion/bundler resuelve así los componentes con el mismo
// webpack que el resto de la composición; la composición solo resuelve
// componentes de este mapa generado (render reproducible, sin imports
// dinámicos de rutas arbitrarias). Si src/kit falta (clon nuevo), reencola
// components.validate o ejecuta scripts/generate-registry.ts con el listado.
import type React from 'react';
import type { ComponentType } from '@fabrica/shared';
import { SubtitlesBasicos } from './themes/SubtitlesBasicos';
import Kit_rotulo_ejemplo_1_0_0 from './kit/rotulo-ejemplo@1.0.0/Component';

export type RegisteredComponent = React.ComponentType<Record<string, unknown>>;

export const componentRegistry: Partial<
  Record<ComponentType, Record<string, RegisteredComponent>>
> = {
  lower_third: {
    'rotulo-ejemplo@1.0.0': Kit_rotulo_ejemplo_1_0_0 as unknown as RegisteredComponent,
  },
  subtitle_theme: {
    'subtitulos-basicos@0.1.0': SubtitlesBasicos as unknown as RegisteredComponent,
  },
};

export function resolveComponent(type: ComponentType, ref: string): RegisteredComponent {
  const component = componentRegistry[type]?.[ref];
  if (!component) {
    throw new Error(
      `Componente de brand kit no registrado: ${type} '${ref}'. ` +
        'Solo se resuelven entradas de registry.generated.ts; valida el zip para regenerarlo.',
    );
  }
  return component;
}
