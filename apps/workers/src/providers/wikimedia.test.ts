import { describe, expect, it } from 'vitest';
import { parsePage, SIN_ATRIBUCION } from './wikimedia.js';

function page(over: {
  license?: string;
  artist?: string;
  width?: number;
  mime?: string;
  description?: string;
}) {
  return {
    pageid: 123,
    title: 'File:NVIDIA Jalapeño die shot.jpg',
    imageinfo: [
      {
        url: 'https://upload.wikimedia.org/original.jpg',
        thumburl: 'https://upload.wikimedia.org/1280px-thumb.jpg',
        width: over.width ?? 2400,
        height: 1600,
        mime: over.mime ?? 'image/jpeg',
        extmetadata: {
          LicenseShortName: { value: over.license ?? 'CC BY-SA 4.0' },
          Artist: { value: over.artist ?? '<a href="/wiki/User:X">Ada Fotógrafa</a>' },
          ...(over.description !== undefined
            ? { ImageDescription: { value: over.description } }
            : {}),
        },
      },
    ],
  };
}

describe('parsePage — el filtro de licencias que protege al canal', () => {
  it('acepta CC BY-SA y construye la atribución sin HTML', () => {
    const r = parsePage(page({}));
    expect(r).not.toBeNull();
    expect(r!.ref).toBe('wikimedia:image:123');
    expect(r!.meta.license).toBe('CC BY-SA 4.0');
    expect(r!.meta.credit).toBe('Ada Fotógrafa, CC BY-SA 4.0, via Wikimedia Commons');
    expect(r!.meta.title).toBe('NVIDIA Jalapeño die shot');
    // el download es el thumb a 1280, no el original (puede ser un TIFF enorme)
    expect(r!.meta.download_url).toContain('1280px');
  });

  it('rechaza NC y ND aunque la imagen fuera perfecta', () => {
    expect(parsePage(page({ license: 'CC BY-NC 4.0' }))).toBeNull();
    expect(parsePage(page({ license: 'CC BY-ND 4.0' }))).toBeNull();
  });

  it('PD y CC0 pasan sin exigir atribución', () => {
    const pd = parsePage(page({ license: 'Public domain' }));
    expect(pd).not.toBeNull();
    expect(pd!.meta.credit).toBe('');
    const cc0 = parsePage(page({ license: 'CC0' }));
    expect(cc0!.meta.credit).toBe('');
  });

  it('rechaza imágenes pequeñas y mimes raros', () => {
    expect(parsePage(page({ width: 320 }))).toBeNull();
    expect(parsePage(page({ mime: 'image/tiff' }))).toBeNull();
  });

  it('limpia el HTML de la descripción y la corta', () => {
    const r = parsePage(page({ description: '<b>Die shot</b> of the <i>chip</i>' }));
    expect(r!.meta.caption).toBe('Die shot of the chip');
  });
});

describe('SIN_ATRIBUCION', () => {
  // La red de b-roll de searchStock solo admite licencias sin crédito exigible:
  // assets no guarda atribución y llevarla a description.txt es plomería que no
  // compensa (mismo criterio por el que se descartó Coverr). Los insertos
  // siguen con el rango completo: su crédito se pinta en el propio recuadro.
  it('deja pasar PD y CC0', () => {
    for (const l of ['Public domain', 'PD', 'CC0', 'CC0 1.0']) {
      expect(SIN_ATRIBUCION.test(l), l).toBe(true);
    }
  });

  it('frena todo CC BY: exige crédito', () => {
    for (const l of ['CC BY 4.0', 'CC BY-SA 4.0', 'CC BY-SA 3.0']) {
      expect(SIN_ATRIBUCION.test(l), l).toBe(false);
    }
  });
});
