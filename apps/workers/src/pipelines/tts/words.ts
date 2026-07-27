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
  // estado de un token del guion partido por el TTS en varios boundaries:
  // se acumulan fragmentos y el token se emite UNA sola vez al completarse
  let partial = '';
  let fragFromMs = 0;
  let fragToMs = 0;

  const push = (raw: string, from_ms: number, to_ms: number) => {
    out.push({
      from_ms,
      to_ms,
      raw,
      sentenceEnd: SENTENCE_END_RE.test(raw),
      clauseEnd: CLAUSE_END_RE.test(raw),
      sceneIdx,
    });
  };

  for (const word of words) {
    if (!word) continue;
    const nw = norm(word.text);
    const wFrom = offsetMs + word.offset_ms;
    const wTo = wFrom + word.duration_ms;
    let handled = false;

    while (!handled) {
      if (j >= tokens.length) {
        push(word.text, wFrom, wTo);
        handled = true;
        break;
      }
      const token = tokens[j] ?? '';
      const nt = norm(token);
      const candidate = partial + nw;

      if (nt === candidate) {
        // token completo (con o sin fragmentos previos)
        push(token, partial ? fragFromMs : wFrom, wTo);
        j++;
        partial = '';
        handled = true;
      } else if (nt.startsWith(candidate)) {
        // fragmento intermedio: acumular sin emitir todavía
        if (!partial) fragFromMs = wFrom;
        fragToMs = wTo;
        partial = candidate;
        handled = true;
      } else if (partial) {
        // desalineación dentro de un token partido: cerrar el token con lo
        // acumulado y reevaluar esta palabra contra el token siguiente
        push(token, fragFromMs, fragToMs);
        j++;
        partial = '';
      } else if (nt.length > 0 && nw.includes(nt)) {
        // el TTS unió varios tokens en una palabra: consumir mientras quepan
        let raw = token;
        let acc = nt;
        j++;
        while (j < tokens.length && acc.length < nw.length) {
          const next = norm(tokens[j] ?? '');
          if (!nw.startsWith(acc + next) && acc + next !== nw) break;
          acc += next;
          raw += ` ${tokens[j]}`;
          j++;
        }
        push(raw, wFrom, wTo);
        handled = true;
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
          push(tokens[found] ?? word.text, wFrom, wTo);
          j = found + 1;
        } else {
          push(word.text, wFrom, wTo);
        }
        handled = true;
      }
    }
  }

  // último token partido sin cerrar (la lista de palabras terminó a mitad)
  if (partial && j < tokens.length) {
    push(tokens[j] ?? partial, fragFromMs, Math.max(fragFromMs + 1, fragToMs));
    j++;
    partial = '';
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
