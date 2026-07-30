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
  { id: 'cierre-redaccion', re: /\b(en resumen|en conclusión|en definitiva|dicho esto|sin más preámbulos)\b/i },
  { id: 'hiperbole', re: /\b(revolucionari[oa]|imparable|el santo grial|cambia las reglas del juego)\b/i },
  { id: 'folleto', re: /\b(sumérgete|desbloquea|el poder de|el secreto de|todo lo que necesitas saber)\b/i },
  { id: 'relleno', re: /\b(es importante destacar|cabe señalar|vale la pena mencionar)\b/i },
  { id: 'y-es-que', re: /(^|[.;]\s+)y es que\b/i },
];

export type ScriptLintKind =
  | 'cliche'
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
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
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
      if (m) hits.push({ id: scene.id, kind: 'cliche', detail: `muletilla «${m[0].trim()}» (${id})` });
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
      hits.push({ id: scene.id, kind: 'escena_corta', detail: `${words} palabras (mínimo ${minWords})` });
    } else if (words > maxWords) {
      hits.push({ id: scene.id, kind: 'escena_larga', detail: `${words} palabras (máximo ${maxWords})` });
    }

    // se comprueba cada cifra por separado: una escena puede traer una buena y
    // otra inventada
    for (const token of new Set(numericTokens(scene.text))) {
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
export const BLOCKING_LINT_KINDS: readonly ScriptLintKind[] = ['cliche', 'cifra_sin_claim'];

export function blockingSceneIds(hits: readonly ScriptLintHit[]): string[] {
  return [...new Set(hits.filter((h) => BLOCKING_LINT_KINDS.includes(h.kind)).map((h) => h.id))];
}
