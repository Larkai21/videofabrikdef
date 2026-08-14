/**
 * Baseline y serie de VARIEDAD entre vídeos — la métrica que no existía.
 *
 *   pnpm variedad            (todos los canales, vídeos hechos)
 *   pnpm variedad -- <channelId>
 *
 * Por qué existe: pnpm calidad mide solo INTRA-vídeo (repetición, cadencia,
 * ratio de imágenes) y la anti-repetición de la cascada es por identidad
 * exacta sobre los últimos 8 vídeos. Nada medía si el canal enseña «la misma
 * oficina genérica» un vídeo tras otro, así que el objetivo entero de «más
 * variedad» era infalsificable. Este script emite los números y congela la
 * baseline en calibracion/variedad-baseline.json ANTES de tocar la cascada:
 * sin baseline previa, ninguna mejora podrá atribuirse (ni ninguna regresión
 * detectarse).
 *
 * Identidad de plano: asset.path (estable tras la ingesta; dos vídeos que
 * reutilizan el mismo fichero de biblioteca comparten path). La ventana de
 * comparación es la misma ANTI_REPEAT_N=8 de la cascada, a propósito: mide lo
 * que la cascada intenta evitar.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { asc, eq } from 'drizzle-orm';
import { createDb, videos } from '@fabrica/db';
import { ANTI_REPEAT_N } from '@fabrica/shared';

const RAIZ = path.resolve(process.cwd(), '../..');
const DESTINO = path.join(RAIZ, 'calibracion', 'variedad-baseline.json');
const VENTANA = ANTI_REPEAT_N;

interface FilaVideo {
  video: string;
  titulo: string;
  creado: string;
  planos: number;
  unicos: number;
  /** % de planos de ESTE vídeo ya vistos en los VENTANA anteriores */
  repetidos_vs_ventana_pct: number | null;
  /** Jaccard del set de assets contra la unión de los VENTANA anteriores */
  jaccard_ventana: number | null;
  proveedores: Record<string, number>;
}

function assetsDe(master: {
  beats?: { asset?: { path?: string; origin?: string } | null; visuals?: { asset?: { path?: string; origin?: string } | null }[] }[];
}): { paths: Set<string>; planos: number; proveedores: Record<string, number> } {
  const paths = new Set<string>();
  const proveedores: Record<string, number> = {};
  let planos = 0;
  for (const beat of master.beats ?? []) {
    // cuando hay sub-planos, la lista `visuals` manda y beat.asset es su eco
    const slots =
      beat.visuals !== undefined && beat.visuals.length > 0
        ? beat.visuals.map((v) => v.asset)
        : [beat.asset];
    for (const a of slots) {
      if (a?.path === undefined || a.path === '') continue;
      planos += 1;
      paths.add(a.path);
      const origen = a.origin ?? 'desconocido';
      proveedores[origen] = (proveedores[origen] ?? 0) + 1;
    }
  }
  return { paths, planos, proveedores };
}

function jaccard(a: Set<string>, b: Set<string>): number | null {
  if (a.size === 0 && b.size === 0) return null;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}

async function main(): Promise<void> {
  const canal = process.argv[2];
  const { db, client } = createDb();

  const filasDb = await db
    .select({
      id: videos.id,
      channelId: videos.channelId,
      title: videos.titleChosen,
      master: videos.master,
      createdAt: videos.createdAt,
      state: videos.state,
    })
    .from(videos)
    .where(canal !== undefined ? eq(videos.channelId, canal) : undefined)
    .orderBy(asc(videos.createdAt));

  const hechos = filasDb.filter(
    (v) => v.state === 'hecho' && (v.master.beats?.length ?? 0) > 0,
  );
  if (hechos.length === 0) {
    console.error('No hay vídeos hechos con beats que medir.');
    await client.end();
    return;
  }

  const filas: FilaVideo[] = [];
  const vistos: Set<string>[] = [];
  const usoGlobal = new Map<string, number>(); // path → nº de vídeos que lo usan
  for (const v of hechos) {
    const { paths, planos, proveedores } = assetsDe(v.master);
    const ventana = vistos.slice(-VENTANA);
    const union = new Set<string>();
    for (const s of ventana) for (const x of s) union.add(x);
    const repetidos = [...paths].filter((p) => union.has(p)).length;
    filas.push({
      video: v.id,
      titulo: (v.title ?? '').slice(0, 48),
      creado: v.createdAt.toISOString().slice(0, 10),
      planos,
      unicos: paths.size,
      repetidos_vs_ventana_pct:
        ventana.length > 0 && paths.size > 0
          ? Math.round((repetidos / paths.size) * 100)
          : null,
      jaccard_ventana: ventana.length > 0 ? round3(jaccard(paths, union)) : null,
      proveedores,
    });
    vistos.push(paths);
    for (const p of paths) usoGlobal.set(p, (usoGlobal.get(p) ?? 0) + 1);
  }

  const topReutilizados = [...usoGlobal.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([p, n]) => ({ path: path.basename(p), videos: n }));

  const resumen = {
    generado: new Date().toISOString(),
    ventana: VENTANA,
    videos: filas,
    top_reutilizados: topReutilizados,
    agregado: {
      videos: filas.length,
      planos_por_video: round1(media(filas.map((f) => f.planos))),
      unicos_por_video: round1(media(filas.map((f) => f.unicos))),
      repetidos_vs_ventana_pct_media: round1(
        media(filas.map((f) => f.repetidos_vs_ventana_pct).filter((x): x is number => x !== null)),
      ),
      jaccard_ventana_media: round3(
        media(filas.map((f) => f.jaccard_ventana).filter((x): x is number => x !== null)),
      ),
    },
  };

  for (const f of filas) {
    const prov = Object.entries(f.proveedores)
      .map(([k, n]) => `${k}:${n}`)
      .join(' ');
    console.log(
      `${f.creado}  ${f.video}  planos ${String(f.planos).padStart(3)}  únicos ${String(f.unicos).padStart(3)}` +
        `  rep.ventana ${f.repetidos_vs_ventana_pct === null ? '  —' : `${String(f.repetidos_vs_ventana_pct).padStart(3)}%`}` +
        `  jaccard ${f.jaccard_ventana ?? '—'}  ${prov}  «${f.titulo}»`,
    );
  }
  console.log(
    `\nAgregado: ${resumen.agregado.videos} vídeos · ${resumen.agregado.planos_por_video} planos/vídeo · ` +
      `${resumen.agregado.unicos_por_video} únicos/vídeo · repetidos vs ventana ${resumen.agregado.repetidos_vs_ventana_pct_media}% · ` +
      `jaccard medio ${resumen.agregado.jaccard_ventana_media}`,
  );
  if (topReutilizados.length > 0) {
    console.log('Más reutilizados:');
    for (const t of topReutilizados) console.log(`  ${t.videos}×  ${t.path}`);
  }

  writeFileSync(DESTINO, `${JSON.stringify(resumen, null, 2)}\n`);
  console.log(`\nBaseline escrita en ${path.relative(RAIZ, DESTINO)}`);
  await client.end();
}

function media(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
function round3(x: number | null): number | null {
  return x === null ? null : Math.round(x * 1000) / 1000;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
