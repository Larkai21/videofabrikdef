/**
 * Exporta la curación humana de producción al banco de calibración.
 *
 *   pnpm --filter @fabrica/workers exec tsx scripts/exportar-etiquetas.ts <videoId> [<videoId>…]
 *
 * Por qué existe: el banco de matching (calibracion/planos-etiquetados.jsonl,
 * 25 beats) es lo que mide cualquier cambio en el ranking, y crecía solo con
 * sesiones de etiquetado a mano. Desde el 31-jul la puerta de curación funciona
 * —elegir y descartar escriben de verdad— así que cada vídeo curado contiene
 * etiquetas gratis. Este script las vuelca.
 *
 * Los vídeos se pasan EXPLÍCITOS, nunca «todos los hechos»: un vídeo aprobado a
 * ciegas (existe al menos uno, aprobado en bloque por un agente para probar el
 * render) metería 25 falsos positivos en el banco, y no hay forma de
 * distinguirlo en la BD de uno curado con ojos.
 *
 * La etiqueta de producción es PARCIAL y va a un fichero propio
 * (planos-produccion.jsonl), no al de las sesiones a mano:
 *   - `choose` del humano   → elegido = candidates[0]; del resto no se sabe nada
 *   - `discard` con motivo  → vetados = [candidates[0]]; un disparate CONOCIDO
 *   - `locked` sin más      → el primero era aceptable (señal débil)
 * «sin disparate» exige `aceptables` completos y aquí no los hay: mezclar los
 * dos ficheros convertiría esa métrica en acierto@1 sin que nadie lo note.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inArray } from 'drizzle-orm';
import { beats, createDb } from '@fabrica/db';

const RAIZ = path.resolve(process.cwd(), '../..');
const DESTINO = path.join(RAIZ, 'calibracion', 'planos-produccion.jsonl');

interface FilaProduccion {
  video: string;
  beat: number;
  query: string;
  narracion: string;
  elegido: string | null;
  /** refs que el humano rechazó explícitamente (discard): disparates conocidos */
  vetados?: string[];
  candidatos: { ref: string; provider: string; kind: string; caption: string; cos: number }[];
  origen: 'produccion';
  /** aceptables desconocidos más allá de `elegido`: no vale para «sin disparate» */
  parcial: true;
}

function clavesExistentes(): Set<string> {
  if (!existsSync(DESTINO)) return new Set();
  return new Set(
    readFileSync(DESTINO, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => {
        const f = JSON.parse(l) as FilaProduccion;
        return `${f.video}:${f.beat}`;
      }),
  );
}

async function main(): Promise<void> {
  const videoIds = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (videoIds.length === 0) {
    console.error('Uso: exportar-etiquetas.ts <videoId> [<videoId>…]  (explícitos a propósito)');
    process.exitCode = 1;
    return;
  }

  const { db, client } = createDb();
  const filas = await db.select().from(beats).where(inArray(beats.videoId, videoIds));
  const ya = clavesExistentes();

  let exportadas = 0;
  let saltadas = 0;
  for (const b of filas.sort((x, y) => x.videoId.localeCompare(y.videoId) || x.idx - y.idx)) {
    const clave = `${b.videoId}:${b.idx}`;
    if (ya.has(clave)) {
      saltadas += 1;
      continue;
    }
    const cands = b.candidates ?? [];
    // sin candidatos no hay nada que comparar; sin acción humana no hay etiqueta
    const curado = b.status === 'locked' || b.discardReason !== null;
    if (cands.length < 2 || !curado) continue;

    const fila: FilaProduccion = {
      video: b.videoId,
      beat: b.idx,
      query: b.visualQuery,
      narracion: b.text,
      elegido: b.status === 'locked' ? (cands[0]?.ref ?? null) : null,
      ...(b.discardReason !== null && cands[0] ? { vetados: [cands[0].ref] } : {}),
      candidatos: cands.map((c) => ({
        ref: c.ref,
        provider: c.provider,
        kind: typeof c.meta?.kind === 'string' ? c.meta.kind : 'clip',
        caption:
          (typeof c.meta?.caption === 'string' && c.meta.caption) ||
          (typeof c.meta?.title === 'string' && c.meta.title) ||
          '',
        cos: c.score,
      })),
      origen: 'produccion',
      parcial: true,
    };
    appendFileSync(DESTINO, `${JSON.stringify(fila)}\n`);
    exportadas += 1;
  }

  console.log(
    `${exportadas} filas exportadas a ${path.relative(RAIZ, DESTINO)} (${saltadas} ya estaban)`,
  );
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
