import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// apps/workers/src/lib → raíz del repo (4 niveles arriba)
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

let loaded = false;
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = path.join(REPO_ROOT, '.env');
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch {
      // variables ya definidas en el entorno tienen prioridad
    }
  }
}

export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export function resolveDataDir(name: 'LIBRARY_DIR' | 'OUTPUTS_DIR'): string {
  const raw = process.env[name] ?? (name === 'LIBRARY_DIR' ? 'library' : 'outputs');
  return path.isAbsolute(raw) ? raw : path.join(REPO_ROOT, raw);
}
