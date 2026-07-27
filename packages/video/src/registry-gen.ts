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
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

interface RegistryLine {
  ref: string;
  identifier: string;
}

// Componentes integrados en el repo (S1): siempre presentes en el registry.
const BUILTINS: Array<{ type: ComponentType; line: RegistryLine; importStmt: string }> = [
  {
    type: 'subtitle_theme',
    line: { ref: 'subtitulos-basicos@0.1.0', identifier: 'SubtitlesBasicos' },
    importStmt: "import { SubtitlesBasicos } from './themes/SubtitlesBasicos';",
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
export function generateRegistrySource(entries: KitRegistryEntry[]): string {
  const seen = new Set<string>();
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
    const ref = `${entry.name}@${entry.version}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    clean.push(entry);
  }
  clean.sort((a, b) => (a.name + a.version).localeCompare(b.name + b.version));

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
    imports.push(`import ${identifier} from './kit/${kitDirName(entry.name, entry.version)}/Component';`);
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
