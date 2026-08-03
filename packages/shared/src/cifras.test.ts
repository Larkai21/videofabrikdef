import { describe, expect, it } from 'vitest';
import { displayCifra, formatCifra, tokenCifra } from './cifras.js';

describe('displayCifra — lo que el espectador ve', () => {
  it('agrupa millares a partir de 5 dígitos, estilo español', () => {
    expect(displayCifra('17000')).toBe('17.000');
    expect(displayCifra('1000000')).toBe('1.000.000');
    expect(displayCifra('17000 libros')).toBe('17.000 libros');
  });

  it('deja en paz las cifras cortas y los porcentajes', () => {
    expect(displayCifra('9999')).toBe('9999');
    expect(displayCifra('25 %')).toBe('25 %');
    expect(displayCifra('70%')).toBe('70%');
  });

  it('re-agrupa una cifra que ya venía separada, en cualquier convención', () => {
    expect(displayCifra('17.000')).toBe('17.000');
    // grouping inglés («10,000»): tres dígitos tras la coma es millar, no decimal
    expect(displayCifra('10,000')).toBe('10.000');
  });

  it('conserva los decimales con su separador original', () => {
    // «1.2B» puede ser notación de la fuente: cambiar el punto por coma
    // alteraría la cita
    expect(displayCifra('$1.2B')).toBe('$1.2B');
    expect(displayCifra('12,5x')).toBe('12,5x');
  });

  it('sin token numérico devuelve el value intacto', () => {
    expect(displayCifra('sin cifra')).toBe('sin cifra');
  });
});

describe('tokenCifra + formatCifra — el count-up de StatCard', () => {
  it('anima un entero largo agrupando en cada paso', () => {
    const t = tokenCifra('17000')!;
    expect(t.target).toBe(17_000);
    expect(formatCifra(t.target * 0.5, t)).toBe('8500');
    expect(formatCifra(t.target, t)).toBe('17.000');
  });

  it('anima un decimal conservando la convención', () => {
    const t = tokenCifra('$1.2B')!;
    expect(t.target).toBeCloseTo(1.2);
    expect(t.decimales).toBe(1);
    expect(formatCifra(0.6, t)).toBe('0.6');
    const t2 = tokenCifra('12,5')!;
    expect(formatCifra(12.5, t2)).toBe('12,5');
  });
});
