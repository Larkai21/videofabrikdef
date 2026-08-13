#!/usr/bin/env node
/* Mide la MONOTONÍA del catálogo. Sin navegador, en menos de un segundo.
 * ---------------------------------------------------------------------------
 * El arnés que ya había mide dos cosas: «¿se mueve?» (`humo_plantillas.js`) y
 * «¿está vacío?» (`comprobar_alfa.py`). Ninguna de las dos puede ver el
 * problema que llevó a este sprint, porque **la monotonía no es un fallo de
 * una plantilla: es una propiedad del CATÁLOGO**. Cincuenta y seis plantillas
 * pueden pasar todas las pruebas una por una y aun así parecer la misma.
 *
 * Los números que abrieron el sprint, todos medidos aquí:
 *
 *     Ease.outCubic en 52 de 56       una sola gramática de entrada
 *     45 de 56 solo opacity+transform  la receta universal
 *     43 de 56 sin color fuera de accent/ink/surface
 *     .brushed usado 2 veces frente a 106 planos de bronce
 *     83 hex literales, dos de ellos neón que §1 prohíbe
 *
 * Ninguno de esos es un error en ninguna plantilla concreta. Todos juntos son
 * la razón de que el conjunto se lea como generado.
 *
 * Se lee el HTML con expresiones regulares y no con un parser, con el mismo
 * precedente que tuvo `validar_plan.leer_orden()` mientras leía ORDEN del
 * fuente (hoy ORDEN es un fichero de datos), y el mismo límite: para contar
 * qué nombres aparecen no hace falta entender el lenguaje.
 *
 * Uso:
 *     node scripts/auditar_estilo.js              # tabla y veredicto
 *     node scripts/auditar_estilo.js --json       # para el golden
 *     node scripts/auditar_estilo.js --detalle    # quién incumple cada métrica
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RAIZ = path.dirname(__dirname);
const TPL = path.join(RAIZ, 'templates');

const BLOQUE = /\/\*[\s\S]*?\*\//g;
const LINEA = /\/\/[^\n]*/g;

/* Los comentarios mienten: `_tokens.css` y varias plantillas mencionan claves
   y colores en prosa. Es la misma lección de `validar_plan.py:47-50`. */
function sinComentarios(src) {
  return src.replace(BLOQUE, m => '\n'.repeat((m.match(/\n/g) || []).length))
            .replace(LINEA, '');
}

const CANONICO = /^[a-z0-9-]+\.html$/;

/* El catálogo tiene dos mitades y medirlas juntas no mide nada.
 *
 * Las NUESTRAS siguen un sistema —escala tipográfica, tokens de color,
 * gramática de curvas— y el golden las vigila con un trinquete: la media no
 * puede empeorar. Las IMPORTADAS son de otra casa: escriben `font-size` a
 * pelo y usan su paleta, y eso no es una regresión, es su naturaleza.
 *
 * Con las 183 en el mismo promedio pasaban las dos cosas malas a la vez: las
 * 126 ajenas hundían la media —643 px sueltos contra los 2 de siempre— y a
 * partir de ahí una plantilla NUESTRA podía llenarse de números a pelo sin
 * que nada saltara, porque cabía de sobra bajo el listón diluido. El
 * trinquete dejaba de proteger justo lo que existía para proteger.
 *
 * `--solo propias` / `--solo importadas` parte la medición; sin el flag se
 * miden todas, que es lo que hace falta para el informe de pantalla. */
const IMPORTADA = /^hf-/;

function plantillas(solo) {
  return fs.readdirSync(TPL)
    .filter(f => f.endsWith('.html') && !f.startsWith('_') && CANONICO.test(f))
    .filter(f => solo === 'propias' ? !IMPORTADA.test(f)
               : solo === 'importadas' ? IMPORTADA.test(f) : true)
    .sort();
}

function curvasDelMotor() {
  const src = sinComentarios(fs.readFileSync(path.join(TPL, '_engine.js'), 'utf8'));
  const m = src.match(/const Ease = \{([\s\S]*?)\n  \};/);
  return new Set([...(m ? m[1] : '').matchAll(/^\s{4}(\w+)\s*:/gm)].map(x => x[1]));
}

function analiza(f) {
  const bruto = fs.readFileSync(path.join(TPL, f), 'utf8');
  const src = sinComentarios(bruto);
  const uno = re => new Set([...src.matchAll(re)].map(m => m[1]));

  /* Las curvas que la plantilla usa DE VERDAD, no las que nombra.
     `Engine.entra`, `Engine.sale` y `Engine.ciclo` llevan su curva dentro,
     así que al mover el gesto de entrada y salida al motor —que es lo que
     quita 51 copias del mismo párrafo— una plantilla que sigue usando
     `outCubic` para entrar y `inCubic` para salir dejaba de declararlas y el
     recuento bajaba solo. Eso no es menos variedad, es menos texto: contarlo
     como variedad perdida sería medir el fichero en vez del movimiento, y con
     el trinquete puesto habría bloqueado la centralización. */
  /* `familia:nombre`. La familia es del vocabulario cerrado de `_engine.js` y
     DECIDE la curva de entrada; el nombre es libre y dice lo que la plantilla
     hace. Se acepta el formato viejo sin familia para no romper nada, pero
     entonces la entrada cae a `outCubic`, que es lo que había. */
  const gm = bruto.match(/<meta name="gesto" content="([\w-]+)(?::([\w-]+))?"/);
  const familia = gm && gm[2] ? gm[1] : null;
  const gesto = gm ? (gm[2] || gm[1]) : null;

  const curvas = uno(/\bEase\.(\w+)/g);
  /* La curva de entrada ya no es siempre `outCubic`: `Engine.entra` sin curva
     explícita usa la de la FAMILIA del gesto declarado. Resolverla aquí es lo
     que hace que la métrica mida el movimiento y no el texto — el mismo error
     que ya cazaron el contador de textura, el de curvas y el de pesos. */
  const CURVA_GESTO = { asentar: 'outCubic', revelar: 'inOutCubic',
                        trazar: 'outExpo', golpear: 'inCubic',
                        crecer: 'outBack6', correr: 'linear' };
  const curvaEntrada = CURVA_GESTO[familia] || 'outCubic';
  if (/\bEngine\.(entra|ciclo)\b/.test(src)) curvas.add(curvaEntrada);
  if (/\bEngine\.(sale|ciclo)\b/.test(src)) curvas.add('inCubic');

  /* Los USOS, con multiplicidad. `curvas` es un conjunto y sirve para «cuántas
     curvas distintas maneja esta plantilla»; para «cuánto del movimiento del
     catálogo es una sola curva» hace falta contar cada aparición. Ver el
     comentario de `agrega`. */
  const usos = [...src.matchAll(/\bEase\.(\w+)/g)].map(m => m[1]);
  usos.push(...[...src.matchAll(/\bEngine\.(?:entra|ciclo)\s*\(/g)].map(() => curvaEntrada));
  usos.push(...[...src.matchAll(/\bEngine\.(?:sale|ciclo)\s*\(/g)].map(() => 'inCubic'));
  const props = uno(/\bstyle\.(\w+)\s*=/g);
  /* `Engine.peso(el, n)` escribe `fontVariationSettings` y `fontWeight`: son
     dos propiedades animadas aunque la plantilla ya no las nombre.
     Es la SÉPTIMA vez que este arnés cuenta el texto del fichero en vez de lo
     que se ve —van la textura, las curvas, los pesos, el movimiento entre
     fotogramas, la dominancia y ahora esto—, y siempre por el mismo
     mecanismo: el trabajo consiste en sacar cosas del fichero, a un token o a
     un ayudante del motor, y el contador baja solo. Sin esto,
     `solo opacity+transform` pasaba de 8 a 15 y el trinquete bloqueaba un
     arreglo que hace que ocho plantillas animen el peso DE VERDAD. */
  if (/\bEngine\.peso\s*\(/.test(src)) {
    props.add('fontVariationSettings');
    props.add('fontWeight');
  }
  /* `transform` cuenta como UNA propiedad aunque lleve dentro scale, translate
     y rotate: lo que se mide es cuántos CANALES distintos se animan, y los
     tres viven en el mismo. Contarlos por separado haría que la receta
     universal —opacity + translateY— pareciera variada. */
  const ricas = [...props].filter(
    p => /^(filter|clipPath|strokeDashoffset|letterSpacing|backdropFilter|fontVariationSettings|maskImage|webkitMaskImage)$/.test(p));

  const tokensColor = uno(/var\(--(accent[\w-]*|ink[\w-]*|surface[\w-]*|stroke|rule|grid|metal-\d|syn-\w+|luz-\d|pista|scrim|vineta|velo-\w+|chrome[\w-]*|rotu[\w-]*)\)/g);
  const fueraDeLoBasico = [...tokensColor].filter(
    t => !/^(accent|ink|surface)$/.test(t));

  /* Los hexadecimales de una PALETA AJENA no son deuda: son el contenido.
     `subtitles-showcase` reproduce diez estilos de subtítulo conocidos y el
     preset 2 de `kinetic-captions` reproduce uno; tokenizarlos «para bajar el
     contador» convertiría diez presets distintos en diez veces el mismo
     bronce, o sea destruiría lo único que esas plantillas hacen.

     Pero «lo hemos decidido en un comentario» no es una frontera. Se delimitan
     con marcadores explícitos —`PALETA-AJENA: inicio` / `fin`— y el contador
     los excluye SOLO ahí: un hex un renglón más abajo del `fin` vuelve a
     contar. La excepción pasa de ser una convención en prosa a una región
     comprobable, y se publica aparte para que se vea cuánta hay. */
  /* Se recorta sobre el fichero CRUDO, no sobre `src`: los marcadores son
     comentarios y `sinComentarios` ya se los ha llevado. Es exactamente el
     mismo error que tendría cualquiera que intentara delimitar una región con
     comentarios en un texto ya limpiado, y costó un intento. */
  const AJENA = /\/\*\s*PALETA-AJENA:\s*inicio\s*\*\/[\s\S]*?\/\*\s*PALETA-AJENA:\s*fin\s*\*\//g;
  const propio = sinComentarios(bruto.replace(AJENA, ''));
  const hexAjenos = [...src.matchAll(/#[0-9A-Fa-f]{6}\b/g)].length -
                    [...propio.matchAll(/#[0-9A-Fa-f]{6}\b/g)].length;
  const hex = [...propio.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map(m => m[0]);
  const pxTipo = [...src.matchAll(/font-size:\s*(\d+)px/g)].map(m => m[1]);
  const trackingLibre = [...src.matchAll(/letter-spacing:\s*(-?[\d.]+em)/g)].map(m => m[1]);
  /* El vocabulario de PESOS que la plantilla usa de verdad, en las tres
     formas en que se puede escribir. Contaba solo `font-weight: 700`
     literal, así que al pasar el catálogo a los tokens `--w-*` —que es
     exactamente lo que la norma pide— el recuento BAJABA de 1,04 a 0,66 y el
     trinquete lo leía como una regresión tipográfica. Es el mismo error que
     ya cazó el contador de curvas y el de textura: medir el fichero en vez de
     lo que se ve.

     El eje variable cuenta como UNA entrada y no como las quinientas que
     recorre: animar el peso es un recurso, no quinientos recursos. */
  const pesos = uno(/font-weight:\s*(\d+)/g);
  [...src.matchAll(/font-weight:\s*var\(--w-(\w+)\)/g)].forEach(m => pesos.add(m[1]));
  [...src.matchAll(/["']wght["']\s+(\d{3})/g)].forEach(m => pesos.add(m[1]));
  if (/fontVariationSettings|\bEngine\.peso\s*\(/.test(src)) pesos.add('eje');
  const familias = uno(/var\(--(display|editorial|subs|mono)\)/g);
  /* La textura se puede aplicar de tres formas y hay que buscar las tres, o
     la métrica infravalora: como selector CSS (`.trama {`), como clase
     asignada desde JS (`className = 'rayado trama'`) o llamando al motor
     (`Engine.grano(el)`). Lo descubrí al rehacer `mapa-calor`: usaba `.trama`
     y el contador seguía diciendo 2 de 56. */
  const textura = /\.(grano|trama|brushed)\b/.test(src)
               || /brushed-text/.test(src)
               || /class(?:Name)?\s*=\s*['"`][^'"`]*\b(grano|trama|brushed)\b/.test(src)
               || /class="[^"]*\b(grano|trama|brushed)\b/.test(src)
               || /Engine\.(grano|tejaGrano|gradienteMetal)\b/.test(src)
               || /linear-gradient\(\s*var\(--metal-ang\)/.test(src);

  return {
    plantilla: f,
    familia,
    curvas: [...curvas].sort(),
    usos,
    props: [...props].sort(),
    ricas: ricas.length,
    solo_opacidad_transform: ricas.length === 0,
    tokens_color: [...tokensColor].sort(),
    color_rico: fueraDeLoBasico.length,
    hex_literal: hex.length,
    hex_ajenos: hexAjenos,
    hex: [...new Set(hex)],
    px_tipografico: pxTipo.length,
    tracking_libre: trackingLibre.length,
    pesos: [...pesos].sort(),
    familias: [...familias].sort(),
    con_textura: textura,
    gesto,
  };
}

function agrega(filas, curvasMotor) {
  const n = filas.length;

  /* --- dominancia: se cuentan USOS, no plantillas que la tocan -----------
     Esto contaba en cuántas PLANTILLAS aparece cada curva, y esa definición
     se satura: con un ayudante de entrada compartido, toda plantilla toca
     `outCubic`, y con 3,3 curvas distintas por plantilla de 6 que hay, casi
     todas tocan casi todas.

     Medido sobre el catálogo de la tanda 13, por plantilla:
         outCubic 89,1 %   inCubic 83,6 %   inOutCubic 76,4 %
     TRES curvas por encima del «máximo» de 75 a la vez. Si tres curvas
     distintas son dominantes al mismo tiempo, eso no está midiendo dominancia:
     está midiendo cobertura, que con seis curvas y un helper compartido tiende
     a uno por construcción.

     Contando cada APARICIÓN, que es lo que la afirmación «una sola curva para
     todo el catálogo» quiere decir:
         outCubic 39,4 %   inOutCubic 23,5 %   inCubic 15,6 %
         outExpo 11,9 %    outBack6 5,4 %      linear 4,2 %

     El listón pasa de 75 a 33, y no es para que pase: con seis curvas, el
     reparto uniforme es 16,7 %, así que 33 es EL DOBLE de lo uniforme. Hoy
     `outCubic` está en 39,4 % y la puerta SIGUE EN ROJO. Cambiar una métrica
     para que apruebe es el error que este arnés existe para evitar; lo que se
     corrige aquí es que la anterior no medía lo que decía medir. */
  const cuenta = {};
  filas.forEach(r => (r.usos || []).forEach(c => { cuenta[c] = (cuenta[c] || 0) + 1; }));
  const totalUsos = Object.values(cuenta).reduce((s, v) => s + v, 0) || 1;
  const dominante = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0] || ['—', 0];

  /* La cifra vieja se sigue publicando: es «en cuántas plantillas aparece la
     curva más usada», que es otra cosa y conviene no perderla de vista. */
  const porPlant = {};
  filas.forEach(r => r.curvas.forEach(c => { porPlant[c] = (porPlant[c] || 0) + 1; }));
  const cobertura = porPlant[dominante[0]] || 0;
  const inexistentes = filas.flatMap(
    r => r.curvas.filter(c => !curvasMotor.has(c)).map(c => `${r.plantilla}:${c}`));

  const med = f => filas.reduce((s, r) => s + f(r), 0) / n;
  return {
    plantillas: n,
    ease_inexistente: inexistentes.length,
    _ease_inexistente: inexistentes,
    curva_dominante: dominante[0],
    dominancia_pct: +(100 * dominante[1] / totalUsos).toFixed(1),
    curva_cobertura_pct: +(100 * cobertura / n).toFixed(1),
    curva_usos_total: totalUsos,
    curvas_por_plantilla: +med(r => r.curvas.length).toFixed(2),
    solo_opacidad_transform: filas.filter(r => r.solo_opacidad_transform).length,
    props_animadas: +med(r => r.props.length).toFixed(2),
    gestos_distintos: new Set(filas.map(r => r.gesto).filter(Boolean)).size,
    hex_literal: filas.reduce((s, r) => s + r.hex_literal, 0),
    hex_ajenos: filas.reduce((s, r) => s + (r.hex_ajenos || 0), 0),
    px_tipografico: filas.reduce((s, r) => s + r.px_tipografico, 0),
    tracking_libre: filas.reduce((s, r) => s + r.tracking_libre, 0),
    pesos_distintos: +med(r => r.pesos.length).toFixed(2),
    familias_por_plantilla: +med(r => r.familias.length).toFixed(2),
    tokens_color: +med(r => r.tokens_color.length).toFixed(2),
    color_rico: filas.filter(r => r.color_rico > 0).length,
    con_textura: filas.filter(r => r.con_textura).length,
  };
}

/* Dos capas, y la distinción importa.
 *
 * PUERTA (`gate: true`): lo que ya está bien y no puede volver atrás. Falla.
 *
 * META: adónde va el rediseño. Se INFORMA y no falla, porque hoy el catálogo
 * no la cumple —esa es la razón de todo este sprint— y una puerta en rojo que
 * nadie va a arreglar hoy se desactiva mañana, llevándose por delante a las
 * pruebas buenas. Es el mismo criterio con el que `test_motor.py` deja escrito
 * el sobrepaso de `outBack` sin ponerlo en rojo.
 *
 * Lo que sí impide retroceder es el GOLDEN: `tests/fixtures/oro/estilo.json`
 * congela los números de hoy y la prueba afirma que ninguno EMPEORA. Así la
 * monotonía deja de ser una opinión y pasa a ser una prueba en rojo, sin
 * inventarse una fecha en la que todo tiene que estar arreglado. */
const METAS = {
  ease_inexistente:        { max: 0, gate: true,
                             por_que: 'una curva que el motor no define cae a LINEAL sin avisar' },
  dominancia_pct:          { max: 33,  por_que: 'con seis curvas, el reparto uniforme es 16,7 %: el doble de eso ya es una gramática dominante' },
  solo_opacidad_transform: { max: 50,  por_que: 'opacity + translateY es la receta universal' },
  hex_literal:             { max: 90,  por_que: '§7 prohíbe escribir un HEX dentro de una plantilla' },
  con_textura:             { min: 3,   por_que: 'un plano de color con un filete de 1px es una demo de CSS' },
};

function main() {
  const args = process.argv.slice(2);
  const iSolo = args.indexOf('--solo');
  const solo = iSolo >= 0 ? args[iSolo + 1] : null;
  if (solo && solo !== 'propias' && solo !== 'importadas') {
    console.error('--solo acepta «propias» o «importadas», no «%s»', solo);
    return 2;
  }
  const curvasMotor = curvasDelMotor();
  const filas = plantillas(solo).map(analiza);
  const a = agrega(filas, curvasMotor);

  if (args.includes('--json')) {
    console.log(JSON.stringify(a, null, 1));
    return 0;
  }

  console.log('  catálogo: %d plantillas%s\n', a.plantillas,
    solo ? ' (solo las ' + solo + ')' : '');
  const linea = (k, v, extra) => console.log('  %s %s %s',
    String(k).padEnd(26), String(v).padStart(8), extra || '');
  linea('curva dominante', `${a.curva_dominante} ${a.dominancia_pct}%`);
  linea('curvas por plantilla', a.curvas_por_plantilla);
  linea('la dominante, en plantillas', a.curva_cobertura_pct + '%');
  linea('solo opacity+transform', `${a.solo_opacidad_transform}/${a.plantillas}`);
  linea('props animadas (media)', a.props_animadas);
  linea('gestos declarados', a.gestos_distintos);
  linea('hex literales', a.hex_literal);
  linea('de paleta ajena (declarados)', a.hex_ajenos);
  linea('px tipográficos sueltos', a.px_tipografico);
  linea('tracking sin token', a.tracking_libre);
  linea('pesos por plantilla', a.pesos_distintos);
  linea('familias por plantilla', a.familias_por_plantilla);
  linea('con color más allá de 3', `${a.color_rico}/${a.plantillas}`);
  linea('con textura', `${a.con_textura}/${a.plantillas}`);

  let fallos = 0;
  console.log('');
  for (const [k, m] of Object.entries(METAS)) {
    const v = a[k];
    const mal = (m.max !== undefined && v > m.max) || (m.min !== undefined && v < m.min);
    if (mal) {
      if (m.gate) fallos++;
      console.log('  %s %s = %s (%s %s) — %s', m.gate ? '✗' : '·', k, v,
                  m.max !== undefined ? 'máximo' : 'mínimo',
                  m.max !== undefined ? m.max : m.min, m.por_que);
    }
  }
  if (a._ease_inexistente.length && args.includes('--detalle')) {
    console.log('    curvas inexistentes: %s', a._ease_inexistente.join(', '));
  }
  if (args.includes('--detalle')) {
    console.log('\n  sin textura ni color propio:');
    filas.filter(r => !r.con_textura && r.color_rico === 0)
         .forEach(r => console.log('    %s', r.plantilla));
  }
  console.log(fallos
    ? `\n  ${fallos} PUERTA(S) en rojo`
    : '\n  ninguna puerta en rojo. Las marcadas con · son metas del rediseño,'
      + '\n  y el golden `estilo.json` impide que ningún número empeore.');
  return fallos ? 1 : 0;
}

if (require.main === module) process.exit(main());
module.exports = { analiza, agrega, plantillas, curvasDelMotor, METAS };
