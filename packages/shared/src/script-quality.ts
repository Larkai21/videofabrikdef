import { figureBackedBy, numericTokens } from './edit-intents.js';

// Linter determinista del guion. Lo mecánico (muletillas, exclamaciones, frases
// kilométricas, cifras sin respaldo) se MIDE aquí gratis, en vez de pedírselo a
// un modelo que lo hace peor y cobra por ello. El juez solo evalúa lo que no se
// puede medir.
//
// Vive en shared porque lo consumen el worker (para inyectar los avisos en el
// prompt del juez) y el dashboard (para pintarlos al margen del documento): así
// worker y UI aplican exactamente la misma regla.

/**
 * Muletillas de texto generado. La lista es corta a propósito: una lista larga
 * en el prompt se ignora, y aquí cada entrada tiene que ganarse el falso
 * positivo que puede provocar.
 */
export const AI_CLICHES: readonly { id: string; re: RegExp }[] = [
  { id: 'en-un-mundo', re: /\ben un mundo (donde|en el que)\b/i },
  { id: 'en-la-era', re: /\ben la era de\b/i },
  { id: 'hoy-en-dia', re: /\b(hoy en día|en el mundo actual)\b/i },
  { id: 'no-es-solo', re: /\bno (es|se trata de) solo\b/i },
  { id: 'mas-que-nunca', re: /\bmás que nunca\b/i },
  { id: 'punta-iceberg', re: /\bla punta del iceberg\b/i },
  { id: 'la-pregunta-es', re: /\bla pregunta es\b/i },
  { id: 'aqui-interesante', re: /\by aquí (viene|está) lo interesante\b/i },
  {
    id: 'cierre-redaccion',
    re: /\b(en resumen|en conclusión|en definitiva|dicho esto|sin más preámbulos)\b/i,
  },
  {
    id: 'hiperbole',
    re: /\b(revolucionari[oa]|imparable|el santo grial|cambia las reglas del juego)\b/i,
  },
  {
    id: 'folleto',
    re: /\b(sumérgete|desbloquea|el poder de|el secreto de|todo lo que necesitas saber)\b/i,
  },
  { id: 'relleno', re: /\b(es importante destacar|cabe señalar|vale la pena mencionar)\b/i },
  { id: 'y-es-que', re: /(^|[.;]\s+)y es que\b/i },
];

// El rótulo de andamiaje es el defecto más caro que ha tenido el guion, porque
// no se queda en el papel: se oye. El locutor dice «PUNTO MEDIO» y «Pago de la
// promesa», y eso está en el MP4 de vídeos publicados. El juez les dio 4 de 5 en
// estructura y en estilo sin mencionarlo ni una vez — la prueba de que una
// rúbrica no sustituye a una comprobación mecánica.
const ROTULO = /^\s*[«"']?([^.!?:]{1,45}):\s+\S/;

// Formas verbales finitas frecuentes. Si el arranque tiene una, es una ORACIÓN
// y los dos puntos son un recurso retórico legítimo: «No fue un fallo: fue el
// diseño» está bien escrito y no se toca.
const VERBO_FINITO =
  /\b(es|son|fue|fueron|era|eran|hay|est[áa]|est[áa]n|tiene|tienen|ten[íi]a|dice|dicen|dijo|hace|hacen|hizo|puede|pueden|podr[íi]a|va|van|iba|sabe|sabes|saben|quieres|quiere|empieza|empiezan|deja|dejan|has|he|hemos|viene|vienen|sirve|sirven|funciona|funcionan|pas[óo]|pasa|pasan|cruza|saca|llega|llegan|sale|salen|ves|vemos|significa|significan|importa|cambia|cambian|cambi[óo]|ocurre|ocurren|ocurri[óo]|parece|parecen|resulta|resultan|conviene|incorpora|incorporan|ofrece|ofrecen|permite|permiten|suena|suenan|exige|exigen|necesita|necesitas|necesitan|obliga|obligan|depende|dependen|falta|faltan|queda|quedan|vale|valen|cuesta|cuestan|entra|entran|abre|abren|cierra|cierran|aparece|aparecen|existe|existen|incluye|incluyen|a[ñn]ade|a[ñn]aden|ejecuta|ejecutan|convierte|convierten|genera|generan|produce|producen|explica|explican|muestra|muestran|revela|revelan|demuestra|prueba|confirma|niega|admite|reconoce|anuncia|publica|lanza|vende|compra|paga|gana|pierde|sube|baja|crece|cae|circul[óo]|ha|han|hab[íi]a|puedes|puede|podemos|empiezas|empieza|empiezan|acaba|acaban|termina|terminan|sigue|siguen|lleva|llevan|pone|ponen|quita|quitan|busca|buscan|encuentra|encuentran|usa|usan|toma|toman|pide|piden|logra|logran|consigue|consiguen|evita|evitan|reduce|reducen|aumenta|aumentan|mejora|mejoran|empeora|rompe|rompen|funciona|arranca|dura|duran|mide|miden|cuenta|cuentan)\b/i;

// …salvo que el rótulo sea una enumeración. «Paso dos:», «Primer paso práctico:»
// y «Segunda idea:» llevan verbo o no según la redacción, pero son índices en
// los dos casos.
const ENUMERACION =
  /\b(paso|fase|punto|idea|raz[óo]n|clave|control|regla|bloque)\b|^\s*(primer|segund|tercer|cuart|quint)/i;

/**
 * ¿La escena abre con un RÓTULO en vez de con una frase?
 *
 * Medido sobre 400 escenas reales (256 del banco + 144 de los vídeos
 * publicados): **205 abren así**. Y la lista de rótulos no tiene fondo, porque
 * el modelo se los inventa: «Arquitectura:», «Demo rápida:», «Quién y dónde:»,
 * «Cómo minimizar riesgos:», «Lo que cambia:». Por eso esto NO puede ser una
 * lista blanca — la que había cubría 28 de 400.
 *
 * La prueba de que la causa es estructural y no de vocabulario: el prompt
 * emitía los papeles en mayúsculas («PUNTO MEDIO», «GIRO») y se reescribió en
 * prosa para que no fueran citables. En la primera tanda del banco tras ese
 * cambio, el modelo escribió «Lo contraintuitivo:» seis veces y «Otra
 * objeción:» cinco — copiando la redacción NUEVA. Cambiar el nombre del papel
 * solo cambia el nombre del rótulo. Mientras el blueprint asigne a cada escena
 * un papel nombrable, el modelo lo va a anunciar, así que hace falta esta red.
 */
export function abreConRotulo(texto: string): boolean {
  const m = ROTULO.exec(texto);
  const prefijo = m?.[1];
  if (prefijo === undefined) return false;
  if (prefijo.trim().split(/\s+/).length > 6) return false;
  if (ENUMERACION.test(prefijo)) return true;
  return !VERBO_FINITO.test(prefijo);
}

/**
 * Cuántas escenas abren con rótulo. La MISMA regla que bloquea, expuesta como
 * número para el informe y para el banco: un guion con doce de dieciséis
 * escenas rotuladas no es un guion, es un índice locutado, y eso se ve en el
 * agregado antes que escena a escena.
 */
export function escenasEncabezadas(scenes: readonly { text: string }[]): number {
  return scenes.filter((s) => abreConRotulo(s.text)).length;
}

// Palabras que empiezan por mayúscula sin ser un nombre propio: arranque de
// frase, gentilicios, meses, y —importante— los rótulos de andamiaje. Sin esta
// última parte, «PUNTO MEDIO» contaría como dos entidades y arreglar los
// rótulos haría BAJAR la concreción medida.
const NO_ES_ENTIDAD = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'y',
  'o',
  'pero',
  'si',
  'no',
  'que',
  'qué',
  'cuando',
  'cuándo',
  'donde',
  'dónde',
  'como',
  'cómo',
  'porque',
  'por',
  'para',
  'con',
  'sin',
  'sobre',
  'entre',
  'desde',
  'hasta',
  'ese',
  'esa',
  'eso',
  'este',
  'esta',
  'esto',
  'aquel',
  'su',
  'sus',
  'tu',
  'tus',
  'mi',
  'mis',
  'al',
  'del',
  'es',
  'son',
  'fue',
  'hay',
  'está',
  'están',
  'tiene',
  'tienen',
  'puede',
  'pueden',
  'va',
  'van',
  'ya',
  'también',
  'además',
  'ahora',
  'hoy',
  'ayer',
  'mañana',
  'aquí',
  'allí',
  'así',
  'solo',
  'sólo',
  'más',
  'menos',
  'muy',
  'todo',
  'toda',
  'todos',
  'todas',
  'otro',
  'otra',
  'cada',
  'nunca',
  'siempre',
  'punto',
  'medio',
  'giro',
  'caso',
  'contexto',
  'pago',
  'desarrollo',
  'complicación',
  'cierre',
  'gancho',
  'conclusión',
  'paso',
  'fase',
  'idea',
  'primera',
  'segunda',
  'tercera',
  'cuarta',
  'quinta',
  'primer',
  'segundo',
  'tercer',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
  'domingo',
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
  'internet',
  'ia',
  // verbos y arranques que aparecen en mayúscula al empezar un claim: «Existe un
  // artículo titulado…» no nombra nada, y contarlo como entidad convertía en
  // «dato con sustancia» justo el claim vacío que motivó toda esta medida
  'existe',
  'existen',
  'aparece',
  'aparecen',
  'según',
  'segun',
  'hay',
  'se',
  'sus',
  'varios',
  'varias',
  'muchos',
  'muchas',
  'algunos',
  'algunas',
  'tras',
  'durante',
  'mientras',
  'aunque',
  'pese',
  'dice',
  'sostiene',
  'sostienen',
  'afirma',
  'afirman',
  'reporta',
  'reportan',
  'indica',
  'indican',
  'nuevo',
  'nueva',
]);

/**
 * Nombres propios y siglas del texto: empresas, productos, personas, leyes.
 *
 * Es la medida de CONCRETO. OJO con el diagnóstico que circulaba: «siete de once
 * guiones no nombran ni una entidad» es FALSO. Salió de contar apariciones de una
 * lista fija de empresas de IA (OpenAI, Anthropic, Google…), que mide otra cosa.
 * Con esta definición, solo 1 de 11 guiones publicados está a cero y la media son
 * 6,9 nombres propios por guion. El problema de concreción es real pero mucho más
 * suave de lo que parecía, y por eso esta función es una MÉTRICA y no un aviso
 * bloqueante.
 *
 * Heurística, no un analizador: mayúscula inicial fuera del arranque de frase, o
 * sigla de dos o más letras. Se queda corta con los nombres en minúscula
 * («arXiv») y se pasa con algún inicio de cita; sirve para comparar corridas, no
 * para juzgar una frase suelta.
 */
export function entidadesNombradas(texto: string): Set<string> {
  const out = new Set<string>();
  const frases = texto.split(/(?<=[.;:?!])\s+/);
  for (const frase of frases) {
    const palabras = frase.trim().split(/\s+/);
    palabras.forEach((cruda, i) => {
      const palabra = cruda.replace(/^[«"'(¿¡]+|[»"',.;:?!)]+$/g, '');
      if (palabra.length < 2) return;
      const bajas = palabra.toLowerCase();
      if (NO_ES_ENTIDAD.has(bajas)) return;
      // sigla: dos o más mayúsculas seguidas, en cualquier posición
      if (/^[\p{Lu}]{2,}(-[\p{Lu}0-9]+)?$/u.test(palabra)) {
        out.add(palabra);
        return;
      }
      // nombre propio: mayúscula inicial y NO al empezar la frase
      if (i > 0 && /^[\p{Lu}]/u.test(palabra)) out.add(palabra);
    });
  }
  return out;
}

/**
 * El cierre de una escena, en palabras de su última frase.
 *
 * Es la medida de ritmo que sí separa, y costó llegar a ella. La desviación
 * típica del largo de ESCENA ordena el corpus al revés. «Hay frases cortas»
 * tampoco vale: el 32 % de las frases de cualquier guion tienen ocho palabras o
 * menos y todos los guiones tienen alguna. Lo que falla es DÓNDE cae el golpe.
 *
 * Medido: `O9WieZkLPrbjAAXcDxq1f` —el único guion del corpus que se lee bien—
 * cierra sus escenas con 11,2 palabras de media y el 30 % con ocho o menos; su
 * gancho cierra con CUATRO: «Todo el contenido, desaparecido.» Los guiones
 * generados cierran con 16-17 palabras y solo el 8-11 % por debajo de ocho.
 *
 * Y no es solo el largo: los cierres generados resumen la escena y empiezan
 * todos igual («Esa diferencia cambia…», «Esa variedad significa…», «Esa
 * política determina…»), mientras que los buenos cierran en consecuencia («Sin
 * claves, tus datos son puro ruido»).
 */
export function palabrasDelCierre(texto: string): number {
  const fs = texto
    .trim()
    .split(/(?<=[.;:?!])\s+/)
    .filter((s) => s.trim().length > 0);
  const ultima = fs[fs.length - 1];
  return ultima === undefined ? 0 : ultima.trim().split(/\s+/).length;
}

/**
 * Promesas que este formato NO puede cumplir.
 *
 * El canal monta con metraje de archivo: no hay cámara, no hay captura de
 * pantalla y no hay adjuntos. Aun así, cinco de los once guiones publicados
 * prometen una demo en pantalla o un descargable: «En la demo usaré un libro
 * técnico como ejemplo», «el flujo que te mostré te las entrega», «descarga el
 * pack del vídeo en el enlace», «en el próximo vídeo desplegamos juntos un
 * benchmark… subimos el notebook».
 *
 * Es peor que un defecto de estilo: el guion le dice al espectador que ha visto
 * algo que no ha visto. Y a diferencia de la fontanería —que desapareció sola
 * al arreglar el research—, esto no depende del material: en el banco sigue
 * apareciendo en diez escenas.
 *
 * Ojo con lo que NO es: «descarga el repositorio desde Hugging Face» le dice al
 * espectador qué hacer en un sitio de terceros y es contenido legítimo. Por eso
 * ningún patrón dispara con «descarga» a secas.
 */
const PROMESA_NO_PRODUCIBLE: readonly { id: string; re: RegExp }[] = [
  // «en la demo» no basta: leyendo el banco apareció «Empezamos con una demo
  // práctica» y «Vas a ver cómo configurar uno», que prometen lo mismo con otra
  // preposición. Se pide el verbo delante para no marcar «la demo de OpenAI»,
  // que sería contenido legítimo.
  {
    id: 'demo-en-pantalla',
    re: /\ben (la|esta|una) demo\b|\b(hacemos|haremos|hago|empezamos con|empiezo con|monto|montamos|verás|vas a ver|veremos|te enseño) (una |la |esta )?demo\b/i,
  },
  {
    id: 'te-muestro',
    // sin `\b` final: en JavaScript es ASCII, y tras “mostré” no hay frontera
    // de palabra porque la é no cuenta como carácter de palabra
    re: /\bte (muestro|mostré|enseño|enseñé)|como ves aquí|ves en pantalla/i,
  },
  {
    id: 'descargable',
    re: /\b(pack del vídeo|(checklist|plantilla|guía|hoja)s? descargables?|descargable en la descripción)\b/i,
  },
  {
    id: 'en-la-descripcion',
    re: /\b(dejo|dejaré|te dejo|tienes|pongo) (el |la |los |las |un |una )?(enlace|link|checklist|plantilla|pack|material)\w*\b/i,
  },
  { id: 'proximo-video', re: /\ben (el|un) próximo vídeo\b/i },
];

/**
 * El guion narrando sus propios movimientos retóricos.
 *
 * Es el andamiaje un nivel más arriba: no anuncia el NOMBRE de la escena
 * («PUNTO MEDIO:»), anuncia su FUNCIÓN («Aquí cumplo la promesa práctica»). Se
 * escapa de `abreConRotulo` porque va dentro de una oración con verbo.
 *
 * Cumplir una promesa no se avisa, se hace. Observado en dos casos de familias
 * distintas: `EKPfJAWT9OOMy3wF098Bp` («Aquí cumplo la promesa práctica», «Lo
 * contraintuitivo es que ahorrar tiempo…») y `OIC6LvB17pOtsK3tOkbqx` («Lo
 * contraintuitivo es que protegerse solo con cumplimiento jurídico…»).
 */
const META_NARRACION: readonly { id: string; re: RegExp }[] = [
  {
    id: 'cumplo-la-promesa',
    re: /\b(cumplo|pago|cierro|aquí va) la promesa\b|\bpago de la promesa\b/i,
  },
  { id: 'lo-contraintuitivo', re: /\blo contraintuitivo\b/i },
  { id: 'punto-medio', re: /\b(punto medio|re-?gancho)\b/i },
];

/**
 * Aperturas de objeción. No se prohíben —la tensión es una regla de oficio y
 * está bien— pero encadenarlas convierte el cuerpo en una lista de pegas.
 */
const OBJECION =
  /^\s*(pero\b|sin embargo|s[íi],? pero|otra objeci|también podr|podr[íi]as (pensar|creer)|no obstante|aunque\b|otro (pero|inconveniente)|hay un pero|la pega)/i;

/** Máximo de escenas de objeción seguidas antes de que sea un bloque, no alternancia. */
export const MAX_OBJECIONES_SEGUIDAS = 2;

// Unidades que hacen que un número sea narrativo o instructivo, no una prueba:
// la edad de un personaje, el largo de un email que le pides al lector, una
// duración. Ninguna de estas puede «no estar en el research», porque no es un
// dato del research.
const UNIDAD_NARRATIVA =
  /^(años?|meses?|semanas?|d[íi]as?|horas?|minutos?|segundos?|palabras?|correos?|emails?|caracteres?|l[íi]neas?|p[áa]ginas?|veces)\b/i;

/**
 * ¿Esta cifra afirma algo que habría que poder respaldar con el research?
 *
 * La regla factual del prompt es buena y la comprobación estaba rota: se pasaba
 * CUALQUIER dígito por `figureBackedBy`. Medido sobre los once maestros, eso da
 * 29 avisos y NINGUNO es una cifra inventada: son los ordinales de las listas
 * («1) mapea en qué capa operas; 2) identifica…»), la edad del personaje —que
 * además está en el título elegido, «Por qué reconvertirte a los 38…»—, «150
 * palabras» y «20 correos».
 *
 * No es un aviso cosmético de más: `cifra_sin_claim` bloquea, y `factualidad`
 * es el ÚNICO eje del juez que decide el veredicto (su mínimo es 4 frente al 3
 * de los demás). Los tres guiones suspendidos del corpus lo fueron por esto, y
 * los tres son falsos positivos. Peor: el presupuesto de cuatro escenas del
 * refinado se gastaba entero en quitarle la edad a Marta, así que las notas
 * sobre estructura no llegaban nunca.
 *
 * Lo que sí exige respaldo: porcentajes, dinero, magnitudes con escala
 * (millones, miles) y cualquier número grande. Es donde vive la afirmación
 * fuerte, y es lo que el prompt quería proteger.
 */
export function cifrasEvidenciales(texto: string): Set<string> {
  const out = new Set<string>();
  // el MISMO barrido que numericTokens, para que los tokens coincidan: esa
  // función NORMALIZA («12.000» → «12000», «300 millones» → «300000000»), así
  // que buscar el token dentro del texto con indexOf no encuentra nada
  for (const m of texto.matchAll(/(\d[\d.,]*)\s*(\p{L}+)?/gu)) {
    const crudo = m[1] ?? '';
    const bare = crudo.replace(/\D/g, '');
    if (bare === '') continue;
    const i = m.index ?? 0;
    const antes = texto.slice(Math.max(0, i - 14), i);
    const despues = texto.slice(i + crudo.length).trimStart();
    const unidad = m[2] ?? '';

    const evidencial =
      /^(%|por ciento)/i.test(despues) ||
      /^(millones?|mill[óo]n|mil(es)?\b|billones?)/i.test(despues) ||
      /[€$]\s*$/.test(antes) ||
      /^(€|\$|d[óo]lares|euros)/i.test(despues) ||
      // proporciones: «uno de cada cuatro adultos», «1 de cada 3»
      /\bde cada\s*$/i.test(antes) ||
      /^de cada\b/i.test(despues) ||
      // Un número grande y desnudo casi nunca es instructivo; uno pequeño casi
      // siempre lo es («prueba 20 contactos», «tres cosas», «1) …»). El corte
      // alto deja pasar alguna afirmación sin porcentaje, y es el lado bueno
      // por el que equivocarse: un falso negativo cuesta una revisión humana,
      // un falso positivo se come el presupuesto entero del refinado.
      (Number(bare) >= 1000 && !UNIDAD_NARRATIVA.test(despues));

    if (!evidencial) continue;
    out.add(bare);
    // la magnitud escrita con letra genera un segundo token en numericTokens
    const mag = /^(millones?|mill[óo]n)/i.test(unidad)
      ? 1e6
      : /^mil$/i.test(unidad)
        ? 1e3
        : /^billones?$/i.test(unidad)
          ? 1e9
          : 0;
    if (mag > 0) out.add(String(Number(bare) * mag));
  }
  return out;
}

export type ScriptLintKind =
  | 'cliche'
  | 'andamiaje'
  | 'promesa_no_producible'
  | 'meta_narracion'
  | 'objeciones_seguidas'
  | 'exclamacion'
  | 'frase_larga'
  | 'escena_corta'
  | 'escena_larga'
  | 'cifra_sin_claim';

export interface ScriptLintHit {
  /** id de la escena */
  id: string;
  kind: ScriptLintKind;
  /** qué se ha encontrado, en español y listo para enseñar */
  detail: string;
}

export interface LintOptions {
  claims: readonly { text: string }[];
  minWords?: number;
  maxWords?: number;
  maxSentenceWords?: number;
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.;:?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Avisos duros sobre las escenas. `cifra_sin_claim` es el más importante: es la
 * misma regla factual que el prompt del guion pide y que hasta ahora nadie
 * comprobaba.
 */
export function lintScenes(
  scenes: readonly { id: string; text: string }[],
  opts: LintOptions,
): ScriptLintHit[] {
  // 25, no 40. El mínimo de 40 marcaba 178 de 256 escenas del banco y, en
  // producción, hizo que el juez pidiera ALARGAR el gancho. El guion que mejor
  // se lee del corpus tiene escenas de 31 palabras: a 40, una escena-golpe es
  // un error. El aviso sigue existiendo para la escena que de verdad no dice
  // nada, que es de lo que iba.
  const minWords = opts.minWords ?? 25;
  const maxWords = opts.maxWords ?? 70;
  const maxSentenceWords = opts.maxSentenceWords ?? 25;
  const claimTexts = opts.claims.map((c) => c.text);
  const hits: ScriptLintHit[] = [];
  let objecionesSeguidas = 0;

  for (const scene of scenes) {
    for (const { id, re } of AI_CLICHES) {
      const m = re.exec(scene.text);
      if (m)
        hits.push({ id: scene.id, kind: 'cliche', detail: `muletilla «${m[0].trim()}» (${id})` });
    }

    if (abreConRotulo(scene.text)) {
      const rotulo = scene.text.split(':')[0]?.trim() ?? '';
      hits.push({
        id: scene.id,
        kind: 'andamiaje',
        detail: `abre con el rótulo «${rotulo}:», y eso se locuta tal cual`,
      });
    }

    for (const { id, re } of PROMESA_NO_PRODUCIBLE) {
      const m = re.exec(scene.text);
      if (m) {
        hits.push({
          id: scene.id,
          kind: 'promesa_no_producible',
          detail: `promete «${m[0].trim()}» (${id}), y este vídeo se monta con metraje de archivo`,
        });
      }
    }

    for (const { id, re } of META_NARRACION) {
      const m = re.exec(scene.text);
      if (m) {
        hits.push({
          id: scene.id,
          kind: 'meta_narracion',
          detail: `narra su propio movimiento: «${m[0].trim()}» (${id})`,
        });
      }
    }

    // La objeción encadenada es un defecto del GUION, no de la escena: dos
    // seguidas son alternancia, cuatro son una lista de pegas. Se cuelga de la
    // escena que rompe la racha para que el refinado sepa cuál tocar.
    if (OBJECION.test(scene.text)) {
      objecionesSeguidas += 1;
      if (objecionesSeguidas > MAX_OBJECIONES_SEGUIDAS) {
        hits.push({
          id: scene.id,
          kind: 'objeciones_seguidas',
          detail: `${objecionesSeguidas} escenas de objeción seguidas: el cuerpo se vuelve una lista de pegas`,
        });
      }
    } else {
      objecionesSeguidas = 0;
    }

    if (scene.text.includes('!') || scene.text.includes('¡')) {
      hits.push({ id: scene.id, kind: 'exclamacion', detail: 'lleva exclamación' });
    }

    for (const s of sentences(scene.text)) {
      const n = countWords(s);
      if (n > maxSentenceWords) {
        hits.push({
          id: scene.id,
          kind: 'frase_larga',
          detail: `una frase de ${n} palabras (máximo ${maxSentenceWords})`,
        });
        break; // una por escena basta: el aviso es la escena, no cada frase
      }
    }

    const words = countWords(scene.text);
    if (words < minWords) {
      hits.push({
        id: scene.id,
        kind: 'escena_corta',
        detail: `${words} palabras (mínimo ${minWords})`,
      });
    } else if (words > maxWords) {
      hits.push({
        id: scene.id,
        kind: 'escena_larga',
        detail: `${words} palabras (máximo ${maxWords})`,
      });
    }

    // se comprueba cada cifra por separado: una escena puede traer una buena y
    // otra inventada. Solo las EVIDENCIALES: ver `cifrasEvidenciales`.
    const evidenciales = cifrasEvidenciales(scene.text);
    for (const token of new Set(numericTokens(scene.text))) {
      if (!evidenciales.has(token)) continue;
      if (!figureBackedBy(token, claimTexts)) {
        hits.push({
          id: scene.id,
          kind: 'cifra_sin_claim',
          detail: `la cifra ${token} no aparece en el research`,
        });
      }
    }
  }
  return hits;
}

/** Los avisos que obligan a retocar la escena aunque el juez no la marque. */
export const BLOCKING_LINT_KINDS: readonly ScriptLintKind[] = [
  'cliche',
  'andamiaje',
  'promesa_no_producible',
  'meta_narracion',
  'objeciones_seguidas',
  'cifra_sin_claim',
];

export function blockingSceneIds(hits: readonly ScriptLintHit[]): string[] {
  return [...new Set(hits.filter((h) => BLOCKING_LINT_KINDS.includes(h.kind)).map((h) => h.id))];
}
