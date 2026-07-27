// Texto canónico con el que se embebe un asset de la biblioteca. TODOS los
// caminos de escritura (ingesta, backfill y re-embebido) deben usar esta
// función: si divergen, el vector de un asset oscila según qué job escribió
// último y las similitudes dejan de ser comparables.
export function buildAssetEmbedText(
  caption: string | null | undefined,
  originQuery: string | null | undefined,
  tags: readonly string[] | null | undefined,
): string {
  return [caption ?? '', originQuery ?? '', (tags ?? []).join(' ')]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ')
    .trim();
}
