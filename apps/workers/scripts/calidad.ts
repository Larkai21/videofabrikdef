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
import { analizarMaster, masterVideoJsonV1, type MetricasVideo } from '@fabrica/shared';

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
function textoEn(master: ReturnType<typeof masterVideoJsonV1.parse>, ms: number): string {
  const cue = (master.cues ?? []).find((c) => c.from_ms <= ms && c.to_ms >= ms);
  if (cue) return cue.text;
  const beat = (master.beats ?? []).find((b) => b.from_ms <= ms && b.to_ms >= ms);
  return beat?.text.slice(0, 90) ?? '';
}

function reloj(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

async function hojaDeContactos(
  videoId: string,
  master: ReturnType<typeof masterVideoJsonV1.parse>,
  m: MetricasVideo,
): Promise<string | null> {
  const dir = path.join(OUTPUTS, videoId);
  const mp4 = path.join(dir, 'video.mp4');
  if (!existsSync(mp4)) return null;
  const salida = path.join(dir, 'calidad');
  rmSync(path.join(salida, 'fotogramas'), { recursive: true, force: true });
  mkdirSync(path.join(salida, 'fotogramas'), { recursive: true });

  const puntos = momentos(master);
  const celdas: string[] = [];
  for (const [i, p] of puntos.entries()) {
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
      mp4,
      '-frames:v',
      '1',
      '-vf',
      'scale=480:-1',
      '-q:v',
      '4',
      '-y',
      path.join(salida, jpg),
    ]);
    celdas.push(
      `<figure><img src="${jpg}" loading="lazy" alt=""><figcaption>` +
        `<b>${reloj(p.ms)}</b> <span class="et">${escapar(p.etiqueta)}</span><br>` +
        `<span class="d">${escapar(p.detalle)}</span></figcaption></figure>`,
    );
  }

  const avisos = m.avisos
    .map(
      (a) =>
        `<li class="${a.gravedad}">${escapar(a.detalle)}${a.at_ms !== undefined ? ` <b>${reloj(a.at_ms)}</b>` : ''}</li>`,
    )
    .join('');
  const html = `<!doctype html><meta charset="utf-8"><title>Calidad · ${videoId}</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#12171c;color:#e7edf3}
 h1{font-size:20px;margin:0 0 4px} .sub{color:#93a1ad;margin-bottom:20px}
 ul{padding-left:20px;margin:0 0 24px} li{margin:3px 0}
 li.alta{color:#ff8f7a} li.media{color:#ffb224}
 .rej{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
 figure{margin:0;background:#191f26;border:1px solid #242c35;border-radius:8px;overflow:hidden}
 img{width:100%;display:block;aspect-ratio:16/9;object-fit:cover;background:#000}
 figcaption{padding:8px 10px;font-size:12px}
 .et{color:#4cc2ff;font-family:ui-monospace,monospace}
 .d{color:#93a1ad}
</style>
<h1>${escapar(master.seo?.titles?.[master.seo.chosen_idx ?? 0] ?? videoId)}</h1>
<div class="sub">${m.duracion_min.toFixed(1)} min · ${m.beats} beats · ${m.planos} planos · ${m.efectos} efectos</div>
${avisos ? `<ul>${avisos}</ul>` : '<p>Sin avisos.</p>'}
<div class="rej">${celdas.join('')}</div>`;
  writeFileSync(path.join(salida, 'informe.html'), html);
  return path.join(salida, 'informe.html');
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
}
