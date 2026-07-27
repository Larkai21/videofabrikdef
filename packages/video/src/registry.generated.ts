import type React from 'react';
import type { ComponentType } from '@fabrica/shared';
import { SubtitlesBasicos } from './themes/SubtitlesBasicos';

// Registry de componentes del brand kit (docs/render.md §2). En S2 el
// validador de zips compila cada Component.tsx y REGENERA este archivo con
// una entrada por 'nombre@versión'. En S1 solo existe el tema de subtítulos
// integrado. PROHIBIDO el import dinámico de rutas arbitrarias: la composición
// solo resuelve componentes que figuren en este mapa generado, así el render
// es reproducible y no ejecuta código fuera del registro versionado.

export type RegisteredComponent = React.ComponentType<Record<string, unknown>>;

export const componentRegistry: Partial<
  Record<ComponentType, Record<string, RegisteredComponent>>
> = {
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
