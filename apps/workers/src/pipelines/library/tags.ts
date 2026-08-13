// Construcción de tags a partir del caption VLM. La tokenización vive en
// @fabrica/shared (tags.ts) porque la API la necesita con el MISMO criterio
// para los nombres de fichero de las subidas; aquí queda el prompt (es del
// captioner, no del tokenizador) y la re-exportación que mantiene a los
// consumidores y al test de este módulo en su sitio.

export { mergeTags, tokensFromCaption } from '@fabrica/shared';

export const CAPTION_PROMPT =
  'Describe en una frase corta el contenido visual de esta imagen para indexarla como b-roll.';
