import { z } from 'zod';

// Intención visual DECLARADA por el guionista dentro de la escena que escribe.
//
// El problema que resuelve: antes, el director de edición releía la narración ya
// hablada e inventaba el texto de la tarjeta; luego buscaba esa palabra en los
// cues para anclarla y, si no la encontraba, el efecto caía al inicio del beat
// sin avisar. La desincronización era el síntoma de que el texto no era literal.
//
// La inversión: el guionista declara `trigger_word` como una palabra que ÉL
// MISMO acaba de escribir en el `text` de esa escena, así que el anclaje no
// puede fallar por construcción. Y si aun así no resuelve, el efecto se
// descarta en vez de colocarse mal.

/**
 * Normalización canónica de una palabra para compararla con otra.
 *
 * Vive aquí y no en cada módulo porque estaba duplicada en cinco sitios con dos
 * criterios distintos (`\p{L}` en unos, `[a-z0-9]` en otro), así que «año»
 * normalizaba diferente según quién preguntara.
 *
 * NFKD + descarte de los diacríticos combinantes: Whisper transcribe unas veces
 * con tilde y otras sin ella, y el guionista escribe siempre con tilde.
 */
export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Los tokens con contenido de un texto, ya normalizados. */
function tokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeWord)
    .filter((t) => t.length > 0);
}

/**
 * ¿Dónde empieza `needle` dentro de `haystack`, como secuencia de tokens
 * COMPLETOS? -1 si no está.
 *
 * La secuencia importa: el contrato deja 40 caracteres a `trigger_word` y el
 * guionista escribe «cadena de custodia» o «2 de agosto» con la misma
 * naturalidad que escribe «sanciones». Comparando token a token, esas nunca
 * casaban: el efecto se descartaba aunque la frase estuviera literal en la
 * escena. Medido sobre las 5.594 intenciones del banco: 503 se caían por
 * `trigger_ausente` y 280 de ellas —el 56 %— tenían su frase entera en el
 * texto. Era el matcher, no el guionista.
 */
export function findTokenRun(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  for (let i = 0; i <= haystack.length - needle.length; i += 1) {
    if (needle.every((n, k) => haystack[i + k] === n)) return i;
  }
  return -1;
}

/** ¿`word` (palabra o frase) aparece como secuencia de tokens completos en `text`? */
export function wordInText(text: string, word: string): boolean {
  const needle = tokens(word);
  if (needle.length === 0) return false;
  return findTokenRun(tokens(text), needle) >= 0;
}

// Magnitudes escritas con letra. La narración dice «dos millones» y la tarjeta
// muestra «2000000»: sin esto, validar la cifra contra el research daría falsos
// negativos constantes.
const MAGNITUDES: Record<string, number> = {
  mil: 1e3,
  k: 1e3,
  millon: 1e6,
  millones: 1e6,
  m: 1e6,
  billon: 1e9,
  billones: 1e9,
  b: 1e9,
};

/** Cifras de un texto, normalizadas a dígitos: «2 millones» → ['2','2000000']. */
export function numericTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(\d[\d.,]*)\s*(\p{L}+)?/gu)) {
    const bare = (m[1] ?? '').replace(/\D/g, '');
    if (bare === '') continue;
    out.push(bare);
    const mag = MAGNITUDES[normalizeWord(m[2] ?? '')];
    if (mag !== undefined) out.push(String(Number(bare) * mag));
  }
  return out;
}

/** ¿La cifra `value` está respaldada por alguno de estos textos? */
export function figureBackedBy(value: string, sources: readonly string[]): boolean {
  const wanted = new Set(numericTokens(value));
  if (wanted.size === 0) return false;
  return sources.some((s) => numericTokens(s).some((t) => wanted.has(t)));
}

// ---- la declaración del guionista ------------------------------------------

// Vocabulario SEMÁNTICO, no los EDIT_TYPES del render: «stat» no elige entre
// stat_card y stat_odometer (eso lo decide el número de dígitos, en código) y el
// guionista no puede equivocarse en algo que es determinista.
export const INTENT_EFFECTS = [
  'callout', // → text_callout
  'stat', // → stat_card | stat_odometer
  'quote', // → quote_card
  'kinetic', // → kinetic_text (solo en el gancho)
  'keyword', // → keyword_highlight
  'annotation', // → annotation
  'device', // → device_frame
  // Los tres siguientes salen del catálogo de motion graphics y existen por un
  // motivo editorial concreto, no por tener más efectos: son las tres formas en
  // que un guion de este nicho se pone a ENUMERAR, y enumerar en voz alta es lo
  // que produce los rótulos que costó todo un sprint quitar. Si la lista se
  // dibuja, la narración puede dejar de recitarla.
  'comparacion', // → split_versus · dos cosas enfrentadas (antes/ahora, A/B)
  'pasos', // → pasos_flow · un proceso de 2 a 4 estaciones
  'tendencia', // → tendencia · una cifra que se dispara o se hunde
  // imagen REAL de referencia cuando la narración nombra una entidad concreta
  // (producto, empresa, modelo). trigger_word = el nombre tal cual se dice;
  // card_text = término de búsqueda si el nombre a secas es ambiguo. La imagen
  // se resuelve en workers (foto de stock → Wikimedia Commons) y el juez de
  // planos la veta: mejor sin inserto que con el logo equivocado.
  'inserto', // → imagen_apoyo
] as const;
export const intentEffectSchema = z.enum(INTENT_EFFECTS);
export type IntentEffect = z.infer<typeof intentEffectSchema>;

export const MAX_INTENTS_PER_SCENE = 2;
export const MAX_CARD_WORDS = 4;

/**
 * Objeto PLANO a propósito, sin superRefine ni unión discriminada.
 *
 * Es el contrato de salida del LLM del guion, y el proveedor hace un parse con
 * un solo reintento: un refine cruzado tumbaría la generación ENTERA del guion
 * por una intención mal escrita. La validación semántica es un pase posterior
 * que DESCARTA lo que no cuadra (validateSceneIntents), no un parse que aborta.
 */
export const editIntentSchema = z.object({
  effect: intentEffectSchema,
  /** Palabra EXACTA del `text` de ESTA MISMA escena donde entra el efecto. */
  trigger_word: z.string().min(1).max(40),
  /** Copy sintético de la tarjeta: 2-4 palabras, sentence case. */
  card_text: z.string().max(48).optional(),
  /** Solo effect='stat': la cifra en dígitos. */
  value: z.string().max(24).optional(),
  label: z.string().max(40).optional(),
  /** Solo effect='stat': índice en research.claims del que sale la cifra. */
  claim_idx: z.number().int().nonnegative().optional(),
  /** annotation: circle|underline|arrow|strike|check · device: browser|phone · tendencia: sube|baja */
  style: z.string().max(16).optional(),
  /**
   * Las piezas de un efecto de lista: los dos lados de una `comparacion` o las
   * estaciones de unos `pasos`. Cada una es un rótulo corto, no una frase: lo
   * que se lee en pantalla mientras la voz sigue hablando.
   */
  items: z.array(z.string().min(1).max(40)).max(4).optional(),
});
export type EditIntent = z.infer<typeof editIntentSchema>;

export type IntentDropReason =
  | 'trigger_ausente'
  | 'sin_copy'
  | 'sin_valor'
  | 'cifra_sin_respaldo'
  | 'copy_largo'
  | 'kinetic_fuera_hook'
  | 'items_mal'
  | 'exceso';

export interface IntentCheck {
  kept: EditIntent[];
  dropped: Array<{ intent: EditIntent; reason: IntentDropReason }>;
}

const NEEDS_COPY = new Set<IntentEffect>(['callout', 'quote', 'kinetic', 'device']);

// El marco de dispositivo TECLEA su texto en una barra de URL/búsqueda: solo
// tiene sentido si el texto ES un dominio, una URL o un comando. «emergency
// stop» pasó los filtros genéricos (2 palabras, ≤48 chars) y salió tecleado en
// una barra de direcciones; con esto se degrada a callout en vez de fingir.
// El último label del dominio exige letras («GPT-5.6» no es un dominio).
const DEVICE_DOMAIN_RE = /(^|\s)(https?:\/\/)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(\/\S*)?(\s|$)/i;
const DEVICE_COMMAND_RE =
  /^[$>]\s?\S|^(npm|pnpm|npx|git|pip3?|docker|curl|wget|ssh|brew|apt|sudo|python3?|node|cargo|go|make|ollama)\b/i;

/** ¿Este texto puede ir en la barra de un DeviceFrame sin quedar en ridículo? */
export function deviceTextValido(text: string): boolean {
  const t = text.trim();
  if (t === '') return false;
  return t.includes('://') || DEVICE_DOMAIN_RE.test(t) || DEVICE_COMMAND_RE.test(t);
}

/**
 * Deja solo las intenciones que se sostienen. Nunca lanza: separa lo válido de
 * lo descartado con su motivo, para poder avisar al humano en vez de colocar un
 * efecto en el sitio equivocado.
 */
/**
 * Cuántas piezas necesita cada efecto de lista, y cuántas admite.
 *
 * La comparación son DOS lados exactos: con uno no hay comparación y con tres
 * es otra cosa. Los pasos van de dos a cuatro; con cinco la ficha no cabe en
 * pantalla a 1080p y con uno no es un proceso.
 */
const ITEMS_EXIGIDOS: Partial<Record<IntentEffect, [number, number]>> = {
  comparacion: [2, 2],
  pasos: [2, 4],
};

export function validateSceneIntents(
  scene: { section: 'hook' | 'body' | 'cta'; text: string; edit_intents?: EditIntent[] },
  claims: readonly { text: string }[],
): IntentCheck {
  const kept: EditIntent[] = [];
  const dropped: IntentCheck['dropped'] = [];
  const drop = (intent: EditIntent, reason: IntentDropReason): void => {
    dropped.push({ intent, reason });
  };

  for (const intent of scene.edit_intents ?? []) {
    if (kept.length >= MAX_INTENTS_PER_SCENE) {
      drop(intent, 'exceso');
      continue;
    }
    // (a) la palabra disparadora está literalmente en el texto de su escena
    if (!wordInText(scene.text, intent.trigger_word)) {
      drop(intent, 'trigger_ausente');
      continue;
    }
    if (intent.effect === 'kinetic' && scene.section !== 'hook') {
      drop(intent, 'kinetic_fuera_hook');
      continue;
    }
    const copy = (intent.card_text ?? '').trim();
    if (NEEDS_COPY.has(intent.effect) && copy === '') {
      drop(intent, 'sin_copy');
      continue;
    }
    if (copy !== '' && copy.split(/\s+/).length > MAX_CARD_WORDS) {
      drop(intent, 'copy_largo');
      continue;
    }
    // un device cuyo texto no parece dominio/URL/comando se DEGRADA a callout:
    // el contenido (la palabra ancla y el copy) sigue valiendo; lo que no vale
    // es teclearlo en una barra de direcciones
    if (intent.effect === 'device' && !deviceTextValido(copy)) {
      kept.push({ ...intent, effect: 'callout' });
      continue;
    }
    // Los efectos de lista se pintan a partir de `items`, así que sin ellos no
    // hay nada que dibujar. Se comprueba aquí y no en el esquema Zod para no
    // tumbar el guion entero por una intención mal formada: la lectura de la
    // salida del LLM es tolerante a propósito.
    if (ITEMS_EXIGIDOS[intent.effect] !== undefined) {
      const [minimo, maximo] = ITEMS_EXIGIDOS[intent.effect]!;
      const items = (intent.items ?? []).map((s) => s.trim()).filter((s) => s !== '');
      const largos = items.some((s) => s.split(/\s+/).length > MAX_CARD_WORDS);
      if (items.length < minimo || items.length > maximo || largos) {
        drop(intent, 'items_mal');
        continue;
      }
    }
    if (intent.effect === 'tendencia') {
      const value = (intent.value ?? '').trim();
      const dir = (intent.style ?? '').trim();
      if (value === '' || (dir !== 'sube' && dir !== 'baja')) {
        drop(intent, 'sin_valor');
        continue;
      }
      if (!figureBackedBy(value, [scene.text, ...claims.map((c) => c.text)])) {
        drop(intent, 'cifra_sin_respaldo');
        continue;
      }
    }
    if (intent.effect === 'stat') {
      const value = (intent.value ?? '').trim();
      if (value === '') {
        drop(intent, 'sin_valor');
        continue;
      }
      // (b) la cifra sale de la propia escena o del claim que cita: la misma
      // regla factual del guion vale para lo que aparece en pantalla
      const cited = intent.claim_idx !== undefined ? claims[intent.claim_idx] : undefined;
      const sources = [scene.text, ...(cited ? [cited.text] : claims.map((c) => c.text))];
      if (!figureBackedBy(value, sources)) {
        drop(intent, 'cifra_sin_respaldo');
        continue;
      }
    }
    kept.push(intent);
  }
  return { kept, dropped };
}

/** Motivos en español: el humano nunca ve el identificador crudo. */
export const DROP_LABELS: Record<IntentDropReason, string> = {
  trigger_ausente: 'la palabra que dispara el efecto no está en el texto de la escena',
  sin_copy: 'falta el texto de la tarjeta',
  sin_valor: 'la tarjeta de dato no trae cifra',
  cifra_sin_respaldo: 'la cifra no aparece en la escena ni en el research',
  copy_largo: 'el texto de la tarjeta pasa de cuatro palabras',
  kinetic_fuera_hook: 'la tipografía cinética solo va en el gancho',
  items_mal: 'el gráfico de lista no trae los elementos que necesita, o son demasiado largos',
  exceso: 'la escena declaraba más efectos de los permitidos',
};
