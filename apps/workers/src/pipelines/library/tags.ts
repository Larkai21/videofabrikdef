// Construcción de tags a partir del caption VLM. Lógica pura, testeada sola.

export const CAPTION_PROMPT =
  'Describe en una frase corta el contenido visual de esta imagen para indexarla como b-roll.';

const MAX_TAGS = 16;

/** Palabras vacías que no aportan como tag (es/en, listas cortas y estables). */
const STOPWORDS = new Set([
  'con', 'como', 'del', 'las', 'los', 'una', 'unas', 'uno', 'unos', 'para',
  'por', 'que', 'sobre', 'entre', 'este', 'esta', 'estos', 'estas', 'hay',
  'the', 'and', 'with', 'for', 'this', 'that', 'from', 'una', 'sin',
]);

/** Tokeniza un texto en candidatos a tag: minúsculas, sin acentos ni signos, longitud > 2. */
export function tokensFromCaption(caption: string): string[] {
  return caption
    .toLowerCase()
    .normalize('NFKD')
    // NFKD separa la tilde como marca combinante; se elimina para que
    // «montaña» quede como tag «montana» y no se parta en dos tokens
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Fusiona los tags existentes con los tokens del caption, sin duplicados y
 * conservando el orden (primero lo que ya había). Tope de MAX_TAGS.
 */
export function mergeTags(existing: string[], caption: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...existing, ...tokensFromCaption(caption)]) {
    const norm = tag.trim().toLowerCase();
    if (norm === '' || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
