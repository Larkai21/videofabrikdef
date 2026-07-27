// Alineación de WordBoundaries del TTS con el texto original de la escena.
// El TTS devuelve palabras sin puntuación; aquí se recupera el token original
// (con puntuación) para poder detectar finales de frase y de cláusula, que son
// la materia prima de cues y beats. Lógica pura, sin I/O.

export interface TimedWord {
  offset_ms: number;
  duration_ms: number;
  text: string;
}

export interface TimedToken {
  from_ms: number;
  to_ms: number;
  // token original del guion, con puntuación
  raw: string;
  sentenceEnd: boolean;
  clauseEnd: boolean;
  sceneIdx: number;
}

const SENTENCE_END_RE = /[.!?…]["')\]»]*$/;
const CLAUSE_END_RE = /[,;:]["')\]»]*$/;

const CONJUNCTIONS = new Set([
  'y',
  'e',
  'o',
  'u',
  'ni',
  'pero',
  'sino',
  'porque',
  'aunque',
  'cuando',
  'mientras',
  'and',
  'or',
  'but',
  'because',
  'while',
  'so',
]);

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// Alinea las palabras temporizadas del TTS con los tokens del texto original.
// Estrategia secuencial tolerante: si el TTS divide o une tokens, se consumen
// los tokens originales cuyo contenido solape con la palabra del TTS.
export function alignSceneTokens(
  sceneText: string,
  words: TimedWord[],
  sceneIdx: number,
  offsetMs: number,
): TimedToken[] {
  const tokens = sceneText.split(/\s+/).filter(Boolean);
  const out: TimedToken[] = [];
  let j = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    const nw = norm(word.text);
    let raw = word.text;

    if (j < tokens.length) {
      const nt = norm(tokens[j] ?? '');
      if (nt === nw || nt.includes(nw) || nw.includes(nt)) {
        raw = tokens[j] ?? raw;
        // el TTS puede unir varios tokens en una palabra: consumir mientras quepan
        let acc = nt;
        j++;
        while (j < tokens.length && acc.length < nw.length) {
          const next = norm(tokens[j] ?? '');
          if (!nw.startsWith(acc + next) && acc + next !== nw) break;
          acc += next;
          raw += ` ${tokens[j]}`;
          j++;
        }
      } else {
        // desalineación puntual: buscar el token en una ventana corta
        let found = -1;
        for (let k = j; k < Math.min(tokens.length, j + 3); k++) {
          const cand = norm(tokens[k] ?? '');
          if (cand === nw || cand.includes(nw) || (nw.length > 2 && nw.includes(cand))) {
            found = k;
            break;
          }
        }
        if (found >= 0) {
          raw = tokens[found] ?? raw;
          j = found + 1;
        }
      }
    }

    out.push({
      from_ms: offsetMs + word.offset_ms,
      to_ms: offsetMs + word.offset_ms + word.duration_ms,
      raw,
      sentenceEnd: SENTENCE_END_RE.test(raw),
      clauseEnd: CLAUSE_END_RE.test(raw),
      sceneIdx,
    });
  }

  // cada escena cierra frase aunque el guion no acabe en puntuación
  const last = out[out.length - 1];
  if (last) last.sentenceEnd = true;

  // cláusula también si la palabra siguiente es conjunción (corte antes de ella)
  for (let i = 0; i < out.length - 1; i++) {
    const cur = out[i];
    const next = out[i + 1];
    if (cur && next && !cur.clauseEnd && CONJUNCTIONS.has(norm(next.raw))) {
      cur.clauseEnd = true;
    }
  }

  return out;
}
