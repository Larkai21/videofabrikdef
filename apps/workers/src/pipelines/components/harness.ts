import path from 'node:path';
import type { ComponentManifest, ComponentType } from '@fabrica/shared';

// Constructores puros del harness de typecheck del validador de zips
// (components.validate). Separados del orquestador para poder testearlos
// sin disco ni procesos hijos.

/**
 * Tipo TS del contrato mínimo de props por tipo de componente
 * (docs/contratos.md §3). null = tipo sin contrato mínimo definido.
 */
export function contractTsType(type: ComponentType): string | null {
  switch (type) {
    case 'subtitle_theme':
      return '{ cues: unknown[]; currentMs: number; safeArea: { top: number; right: number; bottom: number; left: number } }';
    case 'lower_third':
      return '{ title: string; subtitle?: string; fromFrame: number }';
    case 'thumbnail_template':
      return "{ text: string; image_path?: string; variant: 'a' | 'b' }";
    case 'intro':
    case 'outro':
      return '{ channel_name: string; logo?: string }';
    default:
      return null;
  }
}

/**
 * Ruta de import del schema del zip relativa al harness (sin extensión,
 * bajo ./component/). null si la ruta del manifest sale del directorio del
 * componente o no es un módulo TS.
 */
export function schemaImportPathFor(manifest: ComponentManifest): string | null {
  const raw = manifest.props_schema.replaceAll('\\', '/');
  const normalized = path.posix.normalize(raw.startsWith('./') ? raw.slice(2) : raw);
  if (normalized.startsWith('..') || path.posix.isAbsolute(normalized)) return null;
  if (!/\.tsx?$/.test(normalized)) return null;
  return `./component/${normalized.replace(/\.tsx?$/, '')}`;
}

/**
 * Fuente del harness que compila el zip contra el contrato: el componente
 * debe aceptar las props del contrato mínimo de su tipo y las inferidas de
 * su propio schema; schema.ts debe exportar por defecto un esquema Zod.
 */
export function buildHarnessSource(type: ComponentType, schemaImportPath: string): string {
  const contract = contractTsType(type);
  const contractBlock =
    contract === null
      ? `// El tipo '${type}' aún no tiene contrato mínimo definido (docs/contratos.md §3).`
      : `// contrato mínimo del tipo '${type}' (docs/contratos.md §3)
type ContractProps = ${contract};
const componentAcceptsContract: ComponentType<ContractProps> = Component;
void componentAcceptsContract;`;

  return `// Harness generado por components.validate — typecheck real del zip contra
// el contrato de props, compilado con el tsconfig de packages/video.
import type { ComponentType } from 'react';
import type { z } from 'zod';
import Component from './component/Component';
import schema from '${schemaImportPath}';

// schema.ts debe exportar por defecto un esquema Zod
const zodSchema: z.ZodType = schema;
void zodSchema;

// las props que declara el schema deben ser aceptadas por el componente
type SchemaProps = z.infer<typeof schema>;
const componentAcceptsSchema: ComponentType<SchemaProps> = Component;
void componentAcceptsSchema;

${contractBlock}
`;
}

/**
 * tsconfig del harness: extiende el de packages/video (strict, jsx react-jsx,
 * resolución Bundler) y limita el include al harness y al componente copiado.
 */
export function buildHarnessTsconfig(videoTsconfigPath: string): string {
  return `${JSON.stringify(
    {
      extends: videoTsconfigPath,
      compilerOptions: { noEmit: true },
      include: ['harness.ts', 'component/**/*.ts', 'component/**/*.tsx'],
    },
    null,
    2,
  )}\n`;
}
