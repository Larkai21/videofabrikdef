import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { createDb, shorts, videos } from '@fabrica/db';
import { videoMetricsSchema, type VideoMetrics } from '@fabrica/shared';

// Importa a mano el CSV de YouTube Studio (pestaña Contenido → Exportar) y
// guarda las cifras en videos.metrics. Es la telemetría del principio 7: el
// MVP no toca la YouTube API, así que el bucle de datos se cierra con este
// export manual. Uso:
//   pnpm metricas <ruta/al/Datos\ de\ la\ tabla.csv>
//
// El casado fila→vídeo va primero por el ID de YouTube (la primera columna del
// export), que es exacto pero solo lo tenemos de los vídeos subidos por la API
// o marcados a mano; si no, cae al TÍTULO normalizado, que funciona porque los
// títulos salen del propio sistema pero se rompe en cuanto alguien lo edita en
// Studio. Una fila sin vídeo o un vídeo sin fila se listan al final — nunca se
// adivina.

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
// `satisfies` y no `Record<string, …>`: con la anotación ancha, keyof era
// `string` y noUncheckedIndexedAccess volvía `idx.title` posiblemente
// undefined — error latente que salió al incluir scripts/ en el typecheck
const COLS = {
  // la primera columna del export de la pestaña Contenido es el id de 11
  // caracteres. Casar por ahí deja de ser heurístico, pero solo funciona con
  // los vídeos cuyo youtube_id conocemos (los subidos por la API o marcados a
  // mano); para el resto sigue estando el título.
  id: ['contenido del video', 'contenido', 'content', 'video id', 'id del video'],
  title: ['titulo del video', 'video title'],
  views: ['visualizaciones', 'views'],
  impressions: ['impresiones', 'impressions'],
  ctr: ['tasa de clics de las impresiones', 'impressions click through rate'],
  avg_dur: ['duracion media de las visualizaciones', 'average view duration'],
  avg_pct: ['porcentaje medio reproducido', 'average percentage viewed'],
  watch_hours: ['tiempo de visualizacion horas', 'watch time hours'],
  subs: ['suscriptores', 'subscribers'],
} satisfies Record<string, string[]>;

function findCol(headers: string[], keys: string[]): number {
  return headers.findIndex((h) => keys.includes(norm(h).replace(/\s+/g, ' ')));
}

function num(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const t = raw.trim();
  // Dos convenciones según el locale del export: español (punto de millar,
  // coma decimal — «1.234,5») e inglés («1,234.5»). El separador DECIMAL es
  // el que aparece más a la derecha; el otro es de millar y se elimina.
  // Sin coma ni punto no hay que decidir nada. Caso ambiguo restante: un
  // único punto seguido de exactamente 3 dígitos («1.234») se lee como millar
  // — es lo que exporta Studio en español y un decimal de 3 cifras no existe
  // en estas métricas.
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  let limpio: string;
  if (lastDot < 0 && lastComma < 0) {
    limpio = t;
  } else if (lastDot > lastComma) {
    const variosPuntos = t.indexOf('.') !== lastDot;
    const grupoDeMillar = /^\d{1,3}(\.\d{3})+$/.test(t);
    limpio =
      lastComma < 0 && (variosPuntos || grupoDeMillar)
        ? t.replace(/\./g, '') // «1.234» / «1.234.567»: millares españoles
        : t.replace(/,/g, ''); // «6.5» / «1,234.5»: decimal inglés
  } else {
    limpio = t.replace(/\./g, '').replace(',', '.');
  }
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
    .select({
      id: videos.id,
      titleChosen: videos.titleChosen,
      master: videos.master,
      youtube: videos.youtube,
    })
    .from(videos)
    .where(eq(videos.state, 'hecho'));
  const porTitulo = new Map<string, string>();
  const porYoutubeId = new Map<string, string>();
  // el título normalizado de cada vídeo, para poder podar los dos mapas cuando
  // el casado entra por el id: el informe final se construye con lo que quede
  // en porTitulo, y si no se borra ahí, un vídeo casado por id aparecería
  // después como «sin fila en el CSV»
  const tituloDe = new Map<string, string>();
  for (const v of publicados) {
    const t =
      v.titleChosen ??
      v.master.seo?.titles?.[v.master.seo?.chosen_idx ?? 0] ??
      v.master.seo?.titles?.[0];
    if (t) {
      porTitulo.set(norm(t), v.id);
      tituloDe.set(v.id, norm(t));
    }
    const ytId = v.youtube?.youtube_id;
    if (ytId != null && ytId !== '') porYoutubeId.set(ytId, v.id);
  }

  // Los shorts entregados, con la misma mecánica: una fila del export de
  // Studio que sea un Short no puede casar con `videos` (su título es el de
  // la cartela) y caía para siempre en «sin casar». El id lo escribe
  // POST /shorts/:id/publicado; el título sale del sistema, como en el largo.
  const hechos = await db
    .select({ id: shorts.id, title: shorts.title, youtubeId: shorts.youtubeId })
    .from(shorts)
    .where(eq(shorts.state, 'hecho'));
  const porTituloShort = new Map<string, string>();
  const porYoutubeIdShort = new Map<string, string>();
  const tituloDeShort = new Map<string, string>();
  for (const s of hechos) {
    porTituloShort.set(norm(s.title), s.id);
    tituloDeShort.set(s.id, norm(s.title));
    if (s.youtubeId != null && s.youtubeId !== '') porYoutubeIdShort.set(s.youtubeId, s.id);
  }

  let importadas = 0;
  const sinVideo: string[] = [];
  for (const row of rows.slice(1)) {
    const titulo = row[idx.title] ?? '';
    if (titulo.trim() === '' || norm(titulo) === 'total') continue;
    // el id manda sobre el título: es exacto y el título se edita en Studio
    const ytId = idx.id >= 0 ? (row[idx.id] ?? '').trim() : '';
    const videoId =
      (ytId !== '' ? porYoutubeId.get(ytId) : undefined) ?? porTitulo.get(norm(titulo));
    const shortId =
      videoId !== undefined
        ? undefined
        : ((ytId !== '' ? porYoutubeIdShort.get(ytId) : undefined) ??
          porTituloShort.get(norm(titulo)));
    if (videoId === undefined && shortId === undefined) {
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
    if (videoId !== undefined) {
      await db.update(videos).set({ metrics }).where(eq(videos.id, videoId));
      // se borra de los DOS mapas: el informe de «vídeos hechos sin fila» sale
      // de porTitulo, y el título de la fila puede no ser el que tenemos
      porTitulo.delete(norm(titulo));
      const tituloGuardado = tituloDe.get(videoId);
      if (tituloGuardado !== undefined) porTitulo.delete(tituloGuardado);
      if (ytId !== '') porYoutubeId.delete(ytId);
      console.log(
        `✓ ${titulo} → ${videoId}  (${metrics.views ?? '—'} visualizaciones, CTR ${metrics.ctr_pct ?? '—'} %)`,
      );
    } else if (shortId !== undefined) {
      await db.update(shorts).set({ metrics, updatedAt: new Date() }).where(eq(shorts.id, shortId));
      porTituloShort.delete(norm(titulo));
      const tituloGuardado = tituloDeShort.get(shortId);
      if (tituloGuardado !== undefined) porTituloShort.delete(tituloGuardado);
      if (ytId !== '') porYoutubeIdShort.delete(ytId);
      console.log(
        `✓ [short] ${titulo} → ${shortId}  (${metrics.views ?? '—'} visualizaciones)`,
      );
    }
    importadas++;
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
  const shortsSinFila = [...porTituloShort.keys()];
  if (shortsSinFila.length > 0) {
    console.log(`\nShorts hechos sin fila en el CSV (${shortsSinFila.length}):`);
    for (const t of shortsSinFila) console.log(`  · ${t}`);
  }
  console.log(`\n${importadas} fila(s) con métricas importadas.`);
  process.exit(0);
}

void main();
