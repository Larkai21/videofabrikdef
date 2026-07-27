// Score de candidatos de stock (docs/assets-y-biblioteca.md §3):
// score = 0,6·cos + 0,2·calidad + 0,2·novedad. Lógica pura.

export interface StockScoreInput {
  cosine: number;
  width: number;
  height: number;
  durationMs: number | null;
  beatDurationMs: number;
  isImage: boolean;
  usedRecently: boolean;
}

export function stockScore(input: StockScoreInput): number {
  // calidad: mitad por resolución ≥1080p, mitad por cubrir la duración del beat
  // (una imagen siempre cubre: Ken Burns no depende de la duración)
  const resolutionOk = input.height >= 1080 ? 0.5 : 0;
  const durationOk = input.isImage || (input.durationMs ?? 0) >= input.beatDurationMs ? 0.5 : 0;
  const quality = resolutionOk + durationOk;
  const novelty = input.usedRecently ? 0 : 1;
  return 0.6 * input.cosine + 0.2 * quality + 0.2 * novelty;
}

const STOPWORDS = new Set([
  'the',
  'and',
  'with',
  'for',
  'that',
  'this',
  'una',
  'unos',
  'unas',
  'los',
  'las',
  'del',
  'que',
  'con',
  'por',
  'para',
  'como',
  'más',
  'pero',
  'sus',
  'este',
  'esta',
  'sin',
  'sobre',
  'entre',
  'cuando',
  'todo',
  'también',
]);

// Si la visual_query es corta, se enriquece con palabras clave del texto del
// beat para que el embedding tenga señal suficiente.
export function expandQuery(visualQuery: string, beatText: string): string {
  const queryTokens = visualQuery.split(/\s+/).filter(Boolean);
  if (queryTokens.length >= 4) return visualQuery;

  const keywords: string[] = [];
  const seen = new Set(queryTokens.map((t) => t.toLowerCase()));
  for (const raw of beatText.split(/\s+/)) {
    const token = raw
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]/gu, '');
    if (token.length < 4 || STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    keywords.push(token);
    if (keywords.length >= 4) break;
  }
  return keywords.length > 0 ? `${visualQuery} ${keywords.join(' ')}` : visualQuery;
}
