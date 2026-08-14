import { describe, expect, it } from 'vitest';
import { parseNasaDuration, pickNasaFile, tituloDesdeUrlPexels } from './stock.js';

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

// La búsqueda de NASA no trae duración ni URL de mp4: se resuelven con
// metadata.json y collection.json por candidato. Estos dos parsers son la
// frontera con ese formato (exiftool + lista de variantes).
describe('parseNasaDuration', () => {
  it('entiende H:MM:SS, MM:SS y segundos a pelo', () => {
    expect(parseNasaDuration('0:03:39')).toBe(219_000);
    expect(parseNasaDuration('03:39')).toBe(219_000);
    expect(parseNasaDuration('12.5 s')).toBe(12_500);
    expect(parseNasaDuration(42)).toBe(42_000);
  });
  it('rechaza lo que no es una duración', () => {
    expect(parseNasaDuration('')).toBeNull();
    expect(parseNasaDuration(undefined)).toBeNull();
    expect(parseNasaDuration('n/a')).toBeNull();
    expect(parseNasaDuration('0:00:00')).toBeNull();
  });
});

describe('pickNasaFile', () => {
  const base = 'http://images-assets.nasa.gov/video/x/x';
  it('prefiere large sobre medium y orig, y pasa a https', () => {
    const url = pickNasaFile([
      `${base}~orig.mp4`,
      `${base}.srt`,
      `${base}~large.mp4`,
      `${base}~medium.mp4`,
    ]);
    expect(url).toBe(`${base.replace('http://', 'https://')}~large.mp4`);
  });
  it('cae a medium, luego a orig, y null sin mp4', () => {
    expect(pickNasaFile([`${base}~medium.mp4`, `${base}~orig.mp4`])).toContain('~medium.mp4');
    expect(pickNasaFile([`${base}~orig.mp4`])).toContain('~orig.mp4');
    expect(pickNasaFile([`${base}.srt`, `${base}.jpg`])).toBeNull();
  });
});
