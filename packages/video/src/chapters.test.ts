import { describe, expect, it } from 'vitest';
import type { Beat, Scene } from '@fabrica/shared';
import { makeDemoMaster } from '@fabrica/shared';
import {
  chaptersToText,
  computeChapters,
  formatChapterTime,
  mergeChaptersIntoDescription,
  segmentsToChapters,
} from './chapters';

function scene(id: string, section: Scene['section'], text: string): Scene {
  return { id, section, text, visual_query: 'q' };
}

function beat(idx: number, from_ms: number, to_ms: number, text: string): Beat {
  return { idx, from_ms, to_ms, text, visual_query: 'q', status: 'pending' };
}

describe('formatChapterTime', () => {
  it('formatea m:ss', () => {
    expect(formatChapterTime(0)).toBe('0:00');
    expect(formatChapterTime(11_000)).toBe('0:11');
    expect(formatChapterTime(71_400)).toBe('1:11');
    expect(formatChapterTime(615_000)).toBe('10:15');
  });

  it('no baja de cero', () => {
    expect(formatChapterTime(-500)).toBe('0:00');
  });
});

describe('computeChapters', () => {
  const scenes: Scene[] = [
    scene('s1', 'hook', 'En enero pasó algo grande con los modelos.'),
    scene('s2', 'body', 'Para entenderlo basta con mirar dos números clave.'),
    scene('s3', 'cta', 'Si te ha servido, suscríbete al canal.'),
  ];
  const beats: Beat[] = [
    beat(0, 0, 11_000, 'En enero pasó algo grande con los modelos.'),
    beat(1, 11_000, 23_500, 'Para entenderlo basta con mirar dos números clave. Uno explica todo.'),
    beat(2, 23_500, 33_500, 'El otro número explica el resto.'),
    beat(3, 33_500, 43_000, 'Si te ha servido, suscríbete al canal.'),
  ];

  it('deriva el inicio de cada sección del primer beat que la abre', () => {
    const chapters = computeChapters(scenes, beats);
    expect(chapters).toHaveLength(3);
    expect(chapters[0]).toMatchObject({ section: 'hook', start_ms: 0, label: '0:00' });
    expect(chapters[1]).toMatchObject({ section: 'body', start_ms: 11_000, label: '0:11' });
    expect(chapters[2]).toMatchObject({ section: 'cta', start_ms: 33_500, label: '0:33' });
  });

  it('el hook siempre empieza en 0:00 aunque el beat no arranque ahí', () => {
    const shifted = beats.map((b) =>
      b.idx === 0 ? { ...b, from_ms: 300 } : b,
    );
    const chapters = computeChapters(scenes, shifted);
    expect(chapters[0]?.start_ms).toBe(0);
  });

  it('ignora la puntuación y las mayúsculas al casar textos', () => {
    const noisy = beats.map((b) =>
      b.idx === 3 ? { ...b, text: '¡SI TE HA SERVIDO, suscríbete al canal!' } : b,
    );
    const chapters = computeChapters(scenes, noisy);
    expect(chapters.find((c) => c.section === 'cta')?.start_ms).toBe(33_500);
  });

  it('omite secciones sin beat que las abra y mantiene tiempos crecientes', () => {
    const chapters = computeChapters(
      scenes,
      beats.filter((b) => b.idx !== 3),
    );
    expect(chapters.map((c) => c.section)).toEqual(['hook', 'body']);
    expect(chapters.every((c, i, arr) => i === 0 || c.start_ms > (arr[i - 1]?.start_ms ?? 0))).toBe(
      true,
    );
  });

  it('funciona con el maestro de demo compartido', () => {
    const master = makeDemoMaster();
    const chapters = computeChapters(master.script?.scenes ?? [], master.beats ?? []);
    expect(chapters).toHaveLength(3);
    expect(chapters[0]?.label).toBe('0:00');
  });

  it('serializa a texto de descripción m:ss + título', () => {
    const text = chaptersToText(computeChapters(scenes, beats));
    expect(text).toBe('0:00 Introducción\n0:11 Desarrollo\n0:33 Cierre');
  });
});

describe('segmentsToChapters', () => {
  it('convierte segmentos en capítulos con 0:00 al inicio y tiempos crecientes', () => {
    const chapters = segmentsToChapters([
      { title: 'Qué es', beat_idx: 0, from_ms: 400 },
      { title: 'Arquitectura', beat_idx: 3, from_ms: 90_000 },
      { title: 'Cómo usarlo', beat_idx: 6, from_ms: 320_000 },
    ]);
    expect(chapters.map((c) => c.label)).toEqual(['0:00', '1:30', '5:20']);
    expect(chapters.map((c) => c.title)).toEqual(['Qué es', 'Arquitectura', 'Cómo usarlo']);
  });

  it('descarta segmentos que no crecen en el tiempo', () => {
    const chapters = segmentsToChapters([
      { title: 'A', beat_idx: 0, from_ms: 0 },
      { title: 'B', beat_idx: 1, from_ms: 0 },
    ]);
    expect(chapters).toHaveLength(1);
  });
});

describe('mergeChaptersIntoDescription', () => {
  const chapters = computeChapters(
    [
      scene('s1', 'hook', 'Arranque del vídeo con contexto.'),
      scene('s2', 'body', 'Cuerpo con los datos clave.'),
      scene('s3', 'cta', 'Cierre con la llamada final.'),
    ],
    [
      beat(0, 0, 10_000, 'Arranque del vídeo con contexto.'),
      beat(1, 10_000, 20_000, 'Cuerpo con los datos clave.'),
      beat(2, 20_000, 30_000, 'Cierre con la llamada final.'),
    ],
  );
  const real = '0:00 Introducción\n0:10 Desarrollo\n0:20 Cierre';

  it('sustituye el placeholder {timestamps}', () => {
    const out = mergeChaptersIntoDescription('Resumen.\n\nCapítulos:\n{timestamps}\n\nGracias.', chapters);
    expect(out).toBe(`Resumen.\n\nCapítulos:\n${real}\n\nGracias.`);
  });

  it('sustituye una lista literal de tiempos escrita por el LLM', () => {
    // gpt-5-mini a veces ignora el placeholder e inventa tiempos que pueden
    // exceder la duración real del vídeo
    const out = mergeChaptersIntoDescription(
      'Resumen. Capítulos:\n00:00 Intro\n02:20 Modelos\n10:50 Descarga\n\nGracias.',
      chapters,
    );
    expect(out).toBe(`Resumen. Capítulos:\n${real}\n\nGracias.`);
  });

  it('añade un bloque de capítulos si no hay placeholder ni lista', () => {
    const out = mergeChaptersIntoDescription('Solo un resumen.', chapters);
    expect(out).toBe(`Solo un resumen.\n\nCapítulos:\n${real}`);
  });

  it('sin capítulos reales deja la descripción intacta', () => {
    expect(mergeChaptersIntoDescription('Texto con {timestamps}.', [])).toBe(
      'Texto con {timestamps}.',
    );
  });
});
