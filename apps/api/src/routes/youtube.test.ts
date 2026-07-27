import { describe, expect, it } from 'vitest';
import { nextPublishSlot, signState, verifyState } from './youtube.js';

// Base local fija: 27 de julio de 2026 a las 10:30:45.500 (hora del servidor).
const BASE = new Date(2026, 6, 27, 10, 30, 45, 500);
const BASE_DAY = BASE.getDay();

describe('nextPublishSlot', () => {
  it('cae el mismo día si la hora aún no pasó', () => {
    const slot = nextPublishSlot({ weekday: BASE_DAY, hour: 17 }, BASE);
    expect(slot.getDay()).toBe(BASE_DAY);
    expect(slot.getDate()).toBe(BASE.getDate());
    expect(slot.getHours()).toBe(17);
    expect(slot.getMinutes()).toBe(0);
    expect(slot.getSeconds()).toBe(0);
    expect(slot.getMilliseconds()).toBe(0);
  });

  it('salta a la semana siguiente si la hora de hoy ya pasó', () => {
    const slot = nextPublishSlot({ weekday: BASE_DAY, hour: 9 }, BASE);
    expect(slot.getDay()).toBe(BASE_DAY);
    expect(slot.getTime() - new Date(2026, 6, 27, 9, 0, 0, 0).getTime()).toBe(
      7 * 24 * 3600 * 1000,
    );
  });

  it('un hueco exactamente en el instante actual salta a la semana siguiente', () => {
    const exact = new Date(2026, 6, 27, 17, 0, 0, 0);
    const slot = nextPublishSlot({ weekday: exact.getDay(), hour: 17 }, exact);
    expect(slot.getTime() - exact.getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it('cruza la semana hasta el día pedido', () => {
    const targetDay = (BASE_DAY + 3) % 7;
    const slot = nextPublishSlot({ weekday: targetDay, hour: 8 }, BASE);
    expect(slot.getDay()).toBe(targetDay);
    expect(slot.getHours()).toBe(8);
    const diffDays = Math.round((slot.getTime() - BASE.getTime()) / (24 * 3600 * 1000));
    expect(diffDays).toBe(3);
  });

  it('un día anterior de la semana cae en la semana siguiente', () => {
    const targetDay = (BASE_DAY + 6) % 7; // «ayer» en día de la semana
    const slot = nextPublishSlot({ weekday: targetDay, hour: 12 }, BASE);
    expect(slot.getDay()).toBe(targetDay);
    expect(slot.getTime()).toBeGreaterThan(BASE.getTime());
    const diffDays = Math.round((slot.getTime() - BASE.getTime()) / (24 * 3600 * 1000));
    expect(diffDays).toBe(6);
  });

  it('siempre devuelve un instante estrictamente futuro', () => {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      for (const hour of [0, 10, 23]) {
        const slot = nextPublishSlot({ weekday, hour }, BASE);
        expect(slot.getTime()).toBeGreaterThan(BASE.getTime());
        expect(slot.getDay()).toBe(weekday);
        expect(slot.getHours()).toBe(hour);
      }
    }
  });
});

describe('state firmado del OAuth', () => {
  it('firma y verifica el channelId', () => {
    const state = `canal-1.${signState('canal-1', 'secreto')}`;
    expect(verifyState(state, 'secreto')).toBe('canal-1');
  });

  it('rechaza una firma manipulada o de otro secreto', () => {
    const state = `canal-1.${signState('canal-1', 'otro-secreto')}`;
    expect(verifyState(state, 'secreto')).toBeNull();
    expect(verifyState('canal-1.abc', 'secreto')).toBeNull();
    expect(verifyState('sin-punto', 'secreto')).toBeNull();
  });
});
