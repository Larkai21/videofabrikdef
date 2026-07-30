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

/** ¿`word` aparece como token COMPLETO dentro de `text`? */
export function wordInText(text: string, word: string): boolean {
  const needle = normalizeWord(word);
  if (needle.length === 0) return false;
  return text.split(/\s+/).some((t) => normalizeWord(t) === needle);
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
  /** annotation: circle|underline|arrow|strike|check · device: browser|phone */
  style: z.string().max(16).optional(),
});
export type EditIntent = z.infer<typeof editIntentSchema>;

export type IntentDropReason =
  | 'trigger_ausente'
  | 'sin_copy'
  | 'sin_valor'
  | 'cifra_sin_respaldo'
  | 'copy_largo'
  | 'kinetic_fuera_hook'
  | 'exceso';

export interface IntentCheck {
  kept: EditIntent[];
  dropped: Array<{ intent: EditIntent; reason: IntentDropReason }>;
}

const NEEDS_COPY = new Set<IntentEffect>(['callout', 'quote', 'kinetic', 'device']);

/**
 * Deja solo las intenciones que se sostienen. Nunca lanza: separa lo válido de
 * lo descartado con su motivo, para poder avisar al humano en vez de colocar un
 * efecto en el sitio equivocado.
 */
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
  exceso: 'la escena declaraba más efectos de los permitidos',
};
