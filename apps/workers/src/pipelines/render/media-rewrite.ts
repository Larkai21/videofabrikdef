import path from 'node:path';
import type { MasterVideoJson } from '@fabrica/shared';

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
  const copy = structuredClone(master);
  if (copy.audio) copy.audio.path = rewriteMediaPath(copy.audio.path, opts);
  // avatar del canal congelado en la marca: intro/outro lo cargan como logo
  if (copy.brand?.avatar_path) {
    copy.brand.avatar_path = rewriteMediaPath(copy.brand.avatar_path, opts);
  }
  for (const beat of copy.beats ?? []) {
    if (beat.asset?.path) beat.asset.path = rewriteMediaPath(beat.asset.path, opts);
    // los sub-planos llevan su propio asset con ruta local: también se reescriben
    for (const sv of beat.visuals ?? []) {
      if (sv.asset?.path) sv.asset.path = rewriteMediaPath(sv.asset.path, opts);
    }
  }
  // el inserto de referencia lleva su imagen congelada en el propio edit: sin
  // esta reescritura la ruta absoluta llega a Chromium y la imagen no carga
  for (const edit of copy.edits ?? []) {
    if (edit.type === 'imagen_apoyo') {
      edit.image_path = rewriteMediaPath(edit.image_path, opts);
    }
  }
  return copy;
}
