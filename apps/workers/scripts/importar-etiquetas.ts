/**
 * Funde el .jsonl de la hoja de etiquetado al banco de planos.
 *
 *   pnpm --filter @fabrica/workers exec tsx scripts/importar-etiquetas.ts ~/Downloads/planos-etiquetados-nuevos.jsonl
 *
 * Idempotente por (video, beat): re-importar el mismo fichero no duplica filas,
 * y una etiqueta corregida SUSTITUYE a la anterior (la última gana). El banco
 * vive en calibracion/planos-etiquetados.jsonl y lo lee `pnpm rerank`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(process.cwd(), '../..');
const BANCO = path.join(RAIZ, 'calibracion', 'planos-etiquetados.jsonl');

interface Fila {
  video: string;
  beat: number;
  query: string;
  narracion: string;
  elegido: string | null;
  candidatos: { ref: string; provider: string; kind: string; caption: string; cos: number }[];
  aceptables: string[];
}

function leer(fichero: string): Fila[] {
  return readFileSync(fichero, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Fila);
}

function main(): void {
  const entrada = process.argv[2];
  if (!entrada || !existsSync(entrada)) {
    console.error('Uso: importar-etiquetas.ts <fichero.jsonl descargado de la hoja>');
    process.exitCode = 1;
    return;
  }

  const nuevas = leer(entrada);
  const invalidas = nuevas.filter(
    (f) => typeof f.video !== 'string' || !Array.isArray(f.candidatos) || !Array.isArray(f.aceptables),
  );
  if (invalidas.length > 0) {
    console.error(`${invalidas.length} filas con forma inesperada; no se importa nada.`);
    process.exitCode = 1;
    return;
  }
  // una etiqueta que marca un ref inexistente delataría un desfase entre la
  // hoja y el banco: mejor pararse que meter ruido en la métrica
  for (const f of nuevas) {
    const refs = new Set(f.candidatos.map((c) => c.ref));
    const fuera = f.aceptables.filter((r) => !refs.has(r));
    if (fuera.length > 0) {
      console.error(`${f.video}:${f.beat} marca refs que no están entre sus candidatos: ${fuera.join(', ')}`);
      process.exitCode = 1;
      return;
    }
  }

  const previas = existsSync(BANCO) ? leer(BANCO) : [];
  const porClave = new Map(previas.map((f) => [`${f.video}:${f.beat}`, f]));
  let nuevasN = 0;
  let actualizadas = 0;
  for (const f of nuevas) {
    const k = `${f.video}:${f.beat}`;
    if (porClave.has(k)) actualizadas += 1;
    else nuevasN += 1;
    porClave.set(k, f);
  }

  const salida = [...porClave.values()].sort(
    (a, b) => a.video.localeCompare(b.video) || a.beat - b.beat,
  );
  writeFileSync(BANCO, `${salida.map((f) => JSON.stringify(f)).join('\n')}\n`);

  const sinNada = salida.filter((f) => f.aceptables.length === 0).length;
  console.log(
    `Banco: ${salida.length} planos (${nuevasN} nuevos, ${actualizadas} actualizados).\n` +
      `${sinNada} con «ninguno pega» — son etiquetas legítimas y las que más enseñan.\n` +
      `Mide con: pnpm rerank    (y pnpm rerank --juez para incluir el juez LLM)`,
  );
}

main();
