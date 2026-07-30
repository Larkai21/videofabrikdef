import { describe, expect, it } from 'vitest';
import { parseStockRef, stockRef } from './stock-ref.js';

describe('referencia canónica de stock', () => {
  it('construye el formato proveedor:tipo:id que usan la caché y assets.source_ref', () => {
    expect(stockRef('pexels', 'clip', 4443243)).toBe('pexels:video:4443243');
    expect(stockRef('pexels', 'image', '17489160')).toBe('pexels:photo:17489160');
    expect(stockRef('pixabay', 'clip', 3188)).toBe('pixabay:video:3188');
  });

  it('da la vuelta a lo que construye', () => {
    for (const [prov, kind, id] of [
      ['pexels', 'clip', '1'],
      ['pexels', 'image', '22'],
      ['pixabay', 'clip', '333'],
    ] as const) {
      expect(parseStockRef(stockRef(prov, kind, id))).toEqual({ provider: prov, kind, id });
    }
  });

  // Este es el test que importa: el formato viejo de la API (`pexels:123`) se
  // usaba sobre la MISMA tabla que el del worker, así que un clip elegido a
  // mano no deduplicaba contra el mismo clip ya ingerido.
  it('rechaza el formato antiguo sin tipo y cualquier cosa que no sea una ref', () => {
    expect(parseStockRef('pexels:4443243')).toBeNull();
    expect(parseStockRef('pixabay:3188')).toBeNull();
    expect(parseStockRef('library:abc')).toBeNull();
    expect(parseStockRef('flux:xyz')).toBeNull();
    expect(parseStockRef('pexels:video:')).toBeNull();
    expect(parseStockRef('')).toBeNull();
  });

  it('conserva ids con dos puntos en vez de partirlos', () => {
    expect(parseStockRef('pexels:video:a:b')).toEqual({
      provider: 'pexels',
      kind: 'clip',
      id: 'a:b',
    });
  });
});
