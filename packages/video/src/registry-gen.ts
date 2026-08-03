import { COMPONENT_TYPES, type ComponentType } from '@fabrica/shared';

// Generador del registry del brand kit (docs/render.md §2).
//
// MECANISMO ELEGIDO — copia dentro del paquete + import estático relativo:
// el webpack de bundle() de @remotion/bundler resuelve módulos desde el
// entry de packages/video (con el extensionAlias de bundling.ts); un import
// relativo hacia library/components/... saldría del paquete y rompería la
// resolución de react/remotion/zod bajo pnpm. Por eso el validador copia cada
// componente validado desde library/components/<canal>/<tipo>/<nombre>@<versión>/
// a src/kit/<nombre>@<versión>/ (directorio gitignorado y regenerable desde
// library/ con scripts/generate-registry.ts) y este generador emite un import
// estático relativo por entrada. Así el bundle usa el mismo webpack que el
// resto de la composición y el render solo ejecuta código del registro
// versionado: prohibido el import dinámico de rutas arbitrarias.
//
// Convención del zip: Component.tsx hace `export default` del componente.

export interface KitRegistryEntry {
  type: ComponentType;
  name: string;
  version: string;
  // fixed_duration_frames del manifest.json del zip: viaja al registry
  // generado porque las duraciones fijas NO pueden leerse de BD en render
  fixed_duration_frames?: number;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface RegistryLine {
  ref: string;
  identifier: string;
}

// Duraciones fijas de los integrados (frames a 30 fps). Los componentes leen
// la suya con useVideoConfig(): la Sequence que los monta mide exactamente esto.
// 96 = 3,2 s: con 80 (2,67 s) daba para entrar y revelar, pero no para
// SOSTENER. Ojo, la intro desplaza audio, beats, subtítulos y efectos
// (brand-kit.ts): cambiar este número mueve el montaje entero.
export const INTRO_BASICA_DURATION_FRAMES = 96;
// 450 = 15 s. La outro se monta detrás del cuerpo, así que no desplaza nada:
// solo suma al total. Era 120 (4 s) — suficiente para el cierre, pero las
// pantallas finales de YouTube exigen 5–20 s de metraje donde apoyarse: a 15 s
// el «suscríbete» hablado pasa a ser clicable y los dos marcos de la derecha
// (OutroBasica, segundo acto) dan sitio a vídeo sugerido + lista sin tapar
// nada. Espejo manual en packages/shared/src/component-manifest.ts.
export const OUTRO_BASICA_DURATION_FRAMES = 450;

// Componentes integrados en el repo (S1: tema de subtítulos; S3: intro/outro
// básicos): siempre presentes en el registry.
const BUILTINS: Array<{
  type: ComponentType;
  line: RegistryLine;
  importStmt: string;
  fixedDurationFrames?: number;
}> = [
  {
    type: 'intro',
    line: { ref: 'intro-basica@0.1.0', identifier: 'IntroBasica' },
    importStmt: "import { IntroBasica } from './themes/IntroBasica';",
    fixedDurationFrames: INTRO_BASICA_DURATION_FRAMES,
  },
  {
    type: 'outro',
    line: { ref: 'outro-basica@0.1.0', identifier: 'OutroBasica' },
    importStmt: "import { OutroBasica } from './themes/OutroBasica';",
    fixedDurationFrames: OUTRO_BASICA_DURATION_FRAMES,
  },
  {
    type: 'subtitle_theme',
    line: { ref: 'subtitulos-basicos@0.1.0', identifier: 'SubtitlesBasicos' },
    importStmt: "import { SubtitlesBasicos } from './themes/SubtitlesBasicos';",
  },
  {
    type: 'title_card',
    line: { ref: 'titulo-seccion@0.1.0', identifier: 'TituloSeccion' },
    importStmt: "import { TituloSeccion } from './themes/TituloSeccion';",
  },
  {
    type: 'lower_third',
    line: { ref: 'rotulo-basico@0.1.0', identifier: 'RotuloBasico' },
    importStmt: "import { RotuloBasico } from './themes/RotuloBasico';",
  },
];

/** Identificador TS determinista y único para un import de src/kit. */
export function kitIdentifier(name: string, version: string): string {
  return `Kit_${`${name}_${version}`.replace(/[^A-Za-z0-9]/g, '_')}`;
}

/** Ruta del directorio en src/kit para un componente (relativa al paquete). */
export function kitDirName(name: string, version: string): string {
  return `${name}@${version}`;
}

/**
 * Genera el contenido completo de src/registry.generated.ts a partir de los
 * integrados más las entradas validadas del kit. Función pura: dado el mismo
 * listado produce byte a byte el mismo archivo.
 */
// refs reservados por los componentes integrados: un zip no puede ocuparlos
export const BUILTIN_REFS: readonly string[] = BUILTINS.map((b) => b.line.ref);

/**
 * Fichero hermano SIN React: los metadatos por ref (fixed_duration_frames).
 *
 * Existe para que el worker de render pueda saber cuánto dura la intro (los
 * capítulos de description.txt tienen que sumarla) sin importar
 * registry.generated.ts, que arrastra React y todos los componentes. La
 * frontera «el worker solo importa /chapters y /bundling» se conserva.
 */
export function generateMetaSource(entries: KitRegistryEntry[]): string {
  const clean = dedupe(entries);
  const metaByRef = new Map<string, { type: ComponentType; frames: number | undefined }>();
  for (const builtin of BUILTINS) {
    metaByRef.set(builtin.line.ref, { type: builtin.type, frames: builtin.fixedDurationFrames });
  }
  for (const entry of clean) {
    metaByRef.set(`${entry.name}@${entry.version}`, {
      type: entry.type,
      frames: entry.fixed_duration_frames,
    });
  }
  const metaLines = [...metaByRef.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((ref) => {
      const m = metaByRef.get(ref)!;
      return m.frames === undefined
        ? `  '${ref}': { type: '${m.type}' },`
        : `  '${ref}': { type: '${m.type}', fixed_duration_frames: ${m.frames} },`;
    });
  return `// GENERADO por packages/video/scripts/generate-registry.ts — NO EDITAR A MANO.
// Metadatos del manifest por ref, en fichero propio y SIN imports de React:
// lo consume el worker de render (offset de capítulos) además de la
// composición. Ver registry-gen.ts (generateMetaSource).
//
// Lleva el TIPO porque el layout monta un slot solo si el ref está registrado
// BAJO ESE TIPO: un consumidor que mire solo la duración replicaría a medias la
// degradación y calcularía offsets de una intro que no se monta (reproducido:
// components.intro apuntando a una outro desplazaba los capítulos 4 s).
export interface KitComponentMeta {
  type: string;
  fixed_duration_frames?: number;
}

export const componentMeta: Record<string, KitComponentMeta> = {
${metaLines.join('\n')}
};
`;
}

// Validación + dedupe compartidos por las dos emisiones (registry y meta):
// los refs de los integrados están RESERVADOS — una entrada del kit con la
// misma name@version duplicaría la clave del mapa y machacaría sus metadatos.
function dedupe(entries: KitRegistryEntry[]): KitRegistryEntry[] {
  const seen = new Set<string>(BUILTIN_REFS);
  const clean: KitRegistryEntry[] = [];
  for (const entry of entries) {
    if (!NAME_RE.test(entry.name)) {
      throw new Error(`Nombre de componente inválido para el registry: '${entry.name}'`);
    }
    if (!SEMVER_RE.test(entry.version)) {
      throw new Error(`Versión de componente inválida para el registry: '${entry.version}'`);
    }
    if (!COMPONENT_TYPES.includes(entry.type)) {
      throw new Error(`Tipo de componente inválido para el registry: '${entry.type}'`);
    }
    if (
      entry.fixed_duration_frames !== undefined &&
      (!Number.isInteger(entry.fixed_duration_frames) || entry.fixed_duration_frames <= 0)
    ) {
      throw new Error(
        `fixed_duration_frames inválido para el registry: '${entry.name}@${entry.version}' → ${entry.fixed_duration_frames}`,
      );
    }
    const ref = `${entry.name}@${entry.version}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    clean.push(entry);
  }
  clean.sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version));
  return clean;
}

export function generateRegistrySource(entries: KitRegistryEntry[]): string {
  const clean = dedupe(entries);

  const imports: string[] = BUILTINS.map((b) => b.importStmt);
  const byType = new Map<ComponentType, RegistryLine[]>();
  for (const builtin of BUILTINS) {
    const list = byType.get(builtin.type) ?? [];
    list.push(builtin.line);
    byType.set(builtin.type, list);
  }
  for (const entry of clean) {
    const identifier = kitIdentifier(entry.name, entry.version);
    const ref = `${entry.name}@${entry.version}`;
    imports.push(
      `import ${identifier} from './kit/${kitDirName(entry.name, entry.version)}/Component';`,
    );
    const list = byType.get(entry.type) ?? [];
    list.push({ ref, identifier });
    byType.set(entry.type, list);
  }

  const typeBlocks: string[] = [];
  for (const type of COMPONENT_TYPES) {
    const lines = byType.get(type);
    if (!lines || lines.length === 0) continue;
    const inner = lines
      .map((l) => `    '${l.ref}': ${l.identifier} as unknown as RegisteredComponent,`)
      .join('\n');
    typeBlocks.push(`  ${type}: {\n${inner}\n  },`);
  }

  return `// GENERADO por packages/video/scripts/generate-registry.ts — NO EDITAR A MANO.
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
${imports.join('\n')}

export type RegisteredComponent = React.ComponentType<Record<string, unknown>>;

export const componentRegistry: Partial<
  Record<ComponentType, Record<string, RegisteredComponent>>
> = {
${typeBlocks.join('\n')}
};

// Metadatos por ref: viven en registry.meta.generated.ts (sin React) y aquí
// solo se re-exportan para los consumidores de siempre.
export { componentMeta, type KitComponentMeta } from './registry.meta.generated';

export function resolveComponent(type: ComponentType, ref: string): RegisteredComponent {
  const component = componentRegistry[type]?.[ref];
  if (!component) {
    throw new Error(
      \`Componente de brand kit no registrado: \${type} '\${ref}'. \` +
        'Solo se resuelven entradas de registry.generated.ts; valida el zip para regenerarlo.',
    );
  }
  return component;
}
`;
}
