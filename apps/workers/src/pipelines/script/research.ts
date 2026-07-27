import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type pino from 'pino';
import { RESEARCH_MAX_CHARS_PER_SOURCE } from '@fabrica/shared';

const USER_AGENT = 'FabricaBot/0.1 (+contacto en README)';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_SOURCES = 5;

export interface SourceRef {
  url: string;
  title?: string;
  domain?: string;
}

export interface ResearchDoc extends SourceRef {
  text: string;
}

// Descarga las fuentes de la idea y extrae el texto con readability. Un fallo
// individual no rompe el research: la fuente entra sin texto. En modo mock no
// hay red: el pipeline entero debe correr sin conexión.
export async function downloadSources(
  logger: pino.Logger,
  refs: SourceRef[],
  skipNetwork: boolean,
): Promise<ResearchDoc[]> {
  const selected = refs.slice(0, MAX_SOURCES);
  if (skipNetwork) {
    logger.info({ fuentes: selected.length }, 'Modo mock: research sin descarga de fuentes');
    return selected.map((ref) => ({ ...ref, text: '' }));
  }
  const docs: ResearchDoc[] = [];
  for (const ref of selected) {
    try {
      const res = await fetch(ref.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'user-agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const dom = new JSDOM(html, { url: ref.url });
      const article = new Readability(dom.window.document).parse();
      const text = (article?.textContent ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, RESEARCH_MAX_CHARS_PER_SOURCE);
      docs.push({ ...ref, title: ref.title ?? article?.title ?? undefined, text });
    } catch (err) {
      logger.warn(
        { url: ref.url, err },
        'No se pudo descargar una fuente del research; se continúa sin su texto',
      );
      docs.push({ ...ref, text: '' });
    }
  }
  return docs;
}
