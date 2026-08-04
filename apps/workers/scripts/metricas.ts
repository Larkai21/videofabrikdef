import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb, videos } from '@fabrica/db';
import { videoMetricsSchema, type VideoMetrics } from '@fabrica/shared';

// Importa a mano el CSV de YouTube Studio (pestaña Contenido → Exportar) y
// guarda las cifras en videos.metrics. Es la telemetría del principio 7: el
// MVP no toca la YouTube API, así que el bucle de datos se cierra con este
// export manual. Uso:
//   pnpm metricas <ruta/al/Datos\ de\ la\ tabla.csv>
//
// El casado fila→vídeo va por TÍTULO normalizado (el CSV no conoce nuestros
// ids): funciona porque los títulos salen del propio sistema. Una fila sin
// vídeo o un vídeo sin fila se listan al final — nunca se adivina.

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parser CSV mínimo con soporte de comillas (los títulos llevan comas). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

// cabeceras del export en español y en inglés (YouTube las localiza), ya en
// forma NORMALIZADA (norm() quita tildes y signos antes de comparar)
const COLS: Record<string, string[]> = {
  title: ['titulo del video', 'video title'],
  views: ['visualizaciones', 'views'],
  impressions: ['impresiones', 'impressions'],
  ctr: ['tasa de clics de las impresiones', 'impressions click through rate'],
  avg_dur: ['duracion media de las visualizaciones', 'average view duration'],
  avg_pct: ['porcentaje medio reproducido', 'average percentage viewed'],
  watch_hours: ['tiempo de visualizacion horas', 'watch time hours'],
  subs: ['suscriptores', 'subscribers'],
};

function findCol(headers: string[], keys: string[]): number {
  return headers.findIndex((h) => keys.includes(norm(h).replace(/\s+/g, ' ')));
}

function num(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const t = raw.trim();
  // Dos convenciones posibles según el locale del export:
  //   español: coma decimal, punto de millar («1.234,5»)
  //   inglés:  punto decimal, coma de millar («1,234.5»)
  // Un único punto con 1-2 dígitos detrás y sin coma es DECIMAL inglés
  // («6.5» era 65 con la regla anterior, que trataba todo punto como millar).
  const limpio =
    /^\d+\.\d{1,2}$/.test(t) && !t.includes(',')
      ? t
      : t.replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(limpio);
  return Number.isFinite(n) ? n : undefined;
}

function durS(raw: string | undefined): number | undefined {
  if (raw === undefined || !raw.includes(':')) return num(raw);
  const partes = raw.trim().split(':').map(Number);
  if (partes.some((p) => !Number.isFinite(p))) return undefined;
  return partes.reduce((acc, p) => acc * 60 + p, 0);
}

async function main(): Promise<void> {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Uso: pnpm metricas <ruta/al/export.csv>');
    process.exit(1);
  }
  const raw = fs.readFileSync(path.resolve(csvPath), 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(raw);
  const headers = rows[0] ?? [];
  const idx = Object.fromEntries(
    Object.entries(COLS).map(([k, keys]) => [k, findCol(headers, keys)]),
  ) as Record<keyof typeof COLS, number>;
  if (idx.title < 0) {
    console.error(
      `No encuentro la columna de título en: ${headers.join(' | ')}\n¿Es el export de la pestaña Contenido?`,
    );
    process.exit(1);
  }

  const { db } = createDb();
  const publicados = await db
    .select({ id: videos.id, titleChosen: videos.titleChosen, master: videos.master })
    .from(videos)
    .where(eq(videos.state, 'hecho'));
  const porTitulo = new Map<string, string>();
  for (const v of publicados) {
    const t =
      v.titleChosen ??
      v.master.seo?.titles?.[v.master.seo?.chosen_idx ?? 0] ??
      v.master.seo?.titles?.[0];
    if (t) porTitulo.set(norm(t), v.id);
  }

  let importadas = 0;
  const sinVideo: string[] = [];
  for (const row of rows.slice(1)) {
    const titulo = row[idx.title] ?? '';
    if (titulo.trim() === '' || norm(titulo) === 'total') continue;
    const videoId = porTitulo.get(norm(titulo));
    if (videoId === undefined) {
      sinVideo.push(titulo);
      continue;
    }
    const metrics: VideoMetrics = videoMetricsSchema.parse({
      imported_at: new Date().toISOString(),
      source: 'yt-studio-csv',
      ...(idx.views >= 0 ? { views: num(row[idx.views]) } : {}),
      ...(idx.impressions >= 0 ? { impressions: num(row[idx.impressions]) } : {}),
      ...(idx.ctr >= 0 ? { ctr_pct: num(row[idx.ctr]) } : {}),
      ...(idx.avg_dur >= 0 ? { avg_view_duration_s: durS(row[idx.avg_dur]) } : {}),
      ...(idx.avg_pct >= 0 ? { avg_pct_viewed: num(row[idx.avg_pct]) } : {}),
      ...(idx.watch_hours >= 0 ? { watch_hours: num(row[idx.watch_hours]) } : {}),
      ...(idx.subs >= 0 ? { subscribers_gained: num(row[idx.subs]) } : {}),
    });
    await db.update(videos).set({ metrics }).where(eq(videos.id, videoId));
    porTitulo.delete(norm(titulo));
    importadas++;
    console.log(
      `✓ ${titulo} → ${videoId}  (${metrics.views ?? '—'} visualizaciones, CTR ${metrics.ctr_pct ?? '—'} %)`,
    );
  }
  if (sinVideo.length > 0) {
    console.log(`\nFilas sin vídeo casado (${sinVideo.length}):`);
    for (const t of sinVideo) console.log(`  · ${t}`);
  }
  const sinFila = [...porTitulo.keys()];
  if (sinFila.length > 0) {
    console.log(`\nVídeos hechos sin fila en el CSV (${sinFila.length}):`);
    for (const t of sinFila) console.log(`  · ${t}`);
  }
  console.log(`\n${importadas} vídeo(s) con métricas importadas.`);
  process.exit(0);
}

void main();
