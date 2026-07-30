import { describe, expect, it } from 'vitest';
import { EDIT_TYPES, SFX_NAMES } from './master-json.js';
import { MICRO_FX, MICRO_FX_IDS, microFxFor } from './micro-fx.js';

describe('microFxFor', () => {
  it('dispara con y sin tildes, y con mayúsculas o puntuación', () => {
    expect(microFxFor('jamás')?.id).toBe('tachado');
    expect(microFxFor('jamas')?.id).toBe('tachado');
    expect(microFxFor('NUNCA')?.id).toBe('tachado');
    expect(microFxFor('¿nunca?')?.id).toBe('tachado');
  });

  it('no casa dentro de otra palabra', () => {
    // se compara el token completo, así que no hacen falta límites de palabra
    expect(microFxFor('nota')).toBeNull();
    expect(microFxFor('escalada')).toBeNull();
  });

  it('devuelve null para una palabra corriente', () => {
    expect(microFxFor('modelo')).toBeNull();
    expect(microFxFor('')).toBeNull();
  });
});

describe('catálogo', () => {
  it('cada disparador pertenece a un solo efecto', () => {
    // la ambigüedad sería silenciosa: el Map se quedaría con el último y el
    // efecto perdido no daría ningún error
    const visto = new Map<string, string>();
    for (const def of MICRO_FX) {
      for (const t of def.triggers) {
        const previo = visto.get(t);
        expect(previo, `«${t}» está en ${previo} y en ${def.id}`).toBeUndefined();
        visto.set(t, def.id);
      }
    }
  });

  it('los disparadores ya están normalizados', () => {
    for (const def of MICRO_FX) {
      for (const t of def.triggers) {
        expect(t, `«${t}» en ${def.id}`).toMatch(/^[a-z0-9]+$/);
      }
    }
  });

  it('cada efecto apunta a un tipo y un sonido que existen', () => {
    for (const def of MICRO_FX) {
      expect(EDIT_TYPES).toContain(def.edit);
      expect(SFX_NAMES).toContain(def.sfx);
      expect(def.durationMs).toBeGreaterThan(0);
      expect(def.label.length).toBeGreaterThan(0);
    }
  });

  it('no hay ids duplicados y la lista cuadra con el enum', () => {
    const ids = MICRO_FX.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([...MICRO_FX_IDS].sort());
  });
});
