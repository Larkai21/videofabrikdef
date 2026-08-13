// Tokenización de tags de la biblioteca. Vive en shared porque la usan DOS
// dueños con el mismo criterio: los workers (caption VLM en el backfill) y la
// API (nombre de fichero al subir). Antes cada uno tokenizaba a su manera y
// el de la API partía «señalando» en «sen» + «alando»: los nombres de macOS
// llegan en NFD y la tilde combinante no estaba en su clase de caracteres
// (auditoría UI 2026-08, hallazgo 11).

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
 *
 * Lo existente se SANEA de paso (acentos fuera, stopwords fuera): tags rotos
 * de pasadas viejas («con») se curan en el siguiente backfill. La regla de
 * longitud NO se aplica a lo existente: un tag corto puesto por un humano
 * («ia») no se borra por una regla pensada para texto de caption.
 */
export function mergeTags(existing: string[], caption: string): string[] {
  const saneado = existing
    .map((t) => t.trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))
    .filter((t) => t !== '' && !STOPWORDS.has(t));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...saneado, ...tokensFromCaption(caption)]) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}
