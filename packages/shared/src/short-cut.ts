import {
  SHORT_EDIT_MIN_MS,
  SHORT_EDIT_TRUNCATE_MIN,
  SHORT_FRONTERA_TOL_MS,
  SHORT_HEIGHT,
  SHORT_WIDTH,
} from './constants.js';
import { SHORT_EDIT_ALLOWED, type RenderableShort, type ShortFraming } from './short-json.js';
import type { Beat, Cue, Edit, RenderableMaster, SceneSpan, Subvisual } from './master-json.js';

// Recorte puro de un maestro largo a la ventana de un short. Sin React, sin
// BD, sin reloj: mismo maestro y misma ventana → mismo resultado, que es lo
// que permite congelar el maestro del short al proponerlo y que el player del
// dashboard previsualice exactamente lo que se va a renderizar.
//
// La ventana SIEMPRE cae en fronteras de beat. No es una comodidad: los beats
// se cortan preferentemente en fin de frase, así que la frontera de beat es lo
// que hereda esa garantía. Los `TimedToken` con `sentenceEnd` no se persisten
// —viven solo en el worker de voz y se tiran—, así que reconstruirla de otra
// forma no es posible desde un vídeo ya entregado.

/** Lo que la biblioteca ya sabe del asset, sin analizar un solo píxel. */
export interface AssetInfo {
  width?: number | null;
  height?: number | null;
  kind?: string | null;
  /** pie de foto del VLM, escrito en la ingesta */
  caption?: string | null;
  tags?: string[] | null;
}

/**
 * Un plano que ES una pantalla no se puede recortar: al quedarse con el 31 % del
 * ancho, el texto que lleva dentro deja de leerse y el plano no dice nada.
 *
 * Medido sobre material real: una foto de stock de una terminal («Monitor en un
 * entorno oscuro mostrando múltiples terminales con código y estadísticas»)
 * salía ilegible en el short. Su `kind` es `image`, así que la comprobación por
 * tipo no la cogía.
 *
 * Solo cuenta si la pantalla es el SUJETO, y para eso basta mirar las primeras
 * palabras del pie: el VLM escribe «sujeto + verbo + complementos».
 *
 *   «Monitor en un entorno oscuro mostrando terminales…»       → sí
 *   «Mano escribiendo … con teclado y monitor desenfocado»      → NO
 *
 * Buscar en el pie entero, o en las tags —que son una bolsa de palabras sin
 * posición—, marcaba como pantalla cualquier plano con un monitor de atrezo al
 * fondo, y eso manda a la banda con losa planos que se recortarían
 * perfectamente. Medido: 2 de 3 disparos eran falsos positivos.
 */
const PALABRAS_DE_PANTALLA = [
  'pantalla',
  'monitor',
  'terminal',
  'consola',
  'captura',
  'screenshot',
  'dashboard',
  'panel',
  'interfaz',
  'interface',
  'grafico',
  'grafica',
  'chart',
  'diagrama',
  'diagram',
  'codigo',
  'code',
  'navegador',
  'browser',
  'hoja de calculo',
  'spreadsheet',
];

function sinAcentos(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Cuántas palabras del pie se consideran «el sujeto». */
const PALABRAS_DE_SUJETO = 5;

/**
 * Si el pie EMPIEZA por una persona o sus manos, la pantalla que mencione
 * después es atrezo, no sujeto. Medido en el banco de encuadres (12-ago-2026):
 * «Manos tecleando código…» y «Persona de pie escribiendo diagramas…» caían a
 * `entero` por 'codigo'/'diagrama' dentro de las cinco primeras palabras, y
 * son recortes de manual — el sujeto gramatical manda. Con esta guarda el
 * banco pasa de 24/26 a 26/26 sin perder ningún `entero` verdadero (esos pies
 * empiezan por «Pantalla…»/«Monitor…»).
 */
const EMPIEZA_POR_PERSONA =
  /^(mano|manos|persona|personas|hombre|mujer|trabajador|trabajadora|presentador|presentadora|gente|equipo|chico|chica)\b/;

function esPantalla(info: AssetInfo): boolean {
  const pie = sinAcentos(info.caption ?? '');
  if (EMPIEZA_POR_PERSONA.test(pie)) return false;
  const sujeto = pie.split(/\s+/).slice(0, PALABRAS_DE_SUJETO).join(' ');
  if (PALABRAS_DE_PANTALLA.some((p) => sujeto.includes(p))) return true;
  // las tags no llevan posición, así que solo valen las inequívocas: nadie
  // etiqueta «screenshot» un plano donde la captura es atrezo
  const tags = (info.tags ?? []).map((t) => sinAcentos(t));
  return tags.some((t) => t === 'screenshot' || t === 'captura' || t === 'dashboard');
}

export interface CutInput {
  /** id del short que se está creando */
  id: string;
  from_ms: number;
  to_ms: number;
  title: string;
  hook: string;
  reason: string;
  score: number;
  /**
   * Encuadre por ruta de asset, resuelto por quien llama a partir de la tabla
   * `assets`. Sin entrada se usa `recorte`, que es la norma.
   */
  encuadres?: Map<string, ShortFraming>;
}

/**
 * Decide el encuadre de un asset a partir de lo que la biblioteca ya sabe.
 * Determinista y sin análisis de imagen: el principio 6 prohíbe mirar el píxel
 * durante el render, así que esto se resuelve una vez, al proponer el short.
 */
export function encuadreDe(info: AssetInfo): ShortFraming {
  // una captura o un gráfico llevan texto: recortarlo lo deja ilegible
  if (info.kind === 'screenshot' || esPantalla(info)) return 'entero';
  const { width, height } = info;
  if (typeof width === 'number' && typeof height === 'number' && height > width) return 'cover';
  return 'recorte';
}

/**
 * Instantes donde se puede cortar sin partir una frase: límites de beat que
 * además coinciden (±tolerancia) con el final de un cue, porque los cues se
 * cierran en puntuación fuerte.
 */
export function fronterasFuertes(master: RenderableMaster): number[] {
  const finesDeCue = master.cues.map((c) => c.to_ms).sort((a, b) => a - b);
  const cerca = (t: number): boolean =>
    finesDeCue.some((fin) => Math.abs(fin - t) <= SHORT_FRONTERA_TOL_MS);

  const limites = new Set<number>();
  for (const beat of master.beats) {
    if (beat.from_ms === 0 || cerca(beat.from_ms)) limites.add(beat.from_ms);
    if (cerca(beat.to_ms)) limites.add(beat.to_ms);
  }
  return [...limites].sort((a, b) => a - b);
}

const solapa = (from: number, to: number, desde: number, hasta: number): boolean =>
  from < hasta && to > desde;

function recortarCue(cue: Cue, desde: number, hasta: number): Cue | null {
  const words = cue.words.filter((w) => solapa(w.from_ms, w.to_ms, desde, hasta));
  // un cue sin ninguna palabra dentro de la ventana no pinta nada
  if (words.length === 0) return null;
  return {
    from_ms: Math.max(cue.from_ms, desde) - desde,
    to_ms: Math.min(cue.to_ms, hasta) - desde,
    text: cue.text,
    words: words.map((w) => ({
      from_ms: Math.max(w.from_ms, desde) - desde,
      to_ms: Math.min(w.to_ms, hasta) - desde,
      w: w.w,
    })),
  };
}

/**
 * Ajusta el `fit` de un asset cuyo tramo se recortó por delante. `trim` y
 * `loop` avanzan su punto de entrada; `kenburns` no lleva offset porque su
 * paneo se recalcula por duración y sigue siendo determinista, y `stretch`
 * tampoco: su playback_rate se calculó para llenar el beat entero.
 */
function ajustarFit(asset: NonNullable<Beat['asset']>, recortadoMs: number): Beat['asset'] {
  if (recortadoMs <= 0) return asset;
  const { mode } = asset.fit;
  if (mode !== 'trim' && mode !== 'loop') return asset;
  return { ...asset, fit: { ...asset.fit, offset_ms: (asset.fit.offset_ms ?? 0) + recortadoMs } };
}

function conEncuadre(
  asset: NonNullable<Beat['asset']>,
  encuadres: Map<string, ShortFraming> | undefined,
): NonNullable<Beat['asset']> {
  const path = asset.path;
  const encuadre = path !== undefined ? encuadres?.get(path) : undefined;
  return { ...asset, encuadre: encuadre ?? 'recorte' };
}

function recortarSubvisual(sv: Subvisual, desde: number, hasta: number, cut: CutInput): Subvisual {
  const from = Math.max(sv.from_ms, desde);
  const to = Math.min(sv.to_ms, hasta);
  const base: Subvisual = { ...sv, from_ms: from - desde, to_ms: to - desde };
  if (sv.asset === undefined) return base;
  const conFit = ajustarFit(sv.asset, from - sv.from_ms);
  return { ...base, asset: conFit === undefined ? undefined : conEncuadre(conFit, cut.encuadres) };
}

function recortarBeats(
  beats: Beat[],
  desde: number,
  hasta: number,
  cut: CutInput,
): { beats: Beat[]; remapIdx: Map<number, number>; origenes: number[] } {
  const dentro = beats
    .filter((b) => solapa(b.from_ms, b.to_ms, desde, hasta))
    .sort((a, b) => a.from_ms - b.from_ms);

  const remapIdx = new Map<number, number>();
  const origenes: number[] = [];
  const recortados = dentro.map((beat, nuevoIdx) => {
    remapIdx.set(beat.idx, nuevoIdx);
    origenes.push(beat.idx);
    const from = Math.max(beat.from_ms, desde);
    const to = Math.min(beat.to_ms, hasta);
    const asset =
      beat.asset === undefined
        ? undefined
        : (() => {
            const conFit = ajustarFit(beat.asset, from - beat.from_ms);
            return conFit === undefined ? undefined : conEncuadre(conFit, cut.encuadres);
          })();
    const visuals = (beat.visuals ?? [])
      .filter((sv) => solapa(sv.from_ms, sv.to_ms, desde, hasta))
      .map((sv) => recortarSubvisual(sv, desde, hasta, cut));

    return {
      // `idx` se RE-INDEXA a 0..n-1: BeatVisual siembra sus direcciones de Ken
      // Burns por `videoId:idx`, así que dejar los idx del largo daría un
      // reparto que depende de dónde se cortó, no de la pieza.
      idx: nuevoIdx,
      from_ms: from - desde,
      to_ms: to - desde,
      text: beat.text,
      visual_query: beat.visual_query,
      status: beat.status,
      ...(asset !== undefined ? { asset } : {}),
      ...(visuals.length > 0 ? { visuals } : {}),
      // `candidates` se vacía a propósito: son decenas de objetos por beat con
      // metadatos del proveedor, y el maestro del short se guarda entero en una
      // columna jsonb. Ya no hay nada que elegir.
    } satisfies Beat;
  });

  return { beats: recortados, remapIdx, origenes };
}

function recortarEdits(
  edits: Edit[],
  desde: number,
  hasta: number,
  remapIdx: Map<number, number>,
): Edit[] {
  const salida: Edit[] = [];
  for (const edit of edits) {
    if (!SHORT_EDIT_ALLOWED[edit.type]) continue;
    if (!solapa(edit.from_ms, edit.to_ms, desde, hasta)) continue;

    const from = Math.max(edit.from_ms, desde);
    const to = Math.min(edit.to_ms, hasta);
    const original = edit.to_ms - edit.from_ms;
    const superviviente = to - from;
    // un efecto cortado por el borde es peor que ningún efecto
    if (original > 0 && superviviente < original * SHORT_EDIT_TRUNCATE_MIN) continue;
    if (superviviente < SHORT_EDIT_MIN_MS) continue;

    // el beat al que se ancla puede haberse quedado fuera
    let beatIdx = edit.beat_idx;
    if (beatIdx !== undefined) {
      const nuevo = remapIdx.get(beatIdx);
      if (nuevo === undefined) continue;
      beatIdx = nuevo;
    }

    salida.push({
      ...edit,
      from_ms: from - desde,
      to_ms: to - desde,
      ...(beatIdx !== undefined ? { beat_idx: beatIdx } : {}),
    } as Edit);
  }
  return salida;
}

function recortarSceneSpans(spans: SceneSpan[], desde: number, hasta: number): SceneSpan[] {
  return spans
    .filter((s) => solapa(s.from_ms, s.to_ms, desde, hasta))
    .map((s) => ({
      scene_id: s.scene_id,
      from_ms: Math.max(s.from_ms, desde) - desde,
      to_ms: Math.min(s.to_ms, hasta) - desde,
    }));
}

/**
 * Recorta el maestro largo a la ventana `[cut.from_ms, cut.to_ms)`.
 *
 * El audio NO se corta: se conserva la misma ruta y el render lo desplaza con
 * `<Audio trimBefore>`. Cortar el WAV significaría un fichero nuevo por short,
 * una escritura en disco dentro de una función pura y una desincronización
 * posible entre el audio y unos word timestamps que ya están alineados.
 *
 * Devuelve `RenderableShort` y no `ShortMasterJson` porque siempre produce
 * audio, cues, beats y marca: la entrada es un maestro ya renderizable, así que
 * declarar el tipo débil obligaría a cada consumidor a comprobar campos que no
 * pueden faltar.
 */
export function recortarMaster(master: RenderableMaster, cut: CutInput): RenderableShort {
  const desde = cut.from_ms;
  const hasta = cut.to_ms;
  const duracion = hasta - desde;

  const { beats, remapIdx, origenes } = recortarBeats(master.beats, desde, hasta, cut);
  const cues = master.cues
    .filter((c) => solapa(c.from_ms, c.to_ms, desde, hasta))
    .map((c) => recortarCue(c, desde, hasta))
    .filter((c): c is Cue => c !== null);

  return {
    version: '1',
    video: {
      id: cut.id,
      video_id: master.video.id,
      channel_id: master.video.channel_id,
      idea_id: master.video.idea_id,
      fps: 30,
      width: SHORT_WIDTH,
      height: SHORT_HEIGHT,
    },
    short: {
      source_from_ms: desde,
      source_to_ms: hasta,
      duration_ms: duracion,
      source_beat_idxs: origenes,
      title: cut.title,
      hook: cut.hook,
      reason: cut.reason,
      score: cut.score,
    },
    audio: {
      path: master.audio.path,
      duration_ms: duracion,
      lufs: master.audio.lufs,
    },
    cues,
    beats,
    ...(master.scene_spans !== undefined
      ? { scene_spans: recortarSceneSpans(master.scene_spans, desde, hasta) }
      : {}),
    ...(master.edits !== undefined
      ? { edits: recortarEdits(master.edits, desde, hasta, remapIdx) }
      : {}),
    // el kit se queda fuera entero: ver shortBrandSchema
    brand: {
      ...(master.brand.channel_name !== undefined
        ? { channel_name: master.brand.channel_name }
        : {}),
      ...(master.brand.tagline !== undefined ? { tagline: master.brand.tagline } : {}),
      ...(master.brand.design !== undefined ? { design: master.brand.design } : {}),
      ...(master.brand.avatar_path !== undefined ? { avatar_path: master.brand.avatar_path } : {}),
    },
    // las tags alimentan los hashtags de la descripción del short
    seo: master.seo,
  };
}
