import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { componentTypeSchema } from '@fabrica/shared';
import { checkPropsContract, samplePropsFor } from '../src/kit-contract';

// Comprueba el contrato de props de un schema.ts del brand kit. Lo invoca el
// worker components.validate como proceso hijo con el tsx de este paquete:
//   node_modules/.bin/tsx scripts/check-contract.ts <ruta/schema.ts> <tipo>
// IMPORTANTE: la ruta debe estar DENTRO de packages/video (el validador copia
// el zip a .kit-validate/) para que el import de 'zod' resuelva bajo pnpm.
// Salida por stdout: JSON { ok, reason?, sample } — siempre exit 0 salvo
// error de uso; el resultado de negocio viaja en el JSON.

async function main(): Promise<void> {
  const [schemaPath, rawType] = process.argv.slice(2);
  if (schemaPath === undefined || rawType === undefined) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: 'uso: check-contract.ts <ruta/schema.ts> <tipo de componente>',
      }),
    );
    return;
  }
  const parsedType = componentTypeSchema.safeParse(rawType);
  if (!parsedType.success) {
    console.log(JSON.stringify({ ok: false, reason: `tipo de componente desconocido: ${rawType}` }));
    return;
  }
  const type = parsedType.data;

  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(path.resolve(schemaPath)).href)) as { default?: unknown };
  } catch (err) {
    console.log(
      JSON.stringify({
        ok: false,
        reason: `no se pudo importar schema.ts: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
    return;
  }

  const result = checkPropsContract(mod.default, type);
  console.log(JSON.stringify({ ...result, sample: samplePropsFor(type) }));
}

await main();
