import type { Beat, Scene, Segment } from '@fabrica/shared';

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
export function computeChapters(scenes: Scene[], beats: Beat[], offsetMs = 0): Chapter[] {
  const chapters: Chapter[] = [];
  for (const section of SECTION_ORDER) {
    const scene = scenes.find((s) => s.section === section);
    if (!scene) continue;
    const prefix = normalize(scene.text).split(' ').slice(0, 5).join(' ');
    let beat = prefix ? beats.find((b) => normalize(b.text).startsWith(prefix)) : undefined;
    if (!beat && prefix) beat = beats.find((b) => normalize(b.text).includes(prefix));
    let startMs: number;
    if (beat) {
      startMs = beat.from_ms + offsetMs;
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

// Capítulos a partir de los segmentos del director de capítulos: títulos
// reales de subtema. YouTube exige 0:00 y tiempos crecientes; los segmentos ya
// vienen ordenados y con el primero en 0.
//
// `offsetMs` es la INTRO. Los segmentos viven en el reloj del audio, pero el
// MP4 entregado antepone la intro de marca y desplaza todo el cuerpo: sin
// sumarla, cada capítulo apuntaba 3,2 s antes de su sección y el clic
// aterrizaba en la cola de la anterior (medido: «1:17» escrito, 1:20 real).
// El primer capítulo sigue en 0:00, que es lo que exige YouTube.
export function segmentsToChapters(segments: Segment[], offsetMs = 0): Chapter[] {
  const chapters: Chapter[] = [];
  for (const seg of segments) {
    const start = chapters.length === 0 ? 0 : seg.from_ms + offsetMs;
    const previous = chapters[chapters.length - 1];
    if (previous && start <= previous.start_ms) continue;
    chapters.push({
      section: 'body',
      start_ms: start,
      label: formatChapterTime(start),
      title: seg.title,
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

const HEADING = 'Capítulos:';

// Línea de tiempo de capítulo. La versión anterior exigía que la línea EMPEZARA
// por dígito, así que «- 0:00 Intro», «• 0:00 Intro» y «**0:00** Intro» no
// casaban: caían a la rama de «aquí no hay lista» y el merge anexaba una
// SEGUNDA cabecera debajo de la que el modelo ya había escrito.
const CHAPTER_LINE =
  /^\s*(?:[-–—*•·]\s*)?(?:\*\*|__)?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:\*\*|__)?\s*[-–—:]?\s+\S/;

// Cabecera sola en su línea, con o sin dos puntos, con viñeta, almohadilla,
// cita o negritas. Se acepta sin tilde y en mayúsculas.
const CHAPTER_HEADING_ONLY =
  /^\s*(?:[#>*\-•·]+\s*)?(?:\*\*|__)?\s*(?:cap[íi]tulos|chapters)\s*(?:\*\*|__)?\s*:?\s*$/i;

// Cabecera PEGADA al final de un párrafo («…y escalado. Capítulos:»), que es la
// forma que sale en los tres vídeos reales del repo. Los dos puntos son
// OBLIGATORIOS a propósito: sin ellos, una frase que acabe en «…tiene
// capítulos» se mutilaría.
const CHAPTER_HEADING_TAIL = /(?:^|\s)(?:\*\*|__)?(?:cap[íi]tulos|chapters)(?:\*\*|__)?\s*:\s*$/i;

// Deja una línea sin cabecera, sin placeholder y sin tiempos; '' si no queda nada.
function stripChapterMarks(line: string): string {
  if (CHAPTER_LINE.test(line)) return '';
  return line
    .replaceAll('{timestamps}', '')
    .replace(CHAPTER_HEADING_TAIL, '')
    .replace(CHAPTER_HEADING_ONLY, '')
    .trimEnd();
}

function tidy(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

// Fusiona los capítulos REALES (derivados del audio) en la descripción del LLM.
//
// El contrato original era «la descripción trae el placeholder {timestamps}»,
// pero de los tres vídeos producidos NINGUNO lo escribió: los tres escribieron
// la palabra «Capítulos:» pegada al final del párrafo, y uno de ellos además
// una segunda vez como cabecera. La implementación anterior sustituía las
// LÍNEAS de tiempo pero nunca tocaba las cabeceras, así que las conservaba
// todas —o añadía una tercera si la lista venía en viñetas—.
//
// Por eso aquí no hay ramas: se borra TODO rastro de capítulos (placeholder,
// cabeceras en cualquier forma y listas de tiempos) y se reconstruye
// «prosa + una sola cabecera + el bloque real + la cola» (la cola es donde vive
// la línea de transparencia sobre el uso de IA). El placeholder se sigue
// aceptando aunque el prompt ya no lo pida: hay maestros guardados que lo traen.
export function mergeChaptersIntoDescription(description: string, chapters: Chapter[]): string {
  const block = chaptersToText(chapters);
  if (block === '') return description;
  const lines = description.split('\n');
  // la zona de capítulos empieza en el PRIMER indicio, sea el que sea
  const zone = lines.findIndex(
    (l) =>
      l.includes('{timestamps}') ||
      CHAPTER_LINE.test(l) ||
      CHAPTER_HEADING_ONLY.test(l) ||
      CHAPTER_HEADING_TAIL.test(l),
  );
  const cleaned = lines.map(stripChapterMarks);
  const before = tidy(zone === -1 ? cleaned.join('\n') : cleaned.slice(0, zone + 1).join('\n'));
  const after = zone === -1 ? '' : tidy(cleaned.slice(zone + 1).join('\n'));
  return [before, `${HEADING}\n${block}`, after].filter((part) => part !== '').join('\n\n');
}
