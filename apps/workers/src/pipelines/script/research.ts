import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type pino from 'pino';
import { RESEARCH_MAX_CHARS_PER_SOURCE } from '@fabrica/shared';

const USER_AGENT = 'FabricaBot/0.1 (+contacto en README)';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_SOURCES = 5;
// tope de bytes por fuente: un HTML de research no legítimo no debe poder
// agotar la memoria del worker
const MAX_FETCH_BYTES = 5 * 1024 * 1024;

async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Respuesta truncada: supera ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

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
      const parsedUrl = new URL(ref.url);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error(`Protocolo no permitido: ${parsedUrl.protocol}`);
      }
      const res = await fetch(ref.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'user-agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > MAX_FETCH_BYTES) throw new Error(`Respuesta de ${declared} bytes rechazada`);
      const html = await readBodyCapped(res, MAX_FETCH_BYTES);
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
