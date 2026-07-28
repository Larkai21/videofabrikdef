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
import { IntroBasica } from './themes/IntroBasica';
import { OutroBasica } from './themes/OutroBasica';
import { SubtitlesBasicos } from './themes/SubtitlesBasicos';
import { TituloSeccion } from './themes/TituloSeccion';
import Kit_intro_ia_0_1_0 from './kit/intro-ia@0.1.0/Component';
import Kit_rotulo_ejemplo_1_0_0 from './kit/rotulo-ejemplo@1.0.0/Component';

export type RegisteredComponent = React.ComponentType<Record<string, unknown>>;

export const componentRegistry: Partial<
  Record<ComponentType, Record<string, RegisteredComponent>>
> = {
  intro: {
    'intro-basica@0.1.0': IntroBasica as unknown as RegisteredComponent,
    'intro-ia@0.1.0': Kit_intro_ia_0_1_0 as unknown as RegisteredComponent,
  },
  outro: {
    'outro-basica@0.1.0': OutroBasica as unknown as RegisteredComponent,
  },
  title_card: {
    'titulo-seccion@0.1.0': TituloSeccion as unknown as RegisteredComponent,
  },
  lower_third: {
    'rotulo-ejemplo@1.0.0': Kit_rotulo_ejemplo_1_0_0 as unknown as RegisteredComponent,
  },
  subtitle_theme: {
    'subtitulos-basicos@0.1.0': SubtitlesBasicos as unknown as RegisteredComponent,
  },
};

// Metadatos del manifest por ref (fixed_duration_frames de intro/outro/
// transition): el render no consulta la BD, las duraciones fijas viven aquí.
export interface KitComponentMeta {
  fixed_duration_frames?: number;
}

export const componentMeta: Record<string, KitComponentMeta> = {
  'intro-basica@0.1.0': { fixed_duration_frames: 60 },
  'intro-ia@0.1.0': { fixed_duration_frames: 90 },
  'outro-basica@0.1.0': { fixed_duration_frames: 90 },
  'rotulo-ejemplo@1.0.0': {},
  'subtitulos-basicos@0.1.0': {},
  'titulo-seccion@0.1.0': {},
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
