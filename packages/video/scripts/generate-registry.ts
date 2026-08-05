import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { componentTypeSchema } from '@fabrica/shared';
import {
  BUILTIN_REFS,
  generateMetaSource,
  generateRegistrySource,
  kitDirName,
  type KitRegistryEntry,
} from '../src/registry-gen';

// Sincroniza src/kit/ y regenera src/registry.generated.ts a partir de un
// spec JSON (listado completo deseado de componentes validados). Lo invoca el
// worker components.validate como proceso hijo con el tsx de este paquete:
//   node_modules/.bin/tsx scripts/generate-registry.ts <spec.json>
// El spec es el estado completo: los directorios de src/kit que no figuren
// se eliminan (kit es una copia regenerable desde library/, ver registry-gen.ts).
//
// spec.json: { "components": [{ "type", "name", "version", "source_dir" }] }
// Salida por stdout: JSON { ok, entries, removed, skipped } (o { ok:false, error }).
//
// Los ficheros generados se escriben solo si su contenido cambia: los workers
// sincronizan el registry en cada arranque y una escritura incondicional toca
// la mtime, tsx watch reinicia el worker y el arranque vuelve a sincronizar
// (bucle de reinicios infinito en `pnpm dev`).

const specSchema = z.object({
  components: z.array(
    z.object({
      type: componentTypeSchema,
      name: z.string(),
      version: z.string(),
      source_dir: z.string(),
    }),
  ),
});

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kitDir = path.join(pkgDir, 'src', 'kit');
const registryPath = path.join(pkgDir, 'src', 'registry.generated.ts');

function writeIfChanged(filePath: string, content: string): void {
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === content) return;
  writeFileSync(filePath, content);
}

// fixed_duration_frames del manifest.json del componente: se copia al mapa de
// metadatos del registry generado (el render no lee la BD). Lectura tolerante:
// un manifest ilegible deja al componente sin duración fija, nada más.
function readFixedDurationFrames(sourceDir: string): number | undefined {
  try {
    const raw = JSON.parse(readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8')) as {
      fixed_duration_frames?: unknown;
    };
    const value = raw.fixed_duration_frames;
    return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function main(): void {
  const specPath = process.argv[2];
  const spec =
    specPath === undefined
      ? { components: [] }
      : specSchema.parse(JSON.parse(readFileSync(specPath, 'utf8')));

  mkdirSync(kitDir, { recursive: true });
  const gitignorePath = path.join(kitDir, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '*\n!.gitignore\n');
  }

  const skipped: string[] = [];
  const entries: KitRegistryEntry[] = [];
  const desired = new Set<string>();

  const builtinRefs = new Set(BUILTIN_REFS);
  for (const component of spec.components) {
    const dirName = kitDirName(component.name, component.version);
    if (desired.has(dirName)) continue; // duplicado nombre@versión: primero gana
    // los refs integrados están reservados: reportado para que la validación
    // marque el componente como fallido en vez de machacarlos en silencio
    if (builtinRefs.has(`${component.name}@${component.version}`)) {
      skipped.push(`${dirName}: colisiona con un componente integrado (ref reservado)`);
      continue;
    }
    const sourceDir = path.resolve(component.source_dir);
    if (!existsSync(path.join(sourceDir, 'Component.tsx'))) {
      skipped.push(`${dirName}: falta Component.tsx en ${sourceDir}`);
      continue;
    }
    desired.add(dirName);
    const dest = path.join(kitDir, dirName);
    rmSync(dest, { recursive: true, force: true });
    cpSync(sourceDir, dest, { recursive: true });
    entries.push({
      type: component.type,
      name: component.name,
      version: component.version,
      fixed_duration_frames: readFixedDurationFrames(sourceDir),
    });
  }

  // poda: directorios del kit que ya no están en el estado deseado. El
  // ejemplo comiteado se preserva (viene de git, no de la BD: borrarlo en
  // cada arranque dejaría el clon sucio y la plantilla inutilizada)
  const PRESERVED_KIT_DIRS = new Set(['rotulo-ejemplo@1.0.0']);
  const removed: string[] = [];
  for (const item of readdirSync(kitDir, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    if (desired.has(item.name)) continue;
    if (PRESERVED_KIT_DIRS.has(item.name)) continue;
    rmSync(path.join(kitDir, item.name), { recursive: true, force: true });
    removed.push(item.name);
  }

  writeIfChanged(registryPath, generateRegistrySource(entries));
  // la meta pura (sin React) va en fichero hermano: la consume el worker de
  // render para el offset de capítulos sin arrastrar los componentes
  writeIfChanged(
    path.join(path.dirname(registryPath), 'registry.meta.generated.ts'),
    generateMetaSource(entries),
  );
  console.log(
    JSON.stringify({ ok: true, entries: [...desired].sort(), removed: removed.sort(), skipped }),
  );
}

try {
  main();
} catch (err) {
  console.log(
    JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  );
  process.exitCode = 1;
}
