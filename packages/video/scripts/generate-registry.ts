import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { componentTypeSchema } from '@fabrica/shared';
import { generateRegistrySource, kitDirName, type KitRegistryEntry } from '../src/registry-gen';

// Sincroniza src/kit/ y regenera src/registry.generated.ts a partir de un
// spec JSON (listado completo deseado de componentes validados). Lo invoca el
// worker components.validate como proceso hijo con el tsx de este paquete:
//   node_modules/.bin/tsx scripts/generate-registry.ts <spec.json>
// El spec es el estado completo: los directorios de src/kit que no figuren
// se eliminan (kit es una copia regenerable desde library/, ver registry-gen.ts).
//
// spec.json: { "components": [{ "type", "name", "version", "source_dir" }] }
// Salida por stdout: JSON { ok, entries, removed, skipped } (o { ok:false, error }).

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

  for (const component of spec.components) {
    const dirName = kitDirName(component.name, component.version);
    if (desired.has(dirName)) continue; // duplicado nombre@versión: primero gana
    const sourceDir = path.resolve(component.source_dir);
    if (!existsSync(path.join(sourceDir, 'Component.tsx'))) {
      skipped.push(`${dirName}: falta Component.tsx en ${sourceDir}`);
      continue;
    }
    desired.add(dirName);
    const dest = path.join(kitDir, dirName);
    rmSync(dest, { recursive: true, force: true });
    cpSync(sourceDir, dest, { recursive: true });
    entries.push({ type: component.type, name: component.name, version: component.version });
  }

  // poda: directorios del kit que ya no están en el estado deseado
  const removed: string[] = [];
  for (const item of readdirSync(kitDir, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    if (desired.has(item.name)) continue;
    rmSync(path.join(kitDir, item.name), { recursive: true, force: true });
    removed.push(item.name);
  }

  writeFileSync(registryPath, generateRegistrySource(entries));
  console.log(
    JSON.stringify({ ok: true, entries: [...desired].sort(), removed: removed.sort(), skipped }),
  );
}

try {
  main();
} catch (err) {
  console.log(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
}
