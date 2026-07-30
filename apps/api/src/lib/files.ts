import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { resolveDataDir } from './env.js';

// El dashboard recibe SIEMPRE URLs /files/..., nunca rutas de disco.
// Mapea una ruta absoluta bajo OUTPUTS_DIR o LIBRARY_DIR a su URL pública;
// si la ruta no cae bajo ninguno de los dos, se devuelve tal cual.
export function toFileUrl(absPath: string): string {
  const norm = path.resolve(absPath);
  const roots: Array<[string, string]> = [
    [resolveDataDir('OUTPUTS_DIR'), '/files/outputs/'],
    [resolveDataDir('LIBRARY_DIR'), '/files/library/'],
  ];
  for (const [root, prefix] of roots) {
    const rel = path.relative(root, norm);
    if (rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      return prefix + rel.split(path.sep).join('/');
    }
  }
  return absPath;
}

// URL /files de la miniatura oficial de un vídeo: la subida por el humano
// (thumb_custom.*) gana; si no, la auto-generada thumb_a.jpg; null si aún no
// hay ninguna. La usan la ficha del vídeo y la galería de la bandeja.
export async function officialThumbnailUrl(outputsDir: string, id: string): Promise<string | null> {
  let entries: string[] = [];
  try {
    entries = await readdir(path.join(outputsDir, id));
  } catch {
    return null;
  }
  const custom = entries.find((e) => /^thumb_custom\.(png|jpg|jpeg|webp)$/i.test(e));
  if (custom !== undefined) return `/files/outputs/${id}/${custom}`;
  if (entries.includes('thumb_a.jpg')) return `/files/outputs/${id}/thumb_a.jpg`;
  return null;
}
