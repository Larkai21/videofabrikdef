/**
 * Cuadro de métricas del matching de b-roll, por vídeo. El antes/después de
 * cualquier cambio en el pool o en el ranking (plan de matching, fases 1-5).
 *
 *   pnpm --filter @fabrica/workers exec tsx scripts/matching-metricas.ts <videoId> [<videoId>…]
 *
 * OJO con el momento de medir: el % de auto_ok solo es real ANTES de curar
 * (la curación pisa los estados con `locked`). Para el cuadro comparativo se
 * corre justo después del match, con la timeline recién propuesta.
 *
 * Qué mide y por qué:
 *   - auto_ok / review / locked  → cuánta carga de curación queda al humano
 *   - veto del juez              → planos donde NINGÚN candidato ilustraba
 *     (discard_reason del juez de planos; es el proxy de «el pool es corto»)
 *   - caption real del ganador   → el juez decide leyendo pies de foto; un
 *     ganador sin caption VLM compitió con el título del proveedor (slug)
 *   - cuota por proveedor        → de dónde sale lo que gana
 *   - vlm_caption del ledger     → coste de la pasada, contra el techo
 */
import { inArray } from 'drizzle-orm';
import { beats, costLedger, createDb } from '@fabrica/db';

const VETO_JUEZ = 'ningún plano ilustra lo que se dice';

interface Cuadro {
  planos: number;
  autoOk: number;
  review: number;
  locked: number;
  vetosJuez: number;
  conCaption: number;
  porProveedor: Map<string, number>;
}

function cuadroVacio(): Cuadro {
  return {
    planos: 0,
    autoOk: 0,
    review: 0,
    locked: 0,
    vetosJuez: 0,
    conCaption: 0,
    porProveedor: new Map(),
  };
}

async function main(): Promise<void> {
  const videoIds = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (videoIds.length === 0) {
    console.error('Uso: matching-metricas.ts <videoId> [<videoId>…]');
    process.exitCode = 1;
    return;
  }

  const { db, client } = createDb();
  const filas = await db.select().from(beats).where(inArray(beats.videoId, videoIds));
  const ledger = await db
    .select()
    .from(costLedger)
    .where(inArray(costLedger.videoId, videoIds));

  for (const videoId of videoIds) {
    const c = cuadroVacio();
    for (const b of filas.filter((f) => f.videoId === videoId)) {
      // la unidad es el SUB-PLANO cuando existe (es lo que se ve en pantalla);
      // el beat entero cuando no
      const planos =
        (b.visuals ?? []).length > 0
          ? b.visuals!.map((v) => ({ status: v.status, candidates: v.candidates }))
          : [{ status: b.status, candidates: b.candidates ?? [] }];
      for (const p of planos) {
        c.planos += 1;
        if (p.status === 'auto_ok') c.autoOk += 1;
        else if (p.status === 'review') c.review += 1;
        else if (p.status === 'locked') c.locked += 1;
        const ganador = p.candidates[0];
        if (ganador) {
          const caption = ganador.meta?.caption;
          if (typeof caption === 'string' && caption !== '') c.conCaption += 1;
          c.porProveedor.set(ganador.provider, (c.porProveedor.get(ganador.provider) ?? 0) + 1);
        }
      }
      if (b.discardReason === VETO_JUEZ) c.vetosJuez += 1;
    }

    const capUnits = ledger
      .filter(
        (l) => l.videoId === videoId && l.operation === 'vlm_caption' && l.status === 'complete',
      )
      .reduce((acc, l) => acc + l.units, 0);

    const pct = (n: number): string =>
      c.planos > 0 ? `${((100 * n) / c.planos).toFixed(0)} %` : '—';
    const proveedores = [...c.porProveedor.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join('  ');
    console.log(`${videoId}  ·  ${c.planos} planos`);
    console.log(`  auto_ok ${c.autoOk} (${pct(c.autoOk)}) · review ${c.review} · locked ${c.locked}`);
    console.log(`  vetos del juez        ${c.vetosJuez}`);
    console.log(`  ganador con caption   ${c.conCaption} (${pct(c.conCaption)})`);
    console.log(`  cuota por proveedor   ${proveedores || '—'}`);
    console.log(`  vlm_caption (ledger)  ${capUnits} unidades`);
  }
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
