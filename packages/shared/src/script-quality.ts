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

/**
 * Rótulos de andamiaje: el papel que el prompt le asigna a la escena, escrito
 * dentro del texto que se locuta.
 *
 * Es el defecto más caro que ha tenido el guion, porque no se queda en el
 * papel: se oye. Medido sobre los diez vídeos producidos, 18 escenas empiezan
 * por «PUNTO MEDIO:», «GIRO:», «Sí, pero:», «Caso:», «Contexto social:» o
 * «Pago de la promesa:», y esas palabras están en el MP4. El juez les dio 4 de
 * 5 en estructura y en estilo sin mencionarlo ni una vez, que es la prueba de
 * que un juez con rúbrica no sustituye a una comprobación mecánica.
 *
 * La causa era `sceneBlueprint()` emitiendo los papeles en mayúsculas y con dos
 * puntos —la forma exacta de un encabezado—, así que el modelo los leía como
 * parte del formato de salida. El prompt ya está arreglado; esto es la red que
 * garantiza que, si vuelve a filtrarse, no llega al audio.
 */
export const ANDAMIAJE =
  /^\s*(punto medio|giro|s[íi],? pero|caso|contexto( social)?|pago(\s+\d+|\s+de la promesa)?|desarrollo|complicaci[óo]n|re-?gancho|cierre|hook|gancho|conclusi[óo]n|primera idea|segunda idea|tercera idea|cuarta idea|quinta idea|paso (uno|dos|tres|cuatro|cinco|\d+))\s*[:—-]/i;

/**
 * Escena que abre con un ENCABEZADO en vez de con una frase.
 *
 * Distinto de ANDAMIAJE y deliberadamente NO bloqueante, porque aquí sí hay
 * juicio: «No fue un fallo: fue el diseño» usa los dos puntos como recurso
 * retórico y está bien escrito, mientras que «Hardware: las entradas de capital
 * suelen apuntar a aceleradores» es una viñeta leída en voz alta. La diferencia
 * es si delante de los dos puntos hay una oración o una etiqueta, y eso no se
 * decide con una expresión regular sin un analizador morfológico.
 *
 * Se mide porque el dato importa aunque no se pueda bloquear: 81 de las 144
 * escenas producidas (56 %) abren así, y un vídeo entero —OZmRIqZ2w— tiene 12
 * de 16 escenas encabezadas. Eso no es un guion, es un índice locutado. El
 * número va al juez y al informe; la decisión sigue siendo humana.
 */
export const ENCABEZADO = /^\s*[«"']?[\p{Lu}][^.!?]{0,28}:\s+\p{L}/u;

/** Cuántas escenas abren con encabezado en vez de con una frase. */
export function escenasEncabezadas(scenes: readonly { text: string }[]): number {
  return scenes.filter((s) => ENCABEZADO.test(s.text)).length;
}

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

  for (const scene of scenes) {
    for (const { id, re } of AI_CLICHES) {
      const m = re.exec(scene.text);
      if (m)
        hits.push({ id: scene.id, kind: 'cliche', detail: `muletilla «${m[0].trim()}» (${id})` });
    }

    const andamiaje = ANDAMIAJE.exec(scene.text);
    if (andamiaje) {
      hits.push({
        id: scene.id,
        kind: 'andamiaje',
        detail: `empieza con el rótulo «${andamiaje[0].trim()}»: eso se locuta tal cual`,
      });
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
  'cifra_sin_claim',
];

export function blockingSceneIds(hits: readonly ScriptLintHit[]): string[] {
  return [...new Set(hits.filter((h) => BLOCKING_LINT_KINDS.includes(h.kind)).map((h) => h.id))];
}
