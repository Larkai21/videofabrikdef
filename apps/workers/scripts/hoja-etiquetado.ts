/**
 * Hoja de etiquetado del banco de planos: una página local donde marcar, beat a
 * beat, QUÉ CANDIDATOS SERÍAN ACEPTABLES mirando los fotogramas.
 *
 *   pnpm --filter @fabrica/workers exec tsx scripts/hoja-etiquetado.ts [videoId…]
 *   (sin argumentos: todos los vídeos que aún conserven candidatos vivos)
 *
 * Por qué existe: la métrica que gobierna el matching es «sin disparate»
 * (calibracion/README.md) y exige la etiqueta `aceptables` COMPLETA por beat —
 * qué planos NO harían daño en pantalla. Eso no sale de curar en la timeline
 * (que solo dice cuál eligió el humano) ni del caption (etiquetar leyendo el
 * texto es etiquetar el proxy, no la imagen). Con 25 beats el banco no
 * distingue una mejora real del ruido del juez (±3).
 *
 * OJO con la ventana de tiempo: `beats.candidates` se pone a null al congelar
 * en la ingesta, así que solo se puede etiquetar lo que todavía no se ha
 * producido. Este script avisa de cuántos beats quedan.
 *
 * La página guarda en localStorage mientras trabajas y al final descarga un
 * .jsonl que se funde al banco con `importar-etiquetas.ts`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { and, asc, inArray, isNotNull } from 'drizzle-orm';
import { assets, beats, createDb } from '@fabrica/db';

const RAIZ = path.resolve(process.cwd(), '../..');
const DIR = path.join(RAIZ, 'calibracion', 'etiquetado');
const THUMBS = path.join(DIR, 'thumbs');
const DESTINO = path.join(DIR, 'index.html');
const MIN_CANDIDATOS = 2;

interface CandidatoHoja {
  ref: string;
  provider: string;
  kind: string;
  caption: string;
  cos: number;
  thumb: string;
}

interface BeatHoja {
  video: string;
  beat: number;
  query: string;
  narracion: string;
  candidatos: CandidatoHoja[];
}

/**
 * Las miniaturas se BAJAN a disco en vez de enlazar al CDN del proveedor: los
 * hotlinks de Pexels/Pixabay no se pintan desde una página local, y aunque lo
 * hicieran, etiquetar 149 planos esperando red es media tarde tirada. Los
 * candidatos de biblioteca no traen thumb: se extrae un fotograma con ffmpeg
 * de su propio fichero (o se copia si ya es imagen).
 */
async function thumbLocal(
  c: { ref: string; thumb_url?: string; meta?: Record<string, unknown> },
  rutaAsset: string | null,
): Promise<string> {
  const nombre = `${createHash('sha1').update(c.ref).digest('hex').slice(0, 16)}.jpg`;
  const destino = path.join(THUMBS, nombre);
  if (existsSync(destino)) return destino;

  const url = typeof c.thumb_url === 'string' && c.thumb_url !== '' ? c.thumb_url : null;
  if (url !== null) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return '';
      const crudo = `${destino}.crudo`;
      await fs.writeFile(crudo, Buffer.from(await res.arrayBuffer()));
      // reducir SIEMPRE: los thumbs de stock llegan hasta 1440×2560 y 300 KB, y
      // van incrustados en el HTML — a 400 px pesan ~20 KB y se ven de sobra
      await execa('ffmpeg', [
        '-nostdin', '-loglevel', 'error', '-y', '-i', crudo,
        '-vf', 'scale=400:-2', '-q:v', '4', destino,
      ]);
      await fs.rm(crudo, { force: true });
      return existsSync(destino) ? destino : '';
    } catch {
      return '';
    }
  }

  if (rutaAsset === null) return '';
  const abs = path.isAbsolute(rutaAsset) ? rutaAsset : path.join(RAIZ, 'library', rutaAsset);
  if (!existsSync(abs)) return '';
  try {
    const esImagen = /\.(jpe?g|png|webp|gif)$/i.test(abs);
    await execa('ffmpeg', [
      '-nostdin', '-loglevel', 'error', '-y',
      ...(esImagen ? [] : ['-ss', '1']),
      '-i', abs, '-frames:v', '1', '-vf', 'scale=400:-2', '-q:v', '4', destino,
    ]);
    return existsSync(destino) ? destino : '';
  } catch {
    return '';
  }
}

/** El HTML va autocontenido: se abre con doble clic, sin servidor de por medio. */
function comoDataUri(rutaAbs: string): string {
  if (rutaAbs === '' || !existsSync(rutaAbs)) return '';
  try {
    return `data:image/jpeg;base64,${readFileSync(rutaAbs).toString('base64')}`;
  } catch {
    return '';
  }
}

async function main(): Promise<void> {
  const pedidos = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const { db, client } = createDb();

  const filas = await db
    .select({
      videoId: beats.videoId,
      idx: beats.idx,
      text: beats.text,
      visualQuery: beats.visualQuery,
      candidates: beats.candidates,
      visuals: beats.visuals,
    })
    .from(beats)
    .where(
      pedidos.length > 0
        ? and(inArray(beats.videoId, pedidos), isNotNull(beats.candidates))
        : isNotNull(beats.candidates),
    )
    .orderBy(asc(beats.videoId), asc(beats.idx));

  // rutas de los assets de biblioteca, para sacarles fotograma con ffmpeg
  const refsLib = new Set<string>();
  for (const f of filas) {
    const listas = f.visuals && f.visuals.length > 0 ? f.visuals.map((v) => v.candidates) : [f.candidates ?? []];
    for (const l of listas) for (const c of l ?? []) {
      if (c.provider === 'library') refsLib.add(c.ref.replace('library:', ''));
    }
  }
  const rutaPorAsset = new Map<string, string>();
  if (refsLib.size > 0) {
    const rows = await db
      .select({ id: assets.id, path: assets.path })
      .from(assets)
      .where(inArray(assets.id, [...refsLib]));
    for (const r of rows) rutaPorAsset.set(r.id, r.path);
  }

  mkdirSync(THUMBS, { recursive: true });
  const hojas: BeatHoja[] = [];
  let bajadas = 0;
  for (const f of filas) {
    // se etiqueta POR SUB-PLANO cuando los hay: es la unidad que el juez ve
    const planos =
      f.visuals && f.visuals.length > 0
        ? f.visuals.map((v, i) => ({ q: v.visual_query, cands: v.candidates, sub: i }))
        : [{ q: f.visualQuery, cands: f.candidates ?? [], sub: 0 }];
    for (const p of planos) {
      if (!p.cands || p.cands.length < MIN_CANDIDATOS) continue;
      const candidatos: CandidatoHoja[] = [];
      for (const c of p.cands) {
        const assetId = c.provider === 'library' ? c.ref.replace('library:', '') : null;
        const fichero = await thumbLocal(
          c,
          assetId !== null ? (rutaPorAsset.get(assetId) ?? null) : null,
        );
        const thumb = comoDataUri(fichero);
        if (thumb !== '') bajadas += 1;
        candidatos.push({
          ref: c.ref,
          provider: c.provider,
          kind: (c.meta?.kind as string | undefined) ?? 'clip',
          caption:
            (c.meta?.caption as string | undefined) ??
            (c.meta?.title as string | undefined) ??
            '',
          cos: Number(c.score ?? 0),
          thumb,
        });
      }
      hojas.push({
        video: f.videoId,
        // sub-plano 0 conserva el idx del beat; los demás se marcan con decimal
        // para que la clave siga siendo única y ordenable en el banco
        beat: p.sub === 0 ? f.idx : Number(`${f.idx}.${p.sub}`),
        query: p.q,
        narracion: f.text,
        candidatos,
      });
      if (hojas.length % 10 === 0) {
        process.stdout.write(`\r  preparando miniaturas… ${hojas.length} planos`);
      }
    }
  }
  process.stdout.write(`\r  ${bajadas} miniaturas listas en calibracion/etiquetado/thumbs\n`);

  if (hojas.length === 0) {
    console.error(
      'No hay beats con candidatos vivos. Los candidatos se borran al congelar en la ingesta:\n' +
        'solo se pueden etiquetar vídeos que aún no han pasado por assets.ingest.',
    );
    await client.end();
    process.exitCode = 1;
    return;
  }

  const porVideo = new Map<string, number>();
  for (const h of hojas) porVideo.set(h.video, (porVideo.get(h.video) ?? 0) + 1);

  mkdirSync(path.dirname(DESTINO), { recursive: true });
  writeFileSync(DESTINO, render(hojas));

  console.log(`${hojas.length} planos etiquetables:`);
  for (const [v, n] of porVideo) console.log(`  ${v}  ${n}`);
  console.log(`\nAbre: ${DESTINO}`);
  console.log('Al terminar, descarga el .jsonl y funde con:');
  console.log('  pnpm --filter @fabrica/workers exec tsx scripts/importar-etiquetas.ts <fichero>');
  await client.end();
}

function render(hojas: BeatHoja[]): string {
  const datos = JSON.stringify(hojas).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Etiquetado de planos</title>
<style>
  :root { --bg:#0e1216; --panel:#151b21; --line:#242c34; --fg:#e6e9ec; --fg2:#98a2ac;
          --ok:#58c98a; --acento:#4cc4d4; --mal:#e26a5d; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui, sans-serif; }
  header { position:sticky; top:0; z-index:5; background:var(--panel); border-bottom:1px solid var(--line);
           padding:12px 20px; display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
  header b { font-size:16px; }
  .barra { flex:1; height:6px; background:var(--line); border-radius:3px; overflow:hidden; min-width:120px; }
  .barra i { display:block; height:100%; background:var(--acento); }
  button { background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:6px;
           padding:7px 14px; font:inherit; cursor:pointer; }
  button:hover { border-color:var(--acento); }
  button.primario { background:var(--acento); color:#05252b; border-color:var(--acento); font-weight:600; }
  main { max-width:1180px; margin:0 auto; padding:24px 20px 120px; }
  .narracion { font-size:21px; line-height:1.45; margin:0 0 6px; }
  .query { color:var(--fg2); font:13px ui-monospace, Menlo, monospace; margin-bottom:18px; }
  .rejilla { display:grid; grid-template-columns:repeat(auto-fill, minmax(210px,1fr)); gap:14px; }
  .cand { border:2px solid var(--line); border-radius:10px; overflow:hidden; background:var(--panel);
          cursor:pointer; transition:border-color .12s, transform .12s; position:relative; }
  .cand:hover { transform:translateY(-2px); }
  .cand.si { border-color:var(--ok); }
  .cand img { width:100%; aspect-ratio:16/9; object-fit:cover; display:block; background:#000; }
  .cand .pie { padding:8px 10px; font-size:12.5px; color:var(--fg2); line-height:1.35;
               display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
  .cand .num { position:absolute; top:8px; left:8px; background:rgba(0,0,0,.72); color:#fff;
               border-radius:6px; padding:1px 8px; font:600 13px ui-monospace, monospace; }
  .cand .marca { position:absolute; top:8px; right:8px; width:24px; height:24px; border-radius:50%;
                 background:var(--ok); color:#05251a; display:none; align-items:center;
                 justify-content:center; font-weight:700; }
  .cand.si .marca { display:flex; }
  .cand .meta { position:absolute; bottom:44px; right:8px; background:rgba(0,0,0,.72);
                border-radius:5px; padding:1px 7px; font:11.5px ui-monospace, monospace; color:#cfd6dc; }
  .pie-fijo { position:fixed; bottom:0; left:0; right:0; background:var(--panel);
              border-top:1px solid var(--line); padding:12px 20px; display:flex; gap:12px;
              align-items:center; justify-content:center; flex-wrap:wrap; }
  .ayuda { color:var(--fg2); font-size:13px; }
  kbd { background:var(--line); border-radius:4px; padding:1px 6px; font:12px ui-monospace, monospace; }
  .fin { text-align:center; padding:60px 20px; }
  .fin h2 { font-size:26px; }
</style></head><body>
<header>
  <b>Etiquetado de planos</b>
  <span id="pos" class="ayuda"></span>
  <span class="barra"><i id="prog" style="width:0"></i></span>
  <button id="saltar">Saltar</button>
  <button id="descargar" class="primario">Descargar JSONL</button>
</header>
<main id="main"></main>
<div class="pie-fijo">
  <span class="ayuda"><kbd>1</kbd>…<kbd>9</kbd> marcar · <kbd>0</kbd> ninguno pega ·
  <kbd>Enter</kbd> siguiente · <kbd>←</kbd> atrás</span>
  <button id="ninguno">Ninguno pega (0)</button>
  <button id="siguiente" class="primario">Siguiente (Enter)</button>
</div>
<script>
const HOJAS = ${datos};
const CLAVE = 'etiquetado-planos-v1';
const guardado = JSON.parse(localStorage.getItem(CLAVE) || '{}');
let i = HOJAS.findIndex((h) => guardado[h.video + ':' + h.beat] === undefined);
if (i < 0) i = HOJAS.length;

const $main = document.getElementById('main');
const $pos = document.getElementById('pos');
const $prog = document.getElementById('prog');

function claveDe(h) { return h.video + ':' + h.beat; }
function hechos() { return Object.keys(guardado).length; }

function pinta() {
  const total = HOJAS.length;
  $pos.textContent = hechos() + ' de ' + total + ' hechos';
  $prog.style.width = Math.round((hechos() / total) * 100) + '%';
  if (i >= total) {
    $main.innerHTML = '<div class="fin"><h2>Listo: ' + hechos() + ' planos etiquetados</h2>' +
      '<p class="ayuda">Pulsa «Descargar JSONL» arriba y fúndelo al banco.</p></div>';
    return;
  }
  const h = HOJAS[i];
  const marcados = new Set(guardado[claveDe(h)] || []);
  $main.innerHTML =
    '<p class="narracion">' + escapa(h.narracion) + '</p>' +
    '<p class="query">consulta: ' + escapa(h.query) + ' · ' + h.video + ' · plano ' + h.beat + '</p>' +
    '<div class="rejilla">' + h.candidatos.map((c, n) =>
      '<div class="cand' + (marcados.has(c.ref) ? ' si' : '') + '" data-ref="' + escapa(c.ref) + '">' +
        '<span class="num">' + (n + 1) + '</span>' +
        '<span class="marca">✓</span>' +
        (c.thumb ? '<img loading="lazy" src="' + escapa(c.thumb) + '" alt="">'
                 : '<div style="aspect-ratio:16/9;display:grid;place-items:center;color:#667">sin miniatura</div>') +
        '<span class="meta">' + (c.kind === 'image' ? 'foto' : 'clip') + ' · ' + c.cos.toFixed(2) + '</span>' +
        '<div class="pie">' + escapa(c.caption || '(sin descripción)') + '</div>' +
      '</div>').join('') + '</div>';
  for (const el of $main.querySelectorAll('.cand')) {
    el.addEventListener('click', () => alterna(el.dataset.ref));
  }
}

function escapa(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

function alterna(ref) {
  const h = HOJAS[i];
  const k = claveDe(h);
  const lista = new Set(guardado[k] || []);
  if (lista.has(ref)) lista.delete(ref); else lista.add(ref);
  guardado[k] = [...lista];
  localStorage.setItem(CLAVE, JSON.stringify(guardado));
  pinta();
}

function avanza(delta) {
  const h = HOJAS[i];
  // pasar sin marcar nada cuenta como «ninguno pega» solo si se usó el botón 0;
  // saltar de verdad no escribe etiqueta
  if (delta > 0 && h && guardado[claveDe(h)] === undefined) guardado[claveDe(h)] = [];
  localStorage.setItem(CLAVE, JSON.stringify(guardado));
  i = Math.max(0, Math.min(HOJAS.length, i + delta));
  pinta();
  window.scrollTo({ top: 0 });
}

document.getElementById('siguiente').addEventListener('click', () => avanza(1));
document.getElementById('ninguno').addEventListener('click', () => {
  const h = HOJAS[i];
  if (h) { guardado[claveDe(h)] = []; localStorage.setItem(CLAVE, JSON.stringify(guardado)); }
  avanza(1);
});
document.getElementById('saltar').addEventListener('click', () => { i = Math.min(HOJAS.length, i + 1); pinta(); });
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const h = HOJAS[i];
  if (e.key === 'Enter') { e.preventDefault(); avanza(1); return; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); avanza(-1); return; }
  if (!h) return;
  if (e.key === '0') { e.preventDefault(); guardado[claveDe(h)] = []; localStorage.setItem(CLAVE, JSON.stringify(guardado)); avanza(1); return; }
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= h.candidatos.length) {
    e.preventDefault();
    alterna(h.candidatos[n - 1].ref);
  }
});

document.getElementById('descargar').addEventListener('click', () => {
  const filas = HOJAS.filter((h) => guardado[claveDe(h)] !== undefined).map((h) => {
    const aceptables = guardado[claveDe(h)];
    return JSON.stringify({
      video: h.video,
      beat: h.beat,
      query: h.query,
      narracion: h.narracion,
      // el primero aceptable hace de «elegido» (el orden de la rejilla es el
      // del pipeline): la métrica que importa es la lista de aceptables
      elegido: aceptables.length > 0 ? aceptables[0] : null,
      candidatos: h.candidatos.map((c) => ({
        ref: c.ref, provider: c.provider, kind: c.kind, caption: c.caption, cos: c.cos,
      })),
      aceptables,
    });
  });
  const blob = new Blob([filas.join('\\n') + '\\n'], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'planos-etiquetados-nuevos.jsonl';
  a.click();
});

pinta();
</script></body></html>`;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
