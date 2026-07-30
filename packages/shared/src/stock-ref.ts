// Referencia canónica de un recurso de stock: `proveedor:tipo:id`.
//
// Existe porque había DOS clientes de stock —el de la API (búsqueda libre desde
// la timeline) y el de los workers (la cascada)— que emitían formatos distintos
// (`pexels:123` vs `pexels:video:123`) sobre la MISMA tabla `stock_cache` y la
// misma columna `assets.source_ref`. Las consecuencias eran silenciosas: un clip
// elegido a mano no deduplicaba contra el mismo clip ya ingerido (se descargaba
// y se pagaba el VLM dos veces) y `originLabel` mostraba `undefined`.
//
// Al construirse aquí, un cliente nuevo no puede volver a divergir.

export type StockProvider = 'pexels' | 'pixabay';
export type StockKind = 'clip' | 'image';

export function stockRef(provider: StockProvider, kind: StockKind, id: string | number): string {
  return `${provider}:${kind === 'image' ? 'photo' : 'video'}:${String(id)}`;
}

/** Descompone una ref; devuelve null si no sigue el formato canónico. */
export function parseStockRef(
  ref: string,
): { provider: StockProvider; kind: StockKind; id: string } | null {
  const [provider, tipo, ...resto] = ref.split(':');
  const id = resto.join(':');
  if (id === '' || (provider !== 'pexels' && provider !== 'pixabay')) return null;
  if (tipo !== 'video' && tipo !== 'photo') return null;
  return { provider, kind: tipo === 'photo' ? 'image' : 'clip', id };
}
