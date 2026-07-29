import { z } from 'zod';
import type { Cue, Edit, Scene } from '@fabrica/shared';
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
}

function normalize(w: string): string {
  return w.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
}

// ms de la primera aparición (o solapada con un rango) de una palabra en cues.
function findWordMs(cues: Cue[], needle: string, withinFrom = 0, withinTo = Infinity): Cue['words'][number] | null {
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

export function ruleEdits(params: EditingParams): Edit[] {
  const edits: Edit[] = [];
  const { beats, cues, scenes, segmentStartMs, seoTags } = params;

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

  // zoom_punch en beats de escenas marcadas con emphasis
  const emphasisMs = scenes
    .filter((s) => s.emphasis === true)
    .map((s) => findWordMs(cues, s.text.split(/\s+/)[0] ?? '', 0, Infinity)?.from_ms)
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
  const tagWords = seoTags.flatMap((t) => t.split(/\s+/)).filter((w) => w.length >= 4);
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
    '- "stat": una cifra impactante del beat (value) + label corto. Escribe value en DÍGITOS (p. ej. "1000000" o "10000", no "un millón"); incluye también cifras que en la narración van con letra. Las grandes se animan como contador de rodillo.',
    '- "quote": una frase textual breve y citable del beat (text).',
    '- "annotation": marca dibujada a mano para SEÑALAR algo concreto en pantalla; text = etiqueta muy corta opcional. Úsalo con moderación (momentos de "mira esto").',
    '- "device": muestra una web o comando en un marco de navegador; text = la URL o el comando (p. ej. "grapheneos.org"). Solo si el guion menciona un sitio/herramienta concreta.',
    // gancho: tipografía cinética al abrir + payoff al cerrar
    `- OBLIGATORIO: un "kinetic" en el beat ${params.beats[0]?.idx ?? 0} con la frase-golpe del gancho (2-4 palabras), y un "callout" en el beat ${lastIdx} con el PAYOFF/conclusión.`,
    `Textos en ${langName}, muy cortos, sin comillas. Máximo 6 momentos; como mucho 1 "kinetic", 1 "device" y 2 "annotation".`,
    'Devuelve JSON: { "moments": [ { "beat_idx", "type", "text"?, "value"?, "label"?, "keyword"? } ] }.',
  ].join('\n');
  const user = [
    params.title ? `Título del vídeo: ${params.title}` : '',
    params.hookNotes ? `Gancho (promesa/payoff): ${params.hookNotes}` : '',
    '',
    'Beats (idx · narración):',
    ...params.beats.map((b) => `${b.idx} · ${b.text.replace(/\s+/g, ' ').trim().slice(0, 180)}`),
  ]
    .filter((l) => l !== '')
    .join('\n');
  return { system, user };
}

export function momentsToEdits(
  moments: z.infer<typeof editingResultSchema>['moments'],
  beats: DirectorBeat[],
  cues: Cue[],
): Edit[] {
  const edits: Edit[] = [];
  for (const m of moments) {
    const beat = beatOf(beats, m.beat_idx);
    if (!beat) continue;
    // anclar al instante en que se dice la keyword o la 1ª palabra del texto,
    // no al inicio del beat (el overlay cae sobre la frase → se siente editado)
    const anchor = m.keyword ?? m.text ?? m.value ?? '';
    const firstWord = anchor.split(/\s+/)[0] ?? '';
    const at = findWordMs(cues, firstWord, beat.from_ms, beat.to_ms)?.from_ms ?? beat.from_ms;
    const window = (dur: number): number => Math.min(beat.to_ms, at + dur);

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
      edits.push({ type: 'text_callout', from_ms: at, to_ms: window(DUR_MS.text_callout!), beat_idx: beat.idx, text: m.text });
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
      edits.push({ type: 'quote_card', from_ms: at, to_ms: window(DUR_MS.quote_card!), beat_idx: beat.idx, text: m.text });
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
]);
// prioridad al recortar por densidad (mayor primero). kinetic_text es el
// centro del gancho: nunca se recorta. odómetro/tarjeta valen igual que stat.
const PRIORITY: Record<string, number> = {
  kinetic_text: 6,
  device_frame: 5,
  stat_odometer: 5,
  stat_card: 5,
  zoom_punch: 4,
  quote_card: 3,
  text_callout: 2,
};
// topes por tipo de acento no-competitivo (annotation): no saturar
const ANNOTATION_CAP = 2;

function dedupeAndCap(edits: Edit[], durationMs: number): Edit[] {
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
  // un solo overlay visual por beat (el de mayor prioridad) para no amontonar
  const bestPerBeat = new Map<number, Edit>();
  const passthrough: Edit[] = [];
  for (const e of kept) {
    if (!VISUAL_TYPES.has(e.type) || e.beat_idx === undefined) {
      passthrough.push(e);
      continue;
    }
    const cur = bestPerBeat.get(e.beat_idx);
    if (!cur || (PRIORITY[e.type] ?? 0) > (PRIORITY[cur.type] ?? 0)) bestPerBeat.set(e.beat_idx, e);
  }
  let visuals = [...bestPerBeat.values()];
  // densidad media-dinámica: ~1 overlay visual cada 8 s
  const maxVisual = Math.max(1, Math.floor(durationMs / 1000 / 8));
  if (visuals.length > maxVisual) {
    visuals = visuals
      .sort((a, b) => (PRIORITY[b.type] ?? 0) - (PRIORITY[a.type] ?? 0))
      .slice(0, maxVisual);
  }
  // conserva SFX/keyword; recorta los "pop" cuyos overlays fueron descartados
  const keptVisualFroms = new Set(visuals.map((v) => v.from_ms));
  const others = passthrough.filter((e) =>
    e.type === 'sfx' && e.sfx === 'pop' ? keptVisualFroms.has(e.from_ms) : true,
  );
  // annotation: acento ligero (no compite por beat) pero con tope y sin repetir
  // beat, para no saturar; el resto (sfx/keyword) pasa tal cual
  const annotationBeats = new Set<number>();
  const annotations: Edit[] = [];
  const rest: Edit[] = [];
  for (const e of others) {
    if (e.type === 'annotation') {
      const b = e.beat_idx ?? -1;
      if (annotationBeats.has(b) || annotations.length >= ANNOTATION_CAP) continue;
      annotationBeats.add(b);
      annotations.push(e);
    } else {
      rest.push(e);
    }
  }
  return [...visuals, ...annotations, ...rest].sort((a, b) => a.from_ms - b.from_ms);
}

export async function directEdits(ctx: WorkerContext, params: EditingParams): Promise<Edit[]> {
  if (params.beats.length === 0) return [];
  const durationMs = params.beats[params.beats.length - 1]!.to_ms;
  const rules = ruleEdits(params);
  let aiEdits: Edit[] = [];
  try {
    const { system, user } = buildEditingPrompt(params);
    const data = await ledgeredLlmJson(ctx, {
      videoId: params.videoId,
      channelId: params.channelId,
      op: 'editing_director',
      system,
      user,
      schema: editingResultSchema,
      mockContext: { beats: params.beats },
    });
    aiEdits = momentsToEdits(data.moments, params.beats, params.cues);
  } catch (err) {
    ctx.logger.warn(
      { err, videoId: params.videoId },
      'Director de edición (IA) falló; se usan solo las reglas',
    );
  }
  return dedupeAndCap([...rules, ...aiEdits], durationMs);
}
