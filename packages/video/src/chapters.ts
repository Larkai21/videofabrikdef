import type { Beat, Scene } from '@fabrica/shared';

// Capítulos de YouTube derivados de escenas↔beats: el inicio de cada sección
// (hook/body/cta) es el from_ms del primer beat cuyo texto abre esa sección.
// Módulo puro sin React: el worker de render lo importa vía
// `@fabrica/video/chapters` para rellenar {timestamps} en description.txt.

export interface Chapter {
  section: Scene['section'];
  start_ms: number;
  label: string;
  title: string;
}

const SECTION_TITLES: Record<Scene['section'], string> = {
  hook: 'Introducción',
  body: 'Desarrollo',
  cta: 'Cierre',
};

const SECTION_ORDER: Scene['section'][] = ['hook', 'body', 'cta'];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// YouTube exige que el primer capítulo empiece en 0:00 y que los tiempos
// crezcan de forma estricta; se descartan secciones que rompan el orden.
export function computeChapters(scenes: Scene[], beats: Beat[]): Chapter[] {
  const chapters: Chapter[] = [];
  for (const section of SECTION_ORDER) {
    const scene = scenes.find((s) => s.section === section);
    if (!scene) continue;
    const prefix = normalize(scene.text).split(' ').slice(0, 5).join(' ');
    let beat = prefix
      ? beats.find((b) => normalize(b.text).startsWith(prefix))
      : undefined;
    if (!beat && prefix) beat = beats.find((b) => normalize(b.text).includes(prefix));
    let startMs: number;
    if (beat) {
      startMs = beat.from_ms;
    } else if (section === 'hook') {
      startMs = 0;
    } else {
      continue;
    }
    if (section === 'hook') startMs = 0;
    const previous = chapters[chapters.length - 1];
    if (previous && startMs <= previous.start_ms) continue;
    chapters.push({
      section,
      start_ms: startMs,
      label: formatChapterTime(startMs),
      title: SECTION_TITLES[section],
    });
  }
  return chapters;
}

// Formato m:ss (minutos sin cero a la izquierda, segundos con dos cifras).
export function formatChapterTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function chaptersToText(chapters: Chapter[]): string {
  return chapters.map((c) => `${c.label} ${c.title}`).join('\n');
}
