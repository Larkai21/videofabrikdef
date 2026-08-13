#!/usr/bin/env node
/**
 * Trae un bloque del catálogo de HyperFrames y lo deja siendo una plantilla
 * de ESTE repo: sin red, con los tokens de marca, con el contrato
 * `Engine.register({duration, setup, draw})` y con el reloj determinista.
 *
 * Uso:
 *     node scripts/importar_bloque.js x-post yt-comment-card
 *     node scripts/importar_bloque.js --lista            # qué hay en el catálogo
 *
 * ## Por qué existe y no se copia y pega
 *
 * Los dos mundos hablan el mismo idioma por debajo —una timeline de GSAP en
 * pausa a la que se le hace `seek` por fotograma— así que el puente son
 * cuatro líneas. Lo que NO es de cuatro líneas es todo lo demás, y es lo que
 * hace este script:
 *
 *   · **La red.** Sus bloques cargan GSAP de un CDN y algunos las fuentes de
 *     Google. Este repo rasteriza en local y sin red: un `<link>` a
 *     fonts.googleapis.com no da error, da una fuente distinta —y eso no lo
 *     delata ningún log, solo el fotograma—. GSAP se sirve de
 *     `templates/_gsap.min.js`, versionado; los `<link>` de fuentes se
 *     quitan porque las familias que piden (Inter, Playfair Display,
 *     JetBrains Mono) están instaladas en la máquina.
 *   · **La paleta.** Cada familia del catálogo declara SUS variables para
 *     re-vestirse (`--mk-*`, `--yt-*`, `--hw-*`, `--cap-*`…) y no son las
 *     mismas: remapear una no remapea las otras. La tabla `TOKENS` las cruza
 *     con `_tokens.css`, así que un bloque importado queda además tematizado
 *     —`carbon` y `paper`— sin tocarlo.
 *   · **Los hexadecimales que quedan.** Los que no pasan por una variable se
 *     marcan con `PALETA-AJENA: inicio/fin`, que es la frontera que
 *     `auditar_estilo.js` ya entiende: no se cuentan como deuda propia pero
 *     SALEN PUBLICADOS aparte. Es una declaración, no una exención: el
 *     número se ve y baja cuando alguien acaba de vestir el bloque.
 *   · **El lienzo.** Maquetan para 1920x1080 y aquí se monta 1080x1920. Se
 *     escala al ancho y se centra, que es un apaño y está dicho: encoger un
 *     gráfico para que quepa ya salió mal una vez en este repo (la vuelta
 *     atrás de `POS_*`). Lo que toca al final es rehacer la maqueta en
 *     vertical, bloque a bloque.
 *
 * ## Lo que NO hace, y hay que hacer a mano
 *
 *   · **La SALIDA.** Sus bloques entran y se quedan: medido sobre los
 *     importados, `x-post` anima 0,8 s de una timeline de 4,5 y las otras
 *     3,7 s son un plano fijo. Aquí una capa entra, aguanta y SALE dentro de
 *     su duración. El importador mide dónde se asienta la animación y
 *     registra ESO como `duration` —así el humo ve movimiento y el plan
 *     sigue mandando con `config.duration`—, pero la salida hay que
 *     animarla a mano, bloque a bloque.
 *   · **`cues`**: un bloque importado entra MUDO. `setup` puede devolver
 *     `{cues:[{at,sfx,gain}]}` y ahí es donde se le pone el sonido.
 *   · **`anclas`**: sin ellas `colocar.py` no sabe dónde está su caja.
 *   · **Un párrafo en `BRAND_RULES.md`**: `comprobar_docs.py` es una puerta y
 *     falla si una plantilla existe y la norma no la nombra. El script lo
 *     recuerda al terminar, con el nombre exacto.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.dirname(__dirname);
const TPL = path.join(RAIZ, 'templates');
const OBRADOR = path.join(RAIZ, 'build', 'hf');
const PREFIJO = 'hf-';

/* La pareja que declara la paleta ajena. Van juntas y en una constante
   porque las escriben DOS sitios —`importa()` al traer el bloque y
   `repuente()` al regenerar el puente— y basta con que uno de los dos se
   deje el cierre para que la región no exista. */
const MARCA_PUENTE_FIN = '<!-- PUENTE:fin -->';
const MARCA_AJENA_INI = '<!-- /* PALETA-AJENA: inicio */ -->';
const MARCA_AJENA_FIN = '<!-- /* PALETA-AJENA: fin */ -->';

/* Las variables de re-vestido de cada familia contra los tokens de este repo.
 * Ampliar es añadir una línea; lo que no esté aquí sobrevive con su color y
 * sale contado en `hex_ajenos`. */
const TOKENS = [
  [/(--(?:mk|yt|hw|cap|lt)-font\s*:)[^;]+;/g,        '$1 var(--display);'],
  [/(--(?:mk|yt|hw|cap|lt)-mono\s*:)[^;]+;/g,        '$1 var(--mono);'],
  [/(--(?:mk|yt|hw|cap|lt)-ink\s*:)[^;]+;/g,         '$1 var(--ink);'],
  [/(--(?:mk|yt|hw|cap|lt)-ink-dim\s*:)[^;]+;/g,     '$1 var(--ink-faint);'],
  [/(--(?:mk|yt|hw|cap|lt)-muted\s*:)[^;]+;/g,       '$1 var(--ink-faint);'],
  [/(--(?:mk|yt|hw|cap|lt)-accent\s*:)[^;]+;/g,      '$1 var(--accent);'],
  [/(--(?:mk|yt|hw|cap|lt)-accent-2\s*:)[^;]+;/g,    '$1 var(--metal-3);'],
  [/(--(?:mk|yt|hw|cap|lt)-paper\s*:)[^;]+;/g,       '$1 transparent;'],
  [/(--(?:mk|yt|hw|cap|lt)-bg\s*:)[^;]+;/g,          '$1 transparent;'],
  [/(--(?:mk|yt|hw|cap|lt)-surface\s*:)[^;]+;/g,     '$1 var(--surface);'],
  [/(--(?:mk|yt|hw|cap|lt)-axis\s*:)[^;]+;/g,        '$1 var(--ink-faint);'],
  [/(--(?:mk|yt|hw|cap|lt)-rule\s*:)[^;]+;/g,        '$1 var(--rule);'],
];

/* La red, fuera. */
const CDN_GSAP = /<script[^>]*src="https?:\/\/[^"]*gsap[^"]*"[^>]*>\s*<\/script>/gi;
const LINK_RED = /<link[^>]*href="https?:\/\/[^"]*"[^>]*>\s*/gi;

function catalogo() {
  const salida = execFileSync('npx', ['--yes', 'hyperframes', 'catalog'],
                              { cwd: OBRADOR, encoding: 'utf8' });
  return salida.replace(/\x1b\[[0-9;]*m/g, '');
}

function proyecto() {
  if (!fs.existsSync(path.join(OBRADOR, 'hyperframes.json'))) {
    fs.mkdirSync(OBRADOR, { recursive: true });
    execFileSync('npx', ['--yes', 'hyperframes', 'init', '.', '--example',
                         'blank', '--resolution', 'portrait',
                         '--non-interactive'],
                 { cwd: OBRADOR, stdio: 'ignore',
                   env: { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1' } });
  }
}

function baja(nombre) {
  execFileSync('npx', ['--yes', 'hyperframes', 'add', nombre],
               { cwd: OBRADOR, stdio: 'ignore' });
  for (const p of [path.join(OBRADOR, 'compositions', nombre + '.html'),
                   path.join(OBRADOR, 'compositions/components', nombre + '.html')]) {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  throw new Error('«' + nombre + '» no está en el catálogo, o es un fragmento '
                  + 'que decora a un anfitrión y no una pieza suelta '
                  + '(shimmer-sweep, grid-pixelate-wipe…)');
}

function idDeComposicion(src) {
  const m = src.match(/data-composition-id="([^"]+)"/);
  return m ? m[1] : null;
}

/* LAS RANURAS DE TEXTO de los bloques importados.
 *
 * Un bloque del catálogo trae su contenido ESCRITO DENTRO, así que sin esto
 * un guion puede pedirle una tarjeta y recibir la demo del fabricante: la
 * pieza de respiración pidió «EXHALAS → DIAFRAGMA → NERVIO VAGO → PULSO» y
 * salió «Idea / Record / Shine!» — compuesto, sin un aviso, y diciendo otra
 * cosa que la voz.
 *
 * La tabla cruza una clave de `config` con un SELECTOR, y el puente reparte
 * los textos por orden sobre lo que ese selector encuentre. Es lo mismo que
 * `COPY` hace con las nuestras, con la diferencia de que aquí la ranura no la
 * declara la plantilla: se descubre leyendo su marcado. Ampliarla es una
 * línea por bloque, y hasta que un bloque esté aquí no se le puede escribir.
 */
const TEXTOS = {
  'hf-hw-pipeline':   { nodos: '.hw-pl-label' },
  'hf-hw-title':      { lineas: '.hw-t-word' },
  'hf-mk-specs-list': { filas: '.mk-sl-label' },
  'hf-lt-bold-block': { lineas: '.lt-bb-name, .lt-bb-tag' },
  'hf-mk-line-graph': { series: '.mk-lg-legend-name', ejex: '.mk-lg-xlabel' },
  'hf-mk-progress-stat': { cifra: '#mk-ps-num', rotulo: '#mk-ps-label',
                           pie: '#mk-ps-caption' },
  'hf-hw-underline':  { lineas: '.hw-mark' },
  'hf-hw-title':      { lineas: '#hw-t-line' },
  'hf-hw-arrow':      { lineas: '#hw-ar-demo' },
  'hf-lt-bold-block': { lineas: '.lt-name, .lt-tag' },
  'hf-mk-callout-highlight': { lineas: '#mk-ch-box' },
  'hf-mk-usage-arc':  { cifra: '.mk-arc-num', rotulo: '.mk-arc-label' },
};

/* El puente, aparte para poder REGENERARLO sobre una plantilla ya
 * importada sin volver a descargarla ni a medirla: va entre marcadores
 * y `--repuente` lo sustituye conservando el gesto medido. */
function puenteDe(id, ranuras) {
  return `
<!-- PUENTE:inicio · generado por scripts/importar_bloque.js -->
<style>
  /* El lienzo de este repo, y la raíz TRANSPARENTE: si el fondo llega opaco,
     omitBackground no lo recorta y los PNG salen sin alfa — el compositor
     los pega como un rectángulo y tapa el metraje. */
  html, body { width: 1080px; height: 1920px; margin: 0;
               background: transparent !important; overflow: hidden; }
  [data-composition-id="${id}"] { transform-origin: 50% 50%; }
  /* El PLAFÓN DE AUTO-PREVISUALIZACIÓN. Varias piezas del catálogo traen un
     fondo propio para poder mirarse solas —hf-hw-callout-circle lo llama
     literalmente «self-preview scene» y es un degradado verde— y sobre
     nuestro metraje eso no es un fondo: es una mancha que tapa el plano.
     Se quita el relleno y se deja el contenido, que es lo que se quería. */
  [id$="-scene"] { background: none !important; }
</style>
<script>
(function () {
  var ID = ${JSON.stringify(id)};
  var RANURAS = ${JSON.stringify(ranuras || {})};
  var raiz = document.querySelector('[data-composition-id="' + ID + '"]');
  var tl = (window.__timelines || {})[ID] || null;

  /* Maqueta a 1920x1080 y aquí el lienzo es 1080x1920: se escala al ancho y
     se centra. Es un APAÑO declarado, no una solución — la buena es rehacer
     la maqueta en vertical. config.encaje:false lo desactiva y
     config.escala lo fuerza.
     La medida sale de data-width/data-height y NO de offsetWidth: la raíz de
     varios bloques mide 0x0 —es un ancla para hijos posicionados, no una
     caja— y con la medida del DOM el encaje la mandaba a left:-420, fuera
     del cuadro. Fotograma transparente, cero errores, y el humo diciendo
     «no se mueve» porque no había nada que moviera. Por eso se envuelve en
     una caja del tamaño DECLARADO: así los hijos absolutos tienen un
     contenedor de verdad y la escala se aplica a algo con dimensiones. */
  var caja = null;
  function encaja(cfg) {
    if (!raiz || cfg.encaje === false) return;
    var w = +raiz.dataset.width || raiz.offsetWidth || 1920;
    var h = +raiz.dataset.height || raiz.offsetHeight || 1080;
    if (!caja) {
      caja = document.createElement('div');
      raiz.parentNode.insertBefore(caja, raiz);
      caja.appendChild(raiz);
    }
    caja.style.cssText = 'position:absolute;left:0;top:0;width:' + w
                       + 'px;height:' + h + 'px;transform-origin:0 0;';
    raiz.style.position = 'absolute';
    raiz.style.left = '0'; raiz.style.top = '0';
    raiz.style.width = w + 'px'; raiz.style.height = h + 'px';
    var k = cfg.escala || Math.min(1080 / w, 1920 / h);
    /* DÓNDE, y no solo cuánto. Centrado es lo razonable por defecto, pero un
       rótulo inferior centrado en un lienzo vertical queda en mitad de la
       cara; y §18 dice que la banda de abajo la pinta la app. zona mueve la
       caja ya escalada sin tocar la maqueta de dentro: arriba pega bajo la
       banda superior (230 px), abajo se apoya sobre la inferior (1459 px). */
    var alto = h * k;
    var y = (1920 - alto) / 2;
    if (cfg.zona === 'arriba') y = 230 + 40;
    else if (cfg.zona === 'abajo') y = 1459 - 40 - alto;
    caja.style.transform = 'translate(' + Math.round((1080 - w * k) / 2)
      + 'px,' + Math.round(y) + 'px) scale(' + k + ')';
  }

  /* LA CAJA DE TINTA, para colocar.py.
     Sin anclas() una capa es invisible para el colocador: no sabe cuánto
     ocupa ni dónde, así que no puede apartarla del rostro ni avisar de que
     cae bajo el caption de la app. Nuestras plantillas la declaran a mano
     porque saben qué parte de sí mismas importa; un bloque importado no
     puede saberlo, así que se MIDE: unión de los rectángulos visibles, ya en
     coordenadas de lienzo —getBoundingClientRect incluye la transformación
     del encaje—, descartando los contenedores que cubren casi todo.
     Se llama después de seek, así que la caja es la del instante que se
     esté mirando y no la del reposo. */
  function tinta() {
    if (!raiz) return null;
    /* Dos pasadas. La primera descarta los contenedores que cubren casi todo
       —si no, la caja de cualquier plantilla sería el lienzo entero y el dato
       no diría nada—. Pero en las de dibujo a mano el contenido ES un <svg> a
       pantalla completa y sus <path> devuelven cajas de cero: con el filtro
       puesto, veintisiete plantillas se quedaban sin ancla. Si la primera
       pasada no deja nada, se repite SIN filtro: una caja grande de más es
       peor que ninguna, pero ninguna es peor que las dos. */
    function une(filtra) {
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      var todos = raiz.querySelectorAll('*');
      for (var i = 0; i < todos.length; i++) {
        var e = todos[i], s = getComputedStyle(e);
        if (s.display === 'none' || s.visibility === 'hidden' ||
            parseFloat(s.opacity) < 0.05) continue;
        var r = e.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (filtra && r.width * r.height > 0.92 * 1080 * 1920) continue;
        if (r.left < x0) x0 = r.left;
        if (r.top < y0) y0 = r.top;
        if (r.right > x1) x1 = r.right;
        if (r.bottom > y1) y1 = r.bottom;
      }
      return x1 < x0 ? null : [x0, y0, x1, y1];
    }
    var c = une(true) || une(false);
    if (!c) return null;
    var x0 = c[0], y0 = c[1], x1 = c[2], y1 = c[3];
    x0 = Math.max(0, x0); y0 = Math.max(0, y0);
    x1 = Math.min(1080, x1); y1 = Math.min(1920, y1);
    return { bloque: { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2),
                       w: Math.round(x1 - x0), h: Math.round(y1 - y0) } };
  }

  /* LA SALIDA, que sus bloques no tienen: entran y se quedan puestos hasta
     que la composición acaba. Aquí una capa vive dentro de su ventana y
     tiene que irse, y no es cosmética — es lo que humo_plantillas.js
     comprueba cuando muestrea tres instantes y exige que no sean el mismo
     fotograma. Medido: x-post y macos-notification animan su entrada y dan
     tres capturas idénticas después.
     Es una salida GENÉRICA —se va bajando y encogiendo un pelo— y por eso
     se puede apagar con config.salida:false cuando el bloque tenga la suya
     propia. Determinista: solo depende de t. */
  var SALIDA = 0.42;
  /* La duración del GESTO, medida al importar. La sustituye el importador;
     el valor de aquí es el de respaldo para quien abra el fichero suelto.
     Va en una variable y no en dos sitios a propósito: la salida tiene que
     caer dentro de la MISMA ventana que registra la plantilla, y cuando eran
     dos números —la declarada por la timeline y la registrada— la salida se
     programaba fuera del tramo que nadie llega a ver. */
  /* El copy que el plan pide, repartido por orden sobre las ranuras que
     declara TEXTOS. Lo que sobra se ignora; lo que falta se queda con lo que
     el bloque traía.
     Se aplica en CADA fotograma y no solo al montar, y no es por comodidad:
     varios bloques animan su propio texto —un contador que sube, un
     tecleado— así que su timeline reescribe el nodo en cada seek y el copy
     del plan duraba un fotograma. Medido: la tarjeta pedía «−12» y salía el
     «22» de la demo. */
  function copia(cfg) {
    for (var k in RANURAS) {
      if (!cfg || !cfg[k] || !cfg[k].length) continue;
      var nodos = document.querySelectorAll(RANURAS[k]);
      for (var i = 0; i < nodos.length && i < cfg[k].length; i++) {
        if (nodos[i].textContent !== cfg[k][i]) nodos[i].textContent = cfg[k][i];
      }
    }
  }

  var DUR = tl ? tl.duration() : 5;
  var vida = DUR;

  Engine.register({
    duration: DUR,
    /* Las ranuras se escriben LITERALES en los defaults, no con un
       Object.assign: lint_config.py lee ese bloque con una expresión regular
       —no ejecuta la plantilla— así que una clave calculada no existe para
       él y el plan que la usa aborta por «clave que la plantilla no lee».
       Las ranuras entran aquí porque lint_config.py --estricto
       comprueba que toda clave del plan la lea de verdad su plantilla: sin
       declararlas, pedir el copy por config es una clave muerta y el paso
       aborta. */
    defaults: { encaje: true, escala: null, zona: 'centro', salida: true,
                tema: 'carbon', cue: null, cueGain: null${Object.keys(ranuras || {}).map(function (k) {
                  return ', ' + k + ': null'; }).join('')} },
    setup: function (cfg) {
      encaja(cfg);
      vida = cfg.duration || DUR;
      copia(cfg);
      /* EL SONIDO: NINGUNO por defecto, y esto es una vuelta atrás.
         Se publicaba un «aparicion» genérico en cada bloque importado para
         que no entraran mudos. Sobre la pieza montada suena a lo que es: el
         mismo golpe blando en 126 sitios, puesto por una regla que no sabe
         qué está entrando. Un sonido que no significa nada es peor que el
         silencio, porque el oído lo cuenta igual.
         Quien sabe qué suena una capa es el guion —sfx en la capa— o la
         tabla del director para las plantillas que conoce. Con cue en la
         config se puede pedir uno a mano. */
      return { cues: (!cfg.sinSonido && cfg.cue)
                     ? [{ at: 0.04, sfx: cfg.cue, gain: cfg.cueGain || 0.5 }]
                     : [] };
    },
    anclas: function () { return tinta(); },
    /* El puente entero. Los dos motores hacen lo mismo —posicionar una
       animación en el segundo t, sin tocar el reloj del navegador—, así que
       no hay nada que traducir. */
    /* La salida va en la raíz y el encaje en la caja que la envuelve: dos
       transformaciones en dos nodos, para que no se pisen. */
    draw: function (t, cfg) {
      if (tl) tl.time(Math.max(0, Math.min(t, tl.duration())));
      copia(cfg);
      if (!raiz) return;
      if (cfg && cfg.salida !== false && vida > SALIDA) {
        var d = (t - (vida - SALIDA)) / SALIDA;
        if (d > 0) {
          var e = 1 - Math.min(1, d);
          e = e * e * (3 - 2 * e);              /* suavizado, sin rebote */
          raiz.style.opacity = e;
          raiz.style.transform = 'translateY(' + ((1 - e) * -26).toFixed(2)
                               + 'px) scale(' + (0.985 + 0.015 * e).toFixed(4) + ')';
          return;
        }
      }
      raiz.style.opacity = '';
      raiz.style.transform = '';
    }
  });
})();
</script>
<!-- PUENTE:fin -->
`;
}

function transforma(nombre, src) {
  const id = idDeComposicion(src);
  if (!id) throw new Error('«' + nombre + '» no declara data-composition-id: '
                           + 'no hay timeline que conducir');
  /* Y la otra forma de «no es una pieza suelta», que cuesta más de ver: el
     bloque ENTERO vive dentro de un elemento template. Eso en HTML es inerte
     —el navegador no lo pinta y querySelector no entra— y está pensado para
     que un anfitrión lo clone con data-composition-src. Importado tal cual,
     el id existe en el fichero, la timeline se registra, el humo no encuentra
     la raíz, y salen ocho code-snippets renderizando un PNG transparente. Se
     rechaza aquí, con el nombre y el porqué. */
  const antesDelId = src.slice(0, src.indexOf('data-composition-id'));
  const abre = (antesDelId.match(/<template\b/gi) || []).length;
  const cierra = (antesDelId.match(/<\/template>/gi) || []).length;
  if (abre > cierra) {
    throw new Error('«' + nombre + '» vive dentro de un <template>: es una '
      + 'SUB-COMPOSICIÓN inerte que un anfitrión tiene que clonar, no una '
      + 'pieza que se abra sola. Igual que un fragmento, se usa DENTRO de '
      + 'una plantilla, no como una');
  }

  let out = src;
  out = out.replace(CDN_GSAP, '<script src="_gsap.min.js"></script>');
  out = out.replace(LINK_RED, '');
  for (const [re, val] of TOKENS) out = out.replace(re, val);

  /* Los hexadecimales que quedan, delimitados donde `auditar_estilo.js` los
     sabe leer. Los dos marcadores son UNA pareja y viven en una constante
     porque `repuente()` también tiene que saber reponer el cierre.
     La región es el DOCUMENTO ENTERO y no cada `<style>`, que fue el primer
     intento: marcando solo las hojas quedaban fuera los `fill="#…"` de los
     SVG, los `style="…"` en línea y los colores dentro del JS —medido, 1594
     hexadecimales contra los 1296 que sí caían dentro—. Los marcadores van
     envueltos en un comentario de HTML porque fuera de una hoja de estilo
     un comentario de CSS no es un comentario: es texto que se pinta. */
  out = out.replace(/<head([^>]*)>/i, '<head$1>\n' + MARCA_AJENA_INI)
           .replace(/<\/body>/i, MARCA_AJENA_FIN + '\n</body>');

  out = out.replace(/<\/head>/i,
    '  <link rel="stylesheet" href="_tokens.css">\n' +
    '  <script src="_engine.js"></script>\n</head>');

  const puente = puenteDe(id, TEXTOS[PREFIJO + nombre]);

  out = out.replace(/<\/body>/i, puente + '</body>');
  return out;
}

/* Dónde deja de moverse la animación.
 *
 * Sus bloques declaran una timeline larga y animan al principio: `x-post`
 * anima 0,8 s de 4,5 y el resto es un plano fijo. Registrar los 4,5 hace que
 * `humo_plantillas.js` muestree tres instantes DENTRO de la cola muerta y
 * diga, con razón, que la plantilla no se mueve.
 *
 * Se mide con el navegador que rasteriza —no se estima— por firma barata del
 * árbol: transform, opacidad y caja de cada elemento. El último instante en
 * que la firma cambia es el asentamiento; se le da un margen y eso es la
 * duración por defecto. El plan puede pedir más con `config.duration`: lo que
 * se registra aquí es cuánto dura el GESTO, no cuánto sale en pantalla. */
async function asienta(ruta) {
  const { chromium } = require(path.join(RAIZ, 'node_modules', 'playwright'));
  const nav = await chromium.launch();
  const p = await nav.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('file://' + ruta);
  await p.waitForTimeout(300);
  const dur = await p.evaluate(() => (window.TPL && window.TPL.duration) || 0);
  /* Se mide sobre el FOTOGRAMA, no sobre el DOM, y eso costó una vuelta.
     La primera versión firmaba transforms, opacidades y cajas del árbol: en
     `x-post` los contadores de interacción siguen animando hasta el final,
     así que el DOM decía «se mueve hasta el segundo 4,5» mientras
     `humo_plantillas.js` —que compara PÍXELES— veía tres capturas idénticas
     y marcaba la plantilla como quieta. Dos medidas distintas del mismo
     hecho, y la que manda es la que mira la imagen.
     El asentamiento es el último instante cuya captura difiere de la final. */
  const crypto = require('crypto');
  const hash = async t => {
    await p.evaluate(x => window.TPL.seek(x), t);
    const buf = await p.screenshot({ omitBackground: true });
    return crypto.createHash('md5').update(buf).digest('hex');
  };
  const N = 24;
  const ts = [], hs = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * dur;
    ts.push(t); hs.push(await hash(t));
  }
  /* Lo que se busca es el PLANO FIJO, no el último cambio: varios bloques
     mueven algo en el último fotograma —un contador que remata, un brillo—
     después de haber estado quietos tres segundos, así que «el último
     instante que difiere del final» devolvía la duración entera. Se busca el
     primer tramo QUIETO de al menos cuatro muestras seguidas: ahí acaba el
     gesto y empieza la espera, que es exactamente lo que `humo_plantillas.js`
     ve cuando dice que la plantilla no se mueve. */
  const QUIETO = 4;
  let ultimo = dur, corridas = 1;
  for (let i = 1; i < hs.length; i++) {
    corridas = hs[i] === hs[i - 1] ? corridas + 1 : 1;
    if (corridas === QUIETO) { ultimo = ts[i - QUIETO + 1]; break; }
  }
  await nav.close();
  /* Un margen de medio segundo para que se lea lo que acaba de entrar, y
     nunca menos de 1,2 s: por debajo de eso no es una tarjeta, es un parpadeo. */
  return { dur, asentada: Math.max(1.2, Math.min(dur, ultimo + 0.5)) };
}

/* La lista de §19, DERIVADA del disco.
 *
 * `comprobar_docs.py` exige que la norma nombre cada plantilla, y con ciento
 * y pico importadas mantener la tabla a mano es garantizar que se quede
 * vieja. Se regenera entre marcadores y el resto de §19 —la prosa, que es
 * donde está el criterio— no se toca. Mismo trato que `guiones/CONTRATO.md`:
 * el documento es el derivado, la fuente es lo que hay. */
const MARCA_INI = '<!-- HF:inicio · lista generada por scripts/importar_bloque.js -->';
const MARCA_FIN = '<!-- HF:fin -->';

function norma() {
  const ruta = path.join(RAIZ, 'BRAND_RULES.md');
  let doc = fs.readFileSync(ruta, 'utf8');
  const filas = fs.readdirSync(TPL)
    .filter(f => f.startsWith(PREFIJO) && f.endsWith('.html'))
    .sort()
    .map(f => {
      const src = fs.readFileSync(path.join(TPL, f), 'utf8');
      const t = src.match(/<title>([^<]*)<\/title>/i);
      const g = src.match(/var DUR = ([\d.]+);/);
      return '| `' + f + '` | ' + (t ? t[1].trim() : '—') + ' | '
           + (g ? g[1] + ' s' : '—') + ' |';
    });
  const tabla = [MARCA_INI, '', '| plantilla | qué es | gesto medido |', '|---|---|---|']
    .concat(filas).concat(['', MARCA_FIN]).join('\n');
  const rx = new RegExp(MARCA_INI.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                        + '[\\s\\S]*?' + MARCA_FIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (rx.test(doc)) doc = doc.replace(rx, tabla);
  else doc = doc.trimEnd() + '\n\n' + tabla + '\n';
  fs.writeFileSync(ruta, doc);
  console.log('  ✓ BRAND_RULES §19: %d plantillas listadas', filas.length);
  return filas.length;
}

/* Vuelve a poner el puente en las plantillas YA importadas.
 *
 * Sin esto, tocar el puente obliga a re-descargar y re-medir ciento y pico
 * bloques: media hora de navegador para cambiar diez líneas que no dependen
 * del bloque. El gesto medido se conserva —es el dato caro— y lo demás se
 * regenera. Por eso el puente va entre marcadores y no simplemente pegado
 * antes de `</body>`. */
function repuente() {
  let n = 0, sin = [];
  for (const f of fs.readdirSync(TPL)
       .filter(x => x.startsWith(PREFIJO) && x.endsWith('.html'))) {
    const ruta = path.join(TPL, f);
    let s = fs.readFileSync(ruta, 'utf8');
    const id = idDeComposicion(s);
    const dur = (s.match(/var DUR = ([\d.]+);/) || [])[1];
    const desde = s.indexOf('<!-- PUENTE:inicio');
    const legado = s.indexOf('\n<style>\n  /* El lienzo de este repo');
    const corte = desde >= 0 ? desde : legado;
    if (!id || corte < 0) { sin.push(f); continue; }
    /* Se corta hasta el CIERRE del puente, no hasta </body>. Cortar hasta
       el final del documento se llevó por delante el CSS de maqueta vertical
       que hay después —el trabajo de 25 plantillas, medido: volvieron de
       llenar el lienzo a ocupar entre el 20 % y el 70 % del ancho— y no dio
       ni un aviso, porque un puente nuevo sobre un bloque sin reflow sigue
       renderizando algo. Todo lo que viva tras `PUENTE:fin` es de otro y no
       se toca. */
    const fin = s.indexOf(MARCA_PUENTE_FIN);
    const cierre = fin >= 0 ? fin + MARCA_PUENTE_FIN.length
                            : s.lastIndexOf('</body>');
    let nuevo = puenteDe(id, TEXTOS[f.replace(/\.html$/, '')]);
    if (dur) nuevo = nuevo.replace(/var DUR = tl \? tl\.duration\(\) : 5;/,
      'var DUR = ' + dur + ';   /* MEDIDO al importar */');
    /* Todo lo que hay entre `corte` y `</body>` se DESCARTA, y las primeras
       importaciones dejaban ahí el cierre de PALETA-AJENA. Al regenerar el
       puente se lo llevaba por delante: la región quedaba abierta, el
       `[\s\S]*?` de `auditar_estilo.js` no casaba con nada y los 2058
       hexadecimales ajenos del catálogo volvían a contarse como deuda PROPIA
       —de 0 a 2058 sin que ninguna prueba se pusiera en rojo, porque la
       métrica no es una puerta—. El cierre va antes del puente, que es
       además donde le toca: lo ajeno es el bloque importado, y el puente lo
       escribe este repo (cero hexadecimales, medido en las 126). */
    let prefijo = s.slice(0, corte);
    if (/PALETA-AJENA:\s*inicio/.test(prefijo) && !/PALETA-AJENA:\s*fin/.test(prefijo))
      prefijo += MARCA_AJENA_FIN + '\n';
    fs.writeFileSync(ruta, prefijo + nuevo + s.slice(cierre));
    n++;
  }
  console.log('  ✓ puente regenerado en %d plantillas%s', n,
              sin.length ? ' · ' + sin.length + ' sin marcadores: ' + sin.join(', ') : '');
  return n;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--ayuda' || args[0] === '-h') {
    console.log('uso: node scripts/importar_bloque.js <bloque> [<bloque>…]');
    console.log('     node scripts/importar_bloque.js --lista');
    return 0;
  }
  if (args[0] === '--norma') { norma(); return 0; }
  if (args[0] === '--repuente') { repuente(); norma(); return 0; }
  proyecto();
  if (args[0] === '--lista') { console.log(catalogo()); return 0; }

  return importa(args);
}

async function importa(nombres) {
  const hechos = [];
  for (const nombre of nombres) {
    try {
      const destino = path.join(TPL, PREFIJO + nombre + '.html');
      fs.writeFileSync(destino, transforma(nombre, baja(nombre)));
      const m = await asienta(destino);
      /* La duración registrada pasa a ser la del GESTO, medida. */
      fs.writeFileSync(destino, fs.readFileSync(destino, 'utf8').replace(
        /var DUR = tl \? tl\.duration\(\) : 5;/,
        'var DUR = ' + m.asentada.toFixed(2) + ';   /* MEDIDO al importar: la '
        + 'timeline declara ' + m.dur.toFixed(2) + ' s y el gesto acaba aquí */'));
      hechos.push(PREFIJO + nombre);
      console.log('  ✓ templates/' + PREFIJO + nombre + '.html'
                  + '   gesto ' + m.asentada.toFixed(2) + ' s'
                  + ' de ' + m.dur.toFixed(2) + ' declarados');
    } catch (e) {
      /* Se BORRA lo escrito. El fichero se escribe antes de medirlo —hay que
         abrirlo en el navegador para saber dónde acaba su gesto— y si la
         medida revienta se quedaba en `templates/` una plantilla que nunca
         llegó a comprobarse: `caption-blend-difference` no registraba `TPL` y
         `vfx-shatter` llama a `drawElementImage`, una API que solo existe
         dentro del renderizador de HyperFrames. Dejarlas ahí es meter en el
         catálogo dos plantillas rotas con el informe diciendo que fallaron. */
      try { fs.unlinkSync(path.join(TPL, PREFIJO + nombre + '.html')); }
      catch (_) { /* fallo-tolerado: si no llegó a escribirse, no hay nada */ }
      console.error('  ✗ %s: %s', nombre, e.message);
    }
  }
  if (!hechos.length) return 1;

  norma();
  console.log('\n%d plantilla(s) importada(s). Lo que queda a mano:', hechos.length);
  console.log('  1. La lista de BRAND_RULES §19 ya está puesta; el PÁRRAFO de');
  console.log('     cada familia —para qué sirve y cuándo NO usarla— no.');
  console.log('  2. Entran MUDAS: el sonido se publica devolviendo');
  console.log('     `{cues:[{at,sfx,gain}]}` desde `setup`.');
  console.log('  3. Sin `anclas`, `colocar.py` no puede medir su caja.');
  console.log('  4. Van escaladas al ancho: la maqueta vertical es trabajo');
  console.log('     por bloque. `config.encaje:false` lo desactiva.');
  console.log('\n  Compruébalo:  make lint  &&  node scripts/humo_plantillas.js');
  return 0;
}

if (require.main === module) {
  Promise.resolve(main()).then(c => process.exit(c || 0));
}
module.exports = { transforma, puenteDe, TOKENS };
