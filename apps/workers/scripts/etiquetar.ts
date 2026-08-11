/**
 * Etiquetado del conjunto de calibración del b-roll.
 *
 *   pnpm --filter @fabrica/workers exec tsx scripts/etiquetar.ts preparar
 *   pnpm --filter @fabrica/workers exec tsx scripts/etiquetar.ts            (etiquetar)
 *   pnpm --filter @fabrica/workers exec tsx scripts/etiquetar.ts curva
 *
 * Por qué existe: `constants.ts` dice por escrito que T_AUTO/T_REV/T_STOCK están
 * «calibrados a ojo» y que hay que etiquetar ~50 beats a mano. Sin ese conjunto,
 * cualquier cambio en el ranking del b-roll es una opinión. Y no hay señal
 * humana de la que partir: de 181 beats curados, cero descartes.
 *
 * La etiqueta es del PAR (consulta, fotograma), no del coseno: cambiar el modelo
 * de embeddings o el texto que se embebe recalcula cosenos pero no invalida ni
 * una etiqueta. Por eso `pares.jsonl` guarda el par completo.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const RAIZ = path.resolve(process.cwd(), '../..');
const DIR = path.join(RAIZ, 'calibracion');
const POOL = path.join(DIR, 'stock-pool.jsonl');
const PARES = path.join(DIR, 'pares.jsonl');
const ETIQUETAS = path.join(DIR, 'etiquetas.jsonl');

interface Candidato {
  ref: string;
  thumb_url?: string;
  meta?: { caption?: string; title?: string; kind?: string };
}
interface Par {
  id: string;
  query: string;
  ref: string;
  caption: string;
  thumb: string;
  banda: 'baja' | 'media' | 'alta';
}

/** Hash determinista, para barajar con semilla fija y que el orden sea estable. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function preparar(porConsulta: number, consultas: number): void {
  if (!existsSync(POOL)) {
    console.error(
      `No está ${POOL}. Es el volcado de stock_cache; sin él no hay nada que etiquetar.`,
    );
    process.exit(1);
  }
  const filas = readFileSync(POOL, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { query_norm: string; results?: Candidato[] });

  // solo consultas con candidatos ya descritos: el caption es lo que se juzga
  const utiles = filas
    .map((f) => ({
      query: f.query_norm,
      cands: (f.results ?? []).filter(
        (c) => (c.meta?.caption ?? '') !== '' && (c.thumb_url ?? '') !== '',
      ),
    }))
    .filter((f) => f.cands.length > 0);

  // orden estable por hash: dos ejecuciones producen el mismo conjunto
  utiles.sort((a, b) => hash(a.query) - hash(b.query));

  const pares: Par[] = [];
  for (const u of utiles.slice(0, consultas)) {
    for (const c of u.cands.slice(0, porConsulta)) {
      pares.push({
        id: `${u.query}::${c.ref}`,
        query: u.query,
        ref: c.ref,
        caption: c.meta?.caption ?? '',
        thumb: c.thumb_url ?? '',
        // la banda se rellena al calcular la curva, cuando hay cosenos frescos
        banda: 'media',
      });
    }
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(PARES, pares.map((p) => JSON.stringify(p)).join('\n') + '\n');
  console.log(
    `${pares.length} pares de ${Math.min(consultas, utiles.length)} consultas → ${PARES}`,
  );
  console.log('Ahora: pnpm --filter @fabrica/workers exec tsx scripts/etiquetar.ts');
}

function yaEtiquetados(): Set<string> {
  if (!existsSync(ETIQUETAS)) return new Set();
  return new Set(
    readFileSync(ETIQUETAS, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => (JSON.parse(l) as { par_id: string }).par_id),
  );
}

async function etiquetar(): Promise<void> {
  // El prompt del harness de agentes ejecuta comandos SIN stdin interactivo:
  // la primera pregunta quedaba colgada y Node moría con «unsettled top-level
  // await». Mejor decirlo que morir raro.
  if (!stdin.isTTY) {
    console.error(
      'Esta sesión no es interactiva. Abre una terminal normal y corre:\n' +
        '  cd apps/workers && npx tsx scripts/etiquetar.ts',
    );
    process.exit(1);
  }
  if (!existsSync(PARES)) {
    console.error('No hay pares. Ejecuta primero: etiquetar.ts preparar');
    process.exit(1);
  }
  const pares = readFileSync(PARES, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Par);
  const hechos = yaEtiquetados();
  const pendientes = pares.filter((p) => !hechos.has(p.id));
  if (pendientes.length === 0) {
    console.log(`Todo etiquetado: ${hechos.size} pares. Ahora: etiquetar.ts curva`);
    return;
  }

  console.log(`${pendientes.length} pendientes de ${pares.length}.`);
  console.log('La pregunta es siempre la misma: ¿este plano ILUSTRA lo que se busca?');
  console.log('[s] sí · [n] no · [d] duda · [q] salir (se guarda lo hecho)\n');

  const rl = createInterface({ input: stdin, output: stdout });
  let n = 0;
  for (const p of pendientes) {
    n += 1;
    console.log(`\n[${n}/${pendientes.length}]  ${p.thumb}`);
    console.log(`   busca : ${p.query}`);
    console.log(`   plano : ${p.caption}`);
    const r = (await rl.question('   ¿ilustra? ')).trim().toLowerCase();
    if (r === 'q') break;
    if (!['s', 'n', 'd'].includes(r)) {
      console.log('   (respuesta no reconocida, se salta)');
      continue;
    }
    appendFileSync(
      ETIQUETAS,
      JSON.stringify({ par_id: p.id, etiqueta: r, ts: new Date().toISOString() }) + '\n',
    );
  }
  rl.close();
  console.log(`\nEtiquetados en total: ${yaEtiquetados().size}`);
}

/**
 * Curva precisión/cobertura sobre el conjunto etiquetado, con los cosenos
 * RECALCULADOS con el camino de código actual. Así el conjunto sobrevive a
 * cambiar el modelo o el texto que se embebe.
 */
async function curva(): Promise<void> {
  const { createEmbeddings } = await import('../src/providers/embeddings.js');
  const { loadEnv } = await import('../src/lib/env.js');
  loadEnv();
  if (!existsSync(ETIQUETAS)) {
    console.error('No hay etiquetas todavía.');
    process.exit(1);
  }
  const pares = new Map(
    readFileSync(PARES, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Par)
      .map((p) => [p.id, p]),
  );
  const etiquetas = readFileSync(ETIQUETAS, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { par_id: string; etiqueta: string })
    .filter((e) => e.etiqueta !== 'd');

  const embeddings = createEmbeddings(console as never);
  // --pasaje: experimento A del plan de matching — captions con prefijo
  // 'passage: ' (asimetría e5) en vez del 'query: ' uniforme de producción.
  // Solo cambia cómo se MIDE aquí; adoptarlo exigiría re-embeber la biblioteca.
  const pasaje = process.argv.includes('--pasaje');
  if (pasaje) console.log('(variante: captions con prefijo passage:)');
  const muestras: Array<{ cos: number; bueno: boolean }> = [];
  for (const e of etiquetas) {
    const p = pares.get(e.par_id);
    if (!p) continue;
    const [q] = await embeddings.embed([p.query]);
    const [c] = await embeddings.embed([p.caption], pasaje ? 'passage' : 'query');
    if (!q || !c) continue;
    let dot = 0;
    for (let i = 0; i < q.length; i += 1) dot += (q[i] ?? 0) * (c[i] ?? 0);
    muestras.push({ cos: dot, bueno: e.etiqueta === 's' });
  }
  if (muestras.length === 0) {
    console.error('Sin muestras utilizables.');
    process.exit(1);
  }

  const buenos = muestras.filter((m) => m.bueno).length;
  console.log(
    `\n${muestras.length} muestras · ${buenos} relevantes (${((buenos / muestras.length) * 100).toFixed(0)} %)\n`,
  );
  console.log('  t     precisión  cobertura  n≥t');
  for (let t = 0.75; t <= 0.95001; t += 0.01) {
    const sobre = muestras.filter((m) => m.cos >= t);
    const prec = sobre.length === 0 ? NaN : sobre.filter((m) => m.bueno).length / sobre.length;
    const cob = muestras.filter((m) => m.cos < t).length / muestras.length;
    console.log(
      `  ${t.toFixed(2)}   ${Number.isNaN(prec) ? '  —  ' : (prec * 100).toFixed(0).padStart(4)} %    ${(cob * 100).toFixed(0).padStart(4)} %   ${String(sobre.length).padStart(3)}`,
    );
  }
  // AUC por el estadístico de Mann-Whitney: ¿separa la señal, en absoluto?
  const pos = muestras.filter((m) => m.bueno).map((m) => m.cos);
  const neg = muestras.filter((m) => !m.bueno).map((m) => m.cos);
  if (pos.length > 0 && neg.length > 0) {
    let mejores = 0;
    for (const a of pos) for (const b of neg) mejores += a > b ? 1 : a === b ? 0.5 : 0;
    const auc = mejores / (pos.length * neg.length);
    console.log(`\nAUC = ${auc.toFixed(3)}`);
    if (auc < 0.7) {
      console.log(
        '→ por debajo de 0,70 la señal NO separa: no publiques umbral, arregla el ranking.',
      );
    }
  }
}

const cmd = process.argv[2] ?? 'etiquetar';
if (cmd === 'preparar') preparar(Number(process.argv[3] ?? 4), Number(process.argv[4] ?? 30));
else if (cmd === 'curva') await curva();
else await etiquetar();
