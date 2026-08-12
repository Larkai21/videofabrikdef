import { describe, expect, it } from 'vitest';
import { lienzoDe } from '../lienzo';
import {
  CARTELA_FRAMES,
  CARTELA_INTERLINEA,
  CARTELA_PAD_Y,
  CARTELA_SALE_FRAME,
  cuerpoDeCartela,
} from './cuerpo';

// La contención se comprueba por aritmética, sin navegador: es el mismo trato
// que tienen los subtítulos con `cuerpoDeGrupo`. El titular era el texto más
// grande de la pieza y el único exento de cualquier guardia.

const lienzo = lienzoDe(1080, 1920);

describe('cuerpoDeCartela', () => {
  it('un título corto conserva el tamaño de siempre (5 % del ancho)', () => {
    expect(cuerpoDeCartela('Cifra que cambia todo', lienzo)).toBe(54);
  });

  it('el máximo del contrato (60 caracteres) cabe en ≤2 líneas dentro de la banda', () => {
    const titulo = 'x'.repeat(60);
    const cuerpo = cuerpoDeCartela(titulo, lienzo);
    expect(cuerpo).toBeLessThan(54);
    // reconstrucción de la aritmética: a ese cuerpo, el texto entra en 2
    // líneas y las 2 líneas caben en la banda con su padding
    const [ini, fin] = lienzo.zonas.cartela;
    const anchoUtil = lienzo.ancho - lienzo.safe.left - lienzo.safe.right - 52;
    const porLinea = Math.floor(anchoUtil / (0.55 * cuerpo));
    const lineas = Math.ceil(60 / porLinea);
    expect(lineas).toBeLessThanOrEqual(2);
    expect(lineas * cuerpo * CARTELA_INTERLINEA).toBeLessThanOrEqual(fin - ini - 2 * CARTELA_PAD_Y);
  });

  it('nunca baja del suelo de titular aunque el texto sea absurdo', () => {
    expect(cuerpoDeCartela('y'.repeat(200), lienzo)).toBeGreaterThanOrEqual(
      Math.round(lienzo.ancho * 0.033),
    );
  });

  it('la salida de la cartela deja sitio para el fotograma de portada', () => {
    // render/short.ts acota el thumb a CARTELA_SALE_FRAME − 10; si alguien
    // encoge la permanencia por debajo de ese margen, la portada sale vacía
    expect(CARTELA_SALE_FRAME - 10).toBeGreaterThan(0);
    expect(CARTELA_SALE_FRAME).toBeLessThan(CARTELA_FRAMES);
  });
});
