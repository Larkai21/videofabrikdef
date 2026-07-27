import { describe, expect, it } from 'vitest';
import { hashSeed } from './seed';

describe('hashSeed', () => {
  it('es determinista para la misma entrada', () => {
    expect(hashSeed('vid-1:0')).toBe(hashSeed('vid-1:0'));
    expect(hashSeed('')).toBe(hashSeed(''));
  });

  it('devuelve enteros sin signo de 32 bits', () => {
    for (const input of ['a', 'vid-1:3', 'demo-video:12', 'ñandú']) {
      const value = hashSeed(input);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('distingue entradas distintas', () => {
    expect(hashSeed('vid-1:0')).not.toBe(hashSeed('vid-1:1'));
    expect(hashSeed('vid-1:0')).not.toBe(hashSeed('vid-2:0'));
  });

  it('coincide con valores FNV-1a conocidos', () => {
    // vectores de referencia de FNV-1a 32 bits
    expect(hashSeed('a')).toBe(0xe40c292c);
    expect(hashSeed('foobar')).toBe(0xbf9cf968);
  });
});
