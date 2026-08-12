/**
 * Informe de calidad de un vídeo terminado.
 *
 *   pnpm calidad <videoId>            informe + hoja de contactos
 *   pnpm calidad <videoId> --solo-datos
 *   pnpm calidad --todos              compara los que haya en outputs/
 *
 * Existe porque juzgar si un cambio mejora el vídeo exigía verlo entero y
 * fiarse de la memoria. Todo sale del maestro que ya se escribe; la hoja de
 * contactos extrae con ffmpeg los instantes que de verdad importan (el gancho,
 * cada cambio de plano, cada efecto) para poder mirarla en un minuto.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  analizarMaster,
  analizarShort,
  masterVideoJsonV1,
  SHORT_CADENCIA_MAX,
  SHORT_CADENCIA_MIN,
  SHORT_HUECO_GRAFICO_MAX_MS,
  SHORT_TITULO_MAX_PALABRAS,
  shortMasterV1,
  type Aviso,
  type MetricasShort,
  type MetricasVideo,
  type ShortMasterJson,
} from '@fabrica/shared';

const ejec = promisify(execFile);
const OUTPUTS = process.env.OUTPUTS_DIR ?? path.resolve(process.cwd(), '../../outputs');

interface Momento {
  ms: number;
  etiqueta: string;
  detalle: string;
}

/** Los instantes que hay que mirar para juzgar el vídeo, y por qué cada uno. */
function momentos(master: ReturnType<typeof masterVideoJsonV1.parse>): Momento[] {
  const out: Momento[] = [];
  const beats = master.beats ?? [];
  const dur = beats.reduce((a, b) => Math.max(a, b.to_ms), 0);

  // el gancho: donde se pierde la mayor parte de la audiencia
  for (let t = 0; t < Math.min(15_000, dur); t += 2_500) {
    out.push({ ms: t, etiqueta: 'gancho', detalle: textoEn(master, t) });
  }
  // cada plano, 600 ms dentro para saltarse la transición
  for (const b of beats) {
    const vs = b.visuals ?? [];
    const tramos = vs.length > 0 ? vs : [{ from_ms: b.from_ms }];
    for (const v of tramos) {
      out.push({ ms: v.from_ms + 600, etiqueta: `plano b${b.idx}`, detalle: b.text.slice(0, 90) });
    }
  }
  // cada efecto visual, ya terminada su entrada
  for (const e of master.edits ?? []) {
    if (e.type === 'sfx' || e.type === 'zoom_punch') continue;
    out.push({ ms: e.from_ms + 600, etiqueta: e.type, detalle: textoEn(master, e.from_ms) });
  }
  for (const s of master.segments ?? []) {
    out.push({ ms: s.from_ms + 400, etiqueta: 'sección', detalle: s.title });
  }
  if (dur > 5_000)
    out.push({ ms: dur - 5_000, etiqueta: 'cierre', detalle: textoEn(master, dur - 5_000) });

  const vistos = new Set<number>();
  return out
    .filter((m) => m.ms >= 0 && m.ms < dur)
    .sort((a, b) => a.ms - b.ms)
    .filter((m) => {
      const k = Math.round(m.ms / 400);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
}

/** Qué se está diciendo en ese instante, para poder juzgar la relevancia. */
function textoEn(
  master: Pick<ReturnType<typeof masterVideoJsonV1.parse>, 'cues' | 'beats'>,
  ms: number,
): string {
  const cue = (master.cues ?? []).find((c) => c.from_ms <= ms && c.to_ms >= ms);
  if (cue) return cue.text;
  const beat = (master.beats ?? []).find((b) => b.from_ms <= ms && b.to_ms >= ms);
  return beat?.text.slice(0, 90) ?? '';
}

function reloj(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

interface HojaOpts {
  mp4: string;
  /** directorio `calidad/` donde caen fotogramas e informe */
  salida: string;
  titulo: string;
  sub: string;
  /** relación de aspecto de las celdas: el short se mira en 9:16 */
  aspect: '16/9' | '9/16';
  puntos: Momento[];
  avisos: Aviso[];
}

async function generarHoja(o: HojaOpts): Promise<string | null> {
  if (!existsSync(o.mp4)) return null;
  rmSync(path.join(o.salida, 'fotogramas'), { recursive: true, force: true });
  mkdirSync(path.join(o.salida, 'fotogramas'), { recursive: true });

  const celdas: string[] = [];
  for (const [i, p] of o.puntos.entries()) {
    const jpg = `fotogramas/${String(i).padStart(3, '0')}.jpg`;
    // seek de ENTRADA: el de salida decodifica desde el principio y tarda
    // minutos en un vídeo de 8 min con 60 fotogramas
    await ejec('ffmpeg', [
      '-nostdin',
      '-loglevel',
      'error',
      '-ss',
      (p.ms / 1000).toFixed(3),
      '-i',
      o.mp4,
      '-frames:v',
      '1',
      '-vf',
      'scale=480:-1',
      '-q:v',
      '4',
      '-y',
      path.join(o.salida, jpg),
    ]);
    celdas.push(
      `<figure><img src="${jpg}" loading="lazy" alt=""><figcaption>` +
        `<b>${reloj(p.ms)}</b> <span class="et">${escapar(p.etiqueta)}</span><br>` +
        `<span class="d">${escapar(p.detalle)}</span></figcaption></figure>`,
    );
  }

  const avisos = o.avisos
    .map(
      (a) =>
        `<li class="${a.gravedad}">${escapar(a.detalle)}${a.at_ms !== undefined ? ` <b>${reloj(a.at_ms)}</b>` : ''}</li>`,
    )
    .join('');
  // las celdas 9:16 son altas: columnas más estrechas para que quepan más
  const minCol = o.aspect === '9/16' ? 180 : 240;
  const html = `<!doctype html><meta charset="utf-8"><title>Calidad · ${escapar(o.titulo)}</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#12171c;color:#e7edf3}
 h1{font-size:20px;margin:0 0 4px} .sub{color:#93a1ad;margin-bottom:20px}
 ul{padding-left:20px;margin:0 0 24px} li{margin:3px 0}
 li.alta{color:#ff8f7a} li.media{color:#ffb224}
 .rej{display:grid;grid-template-columns:repeat(auto-fill,minmax(${minCol}px,1fr));gap:14px}
 figure{margin:0;background:#191f26;border:1px solid #242c35;border-radius:8px;overflow:hidden}
 img{width:100%;display:block;aspect-ratio:${o.aspect};object-fit:cover;background:#000}
 figcaption{padding:8px 10px;font-size:12px}
 .et{color:#4cc2ff;font-family:ui-monospace,monospace}
 .d{color:#93a1ad}
</style>
<h1>${escapar(o.titulo)}</h1>
<div class="sub">${escapar(o.sub)}</div>
${avisos ? `<ul>${avisos}</ul>` : '<p>Sin avisos.</p>'}
<div class="rej">${celdas.join('')}</div>`;
  writeFileSync(path.join(o.salida, 'informe.html'), html);
  return path.join(o.salida, 'informe.html');
}

async function hojaDeContactos(
  videoId: string,
  master: ReturnType<typeof masterVideoJsonV1.parse>,
  m: MetricasVideo,
): Promise<string | null> {
  const dir = path.join(OUTPUTS, videoId);
  return generarHoja({
    mp4: path.join(dir, 'video.mp4'),
    salida: path.join(dir, 'calidad'),
    titulo: master.seo?.titles?.[master.seo.chosen_idx ?? 0] ?? videoId,
    sub: `${m.duracion_min.toFixed(1)} min · ${m.beats} beats · ${m.planos} planos · ${m.efectos} efectos`,
    aspect: '16/9',
    puntos: momentos(master),
    avisos: m.avisos,
  });
}

/**
 * Los instantes del SHORT: más densos que en el largo porque la pieza dura
 * treinta segundos y el swipe se decide en los primeros dos.
 */
function momentosShort(short: ShortMasterJson): Momento[] {
  const out: Momento[] = [];
  const dur = short.short.duration_ms;
  // el gancho, cada segundo y medio
  for (let t = 0; t < Math.min(6_000, dur); t += 1_500) {
    out.push({ ms: t, etiqueta: 'gancho', detalle: textoEn(short, t) });
  }
  // cada plano, 300 ms dentro (los planos del formato duran 2-3 s)
  for (const b of short.beats ?? []) {
    const vs = b.visuals ?? [];
    const tramos = vs.length > 0 ? vs : [{ from_ms: b.from_ms }];
    for (const v of tramos) {
      out.push({ ms: v.from_ms + 300, etiqueta: `plano b${b.idx}`, detalle: b.text.slice(0, 90) });
    }
  }
  for (const e of short.edits ?? []) {
    if (e.type === 'sfx' || e.type === 'zoom_punch') continue;
    out.push({ ms: e.from_ms + 400, etiqueta: e.type, detalle: textoEn(short, e.from_ms) });
  }
  if (dur > 3_000) {
    out.push({ ms: dur - 2_000, etiqueta: 'cierre', detalle: textoEn(short, dur - 2_000) });
  }
  const vistos = new Set<number>();
  return out
    .filter((p) => p.ms >= 0 && p.ms < dur)
    .sort((a, b) => a.ms - b.ms)
    .filter((p) => {
      const k = Math.round(p.ms / 300);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
}

async function hojaDeContactosShort(
  videoId: string,
  shortId: string,
  short: ShortMasterJson,
  m: MetricasShort,
): Promise<string | null> {
  const dir = path.join(OUTPUTS, videoId, 'shorts', shortId);
  return generarHoja({
    mp4: path.join(dir, 'video.mp4'),
    salida: path.join(dir, 'calidad'),
    titulo: short.short.title,
    sub: `${m.duracion_s.toFixed(1)} s · ${m.beats} beats · ${m.planos} planos · ${m.efectos} efectos`,
    aspect: '9/16',
    puntos: momentosShort(short),
    avisos: m.avisos,
  });
}

function escapar(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

function imprimir(videoId: string, m: MetricasVideo): void {
  const t = (b: boolean): string => (b ? '✓' : '✗');
  console.log(
    `\n${videoId}  ·  ${m.duracion_min.toFixed(1)} min · ${m.beats} beats · ${m.planos} planos · ${m.efectos} efectos`,
  );
  console.log(
    `  · recorte     ${m.recortes} clips recortados, mediana ${m.desfase_mediana_s.toFixed(1)} s de material descartado por lado`,
  );
  console.log(
    `  ${t(m.ratio_imagenes <= m.techo_imagenes)} metraje     ${m.planos - m.imagenes} clips / ${m.imagenes} imágenes fijas (${Math.round(m.ratio_imagenes * 100)} % del tiempo)`,
  );
  if (m.cuota_biblioteca !== null) {
    console.log(
      `  · biblioteca  gana el ${Math.round(m.cuota_biblioteca * 100)} % del tiempo en pantalla (tier 0)`,
    );
  }
  console.log(
    `  ${t(m.planos_repetidos === 0)} repetición  ${m.planos_repetidos} planos repetidos · ${m.bucles} en bucle`,
  );
  console.log(
    `  ${t(m.cadencia_planos_min >= 6 && m.cadencia_planos_min <= 16)} cadencia    ${m.cadencia_planos_min.toFixed(1)} planos/min`,
  );
  console.log(
    `  ${t(m.minutos_mudos === 0)} efectos     ${m.efectos_visuales_por_min.toFixed(1)} visuales/min · reparto [${m.reparto_por_minuto.join(' ')}]`,
  );
  if (m.intents_declaradas !== null) {
    console.log(`  · intenciones ${m.intents_declaradas} declaradas → ${m.intents_vivas} vivas`);
  }
  for (const a of m.avisos) {
    console.log(
      `  ${a.gravedad === 'alta' ? '!!' : ' !'} ${a.codigo.padEnd(20)} ${a.detalle}${a.at_ms !== undefined ? ` (${reloj(a.at_ms)})` : ''}`,
    );
  }
}

function imprimirShort(shortId: string, m: MetricasShort): void {
  const t = (b: boolean): string => (b ? '✓' : '✗');
  console.log(
    `\n  short ${shortId}  ·  ${m.duracion_s.toFixed(1)} s · ${m.beats} beats · ${m.planos} planos · ${m.efectos} efectos` +
      (m.director !== null ? ` · director ${m.director}` : ''),
  );
  console.log(
    `    ${t(m.cadencia_planos_min >= SHORT_CADENCIA_MIN && m.cadencia_planos_min <= SHORT_CADENCIA_MAX)} cadencia    ${m.cadencia_planos_min.toFixed(1)} planos/min (${m.segundos_por_plano.toFixed(1)} s/plano)`,
  );
  console.log(
    `    ${t(m.hueco_grafico_s * 1000 <= SHORT_HUECO_GRAFICO_MAX_MS)} cobertura   ${Math.round(m.cobertura_grafica * 100)} % con gráfico · hueco máx ${m.hueco_grafico_s.toFixed(1)} s`,
  );
  console.log(
    `    ${t(m.titulo_palabras <= SHORT_TITULO_MAX_PALABRAS)} cartela     ${m.titulo_palabras} palabras`,
  );
  for (const a of m.avisos) {
    console.log(
      `    ${a.gravedad === 'alta' ? '!!' : ' !'} ${a.codigo.padEnd(20)} ${a.detalle}${a.at_ms !== undefined ? ` (${reloj(a.at_ms)})` : ''}`,
    );
  }
}

function leerMaster(videoId: string): ReturnType<typeof masterVideoJsonV1.parse> | null {
  const p = path.join(OUTPUTS, videoId, 'master.json');
  if (!existsSync(p)) return null;
  const r = masterVideoJsonV1.safeParse(JSON.parse(readFileSync(p, 'utf8')));
  if (!r.success) {
    console.error(`${videoId}: el maestro no valida —`, r.error.issues.slice(0, 2));
    return null;
  }
  return r.data;
}

/** Los shorts renderizados del vídeo, con su maestro congelado validado. */
function leerShorts(videoId: string): { id: string; master: ShortMasterJson }[] {
  const dir = path.join(OUTPUTS, videoId, 'shorts');
  if (!existsSync(dir)) return [];
  const out: { id: string; master: ShortMasterJson }[] = [];
  for (const sid of readdirSync(dir).sort()) {
    const p = path.join(dir, sid, 'master.json');
    if (!existsSync(p)) continue;
    const r = shortMasterV1.safeParse(JSON.parse(readFileSync(p, 'utf8')));
    if (!r.success) {
      console.error(`${videoId}/shorts/${sid}: el maestro no valida —`, r.error.issues.slice(0, 2));
      continue;
    }
    out.push({ id: sid, master: r.data });
  }
  return out;
}

const args = process.argv.slice(2);
const soloDatos = args.includes('--solo-datos');
const ids = args.includes('--todos')
  ? readdirSync(OUTPUTS).filter((d) => existsSync(path.join(OUTPUTS, d, 'master.json')))
  : args.filter((a) => !a.startsWith('--'));

if (ids.length === 0) {
  console.error('uso: pnpm calidad <videoId> [--solo-datos] | pnpm calidad --todos');
  process.exit(1);
}

for (const id of ids) {
  const master = leerMaster(id);
  if (master === null) continue;
  const m = analizarMaster(master);
  imprimir(id, m);
  if (!soloDatos && ids.length === 1) {
    const html = await hojaDeContactos(id, master, m);
    if (html !== null) console.log(`\n  hoja de contactos: ${html}`);
  }
  // los shorts del vídeo, con los umbrales del formato
  for (const s of leerShorts(id)) {
    const ms = analizarShort(s.master);
    imprimirShort(s.id, ms);
    if (!soloDatos && ids.length === 1) {
      const html = await hojaDeContactosShort(id, s.id, s.master, ms);
      if (html !== null) console.log(`    hoja de contactos: ${html}`);
    }
  }
}
