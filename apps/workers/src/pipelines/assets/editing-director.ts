import { z } from 'zod';
import {
  figureBackedBy,
  FX_CARD_GUARD_MS,
  FX_CARD_SEP_MS,
  FX_CARDS_PER_MIN,
  palabraResaltable,
  FX_KEYWORD_SEP_MS,
  FX_KEYWORDS_PER_MIN,
  FX_MICRO_PER_MIN,
  FX_MICRO_SEP_MS,
  MAX_CARD_WORDS,
  microFxFor,
  normalizeWord,
  validateSceneIntents,
  type Cue,
  type Edit,
  type Scene,
  type SceneSpan,
} from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { ledgeredLlmJson } from '../ideas/llm-call.js';

// Director de edición (híbrido reglas + IA): sobre los beats/cues/segmentos ya
// congelados produce una línea de tiempo de efectos (master.edits) para que el
// vídeo se sienta editado — punch-ins, keyword resaltada, tarjetas de dato,
// callouts, citas y SFX. NO cambia los cortes de audio (principio 1): cada
// efecto se ancla en ms sobre la ley temporal existente. Una sola llamada LLM.

export interface DirectorBeat {
  idx: number;
  from_ms: number;
  to_ms: number;
  text: string;
}

export interface EditingParams {
  videoId: string;
  channelId: string;
  lang: 'en' | 'es';
  beats: DirectorBeat[];
  cues: Cue[];
  scenes: Scene[];
  segmentStartMs: number[]; // from_ms de cada segmento (para whoosh de sección)
  seoTags: string[];
  // señales del hook para el callout de apertura/cierre (Fase 2)
  hookNotes?: string;
  title?: string;
  // índice escena → tramo de audio: acota dónde buscar la palabra disparadora
  sceneSpans?: SceneSpan[];
  // única fuente de cifras permitida en pantalla
  claims?: readonly { text: string }[];
}

// normalizeWord vive en shared: la comparten el director, el catálogo de
// micro-fx y el tema de subtítulos, y antes cada uno tenía su copia
const normalize = normalizeWord;

// ms de la primera aparición (o solapada con un rango) de una palabra en cues.
function findWordMs(
  cues: Cue[],
  needle: string,
  withinFrom = 0,
  withinTo = Infinity,
): Cue['words'][number] | null {
  const n = normalize(needle);
  if (n.length === 0) return null;
  for (const cue of cues) {
    for (const word of cue.words) {
      if (word.from_ms < withinFrom || word.from_ms > withinTo) continue;
      if (normalize(word.w) === n) return word;
    }
  }
  return null;
}

// duración objetivo por tipo de efecto (ms) acotada a la ventana del beat.
const DUR_MS: Record<string, number> = {
  zoom_punch: 1600,
  stat_card: 2600,
  stat_odometer: 2600,
  text_callout: 2400,
  quote_card: 3000,
  keyword_highlight: 900,
  kinetic_text: 2400,
  annotation: 1800,
  device_frame: 2600,
  // Los de lista duran más: hay que LEERLOS, no solo verlos pasar. Los pasos
  // van escalonados, así que el último aparece cuando ya han pasado ~1,2 s.
  split_versus: 3400,
  pasos_flow: 4200,
  tendencia: 3000,
};

// dominio mencionado en la narración (grapheneos.org, github.com…) → marco de
// navegador. Sin protocolo; extensiones habituales de un canal tech.
const DOMAIN_RE = /\b([a-z0-9][a-z0-9-]*\.(?:com|org|io|net|dev|app|ai|gov|co))\b/i;

// una cifra con 3+ dígitos luce como rodillo (stat_odometer); las cortas (%, xN,
// cifras de 1-2 dígitos) van en tarjeta simple con count-up (stat_card).
function pickStatType(value: string): 'stat_odometer' | 'stat_card' {
  return value.replace(/[^\d]/g, '').length >= 3 ? 'stat_odometer' : 'stat_card';
}

function beatOf(beats: DirectorBeat[], idx: number): DirectorBeat | undefined {
  return beats.find((b) => b.idx === idx);
}

// ---- capa de reglas (determinista) -----------------------------------------

// cifras "destacables": %, multiplicadores (10x), magnitudes (2 millones / 500
// mil / 3M) y números de 2+ dígitos. Los números escritos con letra ("dos
// millones") los capta la capa IA. El % no lleva \b final ('%' es no-palabra).
const NUMBER_RE =
  /\d[\d.,]*\s?%|\b\d[\d.,]*\s?x\b|\b\d[\d.,]*\s?(?:mil|millones|millón|billones|k|m|b)\b|\b\d{2,}(?:[.,]\d+)?\b/i;

// Margen para el desfase de la concatenación de escenas (silencios entre
// escenas): la ventana de una escena no cae exactamente donde predice el cálculo.
const SPAN_GRACE_MS = 1_500;

interface Anchor {
  atMs: number;
  beat: DirectorBeat;
}

function countWordOccurrences(cues: Cue[], needle: string): number {
  const n = normalize(needle);
  let total = 0;
  for (const cue of cues) for (const w of cue.words) if (normalize(w.w) === n) total++;
  return total;
}

/**
 * Dónde va un efecto declarado. Devuelve null si la palabra no se pronuncia
 * donde debería, y entonces el efecto SE DESCARTA.
 *
 * Antes esto caía a `beat.from_ms` cuando no encontraba la palabra: el efecto se
 * colocaba igual, mal sincronizado y sin dejar rastro. Esa línea era la causa de
 * que los overlays no cuadraran con la locución.
 */
function resolveAnchor(
  triggerWord: string,
  span: { from_ms: number; to_ms: number } | undefined,
  cues: Cue[],
  beats: DirectorBeat[],
): Anchor | null {
  const hit =
    span !== undefined
      ? findWordMs(cues, triggerWord, span.from_ms - SPAN_GRACE_MS, span.to_ms + SPAN_GRACE_MS)
      : // sin scene_spans (maestro antiguo) solo vale si la palabra es única en
        // todo el vídeo: si se repite no hay forma de saber cuál es
        countWordOccurrences(cues, triggerWord) === 1
        ? findWordMs(cues, triggerWord)
        : null;
  if (!hit) return null;
  const beat = beats.find((b) => hit.from_ms >= b.from_ms && hit.from_ms < b.to_ms);
  return beat ? { atMs: hit.from_ms, beat } : null;
}

export interface IntentPlacement {
  edits: Edit[];
  /** beats que ya llevan un efecto declarado: la IA solo rellena los huecos */
  covered: Set<number>;
  dropped: number;
}

/**
 * Coloca lo que el guion DECLARÓ. Es la capa de máxima prioridad: no adivina
 * nada, solo resuelve la palabra a un instante y monta el efecto ahí.
 */
export function intentEdits(params: EditingParams): IntentPlacement {
  const { beats, cues, scenes, sceneSpans, claims = [] } = params;
  const spanById = new Map((sceneSpans ?? []).map((s) => [s.scene_id, s]));
  const edits: Edit[] = [];
  const covered = new Set<number>();
  let dropped = 0;

  for (const scene of scenes) {
    if (scene.edit_intents === undefined || scene.edit_intents.length === 0) continue;
    // segundo portón: el texto pudo cambiar desde que se escribió el guion, y
    // aquí ya hay cues reales contra los que comprobar
    const { kept, dropped: fuera } = validateSceneIntents(scene, claims);
    dropped += fuera.length;

    for (const intent of kept) {
      const anchor = resolveAnchor(intent.trigger_word, spanById.get(scene.id), cues, beats);
      if (anchor === null) {
        dropped++;
        continue;
      }
      const { atMs, beat } = anchor;
      const win = (dur: number): number => Math.min(beat.to_ms, atMs + dur);
      const card = intent.card_text ?? '';

      switch (intent.effect) {
        case 'kinetic':
          edits.push({
            type: 'kinetic_text',
            from_ms: beat.from_ms,
            to_ms: Math.min(beat.to_ms, beat.from_ms + DUR_MS.kinetic_text!),
            beat_idx: beat.idx,
            text: card,
          });
          edits.push({ type: 'sfx', from_ms: atMs, to_ms: atMs + 300, sfx: 'destello' });
          break;
        case 'callout':
          edits.push({
            type: 'text_callout',
            from_ms: atMs,
            to_ms: win(DUR_MS.text_callout!),
            beat_idx: beat.idx,
            text: card,
          });
          edits.push({ type: 'sfx', from_ms: atMs, to_ms: atMs + 400, sfx: 'pop' });
          break;
        case 'comparacion':
          edits.push({
            type: 'split_versus',
            from_ms: atMs,
            to_ms: win(DUR_MS.split_versus!),
            beat_idx: beat.idx,
            items: (intent.items ?? []).slice(0, 2),
          });
          edits.push({ type: 'sfx', from_ms: atMs, to_ms: atMs + 400, sfx: 'deslizar' });
          break;
        case 'pasos':
          edits.push({
            type: 'pasos_flow',
            from_ms: atMs,
            to_ms: win(DUR_MS.pasos_flow!),
            beat_idx: beat.idx,
            items: (intent.items ?? []).slice(0, 4),
          });
          edits.push({ type: 'sfx', from_ms: atMs, to_ms: atMs + 400, sfx: 'clic' });
          break;
        case 'tendencia':
          edits.push({
            type: 'tendencia',
            from_ms: atMs,
            to_ms: win(DUR_MS.tendencia!),
            beat_idx: beat.idx,
            value: intent.value ?? '',
            style: intent.style ?? 'sube',
            ...(intent.card_text ? { label: intent.card_text } : {}),
          });
          edits.push({ type: 'sfx', from_ms: atMs, to_ms: atMs + 400, sfx: 'riser' });
          break;
        case 'quote':
          edits.push({
            type: 'quote_card',
            from_ms: atMs,
            to_ms: win(DUR_MS.quote_card!),
            beat_idx: beat.idx,
            text: card,
          });
          edits.push({ type: 'sfx', from_ms: atMs, to_ms: atMs + 400, sfx: 'deslizar' });
          break;
        case 'stat': {
          const statType = pickStatType(intent.value ?? '');
          edits.push({
            type: statType,
            from_ms: atMs,
            to_ms: win(DUR_MS[statType]!),
            beat_idx: beat.idx,
            value: intent.value ?? '',
            ...(intent.label ? { label: intent.label } : {}),
          });
          edits.push({ type: 'sfx', from_ms: atMs, to_ms: atMs + 500, sfx: 'ding' });
          break;
        }
        case 'keyword':
          // hasta ahora era IMPOSIBLE que la IA produjera un keyword_highlight:
          // solo salían de partir los tags de SEO
          if (!palabraResaltable(intent.trigger_word)) break;
          edits.push({
            type: 'keyword_highlight',
            from_ms: atMs,
            to_ms: atMs + DUR_MS.keyword_highlight!,
            keyword: intent.trigger_word,
          });
          break;
        case 'annotation':
          edits.push({
            type: 'annotation',
            from_ms: atMs,
            to_ms: win(DUR_MS.annotation!),
            beat_idx: beat.idx,
            ...(intent.style ? { style: intent.style } : {}),
            ...(card !== '' ? { text: card } : {}),
          });
          edits.push({ type: 'sfx', from_ms: atMs, to_ms: atMs + 300, sfx: 'tic' });
          break;
        case 'device':
          edits.push({
            type: 'device_frame',
            from_ms: atMs,
            to_ms: win(DUR_MS.device_frame!),
            beat_idx: beat.idx,
            style: intent.style ?? 'browser',
            text: card,
          });
          edits.push({ type: 'sfx', from_ms: atMs, to_ms: atMs + 800, sfx: 'tecleo' });
          break;
      }
      if (intent.effect !== 'keyword') covered.add(beat.idx);
    }
  }
  return { edits, covered, dropped };
}

/**
 * Micro-FX: acentos disparados por una palabra del catálogo. Cada efecto entra
 * UNA sola vez en todo el vídeo, así que el techo estructural es el tamaño del
 * catálogo por muy largo que sea el vídeo.
 */
export function microFxEdits(params: EditingParams): Edit[] {
  const edits: Edit[] = [];
  const usados = new Set<string>();
  for (const cue of params.cues) {
    for (const word of cue.words) {
      const def = microFxFor(word.w);
      if (def === null || usados.has(def.id)) continue;
      usados.add(def.id);
      // annotation y micro_fx son miembros distintos de la unión: se construyen
      // por separado para que el compilador verifique cada uno
      edits.push(
        def.edit === 'annotation'
          ? {
              type: 'annotation',
              from_ms: word.from_ms,
              to_ms: word.from_ms + def.durationMs,
              style: def.style,
            }
          : {
              type: 'micro_fx',
              from_ms: word.from_ms,
              to_ms: word.from_ms + def.durationMs,
              style: def.style,
            },
      );
      edits.push({ type: 'sfx', from_ms: word.from_ms, to_ms: word.from_ms + 400, sfx: def.sfx });
    }
  }
  return edits;
}

export function ruleEdits(params: EditingParams & { covered?: ReadonlySet<number> }): Edit[] {
  const edits: Edit[] = [];
  const { beats, cues, scenes, segmentStartMs, seoTags } = params;
  // las reglas de CONTENIDO (cifra, dominio) son red de seguridad: pierden ante
  // lo que el guion declaró para ese beat. Las estructurales (riser, whoosh,
  // zoom de sección) no se gatean: no inventan contenido.
  const covered = params.covered ?? new Set<number>();

  // riser al arrancar el cuerpo + zoom en el primer beat (hook)
  const first = beats[0];
  if (first) {
    edits.push({ type: 'sfx', from_ms: first.from_ms, to_ms: first.from_ms + 1000, sfx: 'riser' });
    edits.push({
      type: 'zoom_punch',
      from_ms: first.from_ms,
      to_ms: Math.min(first.to_ms, first.from_ms + DUR_MS.zoom_punch!),
      beat_idx: first.idx,
    });
  }

  // whoosh + zoom_punch al entrar cada sección (salvo la apertura): marca cada
  // cambio de tema con energía (más punches, que es la seña del "editado")
  for (const ms of segmentStartMs.slice(1)) {
    edits.push({ type: 'sfx', from_ms: ms, to_ms: ms + 700, sfx: 'whoosh' });
    const beat = beats.find((b) => ms >= b.from_ms && ms < b.to_ms);
    if (beat) {
      edits.push({
        type: 'zoom_punch',
        from_ms: beat.from_ms,
        to_ms: Math.min(beat.to_ms, beat.from_ms + DUR_MS.zoom_punch!),
        beat_idx: beat.idx,
      });
    }
  }

  // zoom_punch en beats de escenas marcadas con emphasis.
  // Con scene_spans el tramo es exacto. Sin ellos había que buscar la PRIMERA
  // palabra de la escena en todo el vídeo, y como suele ser «el» o «pero»,
  // casaba en cualquier sitio y el zoom caía en un beat que no era.
  const spanById = new Map((params.sceneSpans ?? []).map((s) => [s.scene_id, s]));
  const emphasisMs = scenes
    .filter((s) => s.emphasis === true)
    .map((s) => {
      const span = spanById.get(s.id);
      if (span !== undefined) return span.from_ms;
      return findWordMs(cues, s.text.split(/\s+/)[0] ?? '', 0, Infinity)?.from_ms;
    })
    .filter((ms): ms is number => typeof ms === 'number');
  for (const ms of emphasisMs) {
    const beat = beats.find((b) => ms >= b.from_ms && ms < b.to_ms);
    if (beat && beat.idx !== first?.idx) {
      edits.push({
        type: 'zoom_punch',
        from_ms: beat.from_ms,
        to_ms: Math.min(beat.to_ms, beat.from_ms + DUR_MS.zoom_punch!),
        beat_idx: beat.idx,
      });
    }
  }

  // stat_card en beats cuya narración menciona una cifra destacable
  for (const beat of beats) {
    if (covered.has(beat.idx)) continue;
    const m = beat.text.match(NUMBER_RE);
    if (!m) continue;
    const value = m[0].replace(/\s+/g, ' ').trim();
    const at = findWordMs(cues, m[0].replace(/[^\d]/g, '').slice(0, 6), beat.from_ms, beat.to_ms);
    const fromMs = at?.from_ms ?? beat.from_ms;
    const statType = pickStatType(value);
    edits.push({
      type: statType,
      from_ms: fromMs,
      to_ms: Math.min(beat.to_ms, fromMs + DUR_MS[statType]!),
      beat_idx: beat.idx,
      value,
    });
    edits.push({ type: 'sfx', from_ms: fromMs, to_ms: fromMs + 500, sfx: 'ding' });
  }

  // keyword_highlight: tags del SEO que aparezcan pronunciados en los cues
  // el filtro por longitud dejaba pasar palabras funcionales: se llegó a
  // resaltar «vez». `palabraResaltable` es la misma regla que usa el informe de
  // calidad para señalarlo, así que medir y producir no pueden discrepar
  const tagWords = seoTags.flatMap((t) => t.split(/\s+/)).filter(palabraResaltable);
  const seenKw = new Set<string>();
  for (const tag of tagWords) {
    const key = normalize(tag);
    if (key.length < 4 || seenKw.has(key)) continue;
    const hit = findWordMs(cues, tag);
    if (hit) {
      seenKw.add(key);
      edits.push({
        type: 'keyword_highlight',
        from_ms: hit.from_ms,
        to_ms: hit.to_ms,
        keyword: tag,
      });
    }
  }

  // device_frame: un dominio mencionado en un beat se muestra en un navegador
  for (const beat of beats) {
    if (covered.has(beat.idx)) continue;
    const m = beat.text.match(DOMAIN_RE);
    if (!m) continue;
    edits.push({
      type: 'device_frame',
      from_ms: beat.from_ms,
      to_ms: Math.min(beat.to_ms, beat.from_ms + DUR_MS.device_frame!),
      beat_idx: beat.idx,
      style: 'browser',
      text: m[1]!.toLowerCase(),
    });
  }

  return edits;
}

// ---- capa IA (elige momentos potentes + redacta texto) ---------------------

const editingResultSchema = z.object({
  moments: z
    .array(
      z.object({
        beat_idx: z.number().int().nonnegative(),
        type: z.enum(['callout', 'stat', 'quote', 'kinetic', 'annotation', 'device']),
        text: z.string().optional(),
        value: z.string().optional(),
        label: z.string().optional(),
        keyword: z.string().optional(),
        style: z.string().optional(),
      }),
    )
    .max(8),
});

function buildEditingPrompt(params: EditingParams): { system: string; user: string } {
  const langName = params.lang === 'en' ? 'inglés' : 'español';
  const lastIdx = params.beats.length > 0 ? params.beats[params.beats.length - 1]!.idx : 0;
  const system = [
    'Eres editor de vídeo de un canal de YouTube tipo "faceless".',
    'Recibes la narración por beats numerados. Elige los MOMENTOS más potentes',
    'para superponer un efecto que enganche, sin recargar (máximo ~1 cada 2-3 beats).',
    'Tipos:',
    '- "kinetic": tipografía cinética a pantalla completa, una frase MUY corta de 2-4 palabras (text) que es el golpe del gancho. Úsalo SOLO en el arranque.',
    '- "callout": una etiqueta de 2-5 palabras que refuerza la idea clave del beat.',
    // La regla de cifras va INVERTIDA respecto a la versión anterior, que decía
    // «incluye también cifras que en la narración van con letra» e invitaba a
    // redondear o fabricar magnitudes. Ahora la cifra tiene que estar dicha.
    '- "stat": una cifra que se DICE en ese beat (value) + label corto. value debe aparecer literalmente en la narración del beat: si se dice con letra, escríbela con letra tal cual. Si el beat no trae cifra, no propongas stat. Nunca redondees ni inventes una magnitud.',
    '- "quote": una frase textual breve y citable del beat (text).',
    '- "annotation": marca dibujada a mano para SEÑALAR algo concreto en pantalla; text = etiqueta muy corta opcional. Úsalo con moderación (momentos de "mira esto").',
    '- "device": muestra una web o comando en un marco de navegador; text = la URL o el comando (p. ej. "grapheneos.org"). Solo si el guion menciona un sitio/herramienta concreta.',
    '',
    // sin palabra de anclaje el efecto no se puede sincronizar con la locución:
    // el código descarta el momento, así que pedirla es obligatorio
    'keyword OBLIGATORIA en TODOS los momentos: una palabra EXACTA tal y como aparece escrita en la narración de ESE beat. El efecto entra en el instante en que se pronuncia. Un momento sin keyword válida se descarta, así que cópiala del texto del beat, no la inventes ni la conjugues.',
    `text/card: como mucho ${MAX_CARD_WORDS} palabras. Es un titular que resume la frase, no una transcripción.`,
    // gancho: tipografía cinética al abrir + payoff al cerrar
    `- OBLIGATORIO: un "kinetic" en el beat ${params.beats[0]?.idx ?? 0} con la frase-golpe del gancho, y un "callout" en el beat ${lastIdx} con el PAYOFF/conclusión.`,
    `Textos en ${langName}, muy cortos, sin comillas. Máximo 6 momentos; como mucho 1 "kinetic", 1 "device" y 2 "annotation".`,
    'Devuelve JSON: { "moments": [ { "beat_idx", "type", "keyword", "text"?, "value"?, "label"? } ] }.',
  ].join('\n');
  const user = [
    params.title ? `Título del vídeo: ${params.title}` : '',
    params.hookNotes ? `Gancho (promesa/payoff): ${params.hookNotes}` : '',
    '',
    // el beat va ENTERO: truncarlo a 180 caracteres era la causa directa de que
    // el modelo escribiera palabras que no estaban en la narración
    'Beats (idx · narración):',
    ...params.beats.map((b) => `${b.idx} · ${b.text.replace(/\s+/g, ' ').trim()}`),
  ]
    .filter((l) => l !== '')
    .join('\n');
  return { system, user };
}

export function momentsToEdits(
  moments: z.infer<typeof editingResultSchema>['moments'],
  beats: DirectorBeat[],
  cues: Cue[],
  claims: readonly { text: string }[] = [],
): Edit[] {
  const claimTexts = claims.map((c) => c.text);
  const edits: Edit[] = [];
  for (const m of moments) {
    const beat = beatOf(beats, m.beat_idx);
    if (!beat) continue;
    // El efecto se ancla al instante en que se PRONUNCIA su palabra. Si esa
    // palabra no está en el beat, el momento se descarta: antes caía a
    // `beat.from_ms` y el overlay aparecía desincronizado sin dejar rastro.
    const anchorWord = (m.keyword ?? '').split(/\s+/)[0] ?? '';
    const hit = findWordMs(cues, anchorWord, beat.from_ms, beat.to_ms);
    if (!hit) continue;
    const at = hit.from_ms;
    const window = (dur: number): number => Math.min(beat.to_ms, at + dur);
    // una cifra que no está ni en el beat ni en el research no se pinta
    if (m.type === 'stat' && !figureBackedBy(m.value ?? '', [beat.text, ...claimTexts])) continue;
    // el copy de tarjeta es un titular, no una transcripción
    if ((m.text ?? '').split(/\s+/).filter(Boolean).length > MAX_CARD_WORDS) continue;

    if (m.type === 'kinetic' && m.text) {
      // el kinetic es el tratamiento del gancho: ocupa el arranque del beat
      edits.push({
        type: 'kinetic_text',
        from_ms: beat.from_ms,
        to_ms: Math.min(beat.to_ms, beat.from_ms + DUR_MS.kinetic_text!),
        beat_idx: beat.idx,
        text: m.text,
      });
    } else if (m.type === 'callout' && m.text) {
      edits.push({
        type: 'text_callout',
        from_ms: at,
        to_ms: window(DUR_MS.text_callout!),
        beat_idx: beat.idx,
        text: m.text,
      });
      edits.push({ type: 'sfx', from_ms: at, to_ms: at + 400, sfx: 'pop' });
    } else if (m.type === 'stat' && m.value) {
      const statType = pickStatType(m.value);
      edits.push({
        type: statType,
        from_ms: at,
        to_ms: window(DUR_MS[statType]!),
        beat_idx: beat.idx,
        value: m.value,
        ...(m.label ? { label: m.label } : {}),
      });
      edits.push({ type: 'sfx', from_ms: at, to_ms: at + 400, sfx: 'pop' });
    } else if (m.type === 'quote' && m.text) {
      // pop solo en callouts/tarjetas (en citas resultaba repetitivo)
      edits.push({
        type: 'quote_card',
        from_ms: at,
        to_ms: window(DUR_MS.quote_card!),
        beat_idx: beat.idx,
        text: m.text,
      });
    } else if (m.type === 'annotation') {
      edits.push({
        type: 'annotation',
        from_ms: at,
        to_ms: window(DUR_MS.annotation!),
        beat_idx: beat.idx,
        ...(m.style ? { style: m.style } : {}),
        ...(m.text ? { text: m.text } : {}),
      });
      edits.push({ type: 'sfx', from_ms: at, to_ms: at + 400, sfx: 'whoosh' });
    } else if (m.type === 'device' && m.text) {
      edits.push({
        type: 'device_frame',
        from_ms: at,
        to_ms: window(DUR_MS.device_frame!),
        beat_idx: beat.idx,
        style: m.style ?? 'browser',
        text: m.text,
      });
    }
    // momento sin texto/valor válido: no genera edit
  }
  return edits;
}

// ---- orquestación: reglas + IA, dedupe y tope de densidad ------------------

// overlays visuales que compiten por pantalla (los SFX/keyword no cuentan;
// annotation es un acento ligero que layerea sobre el b-roll → tampoco compite)
const VISUAL_TYPES = new Set([
  'zoom_punch',
  'stat_card',
  'stat_odometer',
  'text_callout',
  'quote_card',
  'kinetic_text',
  'device_frame',
  // Los tres de lista ocupan el centro como cualquier tarjeta: si no compiten,
  // se solaparían con un callout en el mismo beat.
  'split_versus',
  'pasos_flow',
  'tendencia',
]);
/**
 * ¿Vale la pena llamar a la capa de IA del director?
 *
 * Solo si las tarjetas ya colocadas —declaradas por el guion más las de reglas—
 * no llenan el presupuesto del vídeo. La puerta anterior era «¿queda algún beat
 * sin cubrir?», que a longitud real es siempre que sí: con 41 beats y un
 * presupuesto de 9 tarjetas nunca se cubren todos. Así la llamada se hacía
 * SIEMPRE y la economía que promete docs/edicion.md §1 —cuanto mejor declara el
 * guion, menos IA— no podía cumplirse. Además era trabajo tirado: con el
 * presupuesto lleno, `spreadByWindows` descarta después lo que la IA propone.
 */
export function hacenFaltaMasTarjetas(puestas: readonly Edit[], durationMs: number): boolean {
  const presupuesto = Math.max(1, Math.round((durationMs / 60_000) * FX_CARDS_PER_MIN));
  return puestas.filter((e) => VISUAL_TYPES.has(e.type)).length < presupuesto;
}

// prioridad al recortar por densidad (mayor primero). kinetic_text es el
// centro del gancho: nunca se recorta. odómetro/tarjeta valen igual que stat.
const PRIORITY: Record<string, number> = {
  kinetic_text: 6,
  // Los de lista valen como una tarjeta de dato: son el contenido de la escena,
  // no un adorno. Si compiten con un zoom, gana el gráfico.
  split_versus: 5,
  pasos_flow: 5,
  tendencia: 5,
  device_frame: 5,
  stat_odometer: 5,
  stat_card: 5,
  zoom_punch: 4,
  quote_card: 3,
  text_callout: 2,
};
// topes por tipo de acento no-competitivo (annotation): no saturar
const ANNOTATION_CAP = 2;

/**
 * Reparte en el TIEMPO en vez de ordenar por prioridad y truncar.
 *
 * El recorte anterior era un orden total sin tiempo: si el primer minuto daba
 * seis tarjetas y el séptimo una, la del séptimo moría aunque ese minuto
 * estuviera vacío. Aquí el vídeo se parte en tantas ventanas como permita el
 * presupuesto y se elige UN candidato por ventana; la prioridad decide dentro de
 * la ventana, nunca entre ventanas. Determinista: empates por from_ms.
 */
export function spreadByWindows<T>(
  items: readonly T[],
  opts: {
    budget: number;
    durationMs: number;
    sepMs: number;
    at: (t: T) => number;
    score: (t: T) => number;
    reject?: (t: T) => boolean;
    /** suelo del ancho de ventana; ver la nota sobre la rejilla del informe */
    minWindowMs?: number;
  },
): { kept: T[]; dropped: T[] } {
  if (opts.budget <= 0 || items.length === 0) return { kept: [], dropped: [...items] };
  const windowMs = Math.max(1, opts.minWindowMs ?? 0, opts.durationMs / opts.budget);
  const porVentana = new Map<number, T[]>();
  for (const item of items) {
    const w = Math.floor(opts.at(item) / windowMs);
    const lista = porVentana.get(w) ?? [];
    lista.push(item);
    porVentana.set(w, lista);
  }
  const kept: T[] = [];
  const keptSet = new Set<T>();
  let ultimo = Number.NEGATIVE_INFINITY;
  for (const w of [...porVentana.keys()].sort((a, b) => a - b)) {
    const candidatos = (porVentana.get(w) ?? [])
      .filter((t) => opts.reject === undefined || !opts.reject(t))
      .filter((t) => opts.at(t) - ultimo >= opts.sepMs)
      .sort((a, b) => opts.score(b) - opts.score(a) || opts.at(a) - opts.at(b));
    const elegido = candidatos[0];
    if (elegido === undefined) continue;
    kept.push(elegido);
    keptSet.add(elegido);
    ultimo = opts.at(elegido);
  }
  return { kept, dropped: items.filter((t) => !keptSet.has(t)) };
}

export function dedupeAndCap(
  edits: Edit[],
  durationMs: number,
  declared: ReadonlySet<Edit> = new Set(),
): Edit[] {
  // dedupe overlays por (type, beat_idx); un beat no lleva dos del mismo tipo
  const seen = new Set<string>();
  const kept: Edit[] = [];
  for (const e of edits) {
    if (VISUAL_TYPES.has(e.type)) {
      const key = `${e.type}:${e.beat_idx ?? e.from_ms}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(e);
  }
  // Un solo overlay visual por beat para no amontonar. Lo DECLARADO por el
  // guion gana siempre a lo inferido por reglas o por la IA, y esa bonificación
  // tiene que estar AQUÍ y no solo en el reparto de más abajo.
  //
  // Estaba solo abajo, y por eso el sistema de intenciones declaradas se caía
  // en silencio: `zoom_punch` (prioridad 4, lo genera la regla de `emphasis`)
  // ganaba a `text_callout` (prioridad 2, lo pide el guion) en el mismo beat, y
  // la tarjeta moría antes de llegar a `spreadByWindows`, donde el +10 de
  // declarado la habría salvado. Medido en un vídeo real: 8 intenciones
  // ancladas correctamente en el audio, 6 zoom_punch en el maestro y UNA sola
  // tarjeta. El guion declaraba y el montaje lo ignoraba.
  const puntua = (e: Edit): number => (PRIORITY[e.type] ?? 0) + (declared.has(e) ? 10 : 0);
  const bestPerBeat = new Map<number, Edit>();
  const passthrough: Edit[] = [];
  for (const e of kept) {
    if (!VISUAL_TYPES.has(e.type) || e.beat_idx === undefined) {
      passthrough.push(e);
      continue;
    }
    const cur = bestPerBeat.get(e.beat_idx);
    if (!cur || puntua(e) > puntua(cur)) bestPerBeat.set(e.beat_idx, e);
  }
  // Reparto por ventanas en vez del recorte por prioridad: con el `slice`
  // anterior, un vídeo cuyo primer minuto daba mucho material se quedaba con
  // todos los efectos apelotonados al principio y minutos enteros mudos.
  const minutos = durationMs / 60_000;
  const visuals = spreadByWindows([...bestPerBeat.values()], {
    budget: Math.max(1, Math.round(minutos * FX_CARDS_PER_MIN)),
    durationMs,
    sepMs: FX_CARD_SEP_MS,
    at: (e) => e.from_ms,
    // lo DECLARADO por el guion gana a lo inferido por reglas o por la IA
    score: puntua,
    // NO se fuerza aquí una ventana de un minuto. Se probó, con la idea de
    // alinear la rejilla del reparto (duración/presupuesto, 51 s) con la del
    // informe (minutos de reloj). Medido sobre un vídeo real: costó una tarjeta
    // de cinco y NO quitó ni un minuto mudo, porque los minutos mudos no venían
    // de la rejilla — venían de que en el primer y el último minuto no había ni
    // un solo candidato. Eso se arregla arriba, en qué escenas declara tarjeta
    // el guion, no aquí.
  }).kept;
  // conserva SFX/keyword; recorta los "pop" cuyos overlays fueron descartados
  const keptVisualFroms = new Set(visuals.map((v) => v.from_ms));
  const others = passthrough.filter((e) =>
    e.type === 'sfx' && e.sfx === 'pop' ? keptVisualFroms.has(e.from_ms) : true,
  );
  // Carril de ACENTOS (annotation + micro_fx): no compiten por el centro de la
  // pantalla, así que van con su propio presupuesto y su propia separación, y
  // con una guarda para no pisar la entrada de una tarjeta.
  const acentos: Edit[] = [];
  const keywords: Edit[] = [];
  const rest: Edit[] = [];
  for (const e of others) {
    if (e.type === 'annotation' || e.type === 'micro_fx') acentos.push(e);
    else if (e.type === 'keyword_highlight') keywords.push(e);
    else rest.push(e);
  }
  const pisaTarjeta = (e: Edit): boolean =>
    visuals.some(
      (v) => e.from_ms >= v.from_ms - FX_CARD_GUARD_MS && e.from_ms <= v.to_ms + FX_CARD_GUARD_MS,
    );
  const acentosKept = spreadByWindows(acentos, {
    budget: Math.max(1, Math.round(minutos * FX_MICRO_PER_MIN)),
    durationMs,
    sepMs: FX_MICRO_SEP_MS,
    at: (e) => e.from_ms,
    score: (e) => (declared.has(e) ? 10 : 0),
    reject: pisaTarjeta,
  }).kept;
  // El subrayado de subtítulo antes NO tenía tope: partía todos los tags de SEO
  // y encendía la palabra allá donde cayera, decenas de veces por vídeo.
  const keywordsKept = spreadByWindows(keywords, {
    budget: Math.max(1, Math.round(minutos * FX_KEYWORDS_PER_MIN)),
    durationMs,
    sepMs: FX_KEYWORD_SEP_MS,
    at: (e) => e.from_ms,
    // una tarjeta centrada tapa el subtítulo: resaltarlo debajo no se vería
    // a igualdad, gana la palabra más larga: las cortas suelen ser genéricas
    score: (e) => (declared.has(e) ? 10 : 0) + ('keyword' in e ? e.keyword.length : 0) / 100,
    reject: pisaTarjeta,
  }).kept;

  // Los SFX se quedan huérfanos si su dueño cayó en el reparto. Antes solo se
  // limpiaba el `pop`, así que un `ding` podía sonar sin cifra en pantalla.
  const vivos = new Set([...visuals, ...acentosKept, ...keywordsKept].map((e) => e.from_ms));
  const ESTRUCTURALES = new Set(['riser', 'whoosh', 'resolucion', 'impacto']);
  const sonidos = rest.filter(
    (e) => e.type !== 'sfx' || ESTRUCTURALES.has(e.sfx ?? '') || vivos.has(e.from_ms),
  );

  return [...visuals, ...acentosKept, ...keywordsKept, ...sonidos].sort(
    (a, b) => a.from_ms - b.from_ms,
  );
}

export async function directEdits(ctx: WorkerContext, params: EditingParams): Promise<Edit[]> {
  if (params.beats.length === 0) return [];
  const durationMs = params.beats[params.beats.length - 1]!.to_ms;

  // 1) lo que el guion declaró: máxima prioridad y sin adivinar nada
  const intents = intentEdits(params);
  const declared = new Set(intents.edits);

  // 2) reglas estructurales + red de seguridad en los beats sin declarar
  const rules = ruleEdits({ ...params, covered: intents.covered });

  // 3) micro-FX disparados por palabra
  const micro = microFxEdits(params);

  // 4) la IA solo rellena lo que falta para llenar el PRESUPUESTO de tarjetas.
  //
  //    Antes la puerta era «¿quedan beats sin cubrir?», que a longitud real es
  //    siempre que sí: con 41 beats y un presupuesto de 9 tarjetas nunca se
  //    cubren todos, así que la llamada se hacía SIEMPRE y la economía que
  //    promete docs/edicion.md §1 no podía cumplirse. Y era trabajo tirado:
  //    con el presupuesto lleno, `spreadByWindows` descarta después lo que la
  //    IA acaba de proponer.
  const cubiertos = new Set([
    ...intents.covered,
    ...rules.flatMap((e) => (e.beat_idx !== undefined ? [e.beat_idx] : [])),
  ]);
  const huecos = params.beats.filter((b) => !cubiertos.has(b.idx));
  let aiEdits: Edit[] = [];
  if (hacenFaltaMasTarjetas([...intents.edits, ...rules], durationMs) && huecos.length > 0) {
    try {
      const { system, user } = buildEditingPrompt({ ...params, beats: huecos });
      const data = await ledgeredLlmJson(ctx, {
        videoId: params.videoId,
        channelId: params.channelId,
        op: 'editing_director',
        system,
        user,
        schema: editingResultSchema,
        mockContext: { beats: huecos },
      });
      aiEdits = momentsToEdits(data.moments, params.beats, params.cues, params.claims ?? []);
    } catch (err) {
      ctx.logger.warn(
        { err, videoId: params.videoId },
        'Director de edición (IA) falló; se usan las declaradas y las reglas',
      );
    }
  }

  const final = dedupeAndCap(
    [...intents.edits, ...rules, ...micro, ...aiEdits],
    durationMs,
    declared,
  );
  ctx.logger.info(
    {
      videoId: params.videoId,
      declarados: intents.edits.length,
      descartados: intents.dropped,
      reglas: rules.length,
      micro: micro.length,
      ia: aiEdits.length,
      huecos: huecos.length,
      colocados: final.length,
    },
    'Línea de edición montada',
  );
  return final;
}
