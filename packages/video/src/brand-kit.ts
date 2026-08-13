import type {
  Beat,
  ComponentType,
  Cue,
  DesignTokens,
  Edit,
  EditType,
  Scene,
  Segment,
  Seo,
  SfxName,
} from '@fabrica/shared';
import { hashSeed } from './seed';
import { computeChapters } from './chapters';
import { componentMeta, componentRegistry, type KitComponentMeta } from './registry.generated';

/**
 * Lo que el montaje necesita de una pieza, sea larga o vertical.
 *
 * Firma ESTRUCTURAL y no `MasterVideoJson`: el maestro de un short no es
 * asignable a ese tipo —sus literales de tamaño son otros y no trae `script`
 * ni `components`— y duplicar el cálculo del montaje sería tener dos verdades
 * sobre dónde empieza cada cosa, que es exactamente el bug que este módulo
 * existe para evitar (el player y el render tienen que calcular lo mismo).
 *
 * `type` y no `interface`: Remotion exige que las props de una Composition
 * satisfagan `Record<string, unknown>`, y una interface no recibe índice
 * implícito.
 */
export type PiezaMaster = {
  video: { id: string; fps: number };
  audio?: { path: string; duration_ms: number } | undefined;
  beats?: Beat[] | undefined;
  cues?: Cue[] | undefined;
  seo?: Seo | undefined;
  segments?: Segment[] | undefined;
  script?: { scenes: Scene[] } | undefined;
  edits?: Edit[] | undefined;
  brand?:
    | {
        channel_name?: string | undefined;
        tagline?: string | undefined;
        design?: DesignTokens | undefined;
        avatar_path?: string | undefined;
        components?:
          | {
              intro?: string | undefined;
              outro?: string | undefined;
              title_card?: string | undefined;
              lower_third?: string | undefined;
              subtitle_theme?: string | undefined;
              transition?: string | undefined;
            }
          | undefined;
      }
    | undefined;
  /** solo en vertical: la ventana recortada del vídeo largo */
  short?:
    | {
        source_from_ms: number;
        duration_ms: number;
        title: string;
        /** modo del lienzo del clip de episodio (tarjeta | full_bleed) */
        modo?: 'tarjeta' | 'full_bleed' | undefined;
      }
    | undefined;
};

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
  // se deriva de EDIT_TYPES: así añadir un tipo de efecto al contrato rompe
  // aquí en vez de colarse sin renderer
  type: EditType;
  from: number;
  durationInFrames: number;
  beatIdx?: number;
  text?: string;
  value?: string;
  label?: string;
  keyword?: string;
  /** rótulos de los efectos de lista: split_versus (2), pasos_flow (2-4) y barras (2) */
  items?: string[];
  /** barras: las dos magnitudes tal y como se dicen, en el orden de `items` */
  values?: string[];
  // SfxName y no string: el nivel de volumen se indexa con esto
  sfx?: SfxName;
  style?: string;
  /** imagen_apoyo: ruta congelada de la imagen de referencia (reescrita a /files en render) */
  imagePath?: string;
  /** imagen_apoyo: atribución que exige la licencia (se pinta pequeña y va a description.txt) */
  credit?: string;
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
  master: PiezaMaster,
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
      // `in` estrecha la unión discriminada sin aserciones: cada campo solo se
      // copia de los miembros que de verdad lo llevan
      ...(e.beat_idx !== undefined ? { beatIdx: e.beat_idx } : {}),
      ...('text' in e && e.text !== undefined ? { text: e.text } : {}),
      ...('value' in e && e.value !== undefined ? { value: e.value } : {}),
      ...('label' in e && e.label !== undefined ? { label: e.label } : {}),
      ...('keyword' in e ? { keyword: e.keyword } : {}),
      ...('items' in e && e.items !== undefined ? { items: e.items } : {}),
      ...('values' in e && e.values !== undefined ? { values: e.values } : {}),
      ...('sfx' in e ? { sfx: e.sfx } : {}),
      ...('style' in e && e.style !== undefined ? { style: e.style } : {}),
      // un campo no copiado aquí valida, sale en la timeline y renderiza VACÍO
      // (el bug de pasos_flow): imagen_apoyo sin estas dos líneas sería un
      // recuadro sin imagen
      ...('image_path' in e ? { imagePath: e.image_path } : {}),
      ...('credit' in e && e.credit !== undefined ? { credit: e.credit } : {}),
    };
  });
}

function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

// La duración la fija el audio (principio 1 del proyecto): los beats solo son
// el fallback mientras la voz no existe.
function computeBaseFrames(master: PiezaMaster, fps: number): number {
  if (master.audio) return Math.ceil((master.audio.duration_ms / 1000) * fps);
  const last = master.beats?.[master.beats.length - 1];
  if (last) return Math.max(1, Math.ceil((last.to_ms / 1000) * fps));
  return DEFAULT_DURATION_FRAMES;
}

// Un componente de duración fija está activo solo si su ref está en el
// registry Y su manifest declaró fixed_duration_frames: cualquier otra cosa
// se degrada a "sin componente" (el render nunca revienta por un kit a
// medio instalar y la duración total siempre coincide con lo que se pinta).
function fixedSlot(
  view: KitView,
  type: ComponentType,
  ref: string | undefined,
): {
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

function chosenTitle(master: PiezaMaster): string | null {
  const seo = master.seo;
  if (!seo) return null;
  return seo.titles[seo.chosen_idx ?? 0] ?? seo.titles[0] ?? null;
}

export function computeBrandKitLayout(
  master: PiezaMaster,
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
          sectionCards.push({
            ref: titleCardRef,
            from,
            durationInFrames: duration,
            title: seg.title,
          });
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
  /**
   * 'section' = límite de segmento (transición cinematográfica marcada);
   * 'fundido' = crossfade corto; 'slide' = deslizamiento ocasional;
   * 'dura' = corte seco, SIN transición (durationInFrames 0).
   *
   * El corte duro es el dominante a propósito. Antes TODOS los cortes llevaban
   * transición visible de 0,4 s elegida por semilla entre fade/slide/wipe: un
   * deslizamiento cada 8-15 segundos durante todo el vídeo lee a plantilla. El
   * lenguaje del vídeo de noticias es el corte; la transición es el acento.
   */
  kind: 'dura' | 'fundido' | 'slide' | 'section' | 'whip';
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
  opts: {
    fps: number;
    baseFrames: number;
    transitionFrames?: number;
    segmentStartIdxs?: Set<number>;
    // semilla del vídeo: decide qué límites llevan transición y cuáles corte
    // duro, reproducible entre renders
    seed?: number;
    /** décimas de cada tipo de corte; por defecto el reparto del vídeo largo */
    reparto?: { dura: number; fundido: number; slide: number; whip?: number };
  },
): BrollTrack {
  const n = beats.length;
  if (n === 0) return { sequences: [], transitions: [] };
  const lens = beats.map(
    (b, i) =>
      beatWindow(b, {
        fps: opts.fps,
        offsetFrames: 0,
        isLast: i === n - 1,
        bodyEndFrames: opts.baseFrames,
      }).durationInFrames,
  );
  if (n === 1)
    return { sequences: [{ beatIdx: beats[0]!.idx, durationInFrames: lens[0]! }], transitions: [] };

  const D = opts.transitionFrames ?? TRANSITION_FRAMES;
  const segStarts = opts.segmentStartIdxs ?? new Set<number>();
  const semilla = opts.seed ?? 0;
  const reparto = opts.reparto ?? { dura: 6, fundido: 3, slide: 1 };

  // Una transición por límite (entre beat i-1 e i), con duración PROPIA:
  // sección 12 frames, fundido 6, slide 12, corte duro 0. El reparto de los
  // cortes normales es ~60 % duro / ~30 % fundido / ~10 % slide, determinista
  // por semilla — el corte es el lenguaje, la transición el acento.
  const transitions: BrollTransition[] = [];
  for (let i = 1; i < n; i++) {
    if (segStarts.has(beats[i]!.idx)) {
      transitions.push({ durationInFrames: D, kind: 'section' });
      continue;
    }
    const r = hashSeed(`${semilla}:corte:${i}`) % 10;
    // el reparto viene por opciones (perfil.ts): el largo pasa el suyo de
    // siempre —6/3/1— y el vertical uno mucho más seco, porque a 1,2-2,5 s por
    // plano una transición de 6 frames se come el 15 % del plano
    const whip = reparto.whip ?? 0;
    if (r < reparto.dura) transitions.push({ durationInFrames: 0, kind: 'dura' });
    else if (r < reparto.dura + reparto.fundido) {
      transitions.push({ durationInFrames: Math.floor(D / 2), kind: 'fundido' });
    } else if (r < reparto.dura + reparto.fundido + whip) {
      transitions.push({ durationInFrames: D, kind: 'whip' });
    } else transitions.push({ durationInFrames: D, kind: 'slide' });
  }

  // El solape de cada transición se reparte a partes iguales entre sus dos
  // secuencias vecinas, así el cruce queda centrado en el límite del beat y la
  // suma total sigue siendo baseFrames. Con transiciones de duración desigual,
  // cada secuencia suma la mitad de CADA una de sus dos fronteras.
  const mitadAntes = (j: number): number => Math.ceil(transitions[j]!.durationInFrames / 2);
  const mitadDespues = (j: number): number => Math.floor(transitions[j]!.durationInFrames / 2);
  const sequences: BrollSeq[] = beats.map((b, i) => {
    const extra = (i > 0 ? mitadAntes(i - 1) : 0) + (i < n - 1 ? mitadDespues(i) : 0);
    return { beatIdx: b.idx, durationInFrames: lens[i]! + extra };
  });
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

/**
 * Los SFX de la intro y de la outro.
 *
 * Existe porque las dos piezas empezaban y acababan en silencio DIGITAL —−91 dB
 * medidos sobre los tres primeros segundos de un vídeo real—: el único audio del
 * montaje es la voz, que arranca en `introFrames` y termina con el último beat.
 * Son los tres primeros segundos del vídeo, que es donde se decide si alguien
 * se queda.
 *
 * Vive aquí y no dentro de las piezas del kit porque el contrato de esos
 * componentes es visual, los escribe una IA y no deben poder meter audio por su
 * cuenta. La composición sabe dónde empieza y acaba cada pieza; ellas no saben
 * que existe una banda de sonido.
 */
export function kitSfxCues(
  layout: {
    intro: { from: number; durationInFrames: number } | null;
    outro: { from: number; durationInFrames: number } | null;
  },
  /**
   * El arranque del SHORT: la cartela hace de «intro» sonora. Sin esto el
   * vertical empezaba en el mismo silencio digital que este módulo existe para
   * arreglar — los SFX estaban atados a la intro del kit, que en vertical está
   * apagada por construcción (short-json.ts). Sin riser: no hay pantalla que
   * dibujar, la voz ya está sonando en el frame 0.
   */
  cartela?: { aterriza: number; sale: number } | null,
): { from: number; durationInFrames: number; sfx: SfxName }[] {
  const cues: { from: number; durationInFrames: number; sfx: SfxName }[] = [];
  if (layout.intro === null && cartela != null) {
    // el golpe cae donde ATERRIZA el titular, igual que en la intro del largo
    cues.push({ from: cartela.aterriza, durationInFrames: 18, sfx: 'impacto' });
    // y el destello tapa su retirada
    cues.push({ from: cartela.sale, durationInFrames: 14, sfx: 'destello' });
  }
  if (layout.intro !== null) {
    const n = layout.intro.durationInFrames;
    // el riser sube durante todo el dibujado y entrega en el logotipo
    cues.push({ from: 0, durationInFrames: n, sfx: 'riser' });
    // el golpe cae donde ATERRIZA el nombre, no al principio: si suena en el
    // frame 0 acompaña a una pantalla vacía
    const golpe = Math.round(n * 0.28);
    cues.push({ from: golpe, durationInFrames: Math.max(1, n - golpe), sfx: 'impacto' });
    // y el destello de entrega tapa el corte al b-roll
    cues.push({ from: Math.max(0, n - 14), durationInFrames: 14, sfx: 'destello' });
  }
  if (layout.outro !== null) {
    const { from, durationInFrames: n } = layout.outro;
    cues.push({ from, durationInFrames: n, sfx: 'resolucion' });
    // el «suscríbete» entra con rebote en el frame 34 de la pieza
    if (n > 34) cues.push({ from: from + 34, durationInFrames: n - 34, sfx: 'pop' });
  }
  return cues;
}
