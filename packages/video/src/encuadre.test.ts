import { describe, expect, it } from 'vitest';
import { SHORT_HEIGHT, SHORT_WIDTH, VIDEO_HEIGHT, VIDEO_WIDTH } from '@fabrica/shared';
import { FOCO_POR_DEFECTO, movimientoDe, planDeEncuadre } from './encuadre.js';
import { lienzoDe } from './lienzo.js';

const APAISADO = lienzoDe(VIDEO_WIDTH, VIDEO_HEIGHT);
const VERTICAL = lienzoDe(SHORT_WIDTH, SHORT_HEIGHT);

describe('planDeEncuadre', () => {
  // El vídeo largo no puede notar nada de esto.
  it('en apaisado es el cover de siempre, sea cual sea el encuadre', () => {
    for (const e of ['recorte', 'cover', 'entero', undefined] as const) {
      const plan = planDeEncuadre(e, APAISADO);
      expect(plan.estilo).toEqual({ width: '100%', height: '100%', objectFit: 'cover' });
      expect(plan.conLosa).toBe(false);
      expect(plan.estilo.objectPosition).toBeUndefined();
    }
  });

  it('en vertical la norma es recortar anclado al foco', () => {
    const plan = planDeEncuadre('recorte', VERTICAL);
    expect(plan.estilo.objectFit).toBe('cover');
    expect(plan.estilo.objectPosition).toBe('50.0% 42.0%');
    expect(plan.conLosa).toBe(false);
  });

  it('un asset ya vertical llena el lienzo sin anclaje', () => {
    const plan = planDeEncuadre('cover', VERTICAL);
    expect(plan.estilo.objectFit).toBe('cover');
    expect(plan.estilo.objectPosition).toBeUndefined();
  });

  it('lo que no admite recorte se ve entero y pide vestir el hueco', () => {
    const plan = planDeEncuadre('entero', VERTICAL);
    expect(plan.estilo.objectFit).toBe('contain');
    expect(plan.conLosa).toBe(true);
  });

  it('un encuadre ausente cae a la norma', () => {
    expect(planDeEncuadre(undefined, VERTICAL).estilo.objectPosition).toBe('50.0% 42.0%');
  });

  it('el foco se puede mover', () => {
    const plan = planDeEncuadre('recorte', VERTICAL, { x: 0.3, y: 0.25 });
    expect(plan.estilo.objectPosition).toBe('30.0% 25.0%');
  });

  it('el foco por defecto no es el centro geométrico', () => {
    expect(FOCO_POR_DEFECTO.y).toBeLessThan(0.5);
  });
});

describe('movimientoDe', () => {
  it('en apaisado conserva los ocho ejes y los números de siempre', () => {
    const m = movimientoDe(APAISADO, false);
    expect(m.direcciones).toHaveLength(8);
    expect(m.paneo).toBe(2);
    expect(m.zoom).toBe(0.08);
  });

  // Un 16:9 a cover sobre 1080x1920 se renderiza a 3413x1920: sobra ancho y no
  // sobra alto. Panear en vertical descubriría borde.
  it('en vertical panea solo en horizontal', () => {
    const m = movimientoDe(VERTICAL, false);
    for (const [, dy] of m.direcciones) expect(dy).toBe(0);
  });

  it('en vertical el paneo es un travelling y el zoom baja', () => {
    const m = movimientoDe(VERTICAL, false);
    const apaisado = movimientoDe(APAISADO, false);
    expect(m.paneo).toBeGreaterThan(apaisado.paneo * 3);
    expect(m.zoom).toBeLessThan(apaisado.zoom);
  });

  // Con la Losa el plano se ve ENTERO, así que no hay holgura que panear.
  it('con losa vuelve al movimiento conservador', () => {
    expect(movimientoDe(VERTICAL, true).paneo).toBe(2);
    expect(movimientoDe(VERTICAL, true).deriva).toBe(0);
  });

  // Los clips no llevan Ken Burns sino un zoom lento; en apaisado derivar
  // descubriría borde, en vertical sobra ancho para un travelling.
  it('los clips solo derivan en vertical', () => {
    expect(movimientoDe(APAISADO, false).deriva).toBe(0);
    expect(movimientoDe(VERTICAL, false).deriva).toBeGreaterThan(0);
  });
});
