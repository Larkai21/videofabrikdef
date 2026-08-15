/**
 * Antes y después del pool, mirando: para las consultas REALES de producción,
 * qué devolvía la búsqueda con la consulta larga y qué devuelve con la consulta
 * de buscador.
 *
 *   pnpm --filter @fabrica/workers exec tsx scripts/comparar-consultas.ts [n]
 *
 * Por qué existe: el banco de calibración (pnpm rerank) mide REORDENAR un pool
 * ya construido, así que es ciego a los cambios en CÓMO se construye el pool —
 * que es donde estaba el problema («todo lo que sale es basura»). Esto no se
 * mide con un número, se ve: dos filas de miniaturas por consulta.
 *
 * Escribe calibracion/comparativa/index.html (autocontenido, sin servidor).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { desc, isNotNull, ne, and } from 'drizzle-orm';
import { assets, createDb } from '@fabrica/db';
import { consultaDeBuscador } from '../src/pipelines/assets/broll-director.js';

const RAIZ = path.resolve(process.cwd(), '../..');
const DIR = path.join(RAIZ, 'calibracion', 'comparativa');
const THUMBS = path.join(DIR, 'thumbs');
const POR_FILA = 6;

interface Item {
  id: string;
  slug: string;
  thumb: string;
}

async function pexels(q: string, key: string): Promise<Item[]> {
  const params = new URLSearchParams({ query: q, orientation: 'landscape', per_page: '8' });
  const res = await fetch(`https://api.pexels.com/videos/search?${params}&size=medium`, {
    headers: { Authorization: key },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { videos?: { id?: number; url?: string; image?: string }[] };
  return (json.videos ?? []).slice(0, POR_FILA).map((v) => ({
    id: String(v.id ?? ''),
    slug: (v.url ?? '').split('/')[4] ?? '',
    thumb: v.image ?? '',
  }));
}

async function miniatura(url: string): Promise<string> {
  if (url === '') return '';
  const dest = path.join(THUMBS, `${createHash('sha1').update(url).digest('hex').slice(0, 14)}.jpg`);
  if (!existsSync(dest)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return '';
      const crudo = `${dest}.crudo`;
      await fs.writeFile(crudo, Buffer.from(await res.arrayBuffer()));
      await execa('ffmpeg', [
        '-nostdin', '-loglevel', 'error', '-y', '-i', crudo,
        '-vf', 'scale=320:-2', '-q:v', '5', dest,
      ]);
      await fs.rm(crudo, { force: true });
    } catch {
      return '';
    }
  }
  return existsSync(dest) ? `data:image/jpeg;base64,${readFileSync(dest).toString('base64')}` : '';
}

async function main(): Promise<void> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    console.error('Falta PEXELS_API_KEY');
    process.exitCode = 1;
    return;
  }
  const n = Number(process.argv[2] ?? 8);
  const { db, client } = createDb();

  // consultas REALES que se usaron en producción, las más recientes
  const filas = await db
    .selectDistinct({ q: assets.originQuery })
    .from(assets)
    .where(and(isNotNull(assets.originQuery), ne(assets.originQuery, '')))
    .orderBy(desc(assets.originQuery))
    .limit(200);
  const largas = filas
    .map((f) => f.q as string)
    .filter((q) => q.split(/\s+/).length >= 4)
    .slice(0, n);

  mkdirSync(THUMBS, { recursive: true });
  const bloques: string[] = [];
  for (const larga of largas) {
    const corta = consultaDeBuscador(larga);
    const [antes, despues] = await Promise.all([pexels(larga, key), pexels(corta, key)]);
    const [tAntes, tDespues] = await Promise.all([
      Promise.all(antes.map((i) => miniatura(i.thumb))),
      Promise.all(despues.map((i) => miniatura(i.thumb))),
    ]);
    const comunes = new Set(antes.map((a) => a.id));
    const nuevos = despues.filter((d) => !comunes.has(d.id)).length;
    const fila = (items: Item[], thumbs: string[]): string =>
      items
        .map(
          (it, i) =>
            `<figure><img src="${thumbs[i] ?? ''}" alt=""><figcaption>${it.slug.replace(/-/g, ' ').slice(0, 48)}</figcaption></figure>`,
        )
        .join('');
    bloques.push(
      `<section>
        <h2>${larga}</h2>
        <p class="meta">consulta nueva: <b>${corta}</b> · ${nuevos} de ${despues.length} resultados son distintos</p>
        <p class="etiqueta">ANTES · consulta larga</p><div class="fila">${fila(antes, tAntes)}</div>
        <p class="etiqueta ok">DESPUÉS · consulta de buscador</p><div class="fila">${fila(despues, tDespues)}</div>
      </section>`,
    );
    console.log(`${larga}  →  ${corta}   (${nuevos}/${despues.length} distintos)`);
  }

  mkdirSync(DIR, { recursive: true });
  writeFileSync(
    path.join(DIR, 'index.html'),
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Antes y después del pool</title>
<style>
 body{background:#0e1216;color:#e6e9ec;font:15px/1.5 system-ui,sans-serif;margin:0;padding:28px}
 h1{font-size:26px} h2{font-size:19px;margin:0 0 4px} section{margin:0 0 42px;border-bottom:1px solid #242c34;padding-bottom:26px}
 .meta{color:#98a2ac;font-size:13.5px;margin:0 0 14px}
 .etiqueta{font:600 11.5px ui-monospace,monospace;letter-spacing:.08em;color:#98a2ac;margin:12px 0 6px}
 .etiqueta.ok{color:#4cc4d4}
 .fila{display:grid;grid-template-columns:repeat(${POR_FILA},1fr);gap:10px}
 figure{margin:0} img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:7px;background:#000}
 figcaption{font-size:11.5px;color:#98a2ac;margin-top:5px;line-height:1.3}
</style></head><body>
<h1>Antes y después del pool</h1>
<p class="meta">Mismas consultas reales de producción, misma API. Arriba lo que pedía el pipeline; abajo, lo que pide ahora.</p>
${bloques.join('\n')}</body></html>`,
  );
  console.log(`\nAbre: ${path.join(DIR, 'index.html')}`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
