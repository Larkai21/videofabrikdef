#!/usr/bin/env node
/* Galería en MOVIMIENTO de todo el catálogo.
 * ---------------------------------------------------------------------------
 * `hoja_contactos.js` congela un instante de cada plantilla y sirve para
 * juzgar composición y color. No sirve para juzgar lo único que una plantilla
 * de motion hace de verdad: MOVERSE. Una entrada que llega tarde, un rebote
 * elástico prohibido por §11 o un texto que se lee a medias solo se ven a 20
 * fotogramas por segundo.
 *
 * Renderiza cada plantilla del catálogo durante unos segundos y deja los
 * fotogramas más un manifiesto. El montaje lo hace `galeria_video.py`, que es
 * quien sabe de ffmpeg — la misma división que entre `render_playwright.js` y
 * `composite_ffmpeg.py`.
 *
 * Escribe FUERA de `build/` por defecto. `build/` está en `~/Documents`, o sea
 * sincronizado con iCloud, y esta herramienta produce miles de PNG: dejarlos
 * ahí arrastra a cualquier cosa que recorra un glob y encima los desaloja.
 *
 * Uso:
 *   node scripts/galeria.js                    # las 56, tema carbon
 *   node scripts/galeria.js --temas carbon,paper
 *   node scripts/galeria.js --only kinetic     # subconjunto, para iterar
 *   node scripts/galeria.js --dur 2.4 --fps 20
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.dirname(__dirname);
const TPL = path.join(RAIZ, 'templates');
const ANCHO = 1080, ALTO = 1920;

/* El corpus de configuraciones ya existe y está mantenido: reutilizarlo evita
   que la galería y la hoja de contactos enseñen dos cosas distintas de la
   misma plantilla. Las que no tienen muestra salen con sus `defaults`, que es
   exactamente lo que un catálogo debe enseñar de ellas. */
const { MUESTRAS } = require('./hoja_contactos.js');

function args() {
  const a = process.argv.slice(2);
  const o = { salida: path.join('/tmp', 'galeria-editor'), dur: 2.8, fps: 20,
              temas: ['carbon'], only: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--salida') o.salida = a[++i];
    else if (a[i] === '--dur') o.dur = Number(a[++i]);
    else if (a[i] === '--fps') o.fps = Number(a[++i]);
    else if (a[i] === '--temas') o.temas = a[++i].split(',');
    /* Lista separada por comas: sirve para montar una galería de lo que
       CAMBIÓ en una tanda, que es distinto de mirar el catálogo entero. */
    else if (a[i] === '--only') o.only = a[++i].split(',').map(x => x.trim());
  }
  return o;
}

/* Copias de conflicto de iCloud: `kicker-hud 2.html` pasa un filtro por
   extensión y no es una plantilla. Mismo patrón que `colocar.py:CANONICO`. */
const CANONICO = /^[a-z0-9-]+\.html$/;

function catalogo() {
  return fs.readdirSync(TPL)
    .filter(f => f.endsWith('.html') && !f.startsWith('_') && CANONICO.test(f))
    .sort();
}

function configDe(f) {
  /* Si una plantilla tiene varias fichas —`rejilla-logos` en sus dos vistas—
     entran TODAS: son variantes que se ven distinto, que es el motivo de que
     tengan ficha propia. */
  const suyas = MUESTRAS.filter(m => m.f === f);
  if (!suyas.length) return [{ etiqueta: f.replace('.html', ''), cfg: {} }];
  return suyas.map(m => ({
    etiqueta: m.etiqueta || f.replace('.html', ''),
    cfg: Object.assign({}, m.cfg)
  }));
}

async function etiquetaPNG(page, texto, sub, destino) {
  /* El rótulo se dibuja en el navegador y no en ffmpeg a propósito: este
     ffmpeg no trae libfreetype ni libass, así que no puede escribir texto.
     Está documentado en CLAUDE.md y es la razón de que TODO el texto del
     proyecto llegue rasterizado desde Playwright. */
  await page.setViewportSize({ width: ANCHO, height: 96 });
  await page.setContent(
    `<body style="margin:0;height:96px;background:#0C0C0E;color:#F5F5F5;` +
    `display:flex;align-items:center;gap:18px;padding:0 40px;` +
    `font:600 34px/1 ui-monospace,Menlo,monospace;letter-spacing:.04em">` +
    `<span>${texto.replace(/[<>&]/g, '')}</span>` +
    `<span style="color:#8A8F9E;font-size:26px;font-weight:400">` +
    `${(sub || '').replace(/[<>&]/g, '')}</span></body>`);
  await page.screenshot({ path: destino });
  await page.setViewportSize({ width: ANCHO, height: ALTO });
}

async function main() {
  const o = args();
  fs.rmSync(o.salida, { recursive: true, force: true });
  fs.mkdirSync(path.join(o.salida, 'frames'), { recursive: true });

  let fichas = [];
  for (const f of catalogo()) {
    if (o.only && !o.only.some(q => f.includes(q))) continue;
    for (const v of configDe(f)) fichas.push({ f, ...v });
  }

  const navegador = await chromium.launch();
  const page = await navegador.newPage({
    viewport: { width: ANCHO, height: ALTO },
    deviceScaleFactor: 1
  });

  const clips = [];
  const t0 = Date.now();
  let n = 0;

  for (const tema of o.temas) {
    for (const ficha of fichas) {
      const slug = String(clips.length).padStart(3, '0') + '_' +
                   ficha.etiqueta.replace(/[^a-z0-9]+/gi, '-') + '_' + tema;
      const dir = path.join(o.salida, 'frames', slug);
      fs.mkdirSync(dir, { recursive: true });

      await page.goto('file://' + path.join(TPL, ficha.f), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);

      let info;
      try {
        info = await page.evaluate(
          cfg => window.TPL.setup(cfg),
          Object.assign({}, ficha.cfg, { tema, modo: 'detalle' }));
      } catch (e) {
        process.stderr.write(`  ⚠ ${ficha.f}: setup() ha fallado — ${e.message}\n`);
        continue;
      }

      /* Se enseña desde 0 y no desde el instante asentado de la hoja de
         contactos: en una galería de motion, la ENTRADA es lo que hay que
         juzgar. Y se corta a `--dur` porque `capitulos` dura 20 s y una
         galería no puede durar veinte minutos. */
      const dur = Math.min(o.dur, info.duration || o.dur);
      const total = Math.max(1, Math.round(dur * o.fps));
      for (let i = 0; i < total; i++) {
        await page.evaluate(t => window.TPL.seek(t), i / o.fps);
        await page.screenshot({
          path: path.join(dir, String(i + 1).padStart(5, '0') + '.png'),
          omitBackground: true
        });
      }

      const etiq = path.join(o.salida, 'frames', '_etiq_' + slug + '.png');
      await etiquetaPNG(page, ficha.etiqueta,
                        `${tema} · ${(info.duration || dur).toFixed(1)}s`, etiq);

      clips.push({
        etiqueta: ficha.etiqueta, plantilla: ficha.f, tema,
        dir, etiqueta_png: etiq, frames: total, fps: o.fps, dur,
        /* Las señales de sonido las publica la plantilla en tiempo RELATIVO a
           su capa; se guardan tal cual y las coloca el montador. */
        cues: (info.cues || []).filter(c => c.at < dur)
      });
      n++;
      if (n % 10 === 0) {
        process.stdout.write(`  ${n}/${fichas.length * o.temas.length} · ` +
          `${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
      }
    }
  }
  /* Rótulos del catálogo de sonidos. Van aquí y no en un script propio
     porque el generador de rótulos ya está en este fichero: separarlo
     obligaría a mantener dos, y el segundo se quedaría atrás. */
  const dirSfx = path.join(RAIZ, 'assets', 'sfx');
  const etiqSfx = path.join(o.salida, 'etiq_sfx');
  let sonidos = 0;
  if (fs.existsSync(dirSfx)) {
    fs.mkdirSync(etiqSfx, { recursive: true });
    for (const w of fs.readdirSync(dirSfx).filter(f => f.endsWith('.wav')).sort()) {
      const n = w.replace('.wav', '');
      await etiquetaPNG(page, n, 'sfx', path.join(etiqSfx, n + '.png'));
      sonidos++;
    }
  }

  await navegador.close();

  const manifiesto = path.join(o.salida, 'galeria.json');
  fs.writeFileSync(manifiesto, JSON.stringify({
    ancho: ANCHO, alto: ALTO, fps: o.fps, clips
  }, null, 2));

  const seg = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({
    clips: clips.length,
    sonidos,
    fotogramas: clips.reduce((s, c) => s + c.frames, 0),
    con_sonido: clips.filter(c => c.cues.length).length,
    segundos: +seg.toFixed(1),
    manifiesto
  }, null, 2));
}

/* Solo si se INVOCA. Sin esta guarda, un `require()` de este fichero lanzaría
   el render entero del catálogo — el mismo fallo que ya costó un montaje en
   `render_playwright.js`. */
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { catalogo, configDe };
