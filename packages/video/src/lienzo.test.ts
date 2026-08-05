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

  // Los trazos de Annotation y MicroFx se generaban con estas coordenadas
  // escritas a mano. Los generadores de path no se han tocado, así que fijar
  // los anclajes equivale a fijar los `d=`: si estos números no se mueven, el
  // vídeo largo dibuja exactamente lo mismo que antes del refactor.
  it('los anclajes son los mismos números que estaban cableados', () => {
    expect(lienzoDe(VIDEO_WIDTH, VIDEO_HEIGHT).anclajes).toEqual({
      microFx: { cx: 1580, cy: 240 },
      circulo: { cx: 960, cy: 470, rx: 320, ry: 210 },
      subrayado: { x1: 620, x2: 1300, y: 650 },
      tachado: { x1: 620, x2: 1300, y: 520 },
      visto: { cx: 960, cy: 470, r: 190 },
      flecha: { x1: 560, y1: 820, x2: 900, y2: 540 },
      etiqueta: { subrayado: 500, flecha: 700, tachado: 380, otras: 210 },
    });
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

  // Trasladar los anclajes del apaisado por fracción los metería en la cartela
  // y al borde de la columna de acciones. En vertical los subtítulos se van al
  // 67 % del alto, así que la ventana limpia queda libre y es donde se lee.
  it('las marcas se centran en la ventana limpia', () => {
    const a = l.anclajes;
    const [ini, fin] = l.zonas.ventana;
    for (const y of [a.microFx.cy, a.circulo.cy, a.visto.cy, a.tachado.y]) {
      expect(y).toBeGreaterThan(ini);
      expect(y).toBeLessThan(fin);
    }
    expect(a.microFx.cx).toBe(Math.round(l.ancho / 2));
  });

  it('ninguna marca invade la columna de acciones', () => {
    const { x } = l.columnaAcciones!;
    for (const borde of [l.anclajes.subrayado.x2, l.anclajes.tachado.x2]) {
      expect(borde).toBeLessThan(x);
    }
  });
});

describe('fr', () => {
  it('convierte fracciones a píxeles del lienzo', () => {
    expect(lienzoDe(1920, 1080).fr(0.5, 0.5)).toEqual([960, 540]);
    expect(lienzoDe(1080, 1920).fr(0.5, 0.5)).toEqual([540, 960]);
  });
});
