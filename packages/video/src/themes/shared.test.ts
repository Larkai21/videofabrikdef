import { describe, expect, it } from 'vitest';
import { fitTitleSize, initials, overlayWindows } from './shared';

describe('initials', () => {
  it('descarta los conectores en minúscula', () => {
    // sin el filtro «Señal y ruido» daría «SY», que no es el monograma de nadie
    expect(initials('Señal y ruido')).toBe('SR');
    expect(initials('Canal de ejemplo')).toBe('CE');
  });

  it('conserva las palabras cortas en mayúscula: siglas y artículos de marca', () => {
    // el artículo inicial suele ser parte del nombre («La Resistencia» → LR),
    // así que va en mayúscula y sobrevive al filtro; «de»/«y» no
    expect(initials('IA Weekly')).toBe('IW');
    expect(initials('La ciencia de lo raro')).toBe('LC');
  });

  it('con una sola palabra usa sus dos primeras letras', () => {
    expect(initials('Fábrica')).toBe('FÁ');
  });

  it('no se queda sin letras si todo son conectores', () => {
    expect(initials('y de')).toBe('YD');
    expect(initials('   ')).toBe('·');
    expect(initials('42 · 7')).toBe('·');
  });
});

describe('overlayWindows', () => {
  it('respeta las ventanas pedidas cuando caben holgadas', () => {
    expect(overlayWindows(90, 12, 14)).toEqual({ enterF: 12, exitF: 14 });
  });

  it('las escala si entrada + salida se comerían la tarjeta', () => {
    // brand-kit recorta la tarjeta de sección hasta 20 frames: sin escalar,
    // 12 + 14 = 26 > 20 y la pieza nunca llegaría a opacidad plena
    const { enterF, exitF } = overlayWindows(20, 12, 14);
    expect(enterF + exitF).toBeLessThanOrEqual(16);
    expect(enterF).toBeGreaterThan(0);
    expect(exitF).toBeGreaterThan(0);
  });

  it('sobrevive a duraciones degeneradas', () => {
    expect(overlayWindows(0)).toEqual({ enterF: 1, exitF: 1 });
    const uno = overlayWindows(1);
    expect(uno.enterF).toBeGreaterThan(0);
    expect(uno.exitF).toBeGreaterThan(0);
  });
});

describe('fitTitleSize', () => {
  it('acota el titular entre el mínimo y el máximo', () => {
    expect(fitTitleSize('IA')).toBe(92);
    expect(fitTitleSize('x'.repeat(200))).toBe(44);
  });

  it('encoge de forma monótona al crecer el nombre', () => {
    expect(fitTitleSize('Señal y ruido')).toBeGreaterThan(fitTitleSize('Señal y ruido en la era de la IA'));
  });
});
