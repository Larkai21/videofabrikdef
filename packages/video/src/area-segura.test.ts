import { describe, expect, it } from 'vitest';
import { anchoLibreCentrado, lienzoDe, scrimDeSubtitulos } from './lienzo';

// El modelo de la interfaz de la plataforma existía (columnaAcciones, bandas)
// pero nada lo aplicaba en render: el scrim se metía 110 px en la banda
// inferior y los subtítulos medían hasta x=984 con la columna empezando en
// x=950. Estos tests convierten el modelo en garantía.

const vertical = lienzoDe(1080, 1920);
const apaisado = lienzoDe(1920, 1080);

describe('scrimDeSubtitulos', () => {
  it('el scrim no entra en la banda que la plataforma tapa', () => {
    const rect = scrimDeSubtitulos(vertical.safe);
    // [top, bottom] del rect en coordenadas de pantalla
    const rectBottomPx = vertical.alto - rect.bottom;
    const bandaTopPx = vertical.alto - vertical.safe.bottom;
    expect(rectBottomPx).toBeLessThanOrEqual(bandaTopPx);
  });

  it('sigue cubriendo la zona de subtítulos entera', () => {
    const rect = scrimDeSubtitulos(vertical.safe);
    const [subIni, subFin] = vertical.zonas.subtitulos;
    const rectTopPx = vertical.alto - rect.bottom - rect.height;
    const rectBottomPx = vertical.alto - rect.bottom;
    expect(rectTopPx).toBeLessThanOrEqual(subIni);
    expect(rectBottomPx).toBeGreaterThanOrEqual(subFin);
  });
});

describe('anchoLibreCentrado', () => {
  it('en vertical, un elemento centrado a ese ancho no toca la columna de acciones', () => {
    const libre = anchoLibreCentrado(vertical);
    const bordeDerecho = vertical.ancho / 2 + libre / 2;
    expect(vertical.columnaAcciones).not.toBeNull();
    expect(bordeDerecho).toBeLessThanOrEqual(vertical.columnaAcciones!.x);
    // y es más estrecho que los márgenes tipográficos: la columna manda
    expect(libre).toBeLessThan(vertical.ancho - vertical.safe.left - vertical.safe.right);
  });

  it('en apaisado no hay columna y devuelve el ancho útil de siempre', () => {
    expect(anchoLibreCentrado(apaisado)).toBe(
      apaisado.ancho - apaisado.safe.left - apaisado.safe.right,
    );
  });
});
