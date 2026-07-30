import { describe, expect, it } from 'vitest';
import { tituloDesdeUrlPexels } from './stock.js';

// La API de vídeo de Pexels no devuelve `alt` ni `tags`: lo único descriptivo
// es el slug de la URL. Antes se usaba el NOMBRE DEL FOTÓGRAFO como título, y
// con ese texto se decidía a qué candidatos pagarles una descripción VLM, así
// que los que acababan descritos salían prácticamente al azar.
describe('tituloDesdeUrlPexels', () => {
  it('saca la descripción del slug', () => {
    expect(
      tituloDesdeUrlPexels(
        'https://www.pexels.com/video/a-person-using-a-magnifying-glass-on-a-bible-6970650/',
        'Gabe Hollis',
      ),
    ).toBe('a person using a magnifying glass on a bible');
    expect(
      tituloDesdeUrlPexels(
        'https://www.pexels.com/video/type-writer-in-a-magnifying-glass-6980927',
        'x',
      ),
    ).toBe('type writer in a magnifying glass');
  });

  it('cae al nombre del autor solo si la URL no sirve', () => {
    expect(tituloDesdeUrlPexels('', 'Polina Tankilevitch')).toBe('Polina Tankilevitch');
    expect(tituloDesdeUrlPexels('https://www.pexels.com/photo/algo-123/', 'Autor')).toBe('Autor');
    expect(tituloDesdeUrlPexels('https://www.pexels.com/video/123/', 'Autor')).toBe('Autor');
  });
});
