#!/usr/bin/env node
/* =====================================================================
   Hoja de contactos: cada plantilla en cada tema, en una sola imagen.

   Con 2 temas y 11 plantillas hay 22 combinaciones. Revisarlas a mano
   abriendo archivos es inviable, y es exactamente donde se cuelan las
   regresiones que ningún log detecta: una tarjeta que se quedó oscura
   sobre fondo claro, un filete que desapareció, texto ilegible.

   Va en JS y no en Python porque Playwright vive aquí; el montaje se
   delega a ffmpeg.

   Uso:
     node scripts/hoja_contactos.js
     node scripts/hoja_contactos.js --tema paper
     node scripts/hoja_contactos.js --only code-mockup
   ===================================================================== */

const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RAIZ = fs.realpathSync(path.dirname(__dirname));
const TPL = path.join(RAIZ, 'templates');
const SALIDA = path.join(RAIZ, 'build', 'hoja');
/* entorno > PATH > Homebrew, resuelto UNA vez en comun.js para todos. */
const { FFMPEG } = require('./comun.js');

const ANCHO = 1080, ALTO = 1920;
const TEMAS = ['carbon', 'paper'];

/* Config de muestra por plantilla y el instante en el que se captura.
   El instante importa: hay que pillar la animación ASENTADA, no a
   mitad de entrada, o la hoja no dice nada útil. */
const MUESTRAS = [
  { f: 'kicker-hud.html', t: 3.0, cfg: {
      kicker: 'ANTHROPIC', titulo: 'Claude *Opus 5*',
      funcion: '[ CLAUDE 5 ]', metrica: '1M CONTEXTO', y: 620, duration: 6 } },

  { f: 'pip-frame.html', t: 3.0, cfg: {
      label: '[ M4 PRO LOCAL ]', x: 110, y: 560, w: 860, h: 800, duration: 6 } },

  { f: 'pills.html', t: 2.0, cfg: {
      y: 900, align: 'center', duration: 5, items: [
        { txt: '/goal', tipo: 'cmd' }, { txt: '/bg', tipo: 'cmd' },
        { txt: 'LOCAL', tipo: 'stat', punto: true },
        { txt: 'aviso', tipo: 'warn' }] } },

  /* La ficha tenía «MAC» durando de 1,3 a 4,0 —2,7 de los 5 segundos— y el
     bloque terminaba un segundo antes que la capa. Con el relleno de karaoke
     eso ya no es una imagen fija, pero sigue siendo una frase que no dice
     nada durante más de la mitad del plano: una ficha de catálogo tiene que
     enseñar el ritmo real de una locución, no un caso degenerado. */
  { f: 'karaoke-subs.html', t: 1.0, cfg: {
      y: 880, tam: 58, duration: 5, bloques: [
        { ini: 0, fin: 2.4, palabras: [
          { w: 'TODO', ini: 0.0, fin: 0.55 }, { w: 'ESTO', ini: 0.55, fin: 1.0 },
          { w: 'PASA', ini: 1.0, fin: 1.5 },  { w: 'EN', ini: 1.5, fin: 1.75 },
          { w: 'TU', ini: 1.75, fin: 2.0 },   { w: 'MAC', ini: 2.0, fin: 2.4 }] },
        { ini: 2.55, fin: 5.0, palabras: [
          { w: 'SIN', ini: 2.55, fin: 2.95 }, { w: 'SUBIR', ini: 2.95, fin: 3.5 },
          { w: 'NADA', ini: 3.5, fin: 4.1 },  { w: 'A', ini: 4.1, fin: 4.3 },
          { w: 'LA', ini: 4.3, fin: 4.55 },   { w: 'NUBE', ini: 4.55, fin: 5.0 }] }] } },

  { f: 'code-mockup.html', t: 4.5, cfg: {
      archivo: 'main.py', rama: 'opus-5', estado: '1M TOKENS', cps: 90,
      duration: 8, codigo: [
        '# cabe el repositorio entero',
        'resp = client.messages.create(',
        '    model="claude-opus-5",',
        '    max_tokens=4096)'] } },

  { f: 'data-diagram.html', t: 3.5, cfg: {
      vista: 'nodos', titulo: 'Arquitectura', subtitulo: 'LOCAL', duration: 8 } },

  { f: 'data-diagram.html', etiqueta: 'data-diagram(tabla)', t: 4.0, cfg: {
      vista: 'tabla', titulo: 'Rendimiento', subtitulo: 'M4 PRO', duration: 8,
      columnas: ['Etapa', 'Tiempo', 'Carga'], filas: [
        { celdas: ['Transcripción', '6 s', ''], barra: 0.14 },
        { celdas: ['Motion', '54 s', ''], barra: 1.0 },
        { celdas: ['Composición', '7 s', ''], barra: 0.13 }] } },

  { f: 'fondo.html', t: 2.0, cfg: { duration: 4 } },

  { f: 'chat-bubbles.html', t: 5.5, cfg: { y: 620, duration: 9 } },
  { f: 'hero-stat.html',    t: 2.6, cfg: { y: 760, duration: 5 } },
  { f: 'lower-third.html',  t: 2.0, cfg: { y: 900, duration: 5 } },
  { f: 'compare-ab.html',   t: 2.2, cfg: { duration: 7 } },

  { f: 'globo.html', t: 3.0, cfg: {
      duration: 8, cx: 540, cy: 900, r: 330, velocidad: 12 } },

  { f: 'pasos-flow.html', t: 4.6, cfg: { y: 560, escalonado: 1.3, duration: 8 } },

  /* La última palabra acababa en 2,4 con `duration: 4`: el 40 % de la ficha
     era una capa vacía. Una tipografía cinética se juzga por su RITMO, y con
     dos palabras y un silencio al final no hay ritmo que juzgar. */
  { f: 'kinetic-type.html', t: 0.9, cfg: {
      duration: 4, anchoMax: 900, palabras: [
        { txt: 'CERO', at: 0.0, dur: 1.1, gesto: 0, estilo: 'bloque' },
        { txt: 'NUBES', at: 0.75, dur: 1.3, gesto: 3, estilo: 'acento' },
        { txt: 'TODO', at: 1.9, dur: 1.0, gesto: 1 },
        { txt: 'LOCAL', at: 2.7, dur: 1.3, gesto: 2, estilo: 'acento' }] } },

  { f: 'glass-dock.html', t: 3.2, cfg: {
      y: 900, duration: 7, items: [
        { txt: 'Transcribe', ico: 'onda' }, { txt: 'Corta', ico: 'corte' },
        { txt: 'Compone', ico: 'capas' }],
      saltos: [{ at: 0.5, i: 0 }, { at: 1.8, i: 1 }, { at: 2.9, i: 2 }] } },

  /* La ficha enseñaba UN corte de 0,7 s dentro de una capa de 3 s: el 77 % del
     tiempo la hoja estaba a opacidad 0, así que tanto el catálogo como
     `comprobar_movimiento.js` veían una capa vacía casi entera. Y no era un
     fallo de la plantilla —una transición vive DENTRO de una pieza y la mayor
     parte del tiempo no está pasando nada—: era una ficha que enseñaba lo que
     la plantilla no hace. Con tres cortes encadenados se ve lo que sí hace,
     que es puntuar, y de paso se ven tres de sus cuatro modos. */
  { f: 'transicion.html', t: 0.45, cfg: {
      duration: 3, cortes: [
        { at: 0.10, dur: 0.85, modo: 'barrido',  color: 'solida', marca: '01' },
        { at: 1.05, dur: 0.85, modo: 'cortina',  color: 'tinta',  marca: '02' },
        { at: 2.02, dur: 0.98, modo: 'persiana', color: 'solida', marca: '03' }] } },

  { f: 'tarjeta-3d.html', t: 2.4, cfg: {
      duration: 6, cifra: '70', inclinacion: 14, periodo: 6.5 } },

  { f: 'kinetic-quote.html', t: 0.6, cfg: { duration: 1.4 } },

  { f: 'chapter-card.html', t: 0.5, cfg: { duration: 1.0 } },

  { f: 'highlighter-text.html', t: 2.2, cfg: { duration: 3.6 } },

  { f: 'split-versus.html', t: 2.4, cfg: { duration: 4.2 } },

  { f: 'poll-rating.html', t: 2.6, cfg: { duration: 4.0 } },

  { f: 'comment-bubble.html', t: 2.0, cfg: { duration: 4.0 } },

  { f: 'notification-pop.html', t: 1.2, cfg: { duration: 3.2 } },

  /* El instante es DESPUÉS del contacto (pulsación en 0,55): con la onda a
     medio abrir, la etiqueta entrando y el dedo ya apoyado. Capturar antes
     enseñaría un puntero volando, que es lo que la plantilla hace de paso,
     no lo que es. El texto es el del guion que la pidió («pulsa aquí»,
     anclado a «perfil» en la pieza de Codex). */
  { f: 'cursor-tap.html', t: 0.85, cfg: {
      duration: 1.3, x: 540, y: 950, texto: 'PULSA AQUÍ' } },

  { f: 'definition-card.html', t: 2.4, cfg: { duration: 4.2 } },

  { f: 'search-bar.html', t: 3.0, cfg: { duration: 5.0 } },

  { f: 'tweet-card.html', t: 2.4, cfg: { duration: 4.5 } },

  { f: 'headline-clipper.html', t: 2.4, cfg: { duration: 4.5 } },

  /* Con `{ duration: 6 }` y nada más, `palabras` queda vacío y esta plantilla
     no pinta NADA: la hoja de contactos mostraba un hueco y el humo de
     plantillas lo detectó como «no se mueve». Es la plantilla más usada del
     pipeline —va en todas las piezas— y era la única sin muestra de verdad. */
  { f: 'kinetic-captions.html', t: 1.6, cfg: {
      duration: 6, tam: 92, zona: 'abajo', max: 3, clave: ['CINÉTICOS'],
      palabras: [
        { w: 'SUBTÍTULOS', ini: 0.0, fin: 0.7 },
        { w: 'CINÉTICOS', ini: 0.7, fin: 1.5 },
        { w: 'PALABRA', ini: 1.6, fin: 2.2 },
        { w: 'POR', ini: 2.2, fin: 2.5 },
        { w: 'PALABRA', ini: 2.5, fin: 3.2 },
        { w: 'SOBRE', ini: 3.3, fin: 3.8 },
        { w: 'EL', ini: 3.8, fin: 4.0 },
        { w: 'METRAJE', ini: 4.0, fin: 4.8 },
        /* Estas tres no son relleno: sin ellas las palabras acaban en 4,8 s
           con `duration: 6`, y el humo muestrea el movimiento en
           `[0.15, muestra.t, dur*0.9]` — o sea que su TERCER fotograma caía
           en 5,4 s, dentro de la zona muerta, y salía vacío en los dos temas.
           La prueba de «¿se mueve?» comparaba dos fotogramas vivos y uno en
           blanco: pasaba, y valía menos de lo que aparentaba. */
        { w: 'HASTA', ini: 4.9, fin: 5.2 },
        { w: 'EL', ini: 5.2, fin: 5.4 },
        { w: 'FINAL', ini: 5.4, fin: 5.9 },
      ] } },

  /* La DINÁMICA encendida, en muestra propia y no en la de arriba: la de
     arriba es la referencia de la rama apagada —la que compara
     `comparar_fotogramas.py` contra los planes existentes— y encenderla ahí
     dejaría el pipeline sin testigo. Con esta variante el humo, el medidor
     de movimiento y el auditor de estilo cubren la rama nueva sin ninguna
     pieza de por medio. El instante es la entrada del segundo grupo (gesto
     lateral) con la clave a medio pop. Las energías no son uniformes a
     propósito: con todas iguales el modulador sería invisible. */
  { f: 'kinetic-captions.html', etiqueta: 'kinetic-captions(dinamico)',
    t: 1.75, cfg: {
      duration: 6, tam: 92, zona: 'abajo', max: 3, clave: ['CINÉTICOS'],
      /* Los valores son los de `escaleta.DINAMICA["favorito"]` — la
         muestra enseña EL estilo fijado, no una variante inventada. */
      gestos: true, popPalabra: 0.06, popClave: 0.12, vaiven: 16,
      cuerpoClave: 0.12, escalonado: 0.05, giroClave: 1.2,
      palabras: [
        { w: 'SUBTÍTULOS', ini: 0.0, fin: 0.7, energia: 0.55 },
        { w: 'CINÉTICOS', ini: 0.7, fin: 1.5, energia: 0.92 },
        { w: 'PALABRA', ini: 1.6, fin: 2.2, energia: 0.48 },
        { w: 'POR', ini: 2.2, fin: 2.5, energia: 0.3 },
        { w: 'PALABRA', ini: 2.5, fin: 3.2, energia: 0.83 },
        { w: 'SOBRE', ini: 3.3, fin: 3.8, energia: 0.4 },
        { w: 'EL', ini: 3.8, fin: 4.0, energia: 0.2 },
        { w: 'METRAJE', ini: 4.0, fin: 4.8, energia: 0.76 },
        { w: 'HASTA', ini: 4.9, fin: 5.2, energia: 0.5 },
        { w: 'EL', ini: 5.2, fin: 5.4, energia: 0.35 },
        { w: 'FINAL', ini: 5.4, fin: 5.9, energia: 0.88 },
      ] } },

  { f: 'onda.html', t: 4.0, cfg: { duration: 8, y: 900 } },

  { f: 'terminal.html', t: 8.6, cfg: { duration: 9 } },

  { f: 'anotacion.html', t: 3.0, cfg: { duration: 5 } },

  { f: 'cinta.html', t: 2.0, cfg: { duration: 8 } },

  { f: 'odometro.html', t: 2.4, cfg: { duration: 5, valor: 34500 } },

  { f: 'cierre-cta.html', t: 3.0, cfg: { duration: 6, pulsacion: 2.6 } },

  { f: 'marcos.html', etiqueta: 'marcos(web)', t: 4.5, cfg: {
      duration: 7, tipo: 'navegador', ancho: 880, alto: 520,
      desplazamiento: 160 } },

  { f: 'marcos.html', etiqueta: 'marcos(movil)', t: 4.5, cfg: {
      duration: 7, tipo: 'movil', ancho: 480, alto: 900,
      url: '', titular: 'Todo el montaje,\nen tu bolsillo' } },

  { f: 'mapa-calor.html', t: 3.2, cfg: {
      duration: 7, foco: { f: 1, c: 2, txt: 'el cuello de botella' } } },

  { f: 'capitulos.html', t: 7.5, cfg: { duration: 20, y: 700 } },

  { f: 'cita.html', t: 2.5, cfg: {
      duration: 6, resaltar: ['nube', 'máquina'] } },

  { f: 'chat-bubbles.html', etiqueta: 'chat(streaming)', t: 3.2, cfg: {
      y: 700, duration: 9 } },

  { f: 'rejilla-logos.html', t: 3.4, cfg: {
      duration: 7, elegido: 2, nota: 'y este lo pega todo' } },

  { f: 'rejilla-logos.html', etiqueta: 'rejilla(lockup)', t: 2.2, cfg: {
      vista: 'lockup', duration: 6,
      titulo: '', sub: '',
      lockup: { monograma: 'EY', wordmark: 'Editor local',
                tagline: 'M4 Pro · sin nube' } } },

  /* La cortinilla se ve a MEDIO viaje, no asentada: en `hasta` el canto está
     quieto y la hoja no diría si el tirador y los rótulos se despejan bien.
     Es la única muestra donde el instante interesante no es el de reposo.

     Y aquí no hay metraje debajo, así que el lado «antes» sale transparente:
     la hoja de contactos enseña el MUEBLE —canto, tirador, rótulos—, que es
     lo que la plantilla aporta. El revelado lo hace ffmpeg y solo se puede
     juzgar sobre un montaje real. */
  { f: 'antes-despues.html', t: 1.1, cfg: {
      duration: 4.5, pie: 'MISMO CLIP · MISMA EXPOSICIÓN' } },

  /* La tarjeta grande que faltaba — y no una cualquiera: es la plantilla con
     más pantalla de la pieza de Codex y la hoja no la enseñaba. Config de la
     pieza real: `lienzo` tapa el A-Roll y `reparto` estira la cadena. El
     instante es el veredicto de la última puerta (con dur=5 y lienzo, el
     compás lo pone en 4,11 s): es la única frase que este gráfico dice, y
     capturar antes es fotografiar el preámbulo. */
  { f: 'security-pipeline-nodes.html', t: 4.2, cfg: {
      duration: 5, y: 600, lienzo: true, reparto: true } },

  /* En rejilla se ven todos los presets a la vez; el instante pilla la
     cabeza de lectura a mitad de gira, que es lo que la plantilla hace. */
  { f: 'subtitles-showcase.html', t: 3.2, cfg: { duration: 6 } },

  /* --- Los micro-FX. Config mínima a propósito: sus defaults SON la muestra
     canónica, y solo donde el default es texto vacío se pasa uno — una ficha
     sin texto no enseña qué hace el gesto. Viven ~1,2 s, así que el instante
     va TRAS el gesto y antes de la salida, que aquí queda a un cuarto de
     segundo: hay menos margen que en las tarjetas, no menos criterio. --- */
  { f: 'stamp-banned.html',      t: 1.00, cfg: { duration: 1.4 } },
  { f: 'stroke-crossout.html',   t: 0.60, cfg: { duration: 1.0 } },
  { f: 'cut-strip.html',         t: 0.85, cfg: { duration: 1.3 } },
  { f: 'green-spike.html',       t: 0.90, cfg: { duration: 1.2, texto: '+38 %' } },
  { f: 'red-crash.html',         t: 0.75, cfg: { duration: 1.1 } },
  { f: 'head-explode.html',      t: 0.60, cfg: { duration: 1.1 } },

  /* El brillo ES el gesto: se captura a mitad de barrido, no asentado.
     Asentado, gold-glint es un rótulo quieto que no dice por qué existe. */
  { f: 'gold-glint.html',        t: 0.30, cfg: { duration: 1.3 } },

  { f: 'target-hud.html',        t: 0.85, cfg: { duration: 1.3 } },
  { f: 'neural-node-pulse.html', t: 0.90, cfg: { duration: 1.4 } },
  { f: 'svg-checkmark.html',     t: 0.90, cfg: { duration: 1.2, texto: 'APROBADO' } },
  { f: 'padlock-unlock.html',    t: 0.90, cfg: { duration: 1.3 } },

  /* A 0,7 s el anillo va por «2»: congelado en 3 o en 0 parece un badge;
     a mitad de cuenta se lee como cuenta atrás. */
  { f: 'timer-ring.html',        t: 0.70, cfg: { duration: 1.4 } },

  { f: 'text-stack-offset.html', t: 0.80, cfg: { duration: 1.2 } },
];

/* Los hex de fondo VIGENTES, leídos de `_tokens.css` en cada pasada y no
   copiados aquí. Copiados estuvieron: esta hoja llevó 0x121212/0xF6F4F0 —la
   paleta anterior— mientras los temas ya eran #16161A/#EDE8DF, así que TODA
   la hoja juzgaba contraste sobre fondos que ningún espectador vería. Una
   paleta duplicada deriva en silencio; leída de la fuente no puede. */
function fondosVigentes() {
  const css = fs.readFileSync(path.join(TPL, '_tokens.css'), 'utf8');
  const fondos = {};
  for (const tema of TEMAS) {
    const bloque = css.match(new RegExp(
      `:root\\[data-tema="${tema}"\\]\\s*\\{[^}]*`));
    const hex = bloque && bloque[0].match(/--bg:\s*#([0-9A-Fa-f]{6})/);
    if (!hex) {
      throw new Error(
        `_tokens.css no trae --bg para el tema «${tema}»: ¿cambió el ` +
        `formato de :root[data-tema="..."]? Ajusta fondosVigentes() en ` +
        `scripts/hoja_contactos.js a la par.`);
    }
    fondos[tema] = '0x' + hex[1].toUpperCase();
  }
  return fondos;
}

/* Las plantillas que reciben pasada de cristal en el compositor, leídas de
   la tabla CRISTAL de `dirigir.py` —la fuente de verdad— y no copiadas:
   `pills` salió de esa tabla en la tanda 15 y una copia aquí habría seguido
   componiéndola sobre metraje sin motivo. */
function plantillasCristal() {
  const py = fs.readFileSync(path.join(RAIZ, 'scripts', 'dirigir.py'), 'utf8');
  const bloque = py.match(/^CRISTAL = \{([\s\S]*?)^\}/m);
  if (!bloque) {
    throw new Error(
      'no encuentro la tabla CRISTAL en scripts/dirigir.py: si cambió de ' +
      'nombre o de formato, ajusta plantillasCristal() en ' +
      'scripts/hoja_contactos.js a la par.');
  }
  return new Set([...bloque[1].matchAll(/"([a-z0-9-]+)":\s*\{/g)]
    .map(m => m[1] + '.html'));
}

function args() {
  const a = process.argv.slice(2), o = { temas: TEMAS, only: null };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--tema') o.temas = [a[++i]];
    else if (a[i] === '--only') o.only = a[++i];
  }
  return o;
}

async function main() {
  const o = args();
  fs.rmSync(SALIDA, { recursive: true, force: true });
  fs.mkdirSync(SALIDA, { recursive: true });

  const muestras = MUESTRAS.filter(m => {
    if (o.only && !m.f.includes(o.only)) return false;
    if (!fs.existsSync(path.join(TPL, m.f))) {
      if (!m.opcional) console.error('  falta ' + m.f);
      return false;
    }
    return true;
  });

  /* Fondo de las celdas de cristal: un FOTOGRAMA REAL del A-Roll. Difuminar
     un plano liso devuelve el mismo plano — sobre el color del tema la
     refracción es literalmente invisible, y así fue como glass-dock se
     diagnosticó mal una vez: la pastilla gris que `_tokens.css § LIQUID
     GLASS` describe. El instante es FIJO, no aleatorio: mismo metraje →
     misma hoja. 6,0 s pilla el encuadre con más rango tonal de la pieza
     —pared clara, cuadro azul, camiseta oscura—, que es justo lo que un
     velo translúcido necesita detrás para poder juzgarse. */
  const CRISTAL = plantillasCristal();
  const AROLL = path.join(RAIZ, 'build', 'aroll_codex.mp4');
  let fondoAroll = null;
  if (muestras.some(m => CRISTAL.has(m.f))) {
    if (fs.existsSync(AROLL)) {
      fondoAroll = path.join(SALIDA, '_fondo_aroll.png');
      execFileSync(FFMPEG, ['-nostdin', '-y', '-loglevel', 'error',
        '-ss', '6.0', '-i', AROLL, '-frames:v', '1',
        /* por si el A-Roll de otra pieza no viniera ya a 1080x1920 */
        '-vf', `scale=${ANCHO}:${ALTO}:force_original_aspect_ratio=increase,` +
               `crop=${ANCHO}:${ALTO}`,
        fondoAroll]);
    } else {
      /* La hoja no puede DEPENDER de un fichero desechable —build/ no
         viaja— pero tampoco callarse: sin metraje, las celdas de cristal
         vuelven al color plano y lo que enseñan NO es la refracción. */
      console.error(
        'aviso: falta build/aroll_codex.mp4 (build/ es desechable); las ' +
        'celdas de cristal caen al color plano y la refracción NO se puede ' +
        'juzgar. Repón el metraje de la pieza en build/aroll_codex.mp4 ' +
        'para verlas sobre fotograma real.');
    }
  }

  const navegador = await chromium.launch();
  const page = await navegador.newPage({ viewport: { width: ANCHO, height: ALTO } });
  const columnas = [];

  for (const m of muestras) {
    const nombre = (m.etiqueta || m.f.replace('.html', '')).replace(/[^\w()-]/g, '_');
    const porTema = [];
    /* Una navegación por tema, no una por plantilla. Reutilizar la página
       entre temas funciona —comprobado: las 56 celdas salen idénticas al
       byte— pero NO se hace, y a propósito: medido, ahorra 0 s (6,45 s
       frente a 6,67 s, dentro del ruido) porque `goto` sobre un `file://`
       local es barato y el coste está en las capturas. A cambio obligaría
       a que toda plantilla futura limpie su contenedor en `setup`, o el
       segundo tema saldría con contenido duplicado. Regla implícita cara,
       beneficio nulo. */
    for (const tema of o.temas) {
      await page.goto('file://' + path.join(TPL, m.f), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(cfg => window.TPL.setup(cfg),
                          Object.assign({}, m.cfg, { tema }));
      await page.evaluate(t => window.TPL.seek(t), m.t);
      const png = path.join(SALIDA, `${nombre}__${tema}.png`);
      await page.screenshot({ path: png, omitBackground: true });
      porTema.push({ png, tema });
    }
    columnas.push({ nombre, porTema, cristal: CRISTAL.has(m.f) });
    process.stderr.write(`  ${nombre}\n`);
  }
  /* Las etiquetas se dibujan en el navegador porque este ffmpeg viene sin
     libfreetype y no puede escribir texto. Sin nombre bajo cada ficha hay
     que contar columnas para saber qué se está mirando, y ahí es donde se
     cuelan las lecturas equivocadas. */
  const etiq = await navegador.newPage({ viewport: { width: 300, height: 44 } });
  for (const col of columnas) {
    await etiq.setContent(
      `<body style="margin:0;height:44px;display:flex;align-items:center;` +
      `justify-content:center;background:#1E1E24;` +
      `font:600 15px/1 ui-monospace,Menlo,monospace;color:#D8D4CC;` +
      `letter-spacing:.06em">` +
      col.nombre.replace(/[<>&]/g, '') + `</body>`);
    await etiq.screenshot({ path: path.join(SALIDA, `_etiq_${col.nombre}.png`) });
  }
  await navegador.close();

  /* Cada muestra se compone sobre el fondo de SU tema: un overlay
     transparente juzgado sobre el fondo equivocado no dice nada. Los hex
     salen de `_tokens.css`, no de una copia — ver fondosVigentes(). */
  const FONDOS = fondosVigentes();
  const CELDA_W = 300, CELDA_H = 533, ETIQ_H = 44;
  const COLS = Number(process.env.HOJA_COLS || 7);

  /* Los dos temas de una plantilla van APILADOS en la misma ficha, no en
     dos filas separadas a lo largo de toda la hoja. Comparar temas es el
     motivo de existir de esta herramienta, y con filas largas hay que
     contar columnas a ojo para emparejarlos — que es justo como se cuelan
     los errores de lectura. */
  const fichas = [];
  for (const col of columnas) {
    const trozos = [];
    for (const tema of o.temas) {
      const p = col.porTema.find(x => x.tema === tema);
      if (!p) continue;
      const plano = path.join(SALIDA, `_plano_${col.nombre}_${tema}.png`);
      /* Cristal sobre metraje, el resto sobre el color del tema. El
         fotograma es el MISMO en los dos temas a propósito: el metraje no
         cambia con el tema, y lo que se compara apilado es el mueble. */
      const fondo = (col.cristal && fondoAroll)
        ? ['-i', fondoAroll]
        : ['-f', 'lavfi', '-i', `color=c=${FONDOS[tema]}:s=${ANCHO}x${ALTO}:d=1`];
      execFileSync(FFMPEG, ['-nostdin', '-y', '-loglevel', 'error',
        ...fondo,
        '-i', p.png,
        '-filter_complex', `[0:v][1:v]overlay=0:0,scale=${CELDA_W}:${CELDA_H}`,
        '-frames:v', '1', plano]);
      trozos.push(plano);
    }
    if (!trozos.length) continue;
    trozos.push(path.join(SALIDA, `_etiq_${col.nombre}.png`));

    const ficha = path.join(SALIDA, `_ficha_${col.nombre}.png`);
    execFileSync(FFMPEG, ['-nostdin', '-y', '-loglevel', 'error',
      ...trozos.flatMap(t => ['-i', t]),
      '-filter_complex', `${trozos.map((_, i) => `[${i}:v]`).join('')}` +
                         `vstack=inputs=${trozos.length}`,
      '-frames:v', '1', ficha]);
    fichas.push(ficha);
  }

  /* Relleno de la última fila: hstack exige que todas las entradas
     existan, así que las celdas que faltan se rellenan con un plano. */
  const altoFicha = CELDA_H * o.temas.length + ETIQ_H;
  const hueco = path.join(SALIDA, '_hueco.png');
  execFileSync(FFMPEG, ['-nostdin', '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=0x1E1E24:s=${CELDA_W}x${altoFicha}:d=1`,
    '-frames:v', '1', hueco]);

  const filas = [];
  for (let i = 0; i < fichas.length; i += COLS) {
    const grupo = fichas.slice(i, i + COLS);
    while (grupo.length < COLS) grupo.push(hueco);
    const fila = path.join(SALIDA, `_fila_${filas.length}.png`);
    execFileSync(FFMPEG, ['-nostdin', '-y', '-loglevel', 'error',
      ...grupo.flatMap(c => ['-i', c]),
      '-filter_complex', `${grupo.map((_, i) => `[${i}:v]`).join('')}` +
                         `hstack=inputs=${grupo.length}`,
      '-frames:v', '1', fila]);
    filas.push(fila);
  }

  const hoja = path.join(RAIZ, 'build', 'hoja_contactos.png');
  if (filas.length === 1) {
    fs.copyFileSync(filas[0], hoja);
  } else {
    execFileSync(FFMPEG, ['-nostdin', '-y', '-loglevel', 'error',
      ...filas.flatMap(t => ['-i', t]),
      '-filter_complex', `${filas.map((_, i) => `[${i}:v]`).join('')}` +
                         `vstack=inputs=${filas.length}`,
      '-frames:v', '1', hoja]);
  }

  console.log(JSON.stringify({
    hoja, plantillas: columnas.length, temas: o.temas,
    rejilla: `${COLS} x ${filas.length}`,
    cristal: columnas.filter(c => c.cristal).map(c => c.nombre),
    fondo_cristal: fondoAroll ? 'aroll' : 'plano',
    orden: columnas.map(c => c.nombre)
  }, null, 2));
}
/* Solo se ejecuta si se INVOCA, no si se importa. Sin esto, un `require()`
   para reutilizar MUESTRAS lanzaba el trabajo entero y escribía en `build/`.
   Es el equivalente del `if __name__ == "__main__"` que todos los scripts de
   Python ya tienen; se le puso al renderizador después de que me borrara
   fotogramas por esto mismo. */
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
} else {
  module.exports = { MUESTRAS, TEMAS };
}

