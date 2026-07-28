import type { ComponentType, MasterVideoJson } from '@fabrica/shared';
import { computeChapters } from './chapters';
import {
  componentMeta,
  componentRegistry,
  type KitComponentMeta,
} from './registry.generated';

// Montaje del brand kit sobre la ley temporal del audio (SPEC §10,
// docs/render.md §1): la intro DESPLAZA beats, audio y subtítulos intro
// frames — no cambia sus duraciones — y la outro se añade tras el último
// beat. Módulo puro y sin React: lo comparten calculateMetadata (duración
// total player/SSR) y LongForm (posiciones de las Sequence), así el player
// del dashboard y el render calculan exactamente el mismo montaje.

// Frames por defecto cuando el maestro aún no tiene audio ni beats (player
// del dashboard con el maestro recién creado).
export const DEFAULT_DURATION_FRAMES = 300;

// Duraciones por defecto de los rótulos superpuestos cuando su manifest no
// declara fixed_duration_frames (solo intro/outro/transition lo exigen).
export const DEFAULT_TITLE_CARD_FRAMES = 90;
export const DEFAULT_LOWER_THIRD_FRAMES = 150;

// Vista del registry que consume el cálculo del montaje: inyectable en tests
// (registry de prueba) y por defecto respaldada por registry.generated.ts.
export interface KitView {
  has(type: ComponentType, ref: string): boolean;
  meta(ref: string): KitComponentMeta | undefined;
}

export function kitViewFrom(
  registry: Partial<Record<ComponentType, Record<string, unknown>>>,
  meta: Record<string, KitComponentMeta>,
): KitView {
  return {
    has: (type, ref) => registry[type]?.[ref] !== undefined,
    meta: (ref) => meta[ref],
  };
}

const DEFAULT_VIEW = kitViewFrom(componentRegistry, componentMeta);

export interface FixedKitSlot {
  ref: string;
  from: number;
  durationInFrames: number;
}

export interface TitledKitSlot extends FixedKitSlot {
  title: string;
}

// Un efecto de edición situado en la línea de tiempo de frames (ya con el
// offset de la intro aplicado). Lo produce computeEffectsTrack desde master.edits.
export interface EffectCue {
  type: 'zoom_punch' | 'keyword_highlight' | 'text_callout' | 'stat_card' | 'quote_card' | 'sfx';
  from: number;
  durationInFrames: number;
  beatIdx?: number;
  text?: string;
  value?: string;
  label?: string;
  keyword?: string;
  sfx?: string;
}

export interface BrandKitLayout {
  // frames que ocupa la intro (0 si no hay): el offset de beats/audio/cues
  introFrames: number;
  outroFrames: number;
  // duración del cuerpo (la de hoy: audio → beats → DEFAULT_DURATION_FRAMES)
  baseFrames: number;
  // durationInFrames de la composición: intro + cuerpo + outro
  totalFrames: number;
  intro: FixedKitSlot | null;
  outro: FixedKitSlot | null;
  titleCard: TitledKitSlot | null;
  // tarjetas de sección centradas, una por segmento del director de capítulos
  sectionCards: TitledKitSlot[];
  lowerThird: TitledKitSlot | null;
  // efectos de edición (overlays/SFX/punch) ya en frames con el offset de intro
  effects: EffectCue[];
}

// Convierte master.edits (ms) a EffectCue[] en frames, aplicando el offset de la
// intro. Los overlays solo cubren frames existentes → no cambian totalFrames.
export function computeEffectsTrack(
  master: MasterVideoJson,
  fps: number,
  introFrames: number,
): EffectCue[] {
  const edits = master.edits ?? [];
  return edits.map((e) => {
    const from = introFrames + msToFrames(e.from_ms, fps);
    const end = introFrames + msToFrames(e.to_ms, fps);
    return {
      type: e.type,
      from: Math.max(0, from),
      durationInFrames: Math.max(1, end - from),
      ...(e.beat_idx !== undefined ? { beatIdx: e.beat_idx } : {}),
      ...(e.text !== undefined ? { text: e.text } : {}),
      ...(e.value !== undefined ? { value: e.value } : {}),
      ...(e.label !== undefined ? { label: e.label } : {}),
      ...(e.keyword !== undefined ? { keyword: e.keyword } : {}),
      ...(e.sfx !== undefined ? { sfx: e.sfx } : {}),
    };
  });
}

function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

// La duración la fija el audio (principio 1 del proyecto): los beats solo son
// el fallback mientras la voz no existe.
function computeBaseFrames(master: MasterVideoJson, fps: number): number {
  if (master.audio) return Math.ceil((master.audio.duration_ms / 1000) * fps);
  const last = master.beats?.[master.beats.length - 1];
  if (last) return Math.max(1, Math.ceil((last.to_ms / 1000) * fps));
  return DEFAULT_DURATION_FRAMES;
}

// Un componente de duración fija está activo solo si su ref está en el
// registry Y su manifest declaró fixed_duration_frames: cualquier otra cosa
// se degrada a "sin componente" (el render nunca revienta por un kit a
// medio instalar y la duración total siempre coincide con lo que se pinta).
function fixedSlot(view: KitView, type: ComponentType, ref: string | undefined): {
  ref: string;
  frames: number;
} | null {
  if (ref === undefined || !view.has(type, ref)) return null;
  const frames = view.meta(ref)?.fixed_duration_frames;
  if (frames === undefined || frames <= 0) return null;
  return { ref, frames };
}

function overlayFrames(view: KitView, ref: string, fallback: number): number {
  return view.meta(ref)?.fixed_duration_frames ?? fallback;
}

function chosenTitle(master: MasterVideoJson): string | null {
  const seo = master.seo;
  if (!seo) return null;
  return seo.titles[seo.chosen_idx ?? 0] ?? seo.titles[0] ?? null;
}

export function computeBrandKitLayout(
  master: MasterVideoJson,
  view: KitView = DEFAULT_VIEW,
): BrandKitLayout {
  const fps = master.video.fps;
  const components = master.brand?.components;
  const baseFrames = computeBaseFrames(master, fps);

  const intro = fixedSlot(view, 'intro', components?.intro);
  const outro = fixedSlot(view, 'outro', components?.outro);
  const introFrames = intro?.frames ?? 0;
  const outroFrames = outro?.frames ?? 0;
  const bodyEnd = introFrames + baseFrames;
  const title = chosenTitle(master);

  // tarjetas de sección: una por segmento del director de capítulos, centrada,
  // desde el inicio de cada segmento y acotada para no solaparse con la
  // siguiente ni salirse del cuerpo. Si hay segmentos NO se pinta la portada
  // (la primera tarjeta ya abre el vídeo); si no los hay (maestros antiguos),
  // se mantiene la portada con el título del vídeo al inicio del hook.
  let titleCard: TitledKitSlot | null = null;
  const sectionCards: TitledKitSlot[] = [];
  const titleCardRef = components?.title_card;
  const segments = master.segments ?? [];
  if (titleCardRef !== undefined && view.has('title_card', titleCardRef)) {
    const cardFrames = overlayFrames(view, titleCardRef, DEFAULT_TITLE_CARD_FRAMES);
    if (segments.length > 0) {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]!;
        const from = introFrames + msToFrames(seg.from_ms, fps);
        const nextFrom =
          i + 1 < segments.length
            ? introFrames + msToFrames(segments[i + 1]!.from_ms, fps)
            : bodyEnd;
        const duration = Math.min(cardFrames, Math.max(0, nextFrom - from), bodyEnd - from);
        if (duration >= 1 && seg.title.trim() !== '') {
          sectionCards.push({ ref: titleCardRef, from, durationInFrames: duration, title: seg.title });
        }
      }
    } else if (title !== null) {
      const duration = Math.min(cardFrames, baseFrames);
      if (duration >= 1) {
        titleCard = { ref: titleCardRef, from: introFrames, durationInFrames: duration, title };
      }
    }
  }

  // lower_third en el arranque del primer beat de la sección body: la misma
  // correspondencia escenas↔beats que usan los capítulos de YouTube
  let lowerThird: TitledKitSlot | null = null;
  const lowerThirdRef = components?.lower_third;
  if (lowerThirdRef !== undefined && view.has('lower_third', lowerThirdRef) && title !== null) {
    const chapters = computeChapters(master.script?.scenes ?? [], master.beats ?? []);
    const body = chapters.find((c) => c.section === 'body');
    if (body) {
      const from = introFrames + msToFrames(body.start_ms, fps);
      const duration = Math.min(
        overlayFrames(view, lowerThirdRef, DEFAULT_LOWER_THIRD_FRAMES),
        bodyEnd - from,
      );
      if (duration >= 1) {
        lowerThird = { ref: lowerThirdRef, from, durationInFrames: duration, title };
      }
    }
  }

  return {
    introFrames,
    outroFrames,
    baseFrames,
    totalFrames: introFrames + baseFrames + outroFrames,
    intro: intro ? { ref: intro.ref, from: 0, durationInFrames: introFrames } : null,
    outro: outro ? { ref: outro.ref, from: bodyEnd, durationInFrames: outroFrames } : null,
    titleCard,
    sectionCards,
    lowerThird,
    effects: computeEffectsTrack(master, fps, introFrames),
  };
}

// Duración de la transición entre beats (frames a 30 fps ≈ 0,4 s). El corte
// duro se sustituye por un crossfade/wipe centrado en el límite del beat.
export const TRANSITION_FRAMES = 12;

export interface BrollSeq {
  beatIdx: number;
  durationInFrames: number;
}
export interface BrollTransition {
  durationInFrames: number;
  // 'section' = límite de segmento (transición más marcada); 'cut' = beat normal
  kind: 'cut' | 'section';
}
export interface BrollTrack {
  sequences: BrollSeq[];
  // transitions.length === sequences.length - 1
  transitions: BrollTransition[];
}

// Pista de b-roll para <TransitionSeries>: cada beat conserva su ventana de
// audio como parte VISIBLE y las transiciones añaden solape a ambos lados del
// corte, de modo que el crossfade queda CENTRADO en el límite del beat y la
// suma total sigue siendo baseFrames (audio y subtítulos, en capas aparte, no
// se tocan → sincronía intacta). Con un solo beat no hay transición.
export function computeBrollTrack(
  beats: Array<{ idx: number; from_ms: number; to_ms: number }>,
  opts: { fps: number; baseFrames: number; transitionFrames?: number; segmentStartIdxs?: Set<number> },
): BrollTrack {
  const n = beats.length;
  if (n === 0) return { sequences: [], transitions: [] };
  const lens = beats.map((b, i) =>
    beatWindow(b, {
      fps: opts.fps,
      offsetFrames: 0,
      isLast: i === n - 1,
      bodyEndFrames: opts.baseFrames,
    }).durationInFrames,
  );
  if (n === 1) return { sequences: [{ beatIdx: beats[0]!.idx, durationInFrames: lens[0]! }], transitions: [] };

  const D = opts.transitionFrames ?? TRANSITION_FRAMES;
  const headHalf = Math.floor(D / 2);
  const tailHalf = D - headHalf; // headHalf + tailHalf = D → total exacto
  const segStarts = opts.segmentStartIdxs ?? new Set<number>();

  const sequences: BrollSeq[] = beats.map((b, i) => {
    // seq_0 suma headHalf, seq_last suma tailHalf, intermedios suman D
    const extra = i === 0 ? headHalf : i === n - 1 ? tailHalf : D;
    return { beatIdx: b.idx, durationInFrames: lens[i]! + extra };
  });
  const transitions: BrollTransition[] = [];
  for (let i = 1; i < n; i++) {
    transitions.push({ durationInFrames: D, kind: segStarts.has(beats[i]!.idx) ? 'section' : 'cut' });
  }
  return { sequences, transitions };
}

// Ventana de frames de un beat con el desplazamiento de la intro. El último
// beat se extiende hasta el final del cuerpo (bodyEndFrames): la duración
// total usa ceil y los beats round, y esa fracción de frame dejaría el
// fotograma final del cuerpo sin visual (flash de fondo desnudo).
export function beatWindow(
  beat: { from_ms: number; to_ms: number },
  opts: { fps: number; offsetFrames: number; isLast: boolean; bodyEndFrames: number },
): { from: number; durationInFrames: number } {
  const from = opts.offsetFrames + msToFrames(beat.from_ms, opts.fps);
  const rawEnd = opts.offsetFrames + msToFrames(beat.to_ms, opts.fps);
  const end = opts.isLast ? Math.max(rawEnd, opts.bodyEndFrames) : rawEnd;
  return { from, durationInFrames: Math.max(1, end - from) };
}
