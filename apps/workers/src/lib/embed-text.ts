// Texto canónico con el que se embebe un asset de la biblioteca. TODOS los
// caminos de escritura (ingesta, backfill y re-embebido) deben usar esta
// función: si divergen, el vector de un asset oscila según qué job escribió
// último y las similitudes dejan de ser comparables.
//
// Se embebe SOLO la descripción, igual que el stock (assets/index.ts: «el
// coseno mide caption↔query: incluir la query en el texto embebido inflaría la
// similitud con sus propios términos»). Antes la biblioteca metía además la
// consulta que encontró el asset y unos tags derivados de esa misma consulta,
// así que sus términos entraban tres veces y el vector describía la búsqueda en
// vez del plano. Era un bucle autoconfirmante que empeoraba según crecía la
// biblioteca: medido en un vídeo sobre agentes de IA, la biblioteca ganó 18 de
// 36 beats y sirvió estanterías ingeridas para un vídeo sobre libros raros.
//
// Los dos tiers compiten por el mismo coseno, así que tienen que embeberse con
// la misma regla o la comparación no significa nada.
export function buildAssetEmbedText(
  caption: string | null | undefined,
  originQuery: string | null | undefined,
): string {
  const c = (caption ?? '').trim();
  if (c !== '') return c;
  // sin descripción todavía (subida a mano, pendiente de backfill) un vector
  // vacío sería inútil: la consulta es lo único que hay
  return (originQuery ?? '').trim();
}
