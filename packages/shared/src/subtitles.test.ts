import { describe, expect, it } from 'vitest';
import { cuesToSrt, cuesToVtt } from './subtitles.js';

const cues = [
  { from_ms: 0, to_ms: 2_400, text: 'Hola, esto es una prueba' },
  { from_ms: 2_600, to_ms: 3_661_500, text: 'de subtítulos\nen dos líneas' },
];

describe('cuesToSrt', () => {
  it('numera, formatea HH:MM:SS,mmm y separa bloques con línea en blanco', () => {
    const srt = cuesToSrt(cues);
    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:02,400\nHola, esto es una prueba\n\n' +
        '2\n00:00:02,600 --> 01:01:01,500\nde subtítulos\nen dos líneas\n',
    );
  });

  it('re-basa al MP4 con el offset de la intro, igual que los capítulos', () => {
    // la intro de marca antepone 3,2 s: sin este offset el subtítulo entra
    // 3 s antes de que se oiga la voz — el mismo bug medido en los capítulos
    const srt = cuesToSrt(cues, 3_200);
    expect(srt).toContain('00:00:03,200 --> 00:00:05,600');
  });
});

describe('cuesToVtt', () => {
  it('emite cabecera WEBVTT y tiempos con punto decimal', () => {
    const vtt = cuesToVtt(cues, 3_200);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:03.200 --> 00:00:05.600');
    expect(vtt.endsWith('\n')).toBe(true);
  });
});
