import path from 'node:path';
import { mapMasterMediaPaths, type MasterVideoJson } from '@fabrica/shared';

// Reescritura de medios previa al render (estrategia (b), ver index.ts):
// las rutas absolutas bajo LIBRARY_DIR/OUTPUTS_DIR se convierten en URLs de
// la API (/files) para que Chromium y el proxy de OffthreadVideo puedan
// cargarlas. Función pura: no muta el maestro original, que se congela en
// master.json con sus rutas locales.

export interface MediaRewriteOptions {
  libraryDir: string;
  outputsDir: string;
  // p. ej. http://127.0.0.1:3001/files
  baseUrl: string;
}

function mapUnder(absPath: string, root: string, prefix: string, baseUrl: string): string | null {
  const rel = path.relative(root, absPath);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const encoded = rel.split(path.sep).map(encodeURIComponent).join('/');
  return `${baseUrl.replace(/\/$/, '')}/${prefix}/${encoded}`;
}

export function rewriteMediaPath(mediaPath: string, opts: MediaRewriteOptions): string {
  if (/^(https?:|data:|blob:)/.test(mediaPath)) return mediaPath;
  if (!path.isAbsolute(mediaPath)) return mediaPath; // relativa → staticFile del bundle
  return (
    mapUnder(mediaPath, opts.libraryDir, 'library', opts.baseUrl) ??
    mapUnder(mediaPath, opts.outputsDir, 'outputs', opts.baseUrl) ??
    mediaPath
  );
}

export function rewriteMasterMedia(
  master: MasterVideoJson,
  opts: MediaRewriteOptions,
): MasterVideoJson {
  // la lista de campos de medio vive en shared: tres copias divergían y por
  // ese hueco salieron beats en negro y un inserto sin imagen
  return mapMasterMediaPaths(master, (p) => rewriteMediaPath(p, opts));
}
