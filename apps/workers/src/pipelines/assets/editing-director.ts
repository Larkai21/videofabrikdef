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
  text_callout: 2400,
  quote_card: 3000,
  keyword_highlight: 900,
};

function beatOf(beats: DirectorBeat[], idx: number): DirectorBeat | undefined {
  return beats.find((b) => b.idx === idx);
}

// ---- capa de reglas (determinista) -----------------------------------------

// cifras "destacables": porcentajes o números de 2+ dígitos (evita "1", "un 2").
// (el % no lleva \b final: '%' es no-palabra y rompería el límite tras el signo)
const NUMBER_RE = /\d[\d.,]*\s?%|\b\d{2,}(?:[.,]\d+)?\b/;

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

  // whoosh en cada inicio de sección (salvo la apertura)
  for (const ms of segmentStartMs.slice(1)) {
    edits.push({ type: 'sfx', from_ms: ms, to_ms: ms + 700, sfx: 'whoosh' });
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
    const value = m[0].replace(/\s/g, '');
    const at = findWordMs(cues, m[0].replace(/[^\d]/g, '').slice(0, 6), beat.from_ms, beat.to_ms);
    const fromMs = at?.from_ms ?? beat.from_ms;
    edits.push({
      type: 'stat_card',
      from_ms: fromMs,
      to_ms: Math.min(beat.to_ms, fromMs + DUR_MS.stat_card!),
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

  return edits;
}

// ---- capa IA (elige momentos potentes + redacta texto) ---------------------

const editingResultSchema = z.object({
  moments: z
    .array(
      z.object({
        beat_idx: z.number().int().nonnegative(),
        type: z.enum(['callout', 'stat', 'quote']),
        text: z.string().optional(),
        value: z.string().optional(),
        label: z.string().optional(),
        keyword: z.string().optional(),
      }),
    )
    .max(8),
});

function buildEditingPrompt(params: EditingParams): { system: string; user: string } {
  const langName = params.lang === 'en' ? 'inglés' : 'español';
  const system = [
    'Eres editor de vídeo de un canal de YouTube tipo "faceless".',
    'Recibes la narración por beats numerados. Elige los MOMENTOS más potentes',
    'para superponer un efecto que enganche, sin recargar (máximo ~1 cada 2-3 beats).',
    'Tipos:',
    '- "callout": una etiqueta de 2-5 palabras que refuerza la idea clave del beat.',
    '- "stat": una cifra impactante mencionada en el beat (value, p. ej. "70%") + label corto.',
    '- "quote": una frase textual breve y citable del beat (text).',
    `Textos en ${langName}, muy cortos, sin comillas. Máximo 6 momentos.`,
    'Devuelve JSON: { "moments": [ { "beat_idx", "type", "text"?, "value"?, "label"?, "keyword"? } ] }.',
  ].join('\n');
  const user = [
    'Beats (idx · narración):',
    ...params.beats.map((b) => `${b.idx} · ${b.text.replace(/\s+/g, ' ').trim().slice(0, 180)}`),
  ].join('\n');
  return { system, user };
}

function momentsToEdits(
  moments: z.infer<typeof editingResultSchema>['moments'],
  beats: DirectorBeat[],
): Edit[] {
  const edits: Edit[] = [];
  for (const m of moments) {
    const beat = beatOf(beats, m.beat_idx);
    if (!beat) continue;
    const type = m.type === 'callout' ? 'text_callout' : m.type === 'stat' ? 'stat_card' : 'quote_card';
    const dur = DUR_MS[type] ?? 2500;
    const toMs = Math.min(beat.to_ms, beat.from_ms + dur);
    if (type === 'text_callout' && m.text) {
      edits.push({ type, from_ms: beat.from_ms, to_ms: toMs, beat_idx: beat.idx, text: m.text });
    } else if (type === 'stat_card' && m.value) {
      edits.push({
        type,
        from_ms: beat.from_ms,
        to_ms: toMs,
        beat_idx: beat.idx,
        value: m.value,
        ...(m.label ? { label: m.label } : {}),
      });
    } else if (type === 'quote_card' && m.text) {
      edits.push({ type, from_ms: beat.from_ms, to_ms: toMs, beat_idx: beat.idx, text: m.text });
    }
    // un pop acompaña al overlay
    if (edits.length > 0 && edits[edits.length - 1]!.type !== 'sfx') {
      edits.push({ type: 'sfx', from_ms: beat.from_ms, to_ms: beat.from_ms + 400, sfx: 'pop' });
    }
  }
  return edits;
}

// ---- orquestación: reglas + IA, dedupe y tope de densidad ------------------

// overlays visuales que compiten por pantalla (los SFX/keyword no cuentan)
const VISUAL_TYPES = new Set(['zoom_punch', 'stat_card', 'text_callout', 'quote_card']);
// prioridad al recortar por densidad (mayor primero)
const PRIORITY: Record<string, number> = {
  stat_card: 5,
  zoom_punch: 4,
  quote_card: 3,
  text_callout: 2,
};

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
  return [...visuals, ...others].sort((a, b) => a.from_ms - b.from_ms);
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
    aiEdits = momentsToEdits(data.moments, params.beats);
  } catch (err) {
    ctx.logger.warn(
      { err, videoId: params.videoId },
      'Director de edición (IA) falló; se usan solo las reglas',
    );
  }
  return dedupeAndCap([...rules, ...aiEdits], durationMs);
}
