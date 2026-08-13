#!/usr/bin/env node
/**
 * Una plantilla, rasterizada y MEDIDA. Para juzgar mirando y no leyendo.
 *
 *     node scripts/ver_plantilla.js hf-x-post
 *     node scripts/ver_plantilla.js hf-x-post 0.2 0.6 1.1     # instantes
 *     node scripts/ver_plantilla.js hf-x-post --config '{"zona":"abajo"}'
 *
 * Escribe `build/ver/<plantilla>-<t>.png` con alfa y saca por pantalla la
 * caja de tinta en píxeles de lienzo, qué fracción del ancho y del alto
 * ocupa, y si se sale por algún lado.
 *
 * Existe porque el humo dice «pasa» o «no pasa» sobre las 183, y para
 * rehacer la maqueta de UNA hace falta lo contrario: el detalle de esa, en
 * el instante que uno elija, en menos de dos segundos.
 *
 * La fracción del ancho es el número que importa cuando se traen bloques de
 * 1920x1080 a un lienzo de 1080x1920: encajados a escala ocupan la mitad de
 * lo que deberían, y eso no lo dice ninguna puerta — solo se ve.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.dirname(__dirname);
const TPL = path.join(RAIZ, 'templates');
const SALIDA = path.join(RAIZ, 'build', 'ver');
const W = 1080, H = 1920;

/* La caja de TINTA, no la del DOM: se mide sobre el canal alfa del PNG, que
 * es lo que de verdad acaba en el vídeo. Un contenedor de 1080x1920 con un
 * texto de 300 px dentro tiene caja de DOM completa y tinta pequeña. */
function cajaAlfa(png) {
  const { execFileSync } = require('child_process');
  /* entorno > PATH > Homebrew, resuelto UNA vez en comun.js para todos. */
const { FFMPEG } = require('./comun.js');
  const w = 108, h = 192;
  const buf = execFileSync(FFMPEG, ['-nostdin', '-v', 'error', '-i', png,
    '-vf', 'alphaextract,scale=' + w + ':' + h, '-f', 'rawvideo',
    '-pix_fmt', 'gray', '-'], { maxBuffer: 1e8 });
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let fila = 0; fila < h; fila++) {
    for (let col = 0; col < w; col++) {
      if (buf[fila * w + col] < 24) continue;
      if (col < x0) x0 = col;
      if (col > x1) x1 = col;
      if (fila < y0) y0 = fila;
      if (fila > y1) y1 = fila;
    }
  }
  if (x1 < 0) return null;
  const kx = W / w, ky = H / h;
  return { x0: Math.round(x0 * kx), x1: Math.round((x1 + 1) * kx),
           y0: Math.round(y0 * ky), y1: Math.round((y1 + 1) * ky) };
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.log('uso: node scripts/ver_plantilla.js <plantilla> [t…] '
                + "[--config '{\"clave\":valor}']");
    process.exit(2);
  }
  const nombre = args[0].replace(/\.html$/, '');
  const iCfg = args.indexOf('--config');
  const cfg = iCfg > 0 ? JSON.parse(args[iCfg + 1]) : {};
  const ts = args.slice(1, iCfg > 0 ? iCfg : undefined).map(Number).filter(x => !isNaN(x));

  const ruta = path.join(TPL, nombre + '.html');
  if (!fs.existsSync(ruta)) {
    console.error('no existe templates/%s.html', nombre);
    process.exit(2);
  }
  fs.mkdirSync(SALIDA, { recursive: true });

  const { chromium } = require(path.join(RAIZ, 'node_modules', 'playwright'));
  const nav = await chromium.launch();
  const p = await nav.newPage({ viewport: { width: W, height: H } });
  const fallos = [];
  p.on('pageerror', e => fallos.push(e.message));
  p.on('console', m => { if (m.type() === 'error') fallos.push('console: ' + m.text()); });
  await p.goto('file://' + ruta);
  await p.waitForTimeout(400);

  const info = await p.evaluate(c => window.TPL.setup(c), cfg);
  const dur = (cfg && cfg.duration) || info.duration;
  const instantes = ts.length ? ts : [dur * 0.25, dur * 0.55, dur * 0.9];

  console.log(nombre + '   duración ' + dur.toFixed(2) + ' s   cues '
              + (info.cues || []).length);
  for (const t of instantes) {
    await p.evaluate(x => window.TPL.seek(x), t);
    const png = path.join(SALIDA, nombre + '-' + t.toFixed(2) + '.png');
    await p.screenshot({ path: png, omitBackground: true });
    const c = cajaAlfa(png);
    if (!c) { console.log('  t=%s   VACÍO', t.toFixed(2)); continue; }
    const fw = (c.x1 - c.x0) / W, fh = (c.y1 - c.y0) / H;
    const fuera = [];
    if (c.x0 <= 0) fuera.push('izquierda');
    if (c.x1 >= W) fuera.push('derecha');
    if (c.y0 <= 0) fuera.push('arriba');
    if (c.y1 >= H) fuera.push('abajo');
    console.log('  t=%s   x %d-%d  y %d-%d   ancho %d%%  alto %d%%%s',
                t.toFixed(2), c.x0, c.x1, c.y0, c.y1,
                Math.round(fw * 100), Math.round(fh * 100),
                fuera.length ? '   toca el borde: ' + fuera.join(', ') : '');
  }
  const anc = await p.evaluate(() => window.TPL.anclas && window.TPL.anclas());
  if (anc) console.log('  anclas: %s', JSON.stringify(anc));
  if (fallos.length) console.log('  ERRORES: %s', fallos.slice(0, 3).join(' · '));
  console.log('  PNG en build/ver/');
  await nav.close();
})();
