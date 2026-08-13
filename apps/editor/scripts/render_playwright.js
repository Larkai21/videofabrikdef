#!/usr/bin/env node
/* =====================================================================
   Renderiza las plantillas HTML a secuencias PNG con alfa.

   El tiempo NO se deja correr: para cada frame se llama a TPL.seek(t) y
   se captura. Así el resultado es determinista y frame-exacto — capturar
   animaciones CSS en tiempo real produce frames repetidos y saltados.

   Uso:
     node scripts/render_playwright.js                    # todo el plan
     node scripts/render_playwright.js --only karaoke     # una capa
     node scripts/render_playwright.js --fps 30 --scale 1
     node scripts/render_playwright.js --build /tmp/x     # otro destino
   ===================================================================== */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/* realpathSync normaliza el nombre real en disco. Sin esto, invocar el
   script desde una ruta con distinta capitalización ('GitHub' en vez de
   'Github') se propaga a las rutas absolutas de layers.json: en macOS
   cuela por ser case-insensitive, pero cualquier comparación estricta o
   cualquier otro sistema de archivos lo rompe. */
const RAIZ = fs.realpathSync(path.dirname(__dirname));
const TPL = path.join(RAIZ, 'templates');

/* El directorio de trabajo es configurable —`--build <dir>` o la variable
   EDITOR_BUILD— y no una constante, porque este script DESTRUYE lo que hay
   dentro: `vaciar()` borra `build/frames/<capa>` y al final se reescribe
   `build/layers.json`. Mientras fuera fijo, cualquier prueba automática de
   render se llevaba por delante el montaje en curso del usuario, así que las
   pruebas de las plantillas eran inejecutables sin riesgo, no solo
   incómodas. Con esto van a un temporal.
   `let` y no `const` a propósito: se resuelve al leer los argumentos, antes
   de que nada lo use. */
let BUILD = process.env.EDITOR_BUILD
  ? path.resolve(process.env.EDITOR_BUILD)
  : path.join(RAIZ, 'build');
let FRAMES = path.join(BUILD, 'frames');

/* progreso global del render (capa en curso / total): lo publica el bucle de
   fotogramas por stdout con el prefijo ##progreso. capas=0 = apagado. */
const PROGRESO = { capa: 0, capas: 0 };

/* Las rutas `dir`/`mask` del manifiesto se ESCRIBEN relativas al build y la
   raíz va una sola vez en la cabecera (`raiz`): con rutas absolutas dentro,
   un build/ copiado o movido —o el repo clonado en otra ruta— dejaba un
   manifiesto apuntando a los fotogramas de otra máquina. El espejo en
   Python es `comun.resolver_manifiesto`.

   `relativa` deja pasar lo que caiga FUERA del build (un `--build` cruzado,
   por ejemplo): mejor una ruta absoluta que funciona que una relativa
   inventada que no lleva a ningún sitio. */
const relativa = (p) => {
  const rel = path.relative(BUILD, p);
  return rel && !rel.startsWith('..') ? rel : p;
};
/* Y la inversa, para el manifiesto PREVIO que se fusiona con --only. Un
   layers.json anterior al cambio de formato trae rutas absolutas y se
   aceptan tal cual: los builds en curso no se regeneran solos. */
const absoluta = (p, raiz) =>
  path.isAbsolute(p) ? p : path.join(raiz || BUILD, p);

/* El lienzo es configurable: las plantillas se maquetan en porcentajes y
   posiciones absolutas, así que el mismo componente sirve en vertical y en
   apaisado. Lo que cambia de verdad es DÓNDE cabe cada cosa: en 9:16 el
   rostro ocupa el centro y solo quedan bandas arriba y abajo; en 16:9
   queda libre un tercio lateral entero, que es mucho mejor sitio para una
   tarjeta. */
const FORMATOS = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080] };
let ANCHO = 1080, ALTO = 1920;

function args() {
  const a = process.argv.slice(2), o = { fps: 30, scale: 1, only: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--fps') o.fps = Number(a[++i]);
    else if (a[i] === '--scale') o.scale = Number(a[++i]);
    // Admite repetirse y admite lista por comas. Antes se quedaba con el
    // ÚLTIMO valor en silencio: con dos `--only` se rehacía una capa y la
    // otra conservaba sus fotogramas viejos sin que nada lo dijera.
    else if (a[i] === '--only') {
      (o.only = o.only || []).push(...a[++i].split(',').map(s => s.trim()));
    }
    else if (a[i] === '--plan') o.plan = a[++i];
    else if (a[i] === '--formato') o.formato = a[++i];
    else if (a[i] === '--build') o.build = a[++i];
  }
  /* El destino se fija AQUÍ, antes de que `cargarZonas()` o
     `planPorDefecto()` lean nada de él. La precedencia es la de siempre:
     argumento por encima de variable de entorno, y esta por encima del
     `build/` del repo. */
  if (o.build) {
    BUILD = path.resolve(o.build);
    FRAMES = path.join(BUILD, 'frames');
  }
  return o;
}

/* --------------------------------------------------------------------
   Evitación de rostro
   --------------------------------------------------------------------
   build/face.json trae las zonas libres. Si no existe, se asume busto
   centrado y la UI baja al tercio inferior — que es lo que hace la
   inmensa mayoría de vídeos de este formato.
   -------------------------------------------------------------------- */
function cargarZonas() {
  const ruta = path.join(BUILD, 'face.json');
  if (!fs.existsSync(ruta)) {
    return { engine: 'ninguno', verificado: false,
             zones: [{ t0: 0, t1: 1e9, safe: 'bottom', y_ui: 0.72 }] };
  }
  const f = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  if (!f.zones || !f.zones.length) {
    f.zones = [{ t0: 0, t1: 1e9, safe: 'bottom', y_ui: 0.72 }];
  }
  return f;
}

/* Y en píxeles donde puede vivir la UI en el instante t */
function yLibre(face, t, altoElemento) {
  const z = face.zones.find(z => t >= z.t0 && t <= z.t1) ||
            face.zones[face.zones.length - 1];
  const y = z.y_ui * ALTO;
  /* si la zona es la superior, el elemento cuelga hacia abajo desde ahí;
     si es la inferior, hay que dejarle sitio para que no se salga */
  return z.safe === 'top' ? y : Math.min(y, ALTO - altoElemento - 60);
}

/* Reloj original -> reloj de salida. Es la misma función que
   `scripts/reloj.py:Mapa`, y las dos tienen que moverse juntas: si alguna vez
   cambia el criterio de qué pasa con un instante que cae DENTRO de un
   silencio eliminado, hay que cambiarlo en los dos sitios. Se duplica porque
   esto es Node y aquello Python, no porque sean decisiones distintas. */
function mapaDe(keep) {
  const tramos = (keep || [])
    .map(k => [Number(k.src_start), Number(k.src_end), Number(k.out_start)])
    .sort((a, b) => a[0] - b[0]);
  return t => {
    t = Number(t);
    if (!tramos.length) return t;
    if (t <= tramos[0][0]) return tramos[0][2];
    for (const [s0, s1, o0] of tramos) {
      if (s0 <= t && t <= s1) return o0 + (t - s0);
      if (t < s0) return o0;                  /* cayó en un silencio quitado */
    }
    const [s0, s1, o0] = tramos[tramos.length - 1];
    return o0 + (s1 - s0);
  };
}

/* Si no hay plan explícito se deduce del timeline limpio: así el comando
   funciona en seco tras clean_transcript.py sin configurar nada. */
function planPorDefecto() {
  const ruta = path.join(BUILD, 'timeline.json');
  if (!fs.existsSync(ruta)) {
    console.error('falta build/timeline.json — ejecuta antes clean_transcript.py');
    process.exit(2);
  }
  const tl = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const face = cargarZonas();

  /* `blocks` viene en reloj de ORIGEN y esta capa se compone sobre el vídeo
     YA recortado, así que hay que derivar el reloj de salida aquí.

     Sin esto, los subtítulos karaoke quedaban en el reloj anterior mientras
     el resto de la pieza estaba comprimido: exactamente el fallo «ESPACIO
     LATENTE mientras se oía desde la primera capa» que el repo ya tenía
     documentado, reabierto por la ruta paralela de `blocks`, que
     `silencios.py` nunca remapeaba. Con `keep` como única fuente del mapeo,
     el desfase deja de ser posible: se calcula, no se almacena.

     Se mapea TAMBIÉN la sub-lista `palabras` de cada bloque. Es donde está el
     tiempo que de verdad decide qué palabra se ve en cada fotograma; quedarse
     en `ini`/`fin` del bloque dejaba el bloque en su sitio y su contenido
     descolocado, que es peor porque no se ve venir. */
  const mapa = mapaDe(tl.keep);
  const enOrigen = tl.reloj === 'origen';
  const bloques = (tl.blocks || []).map(b => enOrigen ? {
    ...b,
    ini: +mapa(b.ini).toFixed(3),
    fin: +mapa(b.fin).toFixed(3),
    palabras: (b.palabras || []).map(p => ({
      ...p, ini: +mapa(p.ini).toFixed(3), fin: +mapa(p.fin).toFixed(3),
    })),
  } : b);

  /* El final se deriva de `keep`, no de `duration_final`: el campo puede
     quedarse viejo si alguien edita el timeline a mano, y `keep` es lo que
     ffmpeg va a usar de verdad para cortar. */
  const ultimo = (tl.keep || [])[(tl.keep || []).length - 1];
  const fin = ultimo ? Number(ultimo.out_end) : (tl.duration_final || 10);

  if (!face.verificado) {
    process.stderr.write(
      'aviso: sin detección de rostro verificada; UI al tercio inferior. ' +
      'Ejecuta detect_face_bbox.py para posicionado real.\n');
  }

  /* Las zonas de face.json van en reloj de ORIGEN y `fin` aquí es reloj de
     SALIDA: con la zona única daba igual, con zonas por ventana el find()
     elegiría la equivocada. La traducción inversa sale del mismo keep. */
  const origenDe = (t) => {
    for (const k of tl.keep || []) {
      const o0 = Number(k.out_start), o1 = Number(k.out_end);
      if (o0 <= t && t <= o1) return Number(k.src_start) + (t - o0);
    }
    return t;
  };
  const ySubs = yLibre(face, origenDe(fin / 2), 380);

  return [
    {
      capa: 'kicker', template: 'kicker-hud.html', t: 0.4, duracion: 4.5,
      config: {
        kicker: 'EDICIÓN LOCAL',
        titulo: 'Todo el proceso *en tu Mac*',
        funcion: '[ FASE 01 ]',
        metrica: 'M4 PRO · 24 GB',
        duration: 4.5
      }
    },
    {
      capa: 'pip', template: 'pip-frame.html', t: 0, duracion: Math.min(fin, 12),
      config: { label: '[ M4 PRO LOCAL ]', duration: Math.min(fin, 12) }
    },
    {
      capa: 'pills', template: 'pills.html', t: 5.2, duracion: 4.0,
      config: {
        y: Math.max(120, ySubs - 190), duration: 4.0,
        items: [
          { txt: '/goal', tipo: 'cmd' }, { txt: '/btw', tipo: 'cmd' },
          { txt: '/bg', tipo: 'cmd' },
          { txt: 'HIGH GPU', tipo: 'stat', punto: true }
        ]
      }
    },
    {
      capa: 'code', template: 'code-mockup.html', t: 9.5, duracion: 7.0,
      config: { archivo: 'agent.py', rama: 'main', duration: 7.0 }
    },
    {
      capa: 'diagram', template: 'data-diagram.html', t: 17.0, duracion: 6.5,
      config: { modo: 'nodos', titulo: 'Arquitectura', subtitulo: 'LOCAL',
                duration: 6.5 }
    },
    {
      capa: 'karaoke', template: 'karaoke-subs.html', t: 0,
      duracion: Math.max(1, fin),
      config: { y: ySubs, tam: 62, duration: Math.max(1, fin), bloques }
    }
  ];
}

/* Vaciar el destino puede fallar con EACCES si el sincronizador del
   sistema tiene un archivo retenido en ese instante. No es un permiso mal
   puesto: al segundo intento entra. Ver el aviso sobre iCloud en
   CLAUDE.md — la solución de fondo es sacar `build/` de la sincronización. */
function vaciar(destino, intentos = 4) {
  for (let i = 0; i < intentos; i++) {
    try {
      fs.rmSync(destino, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === intentos - 1) throw e;
      process.stderr.write(
        `\n  ⚠ no se pudo vaciar ${path.basename(destino)} (${e.code}), ` +
        `reintento ${i + 1}/${intentos - 1}\n  `);
      /* espera activa breve: no hay await disponible en función síncrona
         y el bloqueo del sincronizador dura milisegundos */
      const hasta = Date.now() + 250;
      while (Date.now() < hasta) { /* esperar */ }
    }
  }
}

async function renderizarPasada(page, capa, o, modo, destino) {
  vaciar(destino);
  fs.mkdirSync(destino, { recursive: true });

  const url = 'file://' + path.join(TPL, capa.template);
  await page.goto(url, { waitUntil: 'load' });
  /* las fuentes deben estar resueltas antes del primer frame, si no el
     primer PNG sale con la tipografía de sistema y se nota el salto */
  await page.evaluate(() => document.fonts.ready);

  /* El fondo del elemento RAÍZ se propaga al lienzo del navegador y queda
     fuera del grupo de opacidad del `body`, así que el truco de
     `body { opacity: 0.998 }` no lo cubre: `omitBackground` no puede
     recortar nada y los PNG salen sin canal alfa. Se mira aquí, en la
     causa, y no en los PNG ya escritos.
     Una plantilla puede declararlo a propósito con
     <meta name="capa-opaca" content="1">, como hace fondo.html. */
  const raiz = await page.evaluate(() => {
    const est = getComputedStyle(document.documentElement);
    const c = est.backgroundColor;
    const m = c.match(/[\d.]+/g) || [];
    const alfa = m.length === 4 ? Number(m[3]) : (c === 'transparent' ? 0 : 1);
    /* Un degradado o una imagen en la raíz tapan igual que un color, y no
       aparecen en `backgroundColor`. Mirar solo el color dejaba pasar
       exactamente el mismo fallo por otra propiedad. */
    const img = est.backgroundImage;
    const conImagen = img && img !== 'none';
    return {
      opaca: alfa > 0.001 || conImagen,
      color: conImagen && alfa <= 0.001 ? img.slice(0, 60) : c,
      via: conImagen ? (alfa > 0.001 ? 'color e imagen' : 'background-image')
                     : 'background-color',
      declarada: !!document.querySelector('meta[name="capa-opaca"]')
    };
  });

  /* `modo` es del renderizador y pisa lo que traiga la config. Una
     plantilla que use esa clave se queda sin ella en silencio: pasó con
     `subtitles-showcase`, que salía siempre en rejilla. Se avisa. */
  if (capa.config && 'modo' in capa.config && capa.config.modo !== modo) {
    console.error('  aviso: ' + capa.capa + ' define config.modo="' +
      capa.config.modo + '", que el renderizador reserva y sobrescribe ' +
      'con "' + modo + '". Usa otro nombre de clave.');
  }
  const info = await page.evaluate(
    cfg => window.TPL.setup(cfg),
    Object.assign({}, capa.config || {}, { modo }));
  const dur = capa.duracion || info.duration;
  /* Frecuencia POR CAPA. Un fondo de manchas difuminadas no necesita 25
     fotogramas por segundo: su contenido no tiene frecuencia espacial alta
     y el juicio del ojo sobre ese material es muy tolerante. Renderizarlo
     a 25 cuesta cinco veces más para una diferencia que no se ve.
     Los subtítulos y las transiciones sí la necesitan y se quedan a 25. */
  const fpsCapa = capa.fps || o.fps;
  const total = Math.max(1, Math.round(dur * fpsCapa));

  /* Las anclas se miden CON la animación puesta, no en `setup`: en reposo
     los elementos aún no llevan los transforms de `draw` y las cajas
     salían falsas en cuanto algo se movía o crecía. Por defecto se toman a
     mitad de capa, que es cuando casi todo está ya colocado; `tAncla` en
     el plan permite elegir otro instante. */
  const tAncla = (capa.tAncla !== undefined) ? capa.tAncla : dur * 0.5;
  await page.evaluate(tt => window.TPL.seek(tt), tAncla);
  const anclas = await page.evaluate(() => window.TPL.anclas());

  for (let f = 0; f < total; f++) {
    const t = f / fpsCapa;
    await page.evaluate(tt => window.TPL.seek(tt), t);
    await page.screenshot({
      path: path.join(destino, String(f).padStart(5, '0') + '.png'),
      omitBackground: true            // <- de aquí sale el canal alfa
    });
    /* progreso PARSEABLE por stdout (stderr es el diagnóstico humano y no se
       toca): un consumidor externo —el worker de reels de la fábrica— lo lee
       línea a línea sin regex frágil. Cada 30 frames: suficiente para una
       barra, invisible en coste. */
    if (PROGRESO.capas > 0 && (f % 30 === 29 || f === total - 1)) {
      process.stdout.write('##progreso ' + JSON.stringify({
        capa: PROGRESO.capa, capas: PROGRESO.capas, frame: f + 1, frames: total,
      }) + '\n');
    }
  }
  return { frames: total, dur, fps: fpsCapa, raiz,
           cues: info.cues || [], anclas };
}

/* Sustituye `{sobre: 'capa.clave'}` por la caja que esa capa publicó.
   Se admiten desplazamientos: `margen` la engorda, `dx`/`dy` la mueven.
   Si el ancla no existe se avisa y se deja el objeto intacto — colocar la
   marca en 0,0 en silencio sería peor que no colocarla. */
function resolverAnclas(nodo, anclas, avisos, usadas) {
  if (Array.isArray(nodo)) {
    nodo.forEach(n => resolverAnclas(n, anclas, avisos, usadas));
    return nodo;
  }
  if (!nodo || typeof nodo !== 'object') return nodo;
  if (typeof nodo.sobre === 'string') {
    const caja = anclas[nodo.sobre];
    if (usadas) usadas.add(String(nodo.sobre).split('.')[0]);
    if (!caja) {
      avisos.push(`ancla «${nodo.sobre}» no existe. Anclas disponibles: ` +
                  (Object.keys(anclas).join(', ') || 'ninguna') +
                  '. ¿Se renderizó antes la capa de destino?');
    } else {
      const m = nodo.margen || 0;
      nodo.x = caja.x + (nodo.dx || 0);
      nodo.y = caja.y + (nodo.dy || 0);
      nodo.w = caja.w + m * 2;
      nodo.h = caja.h + m * 2;
    }
  }
  Object.values(nodo).forEach(v => resolverAnclas(v, anclas, avisos, usadas));
  return nodo;
}

async function renderizarCapa(page, capa, o, anclasPrevias, avisos) {
  const destino = path.join(FRAMES, capa.capa);
  const anclajes = new Set();
  if (anclasPrevias) resolverAnclas(capa.config, anclasPrevias, avisos, anclajes);
  const r = await renderizarPasada(page, capa, o, 'detalle', destino);

  /* Un fondo opaco en la raíz mata el alfa de toda la capa. Si además es
     de cristal es fatal: la máscara no tendría silueta que recortar y la
     refracción se aplicaría al fotograma entero. */
  if (r.raiz && r.raiz.opaca && !r.raiz.declarada) {
    const cómo = capa.cristal
      ? 'ES DE CRISTAL: la máscara se queda sin silueta.'
      : 'Tapará por completo todo lo que tenga debajo.';
    process.stderr.write(
      `\n  ⚠ «${capa.capa}» (${capa.template}): el elemento raíz tiene ` +
      `fondo opaco vía ${r.raiz.via} (${r.raiz.color}), así que la capa ` +
      `sale SIN canal alfa. ` +
      `${cómo}\n` +
      `      El fondo de <html> se propaga al lienzo y queda fuera del ` +
      `grupo de opacidad del body, así que \`body { opacity: 0.998 }\` no ` +
      `lo salva.\n` +
      `      Píntalo en un hijo a sangre, o decláralo a propósito con ` +
      `<meta name="capa-opaca" content="1">.\n  `);
  }
  const salida = { capa: capa.capa, frames: r.frames, dur: r.dur,
                   fps: r.fps, dir: destino };
  if (r.anclas) salida.anclas = r.anclas;
  /* Si la capa se ancla a otra, comparte su desfase de paralaje: si no,
     oscilan a distinto ritmo y la marca se despega de lo que señala. */
  if (anclajes.size === 1) salida.faseCon = [...anclajes][0];
  /* Propiedades de COMPOSICIÓN que viven en el plan y las necesita ffmpeg.
     Sin copiarlas al manifiesto se pierden en silencio: el vídeo sale sin
     paralaje y nada lo delata. */
  if (capa.parallax) salida.parallax = capa.parallax;
  /* dx/dy son de COMPOSICIÓN y viven en el plan; sin copiarlas aquí el
     compositor nunca las ve y la capa se queda centrada, en silencio.
     Es exactamente lo que ya pasó con `parallax`. */
  if (capa.dx) salida.dx = capa.dx;
  if (capa.escala) salida.escala = capa.escala;
  if (capa.dy) salida.dy = capa.dy;

  /* Señales de sonido. El plan ya sabe CUÁNDO pasa cada cosa; deducir los
     golpes aquí evita tener que declararlos otra vez a mano y que se
     desincronicen en cuanto se mueve una transición. */
  const cues = [];
  const cfg = capa.config || {};
  (cfg.cortes || []).forEach(c => {
    const sfx = c.sfx || ({ barrido: 'barrido', persiana: 'impacto',
                            iris: 'impacto', cortina: 'barrido' }[c.modo] || 'impacto');
    /* Los impactos van más fuertes que los barridos a propósito: un
       barrido suele caer en una pausa y se oye solo, pero un impacto cae
       encima de la voz y a igualdad de nivel aporta menos de 2 dB, o sea
       nada. Medido, no supuesto. */
    const peso = c.gain || (sfx === 'impacto' ? 1.7 : 1.0);
    cues.push({ t: +(capa.t + c.at).toFixed(3), sfx, gain: peso });

    /* Un riser no acompaña al corte: lo ANUNCIA. Tiene que arrancar
       antes para que su pico caiga justo encima, así que se coloca su
       propia duración por delante. Si no cabe, se descarta en vez de
       recortarlo: medio riser suena a error de montaje, no a tensión. */
    if (c.riser) {
      const DUR_RISER = 1.8;
      const inicio = capa.t + c.at - DUR_RISER + 0.1;
      if (inicio >= 0) {
        cues.push({ t: +inicio.toFixed(3), sfx: 'riser',
                    gain: c.riserGain || 0.75 });
      } else {
        process.stderr.write(
          `  ⚠ «${capa.capa}»: el corte en ${c.at}s pide riser pero solo ` +
          `hay ${(capa.t + c.at).toFixed(2)}s por delante y necesita ` +
          `${DUR_RISER}s. Se omite.\n`);
      }
    }
  });
  (cfg.flashEn || []).forEach(at => {
    cues.push({ t: +(capa.t + at).toFixed(3), sfx: 'destello', gain: 0.7 });
  });
  /* Señales que publica la propia plantilla, en tiempo relativo a la capa */
  (r.cues || []).forEach(c => {
    cues.push({ t: +(capa.t + c.at).toFixed(3),
                sfx: c.sfx, gain: c.gain || 1.0 });
  });
  if (capa.sfx) {  // golpe explícito al entrar la capa
    cues.push({ t: +capa.t.toFixed(3), sfx: capa.sfx, gain: capa.sfxGain || 0.8 });
  }
  if (cues.length) salida.cues = cues;

  /* Una capa con cristal necesita una segunda pasada: la silueta que
     ffmpeg usará para saber qué región del metraje difuminar. Sin ella
     el backdrop-filter no tiene nada que muestrear y el cristal sale
     como una pastilla gris. */
  /* La cortinilla usa la MISMA segunda pasada por una razón distinta: su
     silueta no marca dónde difuminar, sino qué mitad del metraje va sin
     grading. Comparten mecanismo y no tratamiento, así que comparten la
     pasada y se distinguen por la propiedad que se escribe en el manifiesto:
     `blur`/`sat`/`desplazar` para el cristal, `cortinilla` para el barrido.
     Declarar las dos en la misma capa no tiene sentido —serían dos
     tratamientos sobre la misma región— y el compositor lo rechaza. */
  if (capa.cristal || capa.cortinilla) {
    const dirMask = path.join(FRAMES, capa.capa + '__mask');
    await renderizarPasada(page, capa, o, 'mascara', dirMask);
    salida.mask = dirMask;
    if (capa.cristal) {
      salida.blur = capa.blur || 26;
      salida.sat = capa.sat || 1.8;
      /* 0 = solo difuminado; >0 dobla la luz en el canto del cristal */
      salida.desplazar = capa.desplazar !== undefined ? capa.desplazar : 0.22;
    }
    if (capa.cortinilla) {
      salida.cortinilla = true;
      /* Qué se revela por debajo de la silueta. Sin `imagen`, la segunda
         cadena de A-Roll sin LUT; con ella, esa imagen.

         Es una propiedad de COMPOSICIÓN y por eso se copia al manifiesto, no
         una de la plantilla: la plantilla no puede pintar el «antes» porque
         se captura sobre transparencia. Si no se copiara, la cortinilla se
         compondría con el revelado por defecto y el vídeo saldría con una
         comparación distinta de la que dice el plan, sin un solo aviso. Es
         literalmente lo que ya pasó con `parallax` y con `dx`/`dy`. */
      if (capa.imagen) salida.imagen = capa.imagen;
      if (capa.ajuste) salida.ajuste = capa.ajuste;
    }
  }
  return salida;
}

/* Solo se ejecuta si se INVOCA, no si se importa.
   Sin esta guarda, un `require('render_playwright.js')` —para probar una de
   sus funciones sin abrir el navegador, por ejemplo— lanzaba el render
   completo del plan por defecto: borraba `build/frames/<capa>` de las capas
   que coincidieran de nombre y dejaba cinco directorios de otro montaje.
   Pasó de verdad al comprobar `mapaDe`. Es el equivalente en Node del
   `if __name__ == "__main__"` que todos los scripts de Python ya tienen. */
async function main() {
  const o = args();
  /* Se dice en voz alta cuando NO es el `build/` del repo: este script borra
     fotogramas, y saber sobre qué directorio lo está haciendo no es un
     detalle. */
  if (BUILD !== path.join(RAIZ, 'build')) {
    process.stderr.write(`destino: ${BUILD}\n`);
  }
  if (o.formato) {
    const f = FORMATOS[o.formato];
    if (!f) { console.error('formato desconocido: ' + o.formato +
      ' (usa ' + Object.keys(FORMATOS).join(', ') + ')'); process.exit(2); }
    [ANCHO, ALTO] = f;
    process.stderr.write(`lienzo ${ANCHO}x${ALTO} (${o.formato})\n`);
  }
  const plan = o.plan
    ? JSON.parse(fs.readFileSync(o.plan, 'utf8'))
    : planPorDefecto();

  const capas = o.only ? plan.filter(c => o.only.includes(c.capa)) : plan;
  if (!capas.length) {
    console.error('ninguna capa coincide con --only ' + o.only.join(', '));
    process.exit(2);
  }

  fs.mkdirSync(FRAMES, { recursive: true });
  const navegador = await chromium.launch();
  const page = await navegador.newPage({
    viewport: { width: ANCHO, height: ALTO },
    deviceScaleFactor: o.scale
  });

  /* Las anclas ya publicadas viven en el manifiesto, así que `--only`
     sobre una anotación sigue encontrando la caja de una capa que no se
     re-renderiza en esta pasada. */
  const anclasPrevias = {};
  const manifPrev = path.join(BUILD, 'layers.json');
  if (fs.existsSync(manifPrev)) {
    try {
      (JSON.parse(fs.readFileSync(manifPrev, 'utf8')).capas || [])
        .forEach(c => Object.entries(c.anclas || {})
          .forEach(([k, v]) => { anclasPrevias[c.capa + '.' + k] = v; }));
    } catch {}
  }

  const hechas = [];
  const avisosAncla = [];
  for (const [iCapa, capa] of capas.entries()) {
    PROGRESO.capa = iCapa;
    PROGRESO.capas = capas.length;
    process.stderr.write(`renderizando ${capa.capa}... `);
    const r = await renderizarCapa(page, capa, o, anclasPrevias, avisosAncla);
    Object.entries(r.anclas || {}).forEach(
      ([k, v]) => { anclasPrevias[capa.capa + '.' + k] = v; });
    hechas.push({ ...r, t: capa.t, template: capa.template });
    process.stderr.write(`${r.frames} frames\n`);
  }
  await navegador.close();

  /* El manifiesto se fusiona SOLO con --only, que es para lo que se pensó la
     fusión: se re-renderiza una capa y sobrescribir dejaría el manifiesto con
     esa sola, así que el compositor montaría el vídeo sin las demás, en
     silencio.

     En un render COMPLETO se reemplaza. Antes se fusionaba siempre —el
     comentario decía «con --only» pero el código no distinguía el caso—, y
     eso hacía que las capas de una pieza ANTERIOR sobrevivieran mientras su
     directorio de fotogramas siguiera en disco. `build/` es compartido entre
     piezas y los nombres se repiten por diseño (`kicker`, `pip`, `diagram`,
     `karaoke`), así que el resultado era un gráfico de otro montaje
     apareciendo en el momento equivocado de la narración nueva, con su `t` y
     su `dur` originales, y sin un solo aviso. */
  const manifiesto = path.join(BUILD, 'layers.json');
  let previo = { capas: [] };
  if (o.only && fs.existsSync(manifiesto)) {
    try { previo = JSON.parse(fs.readFileSync(manifiesto, 'utf8')); } catch {}
  }
  /* Se resuelven las rutas del previo a absolutas NADA MÁS leerlo: todo lo
     que sigue (existsSync sobre `dir`, el recuento de la máscara) trabaja
     con absolutas, y al escribir se relativiza todo junto. */
  (previo.capas || []).forEach(c => {
    if (c.dir) c.dir = absoluta(c.dir, previo.raiz);
    if (c.mask) c.mask = absoluta(c.mask, previo.raiz);
  });
  const porNombre = new Map((previo.capas || []).map(c => [c.capa, c]));
  hechas.forEach(c => porNombre.set(c.capa, c));

  /* Y con --only, lo que sobreviva tiene que pertenecer al MISMO plan: si el
     plan ya no declara esa capa, o la declara con otra plantilla, es de otro
     montaje. Se compara por plantilla y no por tiempos porque `silencios.py`
     los mueve legítimamente entre una pasada y otra. */
  const delPlan = new Map(plan.map(c => [c.capa, c]));
  const fuera = [], rehacer = [];
  const supervivientes = [...porNombre.values()].filter(c => {
    if (hechas.some(h => h.capa === c.capa)) return true;
    const p = delPlan.get(c.capa);
    if (!p) { fuera.push(c.capa); return false; }
    if (p.template && c.template && p.template !== c.template) {
      /* El plan la pide con otra plantilla: la entrada del manifiesto es de
         otro montaje, pero la capa SÍ hace falta en este. Se distingue del
         caso anterior porque la acción es distinta. */
      rehacer.push(`${c.capa} (${c.template} -> ${p.template})`);
      return false;
    }
    return true;
  });
  if (fuera.length) {
    process.stderr.write(
      `  ⚠ ${fuera.length} capa(s) del manifiesto no están en este plan y se ` +
      `descartan: ${fuera.join(', ')}.\n    Son de otro montaje; sus ` +
      `fotogramas siguen en build/frames si los necesitas.\n`);
  }
  if (rehacer.length) {
    process.stderr.write(
      `  ⚠ ${rehacer.length} capa(s) están en el plan con OTRA plantilla que ` +
      `la del manifiesto:\n    ${rehacer.join(', ')}\n` +
      `    Se descartan y el vídeo saldría sin ellas. Rehazlas:\n` +
      `      node scripts/render_playwright.js --only ` +
      `${rehacer.map(x => x.split(' ')[0]).join(',')}\n`);
  }

  /* una capa cuyos frames ya no existan en disco no debe sobrevivir */
  const vivas = supervivientes.filter(c => fs.existsSync(c.dir));

  /* Las capas de cristal se renderizan en dos pasadas y el manifiesto
     apunta a las dos. Con --only ambas se rehacen a la vez, así que no se
     desincronizan solas; el problema es que el manifiesto SOBREVIVE a que
     la máscara desaparezca o se quede corta, y entonces:
       · directorio ausente  -> ffmpeg falla con un error suyo, ilegible;
       · fotogramas de menos -> la silueta se acaba antes que la capa y la
         refracción se desincroniza SIN un solo aviso.
     Se comprueba aquí, que es donde se escribe el manifiesto. */
  const pngs = d => fs.readdirSync(d).filter(f => /^\d+\.png$/.test(f)).length;
  const avisos = [];
  vivas.forEach(c => {
    if (!c.mask) return;
    /* El qué se pierde depende de para qué era la máscara: el cristal se
       queda sin refracción y la cortinilla se queda sin el lado «antes», o
       sea sin la comparación entera. Decirlo con el nombre correcto importa
       porque el arreglo es el mismo pero el síntoma en pantalla no. */
    const efecto = c.cortinilla ? 'cortinilla' : 'cristal';
    if (!fs.existsSync(c.mask)) {
      avisos.push(`«${c.capa}»: falta la máscara de ${efecto} (${c.mask}). ` +
                  `Se compone sin ${efecto}. Arréglalo con: ` +
                  `node scripts/render_playwright.js --only ${c.capa}`);
    } else {
      const n = pngs(c.mask);
      if (n !== c.frames) {
        avisos.push(`«${c.capa}»: la máscara tiene ${n} fotogramas y la capa ` +
                    `${c.frames}. Se compone sin ${efecto}. Arréglalo con: ` +
                    `node scripts/render_playwright.js --only ${c.capa}`);
      } else {
        return;
      }
    }
    /* Se quitan las claves de cristal en vez de dejar una ruta rota: un
       manifiesto inválido revienta el compositor, y perder la refracción
       con un aviso a la vista es preferible a un error de ffmpeg. */
    delete c.mask; delete c.blur; delete c.sat; delete c.desplazar;
    delete c.cortinilla; delete c.imagen; delete c.ajuste;
  });
  avisosAncla.forEach(a => avisos.push(a));
  avisos.forEach(a => process.stderr.write('  ⚠ ' + a + '\n'));

  /* `raiz` en la cabecera y `dir`/`mask` relativos a ella (ver `relativa`
     arriba): el manifiesto viaja con sus fotogramas en vez de recordar la
     máquina donde se renderizó. */
  fs.writeFileSync(manifiesto, JSON.stringify(
    { fps: o.fps, ancho: ANCHO, alto: ALTO, raiz: BUILD,
      capas: vivas.map(c => {
        const rel = { ...c, dir: relativa(c.dir) };
        if (rel.mask) rel.mask = relativa(rel.mask);
        return rel;
      }) }, null, 2));
  console.log(JSON.stringify({
    manifiesto,
    avisos,
    renderizadas: hechas.map(c => c.capa),
    capas_en_manifiesto: vivas.map(c => c.capa),
    frames: vivas.reduce((s, c) => s + c.frames, 0)
  }, null, 2));
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
} else {
  module.exports = { mapaDe, planPorDefecto, args, FORMATOS };
}
