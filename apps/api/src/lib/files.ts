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
