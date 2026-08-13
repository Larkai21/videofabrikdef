/* =====================================================================
   Motor de animación DETERMINISTA
   ---------------------------------------------------------------------
   Playwright no captura animaciones CSS en tiempo real de forma fiable:
   el reloj del navegador y el ritmo de capturas se desincronizan y salen
   frames repetidos o saltados. Aquí el tiempo es un PARÁMETRO, no un
   reloj: la plantilla se posiciona con seek(t) y luego se fotografía.
   Mismo t -> mismo pixel, siempre.

   Cada plantilla registra:
       Engine.register({ duration, setup(cfg), draw(t) })

   Y Playwright llama:
       window.TPL.setup(config)
       window.TPL.seek(tSegundos)
   ===================================================================== */

(function (global) {
  'use strict';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* --- curvas de interpolación --- */
  const Ease = {
    linear: t => t,
    /* Arranca quieto y acelera. FALTABA, y dos plantillas ya la llamaban:
       `cut-strip.html:74` y `red-crash.html:52`. Como `span()` hace
       `(easing || Ease.linear)(p)`, `undefined` caía a LINEAL sin un solo
       aviso — y el comentario de red-crash dice «acelera al caer» mientras no
       aceleraba nada. Es el fallo silencioso de manual: el código decía una
       cosa, el vídeo hacía otra, y nada en medio se quejaba.

       De ahí la comprobación de `Engine.curvasUsadas` más abajo: una curva
       inexistente tiene que dar error, no caer de pie. */
    inCubic: t => t * t * t,
    outCubic: t => 1 - Math.pow(1 - t, 3),
    inOutCubic: t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    outExpo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
    /* rebote suave: entra pasándose y se asienta */
    outBack: (t, s = 1.70158) => {
      const p = t - 1;
      return p * p * ((s + 1) * p + s) + 1;
    },
    /* `outBack` con el sobrepaso CALIBRADO al 6 % que permite §10.
       El `s` por defecto (1.70158) se pasa un 10,0 %, o sea que la curva más
       usada del catálogo para «entrar con carácter» lleva desde siempre fuera
       de norma. Y `glass-dock` la reimplementaba a mano con `s * 1.12`, que da
       un 12,1 %: el doble de lo permitido.
       El valor sale de resolver max(f(t)) = 1,06 numéricamente, no de probar
       a ojo, y la prueba `test_motor.py` lo vuelve a resolver en cada pasada
       para que no se quede viejo si alguien toca la fórmula. */
    outBack6: t => Ease.outBack(t, 1.2827),

    /* Golpe elástico. §1 prohíbe los rebotes elásticos, así que esta curva
       solo sirve para salirse de la marca. Se conserva DEPRECADA y con el
       aviso escrito en vez de borrarse, porque borrarla rompería cualquier
       plantilla de terceros que la usara; `test_motor.py` falla si alguna
       plantilla del repo la invoca. */
    outElastic: t => {
      if (t === 0 || t === 1) return t;
      const p = 0.38;
      return Math.pow(2, -10 * t) * Math.sin((t - p / 4) * (2 * Math.PI) / p) + 1;
    }
  };

  /* Progreso 0..1 de un tramo [inicio, inicio+dur] en el instante t */
  function span(t, inicio, dur, easing) {
    if (dur <= 0) return t >= inicio ? 1 : 0;
    const p = clamp((t - inicio) / dur, 0, 1);
    return (easing || Ease.linear)(p);
  }

  /* Entrada + salida en una sola llamada: devuelve 0..1..0 */
  function pulse(t, inicio, fin, subida, bajada, easing) {
    const e = easing || Ease.outCubic;
    if (t < inicio || t > fin) return 0;
    const dIn = span(t, inicio, subida, e);
    const dOut = 1 - span(t, fin - bajada, bajada, e);
    return Math.min(dIn, dOut);
  }

  /* ======================================================================
     GESTOS · vocabulario cerrado de entradas
     ----------------------------------------------------------------------
     `<meta name="gesto">` existía desde el sprint de movimiento y lo leía
     UNA sola cosa: `auditar_estilo.js`, para contarlos. O sea que era
     documentación que no afectaba a nada — la octava máquina construida y
     nunca enchufada. Y encima eran veintitrés nombres libres distintos para
     veintitrés plantillas, así que tampoco era un vocabulario: era una
     etiqueta.

     Ahora el gesto DECIDE la curva de entrada. Se declara
     `content="familia:nombre"`: la familia es de esta tabla y manda; el
     nombre es libre y es lo que la plantilla hace de verdad —`punzon`,
     `esclusa`, `plumilla`—, que es información que no conviene perder.

     Seis familias, y la curva de cada una sale de lo que el gesto ES, no de
     repartir para que salgan distintas:

       asentar  outCubic    llega y se posa: decelera hasta pararse.
       revelar  inOutCubic  una máscara se abre. Nada se mueve en el mundo:
                            lo que arranca y frena es el obturador.
       trazar   outExpo     el trazo sale del ataque y se agota. Es tinta
                            saliendo de una plumilla, no un objeto llegando.
       golpear  inCubic     acelera hasta el contacto. Lo contrario de
                            asentar, y por eso la curva es la inversa.
       crecer   outBack6    una masa que se pasa y vuelve, con el 6 % de
                            sobrepaso que es el máximo de §10.
       correr   linear      velocidad constante. Una correa no decelera al
                            llegar al centro del cuadro.

     `Engine.entra` sin curva explícita usa la de la familia declarada. Una
     plantilla sin `<meta>` se queda en `outCubic`, que es lo que había. */
  const GESTOS = {
    asentar: 'outCubic',
    revelar: 'inOutCubic',
    trazar:  'outExpo',
    golpear: 'inCubic',
    crecer:  'outBack6',
    correr:  'linear',
  };

  let _familia = null;
  function familiaGesto() {
    if (_familia !== null) return _familia;
    const m = document.querySelector('meta[name="gesto"]');
    const c = (m && m.getAttribute('content')) || '';
    _familia = GESTOS[c.split(':')[0]] ? c.split(':')[0] : '';
    return _familia;
  }

  /* Entrada, permanencia y salida en UNA llamada. Devuelve
     `{ e, s, v }` — entrada 0..1, salida 0..1, y `v = e·(1−s)`, que es la
     visibilidad combinada que casi todo `draw` necesita.

     Esto es lo que `pulse()` tenía que haber sido y no fue: `pulse` devuelve
     UN número cuando el `draw` necesita tres —la entrada para desplazar, la
     salida para otra cosa, y el producto para la opacidad—, y por eso tiene
     CERO usos en las 56 mientras el párrafo de tres líneas está copiado a
     mano en todas. Es el código más duplicado del repo, y la consecuencia es
     que cambiar la curva de entrada del catálogo son 56 ediciones: por eso
     nunca se ha hecho.

     --- por qué la salida NO es `outCubic` ---

     Todo el catálogo escribe `1 − span(t, fin − salida, salida, outCubic)`,
     que da `(1−p)³`: cae en picado y luego se arrastra. Medido sobre la
     ventana de salida, con umbral de legibilidad en 0,35 de opacidad:

         outCubic   se lee durante el 29,6 % de la ventana
         inCubic    se lee durante el 86,7 %

     O sea que una `salida: 0.5` declarada da 0,15 s de gráfico legible y
     0,35 s de fantasma. `inCubic` —`1 − p³`— AGUANTA y luego se va, que es lo
     que hace un rótulo de televisión: se lee hasta el final y desaparece. No
     es una preferencia de curva, es tres veces más tiempo útil por el mismo
     número en la configuración.

     La entrada sí sigue en `outCubic`: entrar es llegar y frenar. */
  function ciclo(t, dur, entrada, salida, opts) {
    const o = opts || {};
    const e = span(t, 0, entrada || 0, o.entra || Ease.outCubic);
    const s = salida > 0 ? span(t, dur - salida, salida, o.sale || Ease.inCubic) : 0;
    return { e, s, v: e * (1 - s) };
  }

  /* Poner el PESO de un elemento. Escribe las DOS propiedades, y no es
     redundancia: es la única forma portable de que el gesto se vea.

     --- por qué ---

     `font-variation-settings` solo hace algo si la cara que el emparejado de
     CSS ha elegido es el fichero VARIABLE. Esta máquina tiene instalada la
     familia estática completa junto a la variable —`Geist-Medium.otf`,
     `Geist-Bold.otf`…— así que declarar `font-weight: 500` elige la estática
     Medium, y una estática no tiene ejes: la animación del eje no mueve un
     píxel. Medido con hashes de ráster, no con `document.fonts.check`, que ya
     se sabe que miente:

         Geist Mono, font-weight 500, eje 200/500/900 -> 1 ráster de 3
         Geist,      font-weight 400, eje 200/900     -> 1 ráster de 2

     Y no se puede arreglar desde CSS: el fichero variable y el estático
     COMPARTEN nombre PostScript —los dos son `Geist-Regular`—, así que un
     `@font-face` con `local("Geist-Regular")` es ambiguo y elige uno u otro
     según el orden del sistema. Comprobado: resucita `Geist Mono` y mata
     `Geist`, con la misma regla. Eso no es una solución, es una moneda.

     Escribiendo las dos, el peso SIEMPRE se ve: donde manda el fichero
     variable, `font-variation-settings` gana y da una interpolación continua;
     donde manda una estática, `font-weight` elige la cara más cercana y el
     gesto sale a escalones. Peor que continuo, infinitamente mejor que nada.
     Medido: 3 rásteres de 3 en las dos familias.

     Es además el fallo silencioso perfecto: ocho plantillas del catálogo
     estaban animando una propiedad que no hacía nada, y ni el humo, ni el
     lint, ni el auditor de estilo pueden verlo — solo comparar píxeles. */
  function peso(el, n) {
    if (!el) return;
    const v = Math.round(n);
    el.style.fontVariationSettings = '"wght" ' + v;
    el.style.fontWeight = String(v);
  }

  /* EL SEGUNDO TIEMPO. Progreso 0..1 a lo largo de la PERMANENCIA: desde que
     la entrada termina hasta que la salida empieza.

     Existe porque el fallo más repetido del catálogo tiene esta forma exacta:
     el gesto se agota en el primer tercio —`entrada` suele ser 0,25 s de una
     capa de 1— y la salida no arranca hasta el último cuarto. En medio no se
     anima nada. Medido con `comprobar_movimiento.js`, veinte fichas tenían
     entre el 2 % y el 50 % de sus fotogramas consecutivos idénticos.

     No es lo mismo que incumplir §10: la imagen puede seguir cambiando a medio
     segundo por la flotación de reposo y aun así el GESTO estar parado en
     seco, que es lo que se ve como «el efecto se queda a medias».

     Lo que se anima con esto no puede ser el mismo gesto otra vez: es lo que
     PASA DESPUÉS de llegar. La tinta que sigue mojando, el metal que coge la
     luz, el peso que se asienta, una lectura que cuenta. Si a un gráfico no se
     le ocurre nada que hacer durante su permanencia, casi siempre es que dura
     más de lo que tiene que durar. */
  function reposo(t, entrada, fin, salida, easing) {
    const ini = entrada || 0;
    const largo = Math.max(0.05, (fin || 0) - (salida || 0) - ini);
    return span(t, ini, largo, easing || Ease.inOutCubic);
  }

  /* Los dos accesos sueltos, que es lo que el catálogo ya escribía a mano.
     `sale` devuelve el MULTIPLICADOR (1 mientras está, 0 al final), que es
     como se usaba: `const cierre = Engine.sale(t, fin, cfg.salida)`. */
  function entra(t, dur, easing) {
    if (!easing) {
      const f = familiaGesto();
      easing = f ? Ease[GESTOS[f]] : Ease.outCubic;
    }
    return span(t, 0, dur || 0, easing);
  }
  function sale(t, fin, dur, easing) {
    return dur > 0 ? 1 - span(t, fin - dur, dur, easing || Ease.inCubic) : 1;
  }

  /* Ruido determinista: mismo índice -> mismo valor. Nada de Math.random,
     que rompería la reproducibilidad entre frames. */
  function noise(i, semilla) {
    const x = Math.sin((i + 1) * 127.1 + (semilla || 0) * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /* Flotación de reposo. §10 la exige desde la primera versión de la norma
     —«cada elemento deriva con su propio periodo; sin ella una fila parece una
     captura fija»— y no la implementaba NINGUNA de las 56.

     No es una opinión: el humo captura tres instantes de cada plantilla y
     compara sus hashes, y en 20 de 56 dos de los tres son idénticos. O sea que
     esas veinte se quedan literalmente congeladas —el mismo fotograma, byte a
     byte— durante la mitad de su tiempo en pantalla. Un gráfico de televisión
     nunca se para del todo; uno que se para se lee como una imagen pegada
     encima del vídeo, y eso es exactamente lo que hace que un montaje parezca
     una plantilla y no una pieza.

     Devuelve un desplazamiento en píxeles, función PURA de `t` e `i`: mismo
     instante, mismo píxel. Los periodos salen de `noise` y son distintos por
     elemento a propósito —si todos derivan a la vez el conjunto respira como
     un bloque, que es tan artificial como no moverse—.

     La amplitud por defecto son 3 px sobre 1080: por debajo de lo que se nota
     como movimiento en un fotograma suelto y por encima de lo que hace falta
     para que la imagen deje de estar muerta. Subirla convierte la deriva en
     un efecto, y §10 no pide un efecto. */
  function flota(t, i, opts) {
    const o = opts || {};
    const amp = o.amp === undefined ? 3 : o.amp;
    const base = o.periodo === undefined ? 7.4 : o.periodo;
    const s = o.semilla === undefined ? 3 : o.semilla;
    const TAU = Math.PI * 2;
    /* Periodos deliberadamente inconmensurables entre sí: con periodos que
       comparten divisor, dos elementos vuelven a coincidir dentro de la pieza
       y el conjunto late. */
    const px = base * (0.79 + 0.44 * noise(i * 4 + 1, s));
    const py = base * (0.71 + 0.52 * noise(i * 4 + 2, s));
    const fx = noise(i * 4 + 3, s) * TAU;
    const fy = noise(i * 4 + 4, s) * TAU;
    return {
      x: amp * 0.55 * Math.sin(TAU * t / px + fx),
      y: amp * Math.sin(TAU * t / py + fy),
      /* Rotación en grados. Casi siempre sobra —una tarjeta que cabecea se
         nota— pero una insignia o un sello suelto la agradecen. */
      r: (o.giro || 0) * Math.sin(TAU * t / (base * 1.31) + fx)
    };
  }

  /* Máquina de escribir: cuántos caracteres se ven en el instante t */
  function typed(texto, t, inicio, cps) {
    if (t < inicio) return '';
    const n = Math.floor((t - inicio) * (cps || 28));
    return texto.slice(0, clamp(n, 0, texto.length));
  }

  /* Teja de grano, rasterizada UNA vez por página y cacheada.
     ---------------------------------------------------------------------
     Estaba encerrada dentro de `fondo.html`, y con ella la lección más cara
     del catálogo: antes el grano era un `feTurbulence` de tres octavas sobre
     un elemento con `inset:-50%`, o sea 8,3 megapíxeles de ruido procedural
     recalculados EN CADA FOTOGRAMA con semilla fija — recomputar miles de
     veces algo que no cambia. Costaba 2-3 s por fotograma y hacía inviable
     una pieza larga.

     Que esa lección viviera en una sola plantilla es la razón de que 53 de
     56 no tengan textura: usarla obligaba a copiar treinta líneas y a saber
     por qué. Aquí cuesta una llamada.

     `Engine.noise` con índices consecutivos es seguro aquí aunque parta de
     un seno: multiplicar por 43758.5453 antes de tomar la parte fraccionaria
     decorrelaciona del todo. Medido — autocorrelación a desfases 1-5 de
     0,012 · 0,008 · 0,001 · −0,003 · 0,003: indistinguible de ruido blanco.

     El gris va centrado en blanco (200-255) porque la teja se aplica con
     `mix-blend-mode: multiply`: así solo puede OSCURECER, nunca aclarar, que
     es lo que hace un grano de impresión y no un ruido de vídeo. */
  const _tejas = new Map();
  function tejaGrano(px, semilla) {
    const clave = px + ':' + semilla;
    if (_tejas.has(clave)) return _tejas.get(clave);
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const g = c.getContext('2d');
    const img = g.createImageData(px, px);
    for (let i = 0; i < px * px; i++) {
      const v = 200 + Math.round(noise(i, semilla) * 55);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const url = c.toDataURL('image/png');
    _tejas.set(clave, url);
    return url;
  }

  /* Aplica el grano a un elemento. Dos líneas por plantilla en vez de treinta.

     Pinta el grano en una CAPA HIJA y no sobre el propio elemento. La versión
     anterior escribía `backgroundImage` y `mixBlendMode` directamente en él, y
     decía en su comentario que así «no peleaba con lo que el elemento ya
     tuviera de fondo» — que es exactamente al revés: un estilo en línea gana a
     cualquier clase, así que engranar una superficie que ya tenía un degradado
     BORRABA el degradado.

     Se vio al ponerle grano a la placa de bronce de `cinta`: la placa salía
     gris plata, o sea aluminio cepillado, porque el `linear-gradient` del metal
     había desaparecido y en su sitio estaba la teja de ruido. Ningún log dice
     nada; el fotograma sí.

     Y de paso resuelve el otro problema: la capa hija tiene su propia opacidad,
     así que el grano puede aparecer y desaparecer con el reloj sin arrastrar la
     opacidad del objeto que lo lleva.

     Devuelve la capa, para animarla. Reutiliza la que haya: llamar dos veces al
     mismo elemento no apila dos granos. */
  function grano(el, opts) {
    const o = opts || {};
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    let capa = el.querySelector(':scope > [data-grano]');
    if (!capa) {
      capa = document.createElement('i');
      capa.setAttribute('data-grano', '');
      capa.style.position = 'absolute';
      capa.style.inset = '0';
      capa.style.pointerEvents = 'none';
      el.appendChild(capa);
    }
    capa.style.backgroundImage =
      'url(' + tejaGrano(o.px || 256, o.semilla || 7) + ')';
    capa.style.backgroundRepeat = 'repeat';
    capa.style.mixBlendMode = 'multiply';
    capa.style.opacity = o.op !== undefined ? o.op : 0.42;
    return capa;
  }

  /* Los cinco stops del metal del TEMA ACTIVO, inyectados como <defs> de un
     SVG. Un `<linearGradient>` no puede ser una variable CSS, así que sin esto
     el metal era inalcanzable para todo lo que se dibuja con `stroke` — o sea
     para conectores, anillos, checks y subrayados, que son la mayor parte del
     bronce del catálogo. Devuelve el id para usar en `stroke="url(#id)"`.

     ---------------------------------------------------------------------
     `caja` NO es un adorno: es lo que hace que el helper funcione.

     Por defecto un `<linearGradient>` usa `objectBoundingBox`, y el SVG dice
     que un elemento cuya caja tiene ancho O alto CERO **no se dibuja**. O sea
     que pintar con este degradado una línea vertical o una horizontal —que es
     el 90 % de los conectores, los filetes y los subrayados, justo aquello
     para lo que se escribió— hace que el trazo DESAPAREZCA. Sin error, sin
     aviso, sin nada en consola: el `<path>` está en el DOM, con su `d` y su
     `stroke-width` correctos, y no pinta un píxel.

     Se descubrió al darle el primer uso real —hasta hoy estaba promovido al
     motor y no lo llamaba ninguna de las 56, o sea que nunca se había
     ejecutado—: el raíl de `pasos-flow` es una recta vertical y la traza de
     bronce sencillamente no estaba. Lo delató mirar el fotograma.

     Con `caja = [x1, y1, x2, y2]` en unidades de usuario se pasa a
     `userSpaceOnUse`, que no depende de la caja del elemento. Y de paso es lo
     correcto físicamente: todo lo que se dibuje en ese SVG comparte UNA
     lámina de bronce con una sola luz, en vez de que cada trazo lleve su
     propio reflejo independiente —que es lo que delata que son piezas
     pegadas—.

     Se puede volver a llamar con otra caja: actualiza la que haya en vez de
     salirse. Hace falta cuando la geometría se mueve con el reloj. */
  function gradienteMetal(svg, id, caja) {
    id = id || 'metal';
    const NS = 'http://www.w3.org/2000/svg';
    let lg = svg.querySelector('#' + id);
    if (!lg) {
      const defs = svg.querySelector('defs') || svg.insertBefore(
        document.createElementNS(NS, 'defs'), svg.firstChild);
      lg = document.createElementNS(NS, 'linearGradient');
      lg.setAttribute('id', id);
      [1, 3, 4, 5].forEach((n, i) => {
        const st = document.createElementNS(NS, 'stop');
        st.setAttribute('offset', (i / 3 * 100) + '%');
        lg.appendChild(st);
      });
      defs.appendChild(lg);
    }
    /* Los stops se releen en CADA llamada, no solo al crear el degradado. Lo
       que se cachea es el ELEMENTO, no su color, y confundir las dos cosas
       tenía una consecuencia concreta: el motor hace un `setup({})` de
       cortesía al cargar la página —para que la plantilla se vea al abrirla a
       mano—, ahí nace el degradado con los tokens de fábrica, y el `setup`
       real que llega después con `acento` de plan encontraba el elemento ya
       hecho y se lo saltaba. Resultado: el titular en el color pedido y su
       calibre metálico en azul de marca, en la misma pieza. */
    const est = getComputedStyle(document.documentElement);
    [1, 3, 4, 5].forEach((n, i) => lg.children[i].setAttribute(
      'stop-color', est.getPropertyValue('--metal-' + n).trim()));
    if (caja) {
      lg.setAttribute('gradientUnits', 'userSpaceOnUse');
      lg.removeAttribute('gradientTransform');
      ['x1', 'y1', 'x2', 'y2'].forEach((k, i) => lg.setAttribute(k, caja[i]));
    } else if (!lg.hasAttribute('gradientUnits')) {
      /* Sin caja se conserva el comportamiento de siempre, que sirve para
         formas con área —un `<rect>`, un `<circle>`, un `<path>` cerrado—. Es
         seguro ahí y solo ahí. */
      lg.setAttribute('gradientTransform', 'rotate(25)');
    }
    return id;
  }

  /* ---------- acento de PLAN ----------

     `--accent` es el color de ESTA marca. Sobre una pieza que no es de esta
     marca ese color es el error y no el acierto, y hasta ahora la única salida
     era `config.acento` en `kinetic-captions` —o sea: subtítulos rosas y las
     otras 180 plantillas en azul—. Se resuelve aquí, en el mismo sitio donde
     se aplica el tema, y así lo hereda el catálogo entero sin tocar ninguna
     plantilla.

     Lo que se mueve no es solo `--accent`: los cinco stops de `--metal-1..5`
     son el MATERIAL del acento (BRAND_RULES §2), su rampa. Cambiar el acento y
     dejar la rampa deja dos colores peleándose —el titular rosa y su filete
     azul—, que es exactamente el fallo que `--acento` vino a evitar. Así que
     la rampa se RECONSTRUYE: se conservan el tono y la saturación del color
     dado y se le aplican los mismos saltos de luminancia que la rampa de marca
     tiene hoy respecto a su acento. Medidos de `_tokens.css`, en HSL:

       accent  L 0,637     metal-1 0,353   metal-2 0,490
                           metal-3 0,751   metal-4 0,637   metal-5 0,292

     Dos tokens NO se mueven a propósito. `--senal-ok` y `--senal-no` porque no
     son de marca (§2): un visto verde significa lo mismo en cualquier paleta.
     Y `--accent-2`, porque su trabajo es DIFERENCIAR de `--accent`, y la
     relación que sostiene —acento cálido, acento-2 frío— sigue en pie con
     cualquier acento cálido de plan. */
  const RAMPA_L = [-0.284, -0.147, 0.114, 0.0, -0.345];
  const TOKENS_ACENTO = ['--accent', '--accent-soft', '--accent-line',
    '--metal-1', '--metal-2', '--metal-3', '--metal-4', '--metal-5'];

  /* Se delega el parseo en el propio CSS en vez de escribir un lector de
     `#rgb`/`rgba()`/`hsl()`/nombres: asignar a `style.color` normaliza a
     `rgb(...)`, y un color que el navegador rechaza deja la propiedad vacía,
     que es justo la señal de «esto no es un color» sin validar nada a mano. */
  function rgbDe(color) {
    const s = document.createElement('span');
    s.style.color = color;
    const m = s.style.color.match(/[\d.]+/g);
    return m && m.length >= 3 ? m.slice(0, 3).map(Number) : null;
  }

  function aHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const l = (mx + mn) / 2;
    if (!d) return [0, 0, l];
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0)
      : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function aplicaAcento(color) {
    const raiz = document.documentElement;
    TOKENS_ACENTO.forEach(k => raiz.style.removeProperty(k));
    if (!color) return;
    const rgb = rgbDe(color);
    if (!rgb) {
      console.warn('[acento] no es un color CSS válido, se ignora: ' + color);
      return;
    }
    const [r, g, b] = rgb;
    const [h, s, l] = aHsl(r, g, b);
    const base = r + ', ' + g + ', ' + b;
    raiz.style.setProperty('--accent', 'rgb(' + base + ')');
    raiz.style.setProperty('--accent-soft', 'rgba(' + base + ', 0.13)');
    raiz.style.setProperty('--accent-line', 'rgba(' + base + ', 0.44)');
    RAMPA_L.forEach((d, i) => raiz.style.setProperty('--metal-' + (i + 1),
      'hsl(' + h.toFixed(1) + ' ' + (s * 100).toFixed(1) + '% ' +
      (clamp(l + d, 0.04, 0.96) * 100).toFixed(1) + '%)'));
  }

  const Engine = {
    Ease, span, pulse, noise, typed, clamp, flota, ciclo, entra, sale, reposo,
    peso,
    GESTOS, familiaGesto,
    tejaGrano, grano, gradienteMetal, aplicaAcento,

    register(def) {
      const api = {
        duration: def.duration || 5,
        _cfg: {},
        setup(cfg) {
          api._cfg = Object.assign({}, def.defaults || {}, cfg || {});

          /* El tema se aplica AQUÍ, una sola vez, y todas las plantillas
             quedan tematizadas sin escribir una línea en ninguna: basta
             con que usen los tokens semánticos de _tokens.css.

             Tiene que ser un string, no un objeto: la fusión de arriba es
             Object.assign de un nivel, así que un objeto anidado se
             reemplazaría entero en vez de mezclarse con el default. */
          document.documentElement.dataset.tema = api._cfg.tema || 'carbon';

          /* Y el acento del PLAN, si lo hay, ENCIMA del tema: sustituye
             `--accent` y su rampa metálica. Va aquí y no más abajo porque
             `gradienteMetal` lee los tokens YA computados al crear el
             degradado, así que llegar después dejaría los SVG en azul con el
             resto de la plantilla en el color pedido. */
          aplicaAcento(api._cfg.acento);

          /* Pasada de render. 'detalle' es lo normal; 'mascara' emite solo
             la silueta de los elementos .cristal, para que ffmpeg sepa qué
             región del metraje difuminar. Ver _tokens.css § LIQUID GLASS. */
          document.body.dataset.modo = api._cfg.modo || 'detalle';

          /* Zoom de raíz. Cuando la capa se encoge para vivir en una
             columna, las plantillas con tamaños fijos en CSS se vuelven
             ilegibles: no basta con configurar `tam`, porque muchas no lo
             exponen. `zoom` escala la MAQUETACIÓN entera —tipografía,
             cajas y espaciado— con una sola línea y sin tocar ninguna
             plantilla. Se aplica al documento, no a `.stage`, para que
             valga también en las que posicionan a sangre. */
          /* La banda la decide quien conoce el rostro —el plan—, no la
             plantilla. Se publica como atributo para que el CSS de
             `.tarjeta` la aplique sin que cada componente lo programe.

             Antes de eso hay que separar POSICIÓN de ANIMACIÓN. `.tarjeta`
             se centra con `left:50%` + `translateX(-50%)`, y las plantillas
             animan su entrada escribiendo `style.transform` en ese mismo
             nodo: la primera línea de `draw` borraba el translate y la
             tarjeta aparecía clavada por su borde izquierdo, medio fuera de
             cuadro. Se envuelve una sola vez — el envoltorio se queda con
             el centrado y el nodo original con el vidrio y la animación. */
          document.querySelectorAll('.tarjeta').forEach(el => {
            let pos = el;
            if (!el.classList.contains('tarjeta-pos')) {
              pos = document.createElement('div');
              pos.className = 'tarjeta tarjeta-pos';
              if (el.dataset.ancho) pos.dataset.ancho = el.dataset.ancho;
              el.parentNode.insertBefore(pos, el);
              pos.appendChild(el);
              el.classList.remove('tarjeta');
              el.classList.add('tarjeta-cont');
            }
            pos.dataset.zona = api._cfg.zona || 'centro';
            /* El ancho propio va en el envoltorio: es quien tiene el
               `max-width`. Si se quedara en el hijo no haría nada. */
            if (api._cfg.ancho) {
              pos.dataset.ancho = '1';
              pos.style.setProperty('--ancho-max', api._cfg.ancho + 'px');
            }
          });

          if (api._cfg.zoom && api._cfg.zoom !== 1) {
            document.documentElement.style.zoom = api._cfg.zoom;
          }

          const extra = def.setup ? def.setup(api._cfg) : null;
          if (api._cfg.duration) api.duration = api._cfg.duration;
          api.seek(0);
          /* Una plantilla puede publicar sus propias señales de sonido
             devolviendo `cues: [{at, sfx, gain}]` en tiempo RELATIVO a la
             capa. Es preferible a deducirlas fuera: quien sabe cuándo pasa
             algo es quien lo anima, y si cambia la animación las señales
             cambian con ella en vez de quedarse desfasadas. */
          return { duration: api.duration,
                   cues: (extra && extra.cues) || [] };
        },
        /* Cajas de interés en coordenadas del lienzo, {clave:{x,y,w,h}}
           con x,y en el CENTRO. Sirven para que otra capa —una anotación—
           se coloque encima sin repetir coordenadas a mano.

           Es una llamada APARTE de `setup` y no su valor de retorno: en
           `setup` los elementos aún están en reposo, sin los transforms
           que aplica `draw`. Medir ahí daba cajas falsas en cuanto el
           elemento se movía o crecía. Se llama tras `seek(t)`, así que la
           caja es la real en ese instante. */
        anclas() {
          return def.anclas ? def.anclas(api._cfg) : null;
        },
        seek(t) {
          def.draw(Number(t) || 0, api._cfg);
          /* marca de sincronía: Playwright espera a que exista */
          document.documentElement.dataset.frameReady = String(t);
        }
      };
      global.TPL = api;
      /* si nadie llama a setup(), que al menos se vea algo al abrirlo */
      document.addEventListener('DOMContentLoaded', () => {
        if (!document.documentElement.dataset.frameReady) api.setup({});
      });
    }
  };

  global.Engine = Engine;
})(window);
