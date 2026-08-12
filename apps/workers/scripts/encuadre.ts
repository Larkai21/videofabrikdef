/**
 * Banco de encuadre 9:16: mide `encuadreDe` y el foco constante contra los
 * planos etiquetados a mano.
 *
 *   pnpm --filter @fabrica/workers exec tsx scripts/encuadre.ts
 *
 * Por qué existe: la heurística de encuadre nació con precisión medida 1/3
 * («de tres disparos dos eran falsos», commit 9fcb211) y se verificó UNA vez a
 * mano sobre un vídeo. Y el foco del recorte es la constante {0.5, 0.42} para
 * todo plano: `planDeEncuadre` acepta un foco que nadie alimenta. La cultura
 * del repo prohíbe cablear una mejora sin banco: este script imprime la cifra
 * base que cualquier cambio tiene que batir.
 *
 * El banco (calibracion/encuadres-etiquetados.jsonl) congela los INSUMOS
 * (width/height/kind/caption/tags) además de la etiqueta: sobrevive a que un
 * asset se re-describa o se purgue de la BD.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { encuadreDe, type ShortFraming } from '@fabrica/shared';

const RAIZ = path.resolve(process.cwd(), '../..');
const BANCO = path.join(RAIZ, 'calibracion', 'encuadres-etiquetados.jsonl');

interface Fila {
  path: string;
  width: number | null;
  height: number | null;
  kind: string | null;
  caption: string;
  tags: string[] | null;
  etiqueta: ShortFraming;
  foco: 'izq' | 'centro' | 'dcha';
}

if (!existsSync(BANCO)) {
  console.error(`No está ${BANCO}. Etiqueta primero (ver docs/shorts.md).`);
  process.exit(1);
}

const filas = readFileSync(BANCO, 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as Fila);

let aciertos = 0;
const confusion = new Map<string, number>();
for (const f of filas) {
  const pred = encuadreDe(f);
  if (pred === f.etiqueta) aciertos += 1;
  else {
    const k = `${f.etiqueta} → ${pred}`;
    confusion.set(k, (confusion.get(k) ?? 0) + 1);
    console.log(`  ✗ ${k.padEnd(20)} ${path.basename(f.path)}  «${f.caption.slice(0, 60)}»`);
  }
}

console.log(`\nencuadreDe: ${aciertos}/${filas.length} (${((100 * aciertos) / filas.length).toFixed(0)} %)`);
for (const [k, n] of [...confusion.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)} ${n}`);
}

// El foco constante {x: 0.5}: ¿cuántos planos recortados tienen de verdad el
// sujeto en el tercio central? Los etiquetados izq/dcha son los que el recorte
// centrado corta mal HOY. No hay heurística que medir todavía: esta cifra es
// el techo de mejora de cualquier foco por asset.
const recortados = filas.filter((f) => f.etiqueta === 'recorte');
const porTercio = { izq: 0, centro: 0, dcha: 0 };
for (const f of recortados) porTercio[f.foco] += 1;
const centroOk = porTercio.centro;
console.log(
  `\nfoco constante {0.5}: acierta ${centroOk}/${recortados.length} recortes (${((100 * centroOk) / Math.max(1, recortados.length)).toFixed(0)} %)`,
);
console.log(`  reparto real del sujeto  izq ${porTercio.izq} · centro ${porTercio.centro} · dcha ${porTercio.dcha}`);
if (porTercio.izq + porTercio.dcha > 0) {
  console.log(
    `  → ${porTercio.izq + porTercio.dcha} planos pierden el sujeto con el recorte centrado: es el techo de mejora de un foco por asset`,
  );
}
