import { z } from 'zod';
import {
  deviceTextValido,
  EDIT_BANDA,
  EDIT_RENDER_KIND,
  figureBackedBy,
  FX_CARD_GUARD_MS,
  FX_CARD_SEP_MS,
  FX_CARDS_PER_MIN,
  FX_FRANJA_MS,
  palabraResaltable,
  FX_KEYWORD_SEP_MS,
  FX_KEYWORDS_PER_MIN,
  FX_INSERTOS_PER_MIN,
  FX_MICRO_PER_MIN,
  FX_MICRO_SEP_MS,
  SHORT_CARDS_MAX,
  SHORT_MICRO_MAX,
  SHORT_KEYWORDS_MAX,
  SHORT_ZOOMS_MAX,
  SHORT_FX_CARD_SEP_MS,
  SHORT_FX_MICRO_SEP_MS,
  SHORT_FX_KEYWORD_SEP_MS,
  SHORT_FX_ZOOM_SEP_MS,
  SHORT_FX_GRANO_MS,
  MAX_CARD_WORDS,
  microFxFor,
  normalizeWord,
  tokenCifra,
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

// Todas las palabras cronometradas del audio, en orden y aplanadas. El anclaje
// necesita verlas seguidas porque un disparador puede ser una frase («cadena de
// custodia») y las frases cruzan la frontera de un cue.
function palabrasSeguidas(cues: Cue[]): Cue['words'] {
  return cues.flatMap((c) => c.words);
}

// ms de la primera aparición (o solapada con un rango) de una palabra o frase.
// Devuelve la PRIMERA palabra de la frase: es cuando el espectador empieza a
// oírla, y por tanto cuando debe entrar el efecto.
function findWordMs(
  cues: Cue[],
  needle: string,
  withinFrom = 0,
  withinTo = Infinity,
): Cue['words'][number] | null {
  const buscada = needle
    .split(/\s+/)
    .map(normalize)
    .filter((t) => t.length > 0);
  if (buscada.length === 0) return null;
  const todas = palabrasSeguidas(cues);
  const dichas = todas.map((w) => normalize(w.w));
  for (let i = 0; i <= dichas.length - buscada.length; i += 1) {
    const primera = todas[i];
    if (primera === undefined || primera.from_ms < withinFrom || primera.from_ms > withinTo)
      continue;
    if (buscada.every((n, k) => dichas[i + k] === n)) return primera;
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
  // dos etiquetas + dos cifras y la proporción entre barras: se lee como una
  // comparación, no como un vistazo — el mismo régimen que split_versus
  barras: 3400,
  // hitos escalonados como los pasos: el último aparece cuando la línea llega
  linea_tiempo: 4200,
  // estaciones + trazo del anillo + flecha del cierre: la coreografía entera
  // tarda ~2,3 s en contarse, y aún hay que leerla
  ciclo: 4200,
  // entradas escalonadas + convergencia + escape de la salida: mismo régimen
  // de lectura que el ciclo
  cuello: 4200,
  // la pila se construye losa a losa; menos elementos que un flow
  capas: 3400,
  // raíz + trazado de ramas + hojas escalonadas
  arbol: 3800,
  // una imagen se reconoce en menos tiempo que se lee una lista, pero el
  // espectador tiene que poder MIRARLA: entre tarjeta y lista
  imagen_apoyo: 3000,
};

// dominio mencionado en la narración (grapheneos.org, github.com…) → marco de
// navegador. Sin protocolo; extensiones habituales de un canal tech.
const DOMAIN_RE = /\b([a-z0-9][a-z0-9-]*\.(?:com|org|io|net|dev|app|ai|gov|co))\b/i;

// una cifra con 3+ dígitos luce como rodillo (stat_odometer); las cortas (%, xN,
// cifras de 1-2 dígitos) van en tarjeta simple con count-up (stat_card). Un
// decimal («3,5x») nunca va al rodillo: sus columnas son de dígitos enteros y
// «3,50» acabaría contando hasta 350. Un negativo tampoco: el rodillo no pinta
// el signo (la tarjeta sí, vía formatCifra).
function pickStatType(value: string): 'stat_odometer' | 'stat_card' {
  const token = tokenCifra(value);
  if (token === null || token.decimales > 0 || token.target < 0) return 'stat_card';
  return String(token.target).length >= 3 ? 'stat_odometer' : 'stat_card';
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

// Cuántas veces se dice la palabra o la frase. Sirve para decidir si un
// disparador es inequívoco: si se dice una sola vez en todo el audio, se puede
// anclar aunque caiga fuera de la ventana prevista para la escena.
function countWordOccurrences(cues: Cue[], needle: string): number {
  const buscada = needle
    .split(/\s+/)
    .map(normalize)
    .filter((t) => t.length > 0);
  if (buscada.length === 0) return 0;
  const dichas = palabrasSeguidas(cues).map((w) => normalize(w.w));
  let total = 0;
  for (let i = 0; i <= dichas.length - buscada.length; i += 1) {
    if (buscada.every((n, k) => dichas[i + k] === n)) total++;
  }
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
  /**
   * Insertos declarados con su ancla resuelta, pendientes de imagen. La
   * colocación es síncrona pero la imagen exige red (stock + Commons + juez),
   * así que aquí solo viaja el término y el instante: los resuelve
   * `resolverInsertos` en la orquestación y el que falla se cae sin edit.
   */
  insertos: Array<{ term: string; beatIdx: number; beatText: string; atMs: number; toMs: number }>;
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
  const insertos: IntentPlacement['insertos'] = [];
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
        case 'inserto':
          // el edit no se puede montar aquí: falta la imagen (red + juez).
          // card_text afina la búsqueda si el nombre a secas es ambiguo.
          insertos.push({
            term: card !== '' ? card : intent.trigger_word,
            beatIdx: beat.idx,
            beatText: beat.text,
            atMs,
            toMs: win(DUR_MS.imagen_apoyo!),
          });
          break;
      }
      if (intent.effect !== 'keyword') covered.add(beat.idx);
    }
  }
  return { edits, covered, dropped, insertos };
}

/**
 * Micro-FX: acentos disparados por una palabra del catálogo. Cada efecto entra
 * UNA sola vez en todo el vídeo, así que el techo estructural es el tamaño del
 * catálogo por muy largo que sea el vídeo.
 */
export function microFxEdits(params: EditingParams, opts?: { vertical?: boolean }): Edit[] {
  const edits: Edit[] = [];
  const usados = new Set<string>();
  for (const cue of params.cues) {
    for (const word of cue.words) {
      const def = microFxFor(word.w);
      if (def === null || usados.has(def.id)) continue;
      // las piezas de gramática vertical no entran en 16:9: el motivo del
      // descarte original (a 46 px se pierden) sigue vigente en apaisado
      if (def.soloVertical === true && opts?.vertical !== true) continue;
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
              // la palabra disparadora EN escena es la gramática de estas
              // piezas (el sello estampa «PROHIBIDO», no un trazo)
              ...(def.conPalabra === true ? { text: word.w } : {}),
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

// Palabras que abren un título y no son parte de un nombre propio. Sin esta
// lista, «Qué Propone» o «Por Qué» se colarían como entidad en cuanto un
// título use mayúsculas de titular.
const NO_ES_NOMBRE = new Set([
  'que',
  'por',
  'como',
  'cuando',
  'donde',
  'cual',
  'quien',
  'esto',
  'esta',
  'este',
  'los',
  'las',
  'del',
  'con',
  'para',
  'sin',
  'una',
  'unos',
  'unas',
  'todo',
  'toda',
  'sus',
  'the',
  'and',
  'for',
]);

/**
 * Entidad NOMBRADA del vídeo: dos palabras capitalizadas seguidas («Elon
 * Musk», «Sam Altman»), admitiendo partículas («Ursula von der Leyen»).
 *
 * Se busca en el TÍTULO y en los claims del research, no en el guion, y por un
 * motivo concreto: el guion habla en corto —dice «Musk»— mientras que el
 * título y las fuentes escriben el nombre completo. Ese nombre completo es el
 * que sirve para BUSCAR la imagen; el corto es el que se pronuncia y por tanto
 * el que sirve para ANCLARLA.
 */
export function entidadNombrada(
  title: string | undefined,
  claims: readonly { text: string }[],
): { completo: string; corto: string } | null {
  const fuentes = [title ?? '', ...claims.map((c) => c.text)];
  const re =
    /\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\s+((?:(?:van|von|de|del|der|la|di|da)\s+)*[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})/u;
  for (const fuente of fuentes) {
    const m = re.exec(fuente);
    if (!m) continue;
    const primera = m[1]!;
    const resto = m[2]!;
    if (NO_ES_NOMBRE.has(normalize(primera))) continue;
    const corto = resto.split(/\s+/).at(-1)!;
    if (NO_ES_NOMBRE.has(normalize(corto))) continue;
    return { completo: `${primera} ${resto}`, corto };
  }
  return null;
}

/**
 * Inserto que el guion NO declaró pero que el vídeo pide igualmente: si el
 * tema tiene una persona o entidad con nombre y esa entidad se PRONUNCIA, hay
 * que enseñarla. Es la misma clase de red que `DOMAIN_RE` → device_frame: una
 * regla determinista que cubre lo que el guionista se dejó.
 *
 * Uno por vídeo y en la PRIMERA mención pronunciada: el sujeto del vídeo se
 * presenta al principio, no a mitad. El juez de planos lo veta igual que a
 * cualquier otro, así que una entidad sin foto convincente no pinta nada.
 */
export function insertoAutomatico(
  params: EditingParams,
): { term: string; beatIdx: number; beatText: string; atMs: number; toMs: number } | null {
  const entidad = entidadNombrada(params.title, params.claims ?? []);
  if (entidad === null) return null;
  // se ancla al nombre CORTO (es lo que se pronuncia) o al completo si el
  // guion lo dice entero; el término de búsqueda es siempre el completo
  const hit =
    findWordMs(params.cues, entidad.completo) ?? findWordMs(params.cues, entidad.corto);
  if (hit === null) return null;
  const beat = params.beats.find((b) => hit.from_ms >= b.from_ms && hit.from_ms < b.to_ms);
  if (beat === undefined) return null;
  return {
    term: entidad.completo,
    beatIdx: beat.idx,
    beatText: beat.text,
    atMs: hit.from_ms,
    toMs: Math.min(beat.to_ms, hit.from_ms + DUR_MS.imagen_apoyo!),
  };
}

// ---- capa IA (elige momentos potentes + redacta texto) ---------------------

const editingResultSchema = z.object({
  moments: z
    .array(
      z.object({
        beat_idx: z.number().int().nonnegative(),
        type: z.enum([
          'callout',
          'stat',
          'quote',
          'kinetic',
          'annotation',
          'device',
          // Las tres formas que dibujan una RELACIÓN y no texto en una caja.
          // Existían desde siempre, pero solo las podía pedir el GUION vía
          // edit_intents: el director nunca las tuvo en su vocabulario, así
          // que cuando la voz decía «los tres pasos» salía un rótulo que
          // repetía «los tres pasos» en vez de tres pasos dibujados.
          'versus',
          'pasos',
          'tendencia',
          // A frente a B CON magnitud: dos barras a escala. Nueva del sprint
          // de formas, elegida por frecuencia en el banco de frases (3/39).
          'barras',
          // orden de hechos con su cuándo: hitos sobre una línea (banco: 2/39)
          'linea_tiempo',
          // algo que se retroalimenta: un anillo que se cierra (banco: 2/39)
          'ciclo',
          // mucho entra, poco sale: el embudo de la criba (banco: 3/39)
          'cuello',
          // niveles apilados de la base a la cima: arquitectura (banco: 2/39)
          'capas',
          // una decisión que se ramifica desde un origen común (banco: 1/39)
          'arbol',
        ]),
        text: z.string().optional(),
        value: z.string().optional(),
        label: z.string().optional(),
        /** versus/barras: los dos lados. pasos/capas: de 2 a 4 elementos. */
        items: z.array(z.string()).optional(),
        /** barras: las dos magnitudes tal y como se dicen, misma unidad */
        values: z.array(z.string()).optional(),
        /** linea_tiempo: 2-4 hitos, cada uno con su cuándo y su qué */
        hitos: z.array(z.object({ fecha: z.string(), texto: z.string() })).optional(),
        /** cuello: lo que entra (2-4) y lo único que sale */
        entradas: z.array(z.string()).optional(),
        salida: z.string().optional(),
        /** arbol: el origen y sus 2-3 ramas */
        raiz: z.string().optional(),
        ramas: z.array(z.string()).optional(),
        direccion: z.enum(['sube', 'baja']).optional(),
        keyword: z.string().optional(),
        style: z.string().optional(),
      })
        // Una cifra sin etiqueta no dice nada: un «5» flotando en pantalla es
        // ruido, no un dato. El prompt ya pedía la etiqueta y el modelo la
        // omitía sin consecuencia; aquí falla el esquema y se reintenta, que
        // es mejor que perder la tarjeta. Medido: las DOS únicas tarjetas de
        // dato de los vídeos entregados salieron sin etiqueta.
        .refine((m) => m.type !== 'stat' || (m.label ?? '').trim() !== '', {
          message: 'un momento "stat" necesita label',
        })
        // una forma sin sus datos no se puede dibujar: mejor que falle el
        // esquema y se reintente que colocar un gráfico vacío
        .refine((m) => m.type !== 'versus' || (m.items ?? []).length === 2, {
          message: 'un momento "versus" necesita exactamente 2 items',
        })
        .refine(
          (m) => m.type !== 'pasos' || ((m.items ?? []).length >= 2 && (m.items ?? []).length <= 4),
          { message: 'un momento "pasos" necesita de 2 a 4 items' },
        )
        .refine((m) => m.type !== 'tendencia' || (m.value ?? '').trim() !== '', {
          message: 'un momento "tendencia" necesita value',
        })
        // sin las dos magnitudes no hay proporción que dibujar: mejor
        // reintentar el esquema que pintar dos barras iguales que mienten
        .refine(
          (m) => m.type !== 'barras' || ((m.items ?? []).length === 2 && (m.values ?? []).length === 2),
          { message: 'un momento "barras" necesita 2 items y 2 values' },
        )
        // sin fecha no hay línea de tiempo, hay una lista — y para eso ya
        // están los pasos
        .refine(
          (m) =>
            m.type !== 'linea_tiempo' ||
            ((m.hitos ?? []).length >= 2 &&
              (m.hitos ?? []).length <= 4 &&
              (m.hitos ?? []).every((h) => h.fecha.trim() !== '' && h.texto.trim() !== '')),
          { message: 'un momento "linea_tiempo" necesita de 2 a 4 hitos con fecha y texto' },
        )
        // con una sola estación no hay vuelta que cerrar
        .refine(
          (m) => m.type !== 'ciclo' || ((m.items ?? []).length >= 2 && (m.items ?? []).length <= 4),
          { message: 'un momento "ciclo" necesita de 2 a 4 items' },
        )
        // sin entradas no hay criba y sin salida no hay argumento
        .refine(
          (m) =>
            m.type !== 'cuello' ||
            ((m.entradas ?? []).length >= 2 &&
              (m.entradas ?? []).length <= 4 &&
              (m.salida ?? '').trim() !== ''),
          { message: 'un momento "cuello" necesita de 2 a 4 entradas y una salida' },
        )
        .refine(
          (m) => m.type !== 'capas' || ((m.items ?? []).length >= 2 && (m.items ?? []).length <= 4),
          { message: 'un momento "capas" necesita de 2 a 4 items (de la base a la cima)' },
        )
        .refine(
          (m) =>
            m.type !== 'arbol' ||
            ((m.raiz ?? '').trim() !== '' &&
              (m.ramas ?? []).length >= 2 &&
              (m.ramas ?? []).length <= 3),
          { message: 'un momento "arbol" necesita raiz y de 2 a 3 ramas' },
        ),
    )
    // 8 era el techo real del vídeo largo: por muchos beats que tuviera, el
    // director no podía proponer más de ocho momentos en ocho minutos. El
    // prompt pide el número que toca según la duración; esto solo deja de
    // estorbar.
    .max(24),
});

function buildEditingPrompt(
  params: EditingParams,
  /** vertical: pieza de menos de un minuto, con su propia densidad */
  vertical = false,
): { system: string; user: string } {
  const langName = params.lang === 'en' ? 'inglés' : 'español';
  const lastIdx = params.beats.length > 0 ? params.beats[params.beats.length - 1]!.idx : 0;
  // Los beats que llegan aquí son los HUECOS: los que nadie ha cubierto. Pedir
  // la mitad dejaba la mitad vacía por construcción, que es justo lo contrario
  // de para lo que existe esta capa.
  const maxMomentos = Math.min(24, Math.max(6, params.beats.length));
  const system = [
    'Eres editor de vídeo de un canal de YouTube tipo "faceless".',
    'Recibes la narración por beats numerados. Elige los MOMENTOS más potentes',
    vertical
      ? // Un short tiene DOS O TRES beats en total, así que «uno cada 2-3
        // beats» da uno o dos efectos en toda la pieza. La densidad de este
        // formato se mide en segundos, y varios momentos caben en un beat:
        // cada uno se ancla a SU palabra, no al principio del beat.
        'para superponer un efecto que enganche. Es una pieza VERTICAL de menos de un minuto: elige un momento cada 2-3 SEGUNDOS de narración. Varios momentos pueden caer en el MISMO beat, cada uno con su propia keyword.'
      : 'para superponer un efecto que enganche. Los beats que te paso son los que están VACÍOS: propón uno para cada uno que se preste, sin forzar los que no dan.',
    'Tipos:',
    '- "kinetic": tipografía cinética a pantalla completa, una frase MUY corta de 2-4 palabras (text) que es el golpe del gancho. Úsalo SOLO en el arranque.',
    '- "callout": una etiqueta de 2-5 palabras que refuerza la idea clave del beat.',
    // La regla de cifras va INVERTIDA respecto a la versión anterior, que decía
    // «incluye también cifras que en la narración van con letra» e invitaba a
    // redondear o fabricar magnitudes. Ahora la cifra tiene que estar dicha.
    '- "stat": una cifra que se DICE en ese beat (value) + label corto. value debe aparecer literalmente en la narración del beat: si se dice con letra, escríbela con letra tal cual. Si el beat no trae cifra, no propongas stat. Nunca redondees ni inventes una magnitud.',
    '- "quote": una frase textual breve y citable del beat (text).',
    '- "annotation": marca dibujada a mano para SEÑALAR algo concreto en pantalla; text = etiqueta muy corta opcional. Úsalo con moderación (momentos de "mira esto").',
    // el marco de navegador es 16:9 por definición: en vertical no se ofrece,
    // porque un momento que el render va a tirar es una ranura desperdiciada
    vertical
      ? ''
      : '- "device": muestra una web o comando en un marco de navegador; text = la URL o el comando (p. ej. "grapheneos.org"). Solo si el guion menciona un sitio/herramienta concreta.',
    // Las formas que DIBUJAN una relación. Solo en vertical: en apaisado
    // las declara el guion vía edit_intents, con su propio vocabulario, y
    // ofrecerlas también aquí duplicaría la decisión en dos sitios.
    ...(vertical
      ? [
          '- "versus": DOS cosas enfrentadas, items = exactamente 2 etiquetas cortas. Para "frente a", "en vez de", "antes y ahora".',
          '- "pasos": un proceso, items = de 2 a 4 estaciones muy cortas EN ORDEN. Para "primero… luego…", "los tres pasos", "el cuello de botella está en X" (pon X como última estación).',
          '- "tendencia": una cifra que se dispara o se hunde; value = la cifra dicha, direccion = "sube" o "baja", label = de qué. Para "se disparó", "cayó a la mitad".',
          '- "barras": A frente a B CON magnitud; items = las 2 etiquetas, values = las 2 cifras TAL Y COMO SE DICEN y en la MISMA unidad ("3 semanas" y "2 horas" NO — "504 h" y "2 h" SÍ). Para "diez veces más", "semanas frente a horas". Las dos cifras tienen que estar dichas o respaldadas; nunca las inventes.',
          '- "linea_tiempo": orden de hechos con su cuándo; hitos = de 2 a 4 objetos { "fecha", "texto" }, fecha MUY corta ("julio", "2026", "hoy") y dicha en la narración, texto de 2-4 palabras. Para "primero pasó… y luego…", plazos y cronologías.',
          '- "ciclo": algo que se retroalimenta; items = de 2 a 4 estaciones muy cortas EN ORDEN cuya última vuelve a la primera. Para "y eso vuelve a alimentar…", "el ciclo entre alerta y contención". NO es una lista: úsalo solo si la vuelta al principio es lo que la frase dice.',
          '- "cuello": mucho entra y poco sale; entradas = de 2 a 4 cosas que entran, salida = lo ÚNICO que pasa la criba. Para "de cientos solo tres llegan", "todo acaba pasando por X". La criba tiene que estar dicha, no la inventes.',
          '- "capas": niveles APILADOS de la base a la cima; items = de 2 a 4 niveles muy cortos, el primero es la BASE. Para "tres capas", "por encima de eso va…". Es arquitectura, no cronología: si hay orden temporal usa "pasos".',
          '- "arbol": una decisión que se RAMIFICA; raiz = el origen (2-4 palabras), ramas = de 2 a 3 opciones cortas. Para "si funciona, escala; si no, se descarta". NO es un versus: las opciones salen del mismo origen.',
          'PREFIERE estas formas a un "callout" siempre que la frase exprese una relación: un rótulo que repite lo que ya dice el subtítulo no aporta nada.',
        ]
      : []),
    '',
    // sin palabra de anclaje el efecto no se puede sincronizar con la locución:
    // el código descarta el momento, así que pedirla es obligatorio
    'keyword OBLIGATORIA en TODOS los momentos: una palabra EXACTA tal y como aparece escrita en la narración de ESE beat. El efecto entra en el instante en que se pronuncia. Un momento sin keyword válida se descarta, así que cópiala del texto del beat, no la inventes ni la conjugues.',
    `text/card: como mucho ${MAX_CARD_WORDS} palabras. Es un titular que resume la frase, no una transcripción.`,
    // gancho: tipografía cinética al abrir + payoff al cerrar
    `- OBLIGATORIO: un "kinetic" en el beat ${params.beats[0]?.idx ?? 0} con la frase-golpe del gancho, y un "callout" en el beat ${lastIdx} con el PAYOFF/conclusión.`,
    vertical
      ? `Textos en ${langName}, muy cortos, sin comillas. Máximo 8 momentos; como mucho 1 "kinetic", 3 "annotation" y 2 de cada forma ("versus", "pasos", "tendencia", "barras", "linea_tiempo", "ciclo", "cuello", "capas", "arbol").`
      : // El tope era 6 fijo, o sea seis gráficos en ocho minutos. Ahora sale
        // de los beats que se le pasan, que son los que no ha cubierto nadie.
        `Textos en ${langName}, muy cortos, sin comillas. Máximo ${maxMomentos} momentos; como mucho 1 "kinetic", 1 "device" y ${Math.max(2, Math.round(maxMomentos / 4))} "annotation".`,
    vertical
      ? 'Devuelve JSON: { "moments": [ { "beat_idx", "type", "keyword", "text"?, "value"?, "label"?, "items"?, "values"?, "hitos"?, "direccion"?, "entradas"?, "salida"?, "raiz"?, "ramas"? } ] }.'
      : 'Devuelve JSON: { "moments": [ { "beat_idx", "type", "keyword", "text"?, "value"?, "label"? } ] }.',
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
    // la misma regla que el esquema, para lo que no pasa por él (mocks,
    // maestros antiguos): sin etiqueta, la cifra no se pinta
    if (m.type === 'stat' && (m.label ?? '').trim() === '') continue;
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
    } else if (m.type === 'versus' && (m.items ?? []).length === 2) {
      edits.push({
        type: 'split_versus',
        from_ms: at,
        to_ms: window(DUR_MS.split_versus!),
        beat_idx: beat.idx,
        items: m.items!,
      });
    } else if (m.type === 'pasos' && (m.items ?? []).length >= 2) {
      edits.push({
        type: 'pasos_flow',
        from_ms: at,
        to_ms: window(DUR_MS.pasos_flow!),
        beat_idx: beat.idx,
        items: m.items!.slice(0, 4),
      });
    } else if (m.type === 'tendencia' && m.value) {
      // la cifra sigue la misma regla que stat: dicha o respaldada, nunca
      // redondeada ni inventada
      if (!figureBackedBy(m.value, [beat.text, ...claimTexts])) continue;
      edits.push({
        type: 'tendencia',
        from_ms: at,
        to_ms: window(DUR_MS.tendencia!),
        beat_idx: beat.idx,
        value: m.value,
        // el contrato lo llama `style`: es el perfil de la curva, no un color
        style: m.direccion ?? 'sube',
        ...(m.label ? { label: m.label } : {}),
      });
      edits.push({ type: 'sfx', from_ms: at, to_ms: at + 400, sfx: 'pop' });
    } else if (m.type === 'barras' && (m.items ?? []).length === 2 && (m.values ?? []).length === 2) {
      // las DOS magnitudes siguen la regla de stat/tendencia: dichas en el beat
      // o respaldadas por un claim — una barra a escala inventada es peor que
      // ninguna, porque la proporción ES la afirmación
      const respaldadas = m.values!.every((v) => figureBackedBy(v, [beat.text, ...claimTexts]));
      if (!respaldadas) continue;
      edits.push({
        type: 'barras',
        from_ms: at,
        to_ms: window(DUR_MS.barras!),
        beat_idx: beat.idx,
        items: m.items!,
        values: m.values!,
        ...(m.label ? { label: m.label } : {}),
      });
      edits.push({ type: 'sfx', from_ms: at, to_ms: at + 400, sfx: 'pop' });
    } else if (m.type === 'linea_tiempo' && (m.hitos ?? []).length >= 2) {
      const hitos = m
        .hitos!.map((h) => ({ fecha: h.fecha.trim(), texto: h.texto.trim() }))
        .filter((h) => h.fecha !== '' && h.texto !== '')
        .slice(0, 4);
      if (hitos.length < 2) continue;
      // una fecha CON dígitos sigue la regla de las cifras: dicha en el beat o
      // respaldada por un claim. «hoy» o «mañana» no tienen nada que fabricar,
      // pero un «2019» que nadie dijo es una cronología inventada.
      const fechasOk = hitos.every(
        (h) => !/\d/.test(h.fecha) || figureBackedBy(h.fecha, [beat.text, ...claimTexts]),
      );
      if (!fechasOk) continue;
      edits.push({
        type: 'linea_tiempo',
        from_ms: at,
        to_ms: window(DUR_MS.linea_tiempo!),
        beat_idx: beat.idx,
        hitos,
      });
    } else if (m.type === 'ciclo' && (m.items ?? []).length >= 2) {
      // estaciones sin cifras: no hay magnitud que respaldar, solo rótulos —
      // la misma situación que pasos_flow
      edits.push({
        type: 'ciclo',
        from_ms: at,
        to_ms: window(DUR_MS.ciclo!),
        beat_idx: beat.idx,
        items: m.items!.slice(0, 4),
      });
    } else if (
      m.type === 'cuello' &&
      (m.entradas ?? []).length >= 2 &&
      (m.salida ?? '').trim() !== ''
    ) {
      edits.push({
        type: 'cuello',
        from_ms: at,
        to_ms: window(DUR_MS.cuello!),
        beat_idx: beat.idx,
        entradas: m.entradas!.slice(0, 4),
        salida: m.salida!,
        ...(m.label ? { label: m.label } : {}),
      });
    } else if (m.type === 'capas' && (m.items ?? []).length >= 2) {
      edits.push({
        type: 'capas',
        from_ms: at,
        to_ms: window(DUR_MS.capas!),
        beat_idx: beat.idx,
        items: m.items!.slice(0, 4),
      });
    } else if (
      m.type === 'arbol' &&
      (m.raiz ?? '').trim() !== '' &&
      (m.ramas ?? []).length >= 2
    ) {
      edits.push({
        type: 'arbol',
        from_ms: at,
        to_ms: window(DUR_MS.arbol!),
        beat_idx: beat.idx,
        raiz: m.raiz!,
        ramas: m.ramas!.slice(0, 3),
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
      // el marco de dispositivo teclea su texto en una barra de URL: si el
      // texto de la IA no parece dominio/comando, se degrada a callout — la
      // misma regla que la capa declarada (validateSceneIntents)
      if (deviceTextValido(m.text)) {
        edits.push({
          type: 'device_frame',
          from_ms: at,
          to_ms: window(DUR_MS.device_frame!),
          beat_idx: beat.idx,
          style: m.style ?? 'browser',
          text: m.text,
        });
      } else {
        edits.push({
          type: 'text_callout',
          from_ms: at,
          to_ms: window(DUR_MS.text_callout!),
          beat_idx: beat.idx,
          text: m.text,
        });
        edits.push({ type: 'sfx', from_ms: at, to_ms: at + 400, sfx: 'pop' });
      }
    }
    // momento sin texto/valor válido: no genera edit
  }
  return edits;
}

// ---- orquestación: reglas + IA, dedupe y tope de densidad ------------------

// Overlays que ocupan pantalla, DERIVADOS del contrato (EDIT_RENDER_KIND):
// un edit nuevo clasificado 'overlay' entra aquí solo, sin lista que olvidar.
// Es la misma derivación que usa el informe de calidad — antes eran dos listas
// de literales y divergían (el informe no contaba zoom_punch y este sí).
const OVERLAY_TYPES = new Set<string>(
  Object.entries(EDIT_RENDER_KIND)
    .filter(([, kind]) => kind === 'overlay')
    .map(([type]) => type),
);
// Lo que compite en el CARRIL DE TARJETAS: los overlays MÁS zoom_punch (es
// 'camara', no overlay, pero un golpe de zoom y una tarjeta en el mismo beat
// se pelean por la atención igual). Los SFX/keyword no cuentan; annotation es
// un acento ligero que layerea sobre el b-roll → tampoco compite.
//
// `imagen_apoyo` queda FUERA a propósito: tiene carril propio. Una tarjeta es
// intercambiable —si cae una, entra otra en la ventana siguiente—, pero el
// inserto es la única vía de enseñar a la persona o el producto del que se
// habla, y además llega con una imagen ya buscada, juzgada y descargada.
// Perderlo en el reparto no es «una tarjeta menos»: es que el sujeto no sale.
const VISUAL_TYPES = new Set<string>(
  [...OVERLAY_TYPES, 'zoom_punch'].filter((t) => t !== 'imagen_apoyo'),
);
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
 *
 * El conteo es DOBLE: presupuesto global Y cobertura por ventana. Solo el
 * global dejaba escapar el caso medido (2 minutos mudos con el presupuesto
 * cubierto): si el guion concentra sus tarjetas al principio, el total cumple
 * pero hay tramos de ~50 s sin nada. La ventana es la MISMA rejilla del
 * reparto (durationMs/presupuesto), no el minuto de reloj del informe — ya se
 * probó alinearlas y se revirtió (comentario en spreadByWindows). Aquí cuentan
 * solo los overlays de verdad (sin zoom_punch): un golpe de zoom no rescata a
 * un minuto de sentirse vacío, que es justo la discrepancia que el informe
 * denunciaba como minuto_mudo.
 */
export function hacenFaltaMasTarjetas(
  puestas: readonly Edit[],
  durationMs: number,
  budget?: number,
): boolean {
  const presupuesto = budget ?? Math.max(1, Math.round((durationMs / 60_000) * FX_CARDS_PER_MIN));
  const overlays = puestas.filter((e) => OVERLAY_TYPES.has(e.type));
  if (overlays.length < presupuesto) return true;
  const windowMs = Math.max(1, durationMs / presupuesto);
  const nVentanas = Math.max(1, Math.round(durationMs / windowMs));
  const cubiertas = new Set(
    overlays.map((e) => Math.min(nVentanas - 1, Math.floor(e.from_ms / windowMs))),
  );
  return cubiertas.size < nVentanas;
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
  // las formas nuevas del sprint valen lo mismo: sin entrada aquí puntuaban 0
  // (el fallback del ?? 0) y un zoom_punch (4) las mataba en su propia franja
  barras: 5,
  linea_tiempo: 5,
  ciclo: 5,
  device_frame: 5,
  stat_odometer: 5,
  stat_card: 5,
  // la imagen de referencia costó una búsqueda + juez + descarga y enseña el
  // SUJETO del que se habla: vale lo que una tarjeta de dato
  imagen_apoyo: 5,
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
    /**
     * Segunda pasada: gastar el presupuesto que la rejilla dejó sin usar.
     *
     * La rejilla elige UNO por ventana, así que cuando los candidatos se
     * agrupan —y se agrupan, porque el guion declara por escena— hay ventanas
     * con tres y ventanas con cero, y las de cero no se recuperan. Medido en un
     * vídeo real: 27 candidatos de overlay, 30 ventanas de presupuesto, 16
     * colocados. Los 11 que faltaban no sobraban por densos: sobraban por la
     * rejilla.
     *
     * El relleno recorre lo descartado en orden temporal y admite lo que
     * respete la separación mínima contra TODO lo ya elegido. La separación es
     * la que impide el amontonamiento; la rejilla solo repartía.
     */
    rellenar?: boolean;
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
  if (opts.rellenar === true && kept.length < opts.budget) {
    const sobrantes = items
      .filter((t) => !keptSet.has(t))
      .filter((t) => opts.reject === undefined || !opts.reject(t))
      .sort((a, b) => opts.at(a) - opts.at(b) || opts.score(b) - opts.score(a));
    const tiempos = kept.map((t) => opts.at(t)).sort((a, b) => a - b);
    for (const t of sobrantes) {
      if (kept.length >= opts.budget) break;
      const at = opts.at(t);
      if (tiempos.some((x) => Math.abs(x - at) < opts.sepMs)) continue;
      kept.push(t);
      keptSet.add(t);
      tiempos.push(at);
      tiempos.sort((a, b) => a - b);
    }
    kept.sort((a, b) => opts.at(a) - opts.at(b));
  }
  return { kept, dropped: items.filter((t) => !keptSet.has(t)) };
}

/**
 * Cuántos efectos caben en la pieza y cada cuánto. Existe porque los topes eran
 * TASAS POR MINUTO y la franja de no-amontonamiento era el BEAT: los dos
 * mecanismos son correctos en ocho minutos y degeneran en treinta segundos —la
 * tasa da 0,6 tarjetas y el beat impone un techo de dos o tres efectos por
 * pieza—. El largo pasa `presupuestoLargo()` y sale exactamente lo de antes.
 */
export interface PresupuestoFx {
  tarjetas: number;
  acentos: number;
  keywords: number;
  insertos: number;
  sepTarjetaMs: number;
  sepMicroMs: number;
  sepKeywordMs: number;
  /**
   * Carril propio para el zoom. Sin él, el zoom compite por el hueco de la
   * tarjeta, que es lo correcto en el largo: los dos ocupan el centro y uno
   * tapa al otro. En vertical el zoom es RITMO, no gráfico, y perder una cifra
   * en pantalla para ganar un empujón de cámara sale caro.
   */
  zooms?: number;
  sepZoomMs?: number;
  /** franja de un solo overlay visual, en ms. Sin ella, la franja es el beat. */
  granoMs?: number;
}

export function presupuestoLargo(durationMs: number): PresupuestoFx {
  const minutos = durationMs / 60_000;
  const porMin = (tasa: number): number => Math.max(1, Math.round(minutos * tasa));
  return {
    tarjetas: porMin(FX_CARDS_PER_MIN),
    acentos: porMin(FX_MICRO_PER_MIN),
    keywords: porMin(FX_KEYWORDS_PER_MIN),
    insertos: porMin(FX_INSERTOS_PER_MIN),
    sepTarjetaMs: FX_CARD_SEP_MS,
    sepMicroMs: FX_MICRO_SEP_MS,
    sepKeywordMs: FX_KEYWORD_SEP_MS,
    granoMs: FX_FRANJA_MS,
  };
}

/** Absoluto por pieza. `insertos: 0` porque `imagen_apoyo` no vive en vertical. */
export const PRESUPUESTO_VERTICAL: PresupuestoFx = {
  tarjetas: SHORT_CARDS_MAX,
  acentos: SHORT_MICRO_MAX,
  keywords: SHORT_KEYWORDS_MAX,
  insertos: 0,
  sepTarjetaMs: SHORT_FX_CARD_SEP_MS,
  sepMicroMs: SHORT_FX_MICRO_SEP_MS,
  sepKeywordMs: SHORT_FX_KEYWORD_SEP_MS,
  zooms: SHORT_ZOOMS_MAX,
  sepZoomMs: SHORT_FX_ZOOM_SEP_MS,
  granoMs: SHORT_FX_GRANO_MS,
};

export function dedupeAndCap(
  edits: Edit[],
  durationMs: number,
  declared: ReadonlySet<Edit> = new Set(),
  presupuesto?: PresupuestoFx,
): Edit[] {
  const p = presupuesto ?? presupuestoLargo(durationMs);
  // La franja: el beat en el largo, un tramo de tiempo cuando el formato lo
  // pide. Es el mismo criterio —no apilar dos gráficos en la misma idea— con
  // otra unidad; en treinta segundos la idea no dura un beat entero.
  const franja = (e: Edit): number =>
    p.granoMs === undefined ? (e.beat_idx ?? e.from_ms) : Math.floor(e.from_ms / p.granoMs);
  // dedupe overlays por (type, franja); una franja no lleva dos del mismo tipo
  const seen = new Set<string>();
  const kept: Edit[] = [];
  for (const e of edits) {
    if (VISUAL_TYPES.has(e.type)) {
      const key = `${e.type}:${franja(e)}`;
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
  const zooms: Edit[] = [];
  for (const e of kept) {
    if (!VISUAL_TYPES.has(e.type) || e.beat_idx === undefined) {
      passthrough.push(e);
      continue;
    }
    if (p.zooms !== undefined && e.type === 'zoom_punch') {
      zooms.push(e);
      continue;
    }
    const clave = franja(e);
    const cur = bestPerBeat.get(clave);
    if (!cur || puntua(e) > puntua(cur)) bestPerBeat.set(clave, e);
  }
  // Reparto por ventanas en vez del recorte por prioridad: con el `slice`
  // anterior, un vídeo cuyo primer minuto daba mucho material se quedaba con
  // todos los efectos apelotonados al principio y minutos enteros mudos.
  const tarjetas = spreadByWindows([...bestPerBeat.values()], {
    budget: p.tarjetas,
    durationMs,
    sepMs: p.sepTarjetaMs,
    at: (e) => e.from_ms,
    // lo DECLARADO por el guion gana a lo inferido por reglas o por la IA
    score: puntua,
    rellenar: true,
    // NO se fuerza aquí una ventana de un minuto. Se probó, con la idea de
    // alinear la rejilla del reparto (duración/presupuesto, 51 s) con la del
    // informe (minutos de reloj). Medido sobre un vídeo real: costó una tarjeta
    // de cinco y NO quitó ni un minuto mudo, porque los minutos mudos no venían
    // de la rejilla — venían de que en el primer y el último minuto no había ni
    // un solo candidato. Eso se arregla arriba, en qué escenas declara tarjeta
    // el guion, no aquí.
  }).kept;
  // El carril del zoom solo existe si el formato lo pidió; en el largo `zooms`
  // está vacío porque los zoom_punch siguen compitiendo arriba con las tarjetas.
  const zoomsKept =
    p.zooms === undefined
      ? []
      : spreadByWindows(zooms, {
          budget: p.zooms,
          durationMs,
          sepMs: p.sepZoomMs ?? p.sepTarjetaMs,
          at: (e) => e.from_ms,
          score: puntua,
        }).kept;
  const visuals = [...tarjetas, ...zoomsKept];
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
  const insertos: Edit[] = [];
  const rest: Edit[] = [];
  for (const e of others) {
    if (e.type === 'annotation' || e.type === 'micro_fx') acentos.push(e);
    else if (e.type === 'keyword_highlight') keywords.push(e);
    else if (e.type === 'imagen_apoyo') insertos.push(e);
    else rest.push(e);
  }
  const solapa = (e: Edit, v: Edit): boolean =>
    e.from_ms >= v.from_ms - FX_CARD_GUARD_MS && e.from_ms <= v.to_ms + FX_CARD_GUARD_MS;
  /** ¿Se pisan los dos TRAMOS? (`solapa` solo mira dónde empieza el primero) */
  const seTapan = (a: Edit, b: Edit): boolean =>
    a.from_ms < b.to_ms + FX_CARD_GUARD_MS && b.from_ms < a.to_ms + FX_CARD_GUARD_MS;
  // Qué tarjetas ocupan de verdad la BANDA SUPERIOR, que es donde vive el
  // inserto (marginTop 110, igual que TextCallout). Las demás van centradas en
  // pantalla y conviven con él sin taparlo: una foto arriba y una cifra en el
  // centro es un montaje normal, no un choque. Sin esta distinción, el inserto
  // de la primera mención moría contra cualquier tarjeta del gancho — que es
  // justo el momento en que hay que presentar al sujeto del vídeo.
  const enBandaSuperior = (e: Edit): boolean => EDIT_BANDA[e.type] === 'superior';
  // Carril de INSERTOS: tope propio y guarda contra las tarjetas (los dos
  // ocupan la banda superior). Va antes que acentos y subrayados porque su
  // imagen ya está buscada, juzgada y descargada: si cae, se pierde la única
  // vez que el espectador podía VER a la persona nombrada.
  //
  // Aquí NO se reparte por ventanas como en los demás carriles. La rejilla
  // existe para evitar el apelotonamiento cuando SOBRA material, y con los
  // insertos pasa lo contrario: son dos o tres por vídeo, caros y escasos.
  // Con ventanas, dos insertos separados DOS MINUTOS caían en la misma casilla
  // y uno moría sin estar apelotonado con nada. El criterio correcto para
  // material escaso es «todos los que quepan sin pisarse»: orden temporal,
  // separación mínima y tope.
  const topeInsertos = p.insertos;
  const insertosKept: Edit[] = [];
  for (const e of [...insertos].sort((a, b) => a.from_ms - b.from_ms)) {
    if (insertosKept.length >= topeInsertos) break;
    if (visuals.filter(enBandaSuperior).some((v) => solapa(e, v))) continue;
    const ultimo = insertosKept[insertosKept.length - 1];
    if (ultimo && e.from_ms - ultimo.from_ms < p.sepTarjetaMs) continue;
    insertosKept.push(e);
  }
  // Una tarjeta CENTRADA y un inserto no conviven: pierde la de menos peso.
  //
  // El reparto de arriba deja pasar al inserto si no choca con nada de la banda
  // superior, con el argumento de que una foto arriba y una cifra en el centro
  // conviven. Medido sobre un fotograma real: el recuadro del inserto es lo
  // bastante alto como para llegar al centro, y la tarjeta de cita quedó
  // ILEGIBLE detrás de la foto. El informe lo denunciaba y producción decía ok.
  //
  // No se tira siempre la tarjeta: `kinetic_text` es el centro del gancho y
  // vale más que cualquier foto. Decide la misma prioridad que reparte todo lo
  // demás, y el empate lo gana el inserto porque es lo ESCASO: costó una
  // búsqueda, un juez y una descarga, y es la única vez que el espectador puede
  // VER a la persona nombrada.
  const tapadas = new Set(
    visuals.filter((v) => insertosKept.some((ins) => seTapan(v, ins) && puntua(v) <= puntua(ins))),
  );
  const visualesVivos = visuals.filter((v) => !tapadas.has(v));
  // y al revés: el inserto cede ante lo que vale más que él
  const insertosVivos = insertosKept.filter(
    (ins) => !visualesVivos.some((v) => seTapan(v, ins) && puntua(v) > puntua(ins)),
  );

  // acentos y subrayados esquivan tanto las tarjetas como los insertos
  const pisaTarjeta = (e: Edit): boolean =>
    visualesVivos.some((v) => solapa(e, v)) || insertosVivos.some((v) => solapa(e, v));
  const acentosKept = spreadByWindows(acentos, {
    budget: p.acentos,
    durationMs,
    sepMs: p.sepMicroMs,
    at: (e) => e.from_ms,
    score: (e) => (declared.has(e) ? 10 : 0),
    reject: pisaTarjeta,
    rellenar: true,
  }).kept;
  // El subrayado de subtítulo antes NO tenía tope: partía todos los tags de SEO
  // y encendía la palabra allá donde cayera, decenas de veces por vídeo.
  const keywordsKept = spreadByWindows(keywords, {
    budget: p.keywords,
    durationMs,
    sepMs: p.sepKeywordMs,
    at: (e) => e.from_ms,
    // una tarjeta centrada tapa el subtítulo: resaltarlo debajo no se vería
    // a igualdad, gana la palabra más larga: las cortas suelen ser genéricas
    score: (e) => (declared.has(e) ? 10 : 0) + ('keyword' in e ? e.keyword.length : 0) / 100,
    reject: pisaTarjeta,
  }).kept;

  // Los SFX se quedan huérfanos si su dueño cayó en el reparto. Antes solo se
  // limpiaba el `pop`, así que un `ding` podía sonar sin cifra en pantalla.
  const vivos = new Set(
    [...visualesVivos, ...insertosVivos, ...acentosKept, ...keywordsKept].map((e) => e.from_ms),
  );
  const ESTRUCTURALES = new Set(['riser', 'whoosh', 'resolucion', 'impacto']);
  const sonidos = rest.filter(
    (e) => e.type !== 'sfx' || ESTRUCTURALES.has(e.sfx ?? '') || vivos.has(e.from_ms),
  );

  return [...visualesVivos, ...insertosVivos, ...acentosKept, ...keywordsKept, ...sonidos].sort(
    (a, b) => a.from_ms - b.from_ms,
  );
}

export async function directEdits(
  ctx: WorkerContext,
  params: EditingParams,
  opts?: {
    /**
     * Resuelve los insertos declarados a imagen congelada (red + juez). Es
     * inyectable para que los tests no dependan de stock/Commons; en el
     * pipeline real es `resolverInsertos` de insertos.ts. Sin resolutor, los
     * insertos declarados simplemente no producen edit.
     */
    resolverInsertos?: (
      pendientes: IntentPlacement['insertos'],
    ) => Promise<Map<number, { imagePath: string; credit?: string }>>;
    /** topes y separaciones del formato; sin él, los del vídeo largo */
    presupuesto?: PresupuestoFx;
    /** lienzo 9:16: habilita los micro-FX de gramática vertical (soloVertical) */
    vertical?: boolean;
    /** claves extra para cost_ledger.meta (el short pasa aquí su short_id:
     * factura contra el largo y sin esto su coste marginal es invisible) */
    ledgerMeta?: Record<string, unknown>;
    /**
     * Efectos que la pieza ya trae puestos y hay que respetar. Los usa el
     * short: hereda del maestro largo los que caen en su ventana, y esos SÍ
     * vienen del guion aunque aquí no haya `scenes` para declararlos otra vez.
     * Entran como declarados, así que ganan el reparto.
     */
    heredados?: readonly Edit[];
  },
): Promise<Edit[]> {
  if (params.beats.length === 0) return [];
  const durationMs = params.beats[params.beats.length - 1]!.to_ms;

  // 1) lo que el guion declaró: máxima prioridad y sin adivinar nada
  const intents = intentEdits(params);
  const declared = new Set(intents.edits);
  const heredados = opts?.heredados ?? [];
  for (const e of heredados) {
    declared.add(e);
    if (e.beat_idx !== undefined) intents.covered.add(e.beat_idx);
  }
  const presupuesto = opts?.presupuesto;

  // 1b) insertos: la imagen se resuelve fuera (stock → Commons → juez) y el
  // que vuelve entra como edit DECLARADO (+10 en el reparto, como el resto de
  // lo que pidió el guion); el que no vuelve se cae sin dejar hueco vacío
  // red determinista: si el vídeo trata de una entidad con nombre y el guion
  // no pidió enseñarla, se pide aquí — el archivo de stock no tiene planos de
  // personas concretas, así que sin inserto el sujeto no aparece NUNCA
  const auto = insertoAutomatico(params);
  if (auto !== null) {
    const mismaEntidad = (a: string, b: string): boolean =>
      normalize(a).includes(normalize(b)) || normalize(b).includes(normalize(a));
    const yaCubierta = intents.insertos.findIndex((p) => mismaEntidad(p.term, auto.term));
    if (yaCubierta < 0) {
      intents.insertos.push(auto);
      ctx.logger.info(
        { videoId: params.videoId, entidad: auto.term },
        'Inserto automático: el vídeo nombra una entidad que el guion no pidió enseñar',
      );
    } else if (intents.insertos[yaCubierta]!.atMs > auto.atMs) {
      // El guion declaró el inserto en una mención POSTERIOR. Manda la
      // primera: al espectador se le presenta a alguien cuando se le nombra,
      // no cinco menciones después. Medido en un vídeo real: «Musk» era la
      // primera palabra del guion y la foto salía a los 24,6 s.
      ctx.logger.info(
        {
          videoId: params.videoId,
          entidad: auto.term,
          declaradoEn: intents.insertos[yaCubierta]!.atMs,
          primeraMencion: auto.atMs,
        },
        'Inserto adelantado a la primera mención de la entidad',
      );
      intents.insertos[yaCubierta] = auto;
    }
  }

  if (opts?.resolverInsertos && intents.insertos.length > 0) {
    let resueltos = new Map<number, { imagePath: string; credit?: string }>();
    try {
      resueltos = await opts.resolverInsertos(intents.insertos);
    } catch (err) {
      ctx.logger.warn(
        { err, videoId: params.videoId },
        'La resolución de insertos falló; el vídeo sigue sin ellos',
      );
    }
    for (const [i, res] of resueltos) {
      const p = intents.insertos[i];
      if (!p) continue;
      const edit: Edit = {
        type: 'imagen_apoyo',
        from_ms: p.atMs,
        to_ms: p.toMs,
        beat_idx: p.beatIdx,
        image_path: res.imagePath,
        text: p.term,
        ...(res.credit !== undefined ? { credit: res.credit } : {}),
      };
      intents.edits.push(edit);
      declared.add(edit);
      intents.edits.push({
        type: 'sfx',
        from_ms: p.atMs,
        to_ms: p.atMs + 400,
        sfx: 'aparicion',
      });
    }
    // el beat de un inserto VETADO recupera su red: si su único edit declarado
    // era el inserto y no volvió, dejarlo en covered lo condenaba a quedarse
    // sin regla de contenido y sin capa de IA — mudo por haber pedido algo
    const conEdit = new Set(
      intents.edits.flatMap((e) => (e.beat_idx !== undefined ? [e.beat_idx] : [])),
    );
    for (let i = 0; i < intents.insertos.length; i += 1) {
      const p = intents.insertos[i]!;
      if (!resueltos.has(i) && !conEdit.has(p.beatIdx)) intents.covered.delete(p.beatIdx);
    }
  }

  // 2) reglas estructurales + red de seguridad en los beats sin declarar
  const rules = ruleEdits({ ...params, covered: intents.covered });

  // 3) micro-FX disparados por palabra
  const micro = microFxEdits(params, { vertical: opts?.vertical === true });

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
  // El ahorro de «solo los beats que nadie ha cubierto» existe para no gastar
  // contexto en un vídeo de cuarenta beats. En una pieza de dos, un beat con un
  // solo efecto ya cuenta como cubierto y la llamada no llega a hacerse: el
  // formato denso pregunta siempre, y por toda la pieza.
  const denso = presupuesto?.granoMs !== undefined;
  const huecos = denso ? params.beats : params.beats.filter((b) => !cubiertos.has(b.idx));
  let aiEdits: Edit[] = [];
  if (
    (denso ||
      hacenFaltaMasTarjetas(
        [...heredados, ...intents.edits, ...rules],
        durationMs,
        presupuesto?.tarjetas,
      )) &&
    huecos.length > 0
  ) {
    try {
      const { system, user } = buildEditingPrompt({ ...params, beats: huecos }, denso);
      const data = await ledgeredLlmJson(ctx, {
        videoId: params.videoId,
        channelId: params.channelId,
        op: 'editing_director',
        system,
        user,
        schema: editingResultSchema,
        mockContext: { beats: huecos },
        ...(opts?.ledgerMeta !== undefined ? { meta: opts.ledgerMeta } : {}),
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
    [...heredados, ...intents.edits, ...rules, ...micro, ...aiEdits],
    durationMs,
    declared,
    presupuesto,
  );
  ctx.logger.info(
    {
      videoId: params.videoId,
      heredados: heredados.length,
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
