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
  /\b(es|son|fue|fueron|era|eran|hay|est[áa]|est[áa]n|tiene|tienen|dice|dicen|hace|hacen|puede|pueden|va|van|sabe|sabes|quieres|empieza|deja|has|he|viene|sirve|funciona|pas[óo]|pasa|cruza|saca|llega|sale|ves|significa|importa|cambia|ocurre|ocurri[óo]|parece|resulta|conviene)\b/i;

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
  { id: 'demo-en-pantalla', re: /\ben (la|esta|una) demo\b/i },
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
  const minWords = opts.minWords ?? 40;
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
