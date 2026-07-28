import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ComponentManifest, ComponentType } from '@fabrica/shared';

// Constructores puros del harness de typecheck del validador de zips
// (components.validate). Separados del orquestador para poder testearlos
// sin disco ni procesos hijos.

/**
 * Tipo TS del contrato mínimo de props por tipo de componente
 * (docs/contratos.md §3). null = tipo sin contrato mínimo definido.
 * Todos los tipos con contrato reciben además `design?: DesignTokens` (los
 * tokens de color/tipografía del canal), por eso el harness importa el tipo.
 */
export function contractTsType(type: ComponentType): string | null {
  switch (type) {
    case 'subtitle_theme':
      return '{ cues: unknown[]; currentMs: number; design?: DesignTokens; safeArea: { top: number; right: number; bottom: number; left: number } }';
    case 'lower_third':
      return '{ title: string; subtitle?: string; fromFrame: number; design?: DesignTokens }';
    case 'title_card':
      return '{ title: string; fromFrame: number; design?: DesignTokens }';
    case 'transition':
      return '{ durationInFrames: number; design?: DesignTokens }';
    case 'thumbnail_template':
      return "{ text: string; image_path?: string; variant: 'a' | 'b'; design?: DesignTokens }";
    case 'intro':
    case 'outro':
      return '{ channel_name: string; logo?: string; design?: DesignTokens }';
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
import type { DesignTokens } from '@fabrica/shared';
import Component from './component/Component';
import schema from '${schemaImportPath}';

void (undefined as unknown as DesignTokens);

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
 * Config de eslint generada para la pasada de determinismo sobre el código
 * del zip (docs/render.md §4): importa el eslint.config.js REAL de
 * packages/video (misma fuente de reglas, sin duplicarlas) y re-apunta las
 * entradas con `files` (las reglas de determinismo de src/**) al componente
 * copiado en el workdir. Se ejecuta con el binario eslint de packages/video.
 */
export function buildDeterminismEslintConfig(videoEslintConfigPath: string): string {
  const configUrl = pathToFileURL(videoEslintConfigPath).href;
  return `// Config generada por components.validate — NO EDITAR: reutiliza las reglas
// de determinismo de packages/video/eslint.config.js sobre el zip del kit.
import base from '${configUrl}';

export default base.map((entry) =>
  entry !== null && typeof entry === 'object' && Array.isArray(entry.files)
    ? { ...entry, files: ['component/**/*.ts', 'component/**/*.tsx'] }
    : entry,
);
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
