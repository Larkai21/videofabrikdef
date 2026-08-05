import { describe, expect, it } from 'vitest';
import { SHORT_HEIGHT, SHORT_WIDTH, VIDEO_HEIGHT, VIDEO_WIDTH } from '@fabrica/shared';
import { lienzoDe } from './lienzo.js';

describe('lienzoDe en apaisado', () => {
  // ESTE es el test que impide que el refactor mueva el vídeo largo: son los
  // mismos números que estaban cableados en Subtitles.tsx.
  it('devuelve el área segura de siempre', () => {
    expect(lienzoDe(VIDEO_WIDTH, VIDEO_HEIGHT).safe).toEqual({
      top: 90,
      right: 160,
      bottom: 120,
      left: 160,
    });
  });

  it('no declara columna de acciones', () => {
    expect(lienzoDe(VIDEO_WIDTH, VIDEO_HEIGHT).columnaAcciones).toBeNull();
    expect(lienzoDe(VIDEO_WIDTH, VIDEO_HEIGHT).vertical).toBe(false);
  });

  it('el viewBox es el del lienzo', () => {
    expect(lienzoDe(VIDEO_WIDTH, VIDEO_HEIGHT).viewBox).toBe('0 0 1920 1080');
  });
});

describe('lienzoDe en vertical', () => {
  const l = lienzoDe(SHORT_WIDTH, SHORT_HEIGHT);

  it('reserva las dos bandas de la plataforma, medidas y redondeadas hacia arriba', () => {
    // 12 % arriba y 24,5 % abajo sobre 1920
    expect(l.safe.top).toBe(230);
    expect(l.safe.bottom).toBe(470);
    expect(l.vertical).toBe(true);
  });

  it('las tres zonas cubren el lienzo sin huecos ni solapes', () => {
    const { cartela, ventana, subtitulos } = l.zonas;
    expect(cartela[0]).toBe(l.safe.top);
    expect(ventana[0]).toBe(cartela[1]);
    expect(subtitulos[0]).toBe(ventana[1]);
    expect(subtitulos[1]).toBe(l.alto - l.safe.bottom);
    // y ninguna es de altura negativa
    for (const z of [cartela, ventana, subtitulos]) expect(z[1]).toBeGreaterThan(z[0]);
  });

  it('los subtítulos NO viven pegados abajo', () => {
    // el fallo medido en el proyecto hermano: sus subtítulos caían 240 px
    // dentro de la banda de la interfaz
    expect(l.zonas.subtitulos[1]).toBeLessThan(l.alto - 400);
  });

  it('la columna de acciones es un rectángulo de la mitad inferior derecha', () => {
    expect(l.columnaAcciones).not.toBeNull();
    expect(l.columnaAcciones!.x).toBeGreaterThan(l.ancho * 0.8);
    expect(l.columnaAcciones!.y).toBeGreaterThan(l.alto * 0.5);
  });

  it('los márgenes laterales son tipográficos, no el ancho de la columna', () => {
    expect(l.safe.left).toBe(l.safe.right);
    expect(l.safe.right).toBeLessThan(l.columnaAcciones!.ancho);
  });
});

describe('fr', () => {
  it('convierte fracciones a píxeles del lienzo', () => {
    expect(lienzoDe(1920, 1080).fr(0.5, 0.5)).toEqual([960, 540]);
    expect(lienzoDe(1080, 1920).fr(0.5, 0.5)).toEqual([540, 960]);
  });
});
