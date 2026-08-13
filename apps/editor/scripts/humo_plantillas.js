#!/usr/bin/env node
/* =====================================================================
   Humo de todo el catálogo: cada plantilla se abre, se configura y se
   mueve. Emite JSON por stdout para que `tests/test_plantillas.py` lo
   afirme; se puede ejecutar solo para diagnosticar.

   ES UN NIVEL RÁPIDO, no opt-in, y el número está medido en el propio
   repo: `hoja_contactos.js` hace 56 capturas a 1080x1920 en 6,45 s, o sea
   0,115 s por captura. Lo caro de este pipeline son los fotogramas de una
   pieza —1431 en la última—, no abrir el navegador.

   NO COMPARA PÍXELES con nada de referencia, a propósito: el ítem J del
   ROADMAP dice que el render multicapa a 25 fps no es bit a bit
   reproducible, así que cualquier golden de píxeles nace inestable. Todo
   lo que se comprueba aquí sale del DOM y del canal alfa, que es 100 veces
   más barato y más específico. Lo único que se compara es una captura
   contra OTRA de la misma plantilla, para saber si se mueve.

   Uso:
     node scripts/humo_plantillas.js
     node scripts/humo_plantillas.js --tema paper
     node scripts/humo_plantillas.js --solo cierre-cta.html
   ===================================================================== */

const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RAIZ = fs.realpathSync(path.dirname(__dirname));
const TPL = path.join(RAIZ, 'templates');
const { MUESTRAS } = require(path.join(RAIZ, 'scripts', 'hoja_contactos.js'));

const ANCHO = 1080, ALTO = 1920;

/* Cobertura de alfa aceptable. Los dos extremos son fallos reales que ya han
   pasado en este repo:
     · por debajo, una capa VACÍA —una fuente que falta, un `omitBackground`
       mal puesto— que ningún log delata;
     · por encima, una capa OPACA que taparía el A-Roll sin declararlo.
   El margen es ancho a propósito: aquí se busca «no se ve nada» / «se ve
   todo», no juzgar el diseño. */
const ALFA_MIN = 0.002, ALFA_MAX = 0.98;

function args() {
  const a = process.argv.slice(2), o = { tema: 'carbon', solo: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--tema') o.tema = a[++i];
    else if (a[i] === '--solo') o.solo = a[++i];
  }
  return o;
}

function plantillas() {
  return fs.readdirSync(TPL)
    .filter(f => f.endsWith('.html') && !f.startsWith('_'))
    .sort();
}

/* La config de muestra de `hoja_contactos.js` trae el instante en el que la
   animación está ASENTADA, que es el dato que no se puede adivinar. Se
   reutiliza en vez de inventar otro corpus: 41 de las 56 lo tienen.
   El número cuenta PLANTILLAS DISTINTAS y no fichas: hay 45 fichas para
   esas 41 porque algunas se muestran dos veces —`rejilla-logos` en sus dos
   vistas, por ejemplo—. La cuenta anterior decía 42 y era el de fichas. */
/* Un fichero puede tener VARIAS muestras, y hay que probarlas todas. Antes
   esto era `new Map(MUESTRAS.map(m => [m.f, m]))`: un Map se queda con la
   última clave repetida, así que de `data-diagram`, `chat-bubbles`, `marcos` y
   `rejilla-logos` —las cuatro que se muestran en dos vistas— solo se probaba
   UNA, y siempre la segunda. Son 4 de las 45 fichas que no comprobaba nadie:
   la vista de nodos de `data-diagram` podía estar rota entera y el humo salía
   verde. El propio comentario de aquí decía que hay 45 fichas para 41
   plantillas y aun así indexaba por fichero. */
const porMuestra = new Map();
MUESTRAS.forEach(m => {
  if (!porMuestra.has(m.f)) porMuestra.set(m.f, []);
  porMuestra.get(m.f).push(m);
});

async function probar(page, f, tema, muestra) {
  const r = { plantilla: f, tema, problemas: [], avisos: [] };
  /* La identidad de cara al golden y a los mensajes: la etiqueta si la ficha
     la trae, y si no el fichero. Sin esto dos variantes del mismo fichero se
     pisan también en `anclas.json`. */
  r.variante = (muestra && muestra.etiqueta) || f;
  r.con_muestra = !!muestra;
  const cfg = Object.assign({ tema }, muestra ? muestra.cfg : {});

  await page.goto('file://' + path.join(TPL, f), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  // --- setup ---
  let info;
  try {
    info = await page.evaluate(c => window.TPL.setup(c), cfg);
  } catch (e) {
    r.problemas.push('setup() lanza: ' + String(e.message).slice(0, 160));
    return r;
  }
  if (!info || typeof info.duration !== 'number' || !(info.duration > 0)) {
    r.problemas.push('setup() no devuelve una duración positiva: ' +
                     JSON.stringify(info));
    return r;
  }
  r.duration = info.duration;
  r.cues = (info.cues || []).length;

  const dur = cfg.duration || info.duration;

  // --- el motor ha aplicado tema y modo ---
  const dom = await page.evaluate(() => ({
    tema: document.documentElement.dataset.tema,
    modo: document.body.dataset.modo,
    opaca: (() => {
      const est = getComputedStyle(document.documentElement);
      const m = (est.backgroundColor.match(/[\d.]+/g) || []);
      const alfa = m.length === 4 ? Number(m[3])
                 : (est.backgroundColor === 'transparent' ? 0 : 1);
      const img = est.backgroundImage;
      return alfa > 0.001 || (img && img !== 'none');
    })(),
    declarada: !!document.querySelector('meta[name="capa-opaca"]'),
    /* Qué familia resuelve DE VERDAD cada rol tipográfico. Se mide aquí y no
       leyendo `~/Library/Fonts` porque este es el mismo Chromium que rasteriza
       los PNG: lo que él no encuentre, no sale en el vídeo, diga lo que diga
       el sistema de ficheros.

       Existe por un fallo concreto y caro: `CLAUDE.md` y `BRAND_RULES.md`
       afirmaron durante semanas que «ninguna fuente de marca está instalada,
       todo cae a SF Pro y Menlo». Era falso —están las once—, y mientras esa
       frase estuvo escrita el aspecto genérico del catálogo se atribuyó a ella
       y nadie buscó la causa real. Una afirmación falsa en la documentación es
       un diagnóstico bloqueado, y la única forma de que no vuelva a pasar es
       que la compruebe una máquina. */
    fuentes: (() => {
      /* NO se usa `document.fonts.check`, y esto costó una vuelta entera:
         **devuelve `true` para una familia que no existe**. Solo informa de
         si hay cargas `@font-face` pendientes; el emparejado de familias de
         CSS nunca «falla» —cae al respaldo— así que siempre dice que sí.
         Comprobado: `check('400 40px "Fuente Que No Existe"')` → true.

         La medida que sí vale es el ANCHO. Se compone la misma cadena con la
         familia sobre DOS respaldos muy distintos: si la familia está, gana en
         los dos casos y los anchos coinciden; si no está, cada respaldo mide
         lo suyo y difieren. Es la única forma de preguntarle al navegador algo
         que no pueda contestar de oído. */
      const s = document.createElement('span');
      s.style.cssText = 'position:absolute;left:-9999px;top:0;font-size:96px;' +
                        'white-space:pre;visibility:hidden';
      s.textContent = 'mmmmmwwwwwiiiii0123';
      document.body.appendChild(s);
      const ancho = pila => { s.style.fontFamily = pila; return s.getBoundingClientRect().width; };
      const hay = fam => {
        const q = '"' + fam + '"';
        return Math.abs(ancho(q + ', serif') - ancho(q + ', monospace')) < 0.5;
      };

      const est = getComputedStyle(document.documentElement);
      const fuera = {};
      for (const rol of ['display', 'subs', 'mono']) {
        const pila = est.getPropertyValue('--' + rol).trim();
        const cand = pila.split(',').map(x => x.trim().replace(/^["']|["']$/g, ''))
                         .filter(x => !/^(serif|sans-serif|monospace|system-ui|cursive)$/.test(x));
        fuera[rol] = cand.find(hay) || null;
        fuera[rol + '_pedida'] = cand[0];
      }
      s.remove();
      return fuera;
    })(),
  }));
  /* Aviso y no problema: depende de la máquina, y un arnés que se pone rojo
     por el entorno de quien lo ejecuta se desactiva. Pero queda ESCRITO en la
     salida, que es lo que faltaba. */
  for (const rol of ['display', 'subs', 'mono']) {
    if (!dom.fuentes[rol]) {
      r.problemas.push(`ninguna familia de --${rol} está instalada; el texto ` +
                       `saldrá con la del sistema`);
    } else if (dom.fuentes[rol] !== dom.fuentes[rol + '_pedida']) {
      r.avisos.push(`--${rol} pide «${dom.fuentes[rol + '_pedida']}» y usa ` +
                    `«${dom.fuentes[rol]}»: el respaldo, no la de marca`);
    }
  }
  r.fuentes = { display: dom.fuentes.display, subs: dom.fuentes.subs,
                mono: dom.fuentes.mono };
  if (dom.tema !== tema) {
    r.problemas.push(`el tema no se ha aplicado: dataset.tema=${dom.tema}`);
  }
  if (dom.modo !== 'detalle') {
    r.problemas.push(`body.dataset.modo=${dom.modo}, se esperaba «detalle». ` +
                     'La plantilla usa `modo` como clave propia y el ' +
                     'renderizador la reserva.');
  }
  /* El fondo del elemento RAÍZ queda fuera del grupo de opacidad del body, así
     que `omitBackground` no puede recortarlo y los PNG salen SIN canal alfa.
     El renderizador ya lo comprueba por capa; aquí se cubren las 56 de una vez. */
  if (dom.opaca && !dom.declarada) {
    r.problemas.push('la raíz es opaca y no lo declara con ' +
                     '<meta name="capa-opaca">: los PNG saldrían sin alfa');
  }
  r.opaca_declarada = dom.declarada;

  // --- seek en los bordes: es donde revienta un slice ---
  for (const t of [0, dur / 2, dur, -1, dur * 2]) {
    try {
      await page.evaluate(tt => window.TPL.seek(tt), t);
    } catch (e) {
      r.problemas.push(`seek(${t.toFixed(2)}) lanza: ` +
                       String(e.message).slice(0, 120));
    }
  }

  // --- anclas dentro del lienzo ---
  const anclas = await page.evaluate(() => window.TPL.anclas());
  if (anclas) {
    for (const [k, c] of Object.entries(anclas)) {
      const finitos = ['x', 'y', 'w', 'h'].every(
        p => Number.isFinite(Number(c[p])));
      if (!finitos) {
        r.problemas.push(`el ancla «${k}» tiene valores no finitos: ` +
                         JSON.stringify(c));
        continue;
      }
      /* Caza el fallo de la tanda 6: una tarjeta que animaba su propio nodo
         borraba el `translateX(-50%)` que la centra y aparecía clavada por su
         borde izquierdo, medio fuera de cuadro. */
      if (c.x - c.w / 2 < -c.w * 0.5 || c.x + c.w / 2 > ANCHO + c.w * 0.5 ||
          c.y < -ALTO * 0.5 || c.y > ALTO * 1.5) {
        r.problemas.push(`el ancla «${k}» cae fuera del lienzo: ` +
                         JSON.stringify(c));
      }
    }
    r.anclas = Object.keys(anclas).length;
  }

  // --- ¿se mueve de verdad? ---
  /* `dataset.frameReady` solo prueba que `seek` se ejecutó. Que la plantilla
     SE MUEVA hay que verlo: se capturan tres instantes y se comparan sus
     hashes. Una plantilla congelada pasa hoy todos los demás controles. */
  const instantes = muestra ? [0.15, muestra.t, dur * 0.9]
                            : [0.15, dur * 0.5, dur * 0.9];
  const hashes = [], coberturas = [];
  for (const t of instantes) {
    await page.evaluate(tt => window.TPL.seek(tt), Math.max(0, t));
    const buf = await page.screenshot({ omitBackground: true });
    hashes.push(crypto.createHash('md5').update(buf).digest('hex'));
    coberturas.push(await page.evaluate(() => {
      /* Fracción de píxeles con contenido. Se mide en el DOM y no
         decodificando el PNG: es un orden de magnitud más barato y basta para
         distinguir «vacío» de «lleno». */
      const cuenta = document.querySelectorAll(
        '.stage *:not(script):not(style)').length;
      const r = document.querySelector('.stage')
        ? document.querySelector('.stage').getBoundingClientRect() : null;
      return { nodos: cuenta, ancho: r ? r.width : 0, alto: r ? r.height : 0 };
    }));
  }
  r.hashes = hashes.map(h => h.slice(0, 8));
  if (new Set(hashes).size === 1) {
    r.problemas.push('los tres instantes dan el MISMO fotograma: la ' +
                     'plantilla no se mueve');
  }

  // --- cobertura de alfa del fotograma asentado ---
  await page.evaluate(tt => window.TPL.seek(tt), muestra ? muestra.t : dur * 0.5);
  const png = await page.screenshot({ omitBackground: true });
  r.bytes = png.length;
  /* Un PNG con alfa totalmente transparente comprime a casi nada. El umbral
     está calibrado sobre el catálogo: la capa más ligera con contenido real
     ronda los 3 KB. */
  if (png.length < 2500) {
    r.problemas.push(`el fotograma pesa ${png.length} bytes: está vacío`);
  }

  return r;
}

async function main() {
  const o = args();
  const lista = o.solo ? [o.solo] : plantillas();
  const navegador = await chromium.launch();
  const page = await navegador.newPage({
    viewport: { width: ANCHO, height: ALTO },
    deviceScaleFactor: 1,
  });

  const t0 = Date.now();
  const fuera = [];
  for (const f of lista) {
    /* `[null]` cuando no hay ficha: la plantilla se prueba igual con sus
       defectos, que es como se probaban las 15 sin muestra. */
    for (const muestra of (porMuestra.get(f) || [null])) {
      try {
        fuera.push(await probar(page, f, o.tema, muestra));
      } catch (e) {
        fuera.push({ plantilla: f, variante: (muestra && muestra.etiqueta) || f,
                     tema: o.tema,
                     problemas: ['excepción: ' + String(e.message).slice(0, 200)] });
      }
    }
  }
  await navegador.close();

  const malas = fuera.filter(x => x.problemas.length);
  const resumen = {
    tema: o.tema,
    plantillas: fuera.length,
    con_muestra: fuera.filter(x => x.con_muestra).length,
    con_problemas: malas.length,
    segundos: +((Date.now() - t0) / 1000).toFixed(2),
    resultados: fuera,
  };
  process.stdout.write(JSON.stringify(resumen, null, 1));

  for (const m of malas) {
    process.stderr.write(`\n  ✗ ${m.variante || m.plantilla}\n`);
    m.problemas.forEach(p => process.stderr.write(`      ${p}\n`));
  }
  process.stderr.write(
    `\n${fuera.length} fichas · ${malas.length} con problemas · ` +
    `${resumen.segundos}s (${(resumen.segundos / fuera.length).toFixed(3)}s ` +
    `por ficha)\n`);
  process.exitCode = malas.length ? 1 : 0;
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
} else {
  module.exports = { probar, plantillas };
}
