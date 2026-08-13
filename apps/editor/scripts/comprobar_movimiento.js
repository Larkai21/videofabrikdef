/* ===========================================================================
   ¿Se mueve la plantilla DURANTE TODA su duración?
   ---------------------------------------------------------------------------
   `humo_plantillas.js` ya pregunta «¿se mueve?», pero lo hace con TRES
   instantes: 0,15 · el de la ficha · el 90 % de la duración. Con tres muestras
   basta para cazar una plantilla muerta del todo, y no basta para nada más:
   una capa puede tener los tres hashes distintos y aun así estar congelada
   byte a byte durante el 30 % de su tiempo en pantalla, porque la acción se
   agota en el primer tercio y el fundido de salida no arranca hasta el último
   cuarto. En medio no se anima nada.

   Eso salió auditando una tanda de micro-FX y no había forma de verlo con el
   arnés que había: cinco de once pasaban el humo con tramos muertos de entre
   0,20 y 0,40 segundos, hasta el 31 % de la capa.

   Aquí se renderiza la capa ENTERA a 30 fotogramas por segundo y se mide la
   diferencia de cada fotograma con el anterior. Se informa del tramo muerto
   más largo y de qué fracción de la capa ocupa.

   --- por qué el umbral es 6 de 255 ---

   La comparación no puede ser «bytes iguales o distintos»: un fotograma puede
   cambiar en 26 píxeles de dos millones con un delta de 3, dar un hash
   distinto y estar quieto para cualquier ojo. Pasó literalmente: una plantilla
   declaraba en un comentario haber arreglado sus «catorce fotogramas idénticos
   byte a byte» con una luz que no para, y la luz movía como mucho 10 de 255
   acumulado sobre dieciocho fotogramas. Sobrevivía al detector y no a la
   vista, y desaparece del todo al codificar en H.264.

   6/255 es 2,4 % de la escala. Por debajo de eso el cuantizador de H.264 a
   CRF 17-23 se lo come en cualquier bloque que no sea un plano liso, así que
   un cambio menor no llega al vídeo entregado.

   --- por qué se mide a media resolución ---

   `deviceScaleFactor: 0.5` rasteriza a 540×960 con la MISMA maquetación: solo
   cambia el muestreo. Cuesta la cuarta parte y además promedia el antialiasing
   de las fuentes variables, que es ruido para esta pregunta —un glifo cuyo
   borde cambia medio nivel no es movimiento—.

   Uso:
       node scripts/comprobar_movimiento.js               # las 56
       node scripts/comprobar_movimiento.js --solo cita.html
       node scripts/comprobar_movimiento.js --umbral 6 --fps 30
       node scripts/comprobar_movimiento.js --json
   =========================================================================== */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const RAIZ = path.dirname(__dirname);
const TPL = path.join(RAIZ, 'templates');
/* entorno > PATH > Homebrew, resuelto UNA vez en comun.js para todos. */
const { FFMPEG } = require('./comun.js');

/* El corpus de configuraciones de la hoja de contactos, por el mismo motivo
   que lo reutiliza el humo: que las dos pruebas miren la misma plantilla. */
const { MUESTRAS } = require('./hoja_contactos.js');
const porMuestra = new Map();
MUESTRAS.forEach(m => {
  if (!porMuestra.has(m.f)) porMuestra.set(m.f, []);
  porMuestra.get(m.f).push(m);
});

function args() {
  const a = process.argv.slice(2);
  const o = { umbral: 6, fps: 30, solo: null, json: false, tema: 'carbon',
              /* Un tramo muerto de menos de 4 fotogramas (0,13 s) es una
                 pausa, no una congelación: hay gestos que se asientan. */
              minTramo: 4 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--umbral') o.umbral = Number(a[++i]);
    else if (a[i] === '--fps') o.fps = Number(a[++i]);
    else if (a[i] === '--solo') o.solo = a[++i];
    else if (a[i] === '--tema') o.tema = a[++i];
    else if (a[i] === '--min-tramo') o.minTramo = Number(a[++i]);
    else if (a[i] === '--json') o.json = true;
  }
  return o;
}

function plantillas() {
  return fs.readdirSync(TPL)
    .filter(f => f.endsWith('.html') && !f.startsWith('_'))
    .sort();
}

/* Diferencia máxima de cada fotograma contra el que está `salto` fotogramas
   antes, en UNA pasada de ffmpeg. Con `salto = 1` es la diferencia contra el
   anterior; con `salto = 15` (medio segundo) es otra pregunta distinta, y es
   la que de verdad importa.

   --- por qué hacen falta las dos ---

   `Engine.flota` deriva 3 px con un periodo de unos 8 segundos. Entre dos
   fotogramas consecutivos eso son 3 · 2π/8 · 1/30 ≈ 0,08 px: por debajo de
   cualquier umbral razonable. O sea que midiendo solo contra el fotograma
   anterior, una plantilla que SÍ cumple §10 sale marcada como muerta.

   Y al revés: medio segundo de deriva son ~1,2 px, que ya se ve. §10 no pide
   que algo cambie entre dos fotogramas —eso es un efecto—, pide que la imagen
   no sea una captura fija, y eso se mide en segundos.

   Con dos entradas de la misma secuencia, una arrancada `salto` fotogramas
   más adelante, `blend=difference` da exactamente eso. */
function deltas(dir, salto) {
  const n = fs.readdirSync(dir).filter(x => x.endsWith('.png')).length;
  if (n <= salto) return [];
  const args = ['-v', 'error',
    '-framerate', '30', '-start_number', '0', '-i', path.join(dir, '%05d.png'),
    '-framerate', '30', '-start_number', String(salto), '-i', path.join(dir, '%05d.png'),
    '-filter_complex',
      '[0:v]format=gray[a];[1:v]format=gray[b];' +
      '[a][b]blend=all_mode=difference,signalstats,' +
      'metadata=print:key=lavfi.signalstats.YMAX:file=-',
    '-f', 'null', '-'];
  let salida = '';
  try {
    salida = execFileSync(FFMPEG, args,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
  } catch (e) {
    salida = String((e && e.stdout) || '');
  }
  return [...salida.matchAll(/YMAX=(\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
}

/* El tramo de fotogramas consecutivos más largo por debajo del umbral. */
function tramoMuerto(ds, umbral, minTramo) {
  let mejor = { largo: 0, desde: 0 }, largo = 0, desde = 0;
  ds.forEach((d, i) => {
    if (d <= umbral) {
      if (largo === 0) desde = i;
      largo++;
      if (largo > mejor.largo) mejor = { largo, desde };
    } else largo = 0;
  });
  return mejor.largo >= minTramo ? mejor : { largo: 0, desde: 0 };
}

async function medir(page, f, muestra, o, tmp) {
  const cfg = Object.assign({ tema: o.tema }, muestra ? muestra.cfg : {});
  await page.goto('file://' + path.join(TPL, f), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const info = await page.evaluate(c => window.TPL.setup(c), cfg);
  /* Las fuentes se vuelven a esperar DESPUÉS de `setup`: una familia que solo
     usa un nodo creado ahí no estaba pendiente cuando se preguntó antes, y el
     primer fotograma saldría con el respaldo. */
  await page.evaluate(() => document.fonts.ready);
  const dur = (info && info.duration) || 5;
  const n = Math.max(2, Math.round(dur * o.fps));

  const dir = fs.mkdtempSync(path.join(tmp, 'mov-'));
  for (let i = 0; i < n; i++) {
    await page.evaluate(t => window.TPL.seek(t), +(i / o.fps).toFixed(4));
    await page.screenshot({
      path: path.join(dir, String(i).padStart(5, '0') + '.png'),
      omitBackground: false,
    });
  }
  /* Dos preguntas distintas sobre la misma secuencia:
       `dsA` — ¿ha pasado algo en el último SEXTO de segundo?   (el gesto)
       `dsB` — ¿la imagen de dentro de medio segundo es otra?   (§10)

     `dsA` iba contra el fotograma ANTERIOR y eso medía mal: con el umbral en
     6/255, exigir ese salto entre dos fotogramas consecutivos es exigir
     180/255 POR SEGUNDO, o sea un destello. Medido en `gold-glint`, cuya luz
     recorre la pieza durante toda la capa: 2/255 entre fotogramas seguidos y
     15/255 a tres décimas. La luz se mueve, y el H.264 la conserva porque el
     codificador no cuantiza cada delta por separado — ve la rampa a lo largo
     del GOP. Con la medida contra el anterior, una rampa lenta salía marcada
     como gesto parado.

     Cinco fotogramas (un sexto de segundo) es el tramo más corto en el que un
     ojo distingue «se está moviendo» de «está quieto». Un gesto que no cambia
     nada en ese tiempo sí está parado. */
  const dsA = deltas(dir, Math.max(1, Math.round(o.fps / 6)));
  const dsB = deltas(dir, Math.max(1, Math.round(o.fps / 2)));
  fs.rmSync(dir, { recursive: true, force: true });

  /* DOS tramos, porque son dos fallos distintos y hay que verlos los dos:
       `tramo_efecto` — fotogramas consecutivos idénticos. El gesto se ha
                        parado en seco a mitad de camino. Es lo que vio el
                        auditor de los micro-FX: seis viñetas iguales.
       `tramo_imagen` — medio segundo sin que la imagen cambie. Es la captura
                        fija que §10 prohíbe.
     Un gesto puede pararse tres fotogramas sin que la capa sea una foto, y una
     capa puede ser una foto sin que ningún fotograma sea idéntico al anterior
     —basta un ruido de un nivel—. Con una sola medida se pierde uno de los
     dos. */
  const tA = tramoMuerto(dsA, o.umbral, o.minTramo);
  const t = tramoMuerto(dsB, o.umbral, o.minTramo);
  const med = xs => xs.length ? +[...xs].sort((a, b) => a - b)[xs.length >> 1].toFixed(1) : 0;
  return {
    plantilla: f,
    variante: (muestra && muestra.etiqueta) || f,
    duracion: +dur.toFixed(2),
    fotogramas: n,
    mediana_f: med(dsA),          // movimiento entre fotogramas: el efecto
    mediana_s: med(dsB),          // movimiento a medio segundo: §10
    /* El tramo muerto se mide SIEMPRE sobre `dsB`: es la pregunta de §10.
       Un gesto puede pararse tres fotogramas y eso no es una captura fija. */
    tramo_efecto: tA.largo,
    efecto_desde: +(tA.desde / o.fps).toFixed(2),
    tramo_muerto: t.largo,
    tramo_desde: +(t.desde / o.fps).toFixed(2),
    frac_tramo: dsB.length ? +(t.largo / dsB.length).toFixed(3) : 0,
    frac_efecto: dsA.length ? +(tA.largo / dsA.length).toFixed(3) : 0,
  };
}

async function main() {
  const o = args();
  const lista = o.solo ? [o.solo] : plantillas();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'movimiento-'));
  const nav = await chromium.launch();
  const page = await nav.newPage({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 0.5,
  });

  const fuera = [];
  for (const f of lista) {
    for (const muestra of (porMuestra.get(f) || [null])) {
      try {
        fuera.push(await medir(page, f, muestra, o, tmp));
      } catch (e) {
        fuera.push({ plantilla: f, variante: f, error: String(e.message).slice(0, 160) });
      }
    }
  }
  await nav.close();
  fs.rmSync(tmp, { recursive: true, force: true });

  if (o.json) { process.stdout.write(JSON.stringify(fuera, null, 1)); return; }

  const malas = fuera.filter(x => x.tramo_muerto >= o.minTramo)
                     .sort((a, b) => b.frac_tramo - a.frac_tramo);
  const parones = fuera.filter(x => x.tramo_efecto >= o.minTramo &&
                                    x.tramo_muerto < o.minTramo)
                       .sort((a, b) => b.frac_efecto - a.frac_efecto);
  process.stdout.write(
    `\n  ${fuera.length} fichas · umbral ${o.umbral}/255 · ${o.fps} fps · ` +
    `tramo mínimo ${o.minTramo} fotogramas\n` +
    `  el tramo muerto se mide a MEDIO SEGUNDO de distancia, no contra el ` +
    `fotograma anterior:\n  §10 pide que la imagen no sea una captura fija, ` +
    `y eso se mide en segundos.\n\n`);
  if (!malas.length) {
    process.stdout.write('  ✓ ninguna ficha tiene un tramo muerto\n\n');
  } else {
    process.stdout.write(
      `  ${malas.length} ficha(s) con un tramo QUIETO en medio:\n\n`);
    for (const m of malas) {
      process.stdout.write(
        `    ${m.variante.padEnd(28)} ${String(m.tramo_muerto).padStart(3)} f ` +
        `(${(m.frac_tramo * 100).toFixed(0).padStart(2)} % de la capa) ` +
        `desde t=${m.tramo_desde}s · mediana ½s ${m.mediana_s} · ` +
        `entre fotogramas ${m.mediana_f}\n`);
    }
    process.stdout.write(
      '\n  Un tramo muerto no lo ve `humo_plantillas.js`: con tres muestras\n' +
      '  los hashes salen distintos y la capa está parada en medio.\n\n');
  }
  if (parones.length) {
    process.stdout.write(
      `  ${parones.length} ficha(s) SIN captura fija pero con el GESTO PARADO:\n` +
      `  no cambia nada en un sexto de segundo, aunque la imagen sí cambie a\n` +
      `  medio segundo. No incumplen §10; el efecto se queda a medias:\n\n`);
    for (const m of parones) {
      process.stdout.write(
        `    ${m.variante.padEnd(28)} ${String(m.tramo_efecto).padStart(3)} f ` +
        `(${(m.frac_efecto * 100).toFixed(0).padStart(2)} %) ` +
        `desde t=${m.efecto_desde}s\n`);
    }
    process.stdout.write('\n');
  }
  process.exitCode = malas.length ? 1 : 0;
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
} else {
  module.exports = { tramoMuerto, deltas };
}
