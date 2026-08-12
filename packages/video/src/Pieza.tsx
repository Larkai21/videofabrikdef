import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { linearTiming, TransitionSeries, type TransitionPresentation } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { hashSeed } from './seed';
import {
  defaultDesign,
  EDIT_RENDER_KIND,
  type ComponentType as KitType,
  type DesignTokens,
  type SfxName,
} from '@fabrica/shared';
import { BeatVisual } from './BeatVisual';
import {
  computeBrandKitLayout,
  computeBrollTrack,
  kitSfxCues,
  type EffectCue,
  type PiezaMaster,
} from './brand-kit';
import { useLienzo } from './lienzo';
import { perfilDe } from './perfil';
import { AnclaMarca } from './short/AnclaMarca';
import { ClipLayout } from './short/ClipLayout';
import {
  CARTELA_ATERRIZA_FRAME,
  CARTELA_FRAMES,
  CARTELA_SALE_FRAME,
  CartelaGancho,
} from './short/CartelaGancho';
import { SECTION_TRANSITIONS, whip } from './effects/transitions';
import {
  Ambience,
  Annotation,
  DeviceFrame,
  ImagenApoyo,
  KineticText,
  MicroFx,
  PasosFlow,
  ProgressBar,
  QuoteCard,
  SplitVersus,
  StatCard,
  StatOdometer,
  Tendencia,
  TextCallout,
} from './effects';
import { ensureFontLoaded, FONT_FAMILY } from './fonts';
import { isRenderableSrc, toSrc } from './media-src';
import { resolveComponent } from './registry.generated';
import { Subtitles } from './Subtitles';

// Volumen de cada SFX, nivelado para una sonoridad PERCIBIDA pareja bajo la voz
// (−16 LUFS) y con la música ya agachada a −22 dB. Tres familias:
//   · banda ancha (ruido): se percibe fuerte → más bajo
//   · graves cortos: se sienten más que se oyen, y comen headroom donde vive el
//     fundamental de la voz → bajos
//   · tonos agudos puros: se perciben flojos → un pelín más altos
// El tipo Record<SfxName, …> es la garantía: añadir un nombre a SFX_NAMES sin
// nivelarlo aquí NO COMPILA. Antes era Record<string, …> con fallback, así que
// un sonido nuevo sonaba al nivel equivocado en silencio.
const SFX_VOLUME: Record<SfxName, number> = {
  whoosh: 0.38,
  pop: 0.5,
  riser: 0.5,
  ding: 0.5,
  impacto: 0.45,
  clic: 0.3,
  tic: 0.32,
  tecleo: 0.26,
  // más alto que el resto de la familia de ruido: aun con la banda ensanchada su
  // pico se queda 5 dB por debajo, medido con volumedetect
  deslizar: 0.45,
  destello: 0.4,
  subgrave: 0.42,
  aparicion: 0.42,
  notificacion: 0.44,
  resolucion: 0.46,
};

// Presentación de cada transición que computeBrollTrack decidió. El corte duro
// no llega aquí (no monta Transition); en secciones, una cinematográfica
// (iris/barrido/cortina); 'fundido' es fade corto y 'slide' el deslizamiento
// ocasional. El wipe se retiró de los cortes normales: era 1/3 de todos los
// cortes y es la transición que más lee a plantilla.
const DIRS = ['from-left', 'from-right', 'from-top', 'from-bottom'] as const;
function pickTransition(
  kind: 'fundido' | 'slide' | 'section' | 'whip',
  i: number,
  seedBase: string,
): TransitionPresentation<Record<string, unknown>> {
  const seed = hashSeed(`${seedBase}:trans:${i}`);
  if (kind === 'whip') {
    return whip(seed % 2 === 0 ? 'izquierda' : 'derecha') as unknown as TransitionPresentation<
      Record<string, unknown>
    >;
  }
  if (kind === 'section') {
    const make = SECTION_TRANSITIONS[seed % SECTION_TRANSITIONS.length]!;
    return make() as unknown as TransitionPresentation<Record<string, unknown>>;
  }
  if (kind === 'slide') {
    return slide({ direction: DIRS[seed % 4]! }) as TransitionPresentation<Record<string, unknown>>;
  }
  return fade() as TransitionPresentation<Record<string, unknown>>;
}

// Renderiza el overlay de edición que corresponde al cue (callout/stat/quote).
const EditOverlay: React.FC<{ cue: EffectCue; design: DesignTokens }> = ({ cue, design }) => {
  if (cue.type === 'text_callout') return <TextCallout text={cue.text ?? ''} design={design} />;
  if (cue.type === 'stat_card') {
    return <StatCard value={cue.value ?? ''} label={cue.label} design={design} />;
  }
  if (cue.type === 'quote_card') return <QuoteCard text={cue.text ?? ''} design={design} />;
  if (cue.type === 'kinetic_text') {
    return <KineticText text={cue.text ?? ''} seed={cue.from} design={design} />;
  }
  if (cue.type === 'stat_odometer') {
    return <StatOdometer value={cue.value ?? ''} label={cue.label} design={design} />;
  }
  if (cue.type === 'device_frame') {
    return <DeviceFrame text={cue.text ?? ''} style={cue.style} design={design} />;
  }
  if (cue.type === 'split_versus') return <SplitVersus items={cue.items ?? []} design={design} />;
  if (cue.type === 'pasos_flow') return <PasosFlow items={cue.items ?? []} design={design} />;
  if (cue.type === 'tendencia') {
    return (
      <Tendencia
        value={cue.value ?? ''}
        direccion={cue.style ?? 'sube'}
        label={cue.label}
        design={design}
      />
    );
  }
  if (cue.type === 'imagen_apoyo') {
    return (
      <ImagenApoyo imagePath={cue.imagePath} text={cue.text} credit={cue.credit} design={design} />
    );
  }
  return null;
};

// Un componente del brand kit resuelto del registry generado. Se resuelve al
// renderizar (no al montar el árbol) y solo para slots que el layout ya
// comprobó presentes en el registry.
const KitSlot: React.FC<{
  type: KitType;
  refName: string;
  kitProps: Record<string, unknown>;
}> = ({ type, refName, kitProps }) => {
  const Kit = resolveComponent(type, refName);
  return <Kit {...kitProps} />;
};

// La composición, en los DOS formatos. inputProps = JSON maestro PROGRESIVO:
// el player del dashboard la monta con el maestro a medio construir (sin
// audio, sin assets), así que cada capa tolera la ausencia de su sección. El
// render SSR valida antes con renderableMasterV1 / renderableShortV1.
//
// Un solo componente y dos <Composition>, no dos árboles: esto ordena once
// capas y dos copias de ese orden divergen a la segunda revisión. Lo que
// cambia entre formatos vive en `perfilDe(lienzo)`, y el kit se apaga solo
// porque el maestro del short no declara `components` y `fixedSlot` devuelve
// null para cada slot ausente.
//
// Brand kit (docs/render.md §1): la intro DESPLAZA beats, audio y subtítulos
// layout.introFrames — la ley temporal del audio no cambia, solo su offset —
// y la outro se monta tras el último beat. Sin intro/outro activos el árbol
// es exactamente el de siempre (offset 0, sin Sequence extra).
export const Pieza: React.FC<PiezaMaster> = (master) => {
  ensureFontLoaded();
  const { fps, durationInFrames: totalFrames } = useVideoConfig();
  const lienzo = useLienzo();
  const perfil = perfilDe(lienzo);
  const beats = master.beats ?? [];
  const cues = master.cues ?? [];
  const audio = master.audio;
  const themeRef = master.brand?.components?.subtitle_theme ?? perfil.temaSubtitulosPorDefecto;
  // tokens de diseño del canal (colores/tipografía); fallback a la paleta base
  const design = master.brand?.design ?? defaultDesign();
  const avatar =
    master.brand?.avatar_path && isRenderableSrc(master.brand.avatar_path)
      ? toSrc(master.brand.avatar_path)
      : undefined;
  const layout = React.useMemo(() => computeBrandKitLayout(master), [master]);
  const offset = layout.introFrames;
  // fin del cuerpo relativo a la duración real de la composición (igual que
  // la extensión del último beat de siempre, ahora restando la outro)
  const bodyEnd = Math.max(offset + 1, totalFrames - layout.outroFrames);

  // línea de tiempo de efectos de edición (director de edición → master.edits)
  const effects = layout.effects;
  const highlightKeywords = React.useMemo(
    () =>
      effects
        .filter((e) => e.type === 'keyword_highlight' && e.keyword)
        .map((e) => e.keyword as string),
    [effects],
  );
  // zoom punch-in por beat: frame LOCAL (dentro del beat) donde arranca el punch
  const punchByBeat = React.useMemo(() => {
    const map = new Map<number, number>();
    const byIdx = new Map(beats.map((b) => [b.idx, b]));
    for (const e of master.edits ?? []) {
      if (e.type === 'zoom_punch' && e.beat_idx !== undefined) {
        const beat = byIdx.get(e.beat_idx);
        if (beat) {
          map.set(e.beat_idx, Math.max(0, Math.round(((e.from_ms - beat.from_ms) / 1000) * fps)));
        }
      }
    }
    return map;
  }, [master.edits, beats, fps]);
  // La clasificación vive en el contrato (EDIT_RENDER_KIND) y no aquí porque
  // aquí era una lista de literales: `pasos_flow` tenía componente, rama en
  // EditOverlay y etiqueta en la timeline, y aun así no salía en pantalla.
  const overlayCues = effects.filter((e) => EDIT_RENDER_KIND[e.type] === 'overlay');
  // Coordinación capítulos ↔ edición: una tarjeta de sección y un overlay de
  // contenido (callout/cifra/kinetic) que coincidan en el tiempo chocarían en
  // pantalla (ambos centrados). El overlay es específico del momento y manda:
  // se omite la tarjeta de sección solapada. Los efectos que no cubren pantalla
  // (zoom_punch, keyword_highlight, sfx) no cuentan.
  const sectionCards = React.useMemo(() => {
    const windows = overlayCues.map((c) => ({ from: c.from, to: c.from + c.durationInFrames }));
    return layout.sectionCards.filter(
      (card) =>
        !windows.some((w) => card.from < w.to && card.from + card.durationInFrames > w.from),
    );
  }, [layout.sectionCards, overlayCues]);
  // anotaciones: acento ligero sobre el b-roll; se montan aparte (no compiten
  // con las tarjetas ni suprimen las de sección)
  const annotationCues = effects.filter((e) => e.type === 'annotation');
  // los micro-FX van en el carril de ACENTOS, junto a las anotaciones: no
  // cuentan como overlay de contenido y por eso no suprimen la tarjeta de
  // sección solapada (a diferencia de overlayCues)
  const microCues = effects.filter((e) => e.type === 'micro_fx');
  const sfxCues = effects.filter((e) => e.type === 'sfx' && e.sfx);

  // sonido de las piezas del kit (pura, en brand-kit.ts); en vertical la
  // cartela hace de intro sonora — sin esto el short arrancaba en seco
  const esShort = perfil.cartela && master.short !== undefined;
  const kitSfx = React.useMemo(
    () =>
      kitSfxCues(
        layout,
        esShort ? { aterriza: CARTELA_ATERRIZA_FRAME, sale: CARTELA_SALE_FRAME } : null,
      ),
    [layout, esShort],
  );

  // El short de FÁBRICA comparte el WAV del vídeo largo y lo desplaza con
  // trimBefore. El clip de EPISODIO trae su segmento YA cortado (offset 0):
  // aplicarle el trim del reloj del episodio buscaba el segundo ~300 en un
  // wav de 59 y el clip salía MUDO — encontrado oyendo el primer clip real.
  const esClipDeEpisodio =
    master.video !== undefined &&
    'episode_id' in master.video &&
    master.video.episode_id !== undefined;
  const trimFrames =
    master.short !== undefined && !esClipDeEpisodio
      ? Math.round((master.short.source_from_ms / 1000) * fps)
      : 0;
  const audioEl =
    audio && isRenderableSrc(audio.path) ? (
      <Audio src={toSrc(audio.path)} {...(trimFrames > 0 ? { trimBefore: trimFrames } : {})} />
    ) : null;
  const subtitlesEl = (
    <Subtitles
      cues={cues}
      themeRef={themeRef}
      design={design}
      highlightKeywords={highlightKeywords}
    />
  );


  // pista de b-roll con transiciones: solape compensado para que el corte
  // quede centrado y el total siga siendo baseFrames (audio/subtítulos intactos)
  const segmentStartIdxs = React.useMemo(
    () => new Set((master.segments ?? []).map((s) => s.beat_idx)),
    [master.segments],
  );
  const brollTrack = React.useMemo(
    () =>
      computeBrollTrack(beats, {
        fps,
        baseFrames: layout.baseFrames,
        segmentStartIdxs,
        seed: hashSeed(master.video.id),
        reparto: perfil.transiciones,
      }),
    [beats, fps, layout.baseFrames, segmentStartIdxs, master.video.id, perfil.transiciones],
  );


  // El clip de EPISODIO no usa el cuerpo estándar (b-roll por beats + cartela
  // + subtítulos del tema): usa el layout del formato de clips —tarjeta
  // redondeada, cabecera de canal, titular a color, subtítulo con contorno—
  // calcado del canal de referencia. Va tras los hooks a propósito.
  if (esClipDeEpisodio && master.short !== undefined) {
    return (
      <AbsoluteFill>
        {audioEl}
        <ClipLayout master={master} design={design} avatarSrc={avatar} />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: design.background, fontFamily: FONT_FAMILY }}>
      {audioEl !== null ? (
        offset > 0 ? (
          <Sequence from={offset} name="Voz">
            {audioEl}
          </Sequence>
        ) : (
          audioEl
        )
      ) : null}
      {/* capa de SFX: cada cue dispara un efecto de sonido built-in (public/sfx) */}
      {sfxCues.map((cue, i) => (
        <Sequence
          key={`sfx-${i}`}
          from={cue.from}
          durationInFrames={cue.durationInFrames}
          name={`SFX ${cue.sfx}`}
        >
          <Audio
            src={toSrc(`sfx/${cue.sfx}.wav`)}
            volume={cue.sfx !== undefined ? SFX_VOLUME[cue.sfx] : 0.5}
          />
        </Sequence>
      ))}
      {kitSfx.map((cue, i) => (
        <Sequence
          key={`kit-sfx-${i}`}
          from={cue.from}
          durationInFrames={cue.durationInFrames}
          name={`SFX kit ${cue.sfx}`}
        >
          <Audio src={toSrc(`sfx/${cue.sfx}.wav`)} volume={SFX_VOLUME[cue.sfx]} />
        </Sequence>
      ))}
      {beats.length > 0 ? (
        <Sequence from={offset} durationInFrames={Math.max(1, bodyEnd - offset)} name="B-roll">
          <TransitionSeries>
            {brollTrack.sequences.map((seq, i) => {
              const beat = beats[i]!;
              const trans = i > 0 ? brollTrack.transitions[i - 1]! : null;
              return (
                <React.Fragment key={seq.beatIdx}>
                  {trans !== null && trans.kind !== 'dura' && trans.durationInFrames > 0 ? (
                    <TransitionSeries.Transition
                      timing={linearTiming({ durationInFrames: trans.durationInFrames })}
                      presentation={pickTransition(trans.kind, i, master.video.id)}
                    />
                  ) : null}
                  <TransitionSeries.Sequence durationInFrames={seq.durationInFrames}>
                    <BeatVisual
                      beat={beat}
                      videoId={master.video.id}
                      durationInFrames={seq.durationInFrames}
                      punchFromFrame={punchByBeat.get(beat.idx)}
                      design={design}
                    />
                  </TransitionSeries.Sequence>
                </React.Fragment>
              );
            })}
          </TransitionSeries>
        </Sequence>
      ) : null}
      {/* ambiente (viñeta + grano) sobre el b-roll y bajo los subtítulos */}
      {beats.length > 0 ? (
        <Sequence from={offset} durationInFrames={Math.max(1, bodyEnd - offset)} name="Ambiente">
          <Ambience design={design} />
        </Sequence>
      ) : null}
      {offset > 0 ? (
        <Sequence from={offset} durationInFrames={Math.max(1, bodyEnd - offset)} name="Subtítulos">
          {subtitlesEl}
        </Sequence>
      ) : (
        subtitlesEl
      )}
      {/* el titular del short: en la banda que en 9:16 existe y en 16:9 no */}
      {perfil.cartela && master.short !== undefined ? (
        <Sequence from={0} durationInFrames={CARTELA_FRAMES} name="Cartela">
          <CartelaGancho title={master.short.title} design={design} />
        </Sequence>
      ) : null}
      {/* cuando la cartela se retira, la marca se queda: sin esto un short
          compartido fuera de la plataforma no dice de quién es en 30 de sus
          33 s */}
      {perfil.cartela && master.short !== undefined ? (
        <Sequence from={CARTELA_FRAMES} name="Ancla de marca">
          <AnclaMarca
            nombre={master.brand?.channel_name}
            avatarSrc={avatar}
            design={design}
          />
        </Sequence>
      ) : null}
      {layout.titleCard !== null ? (
        <Sequence
          from={layout.titleCard.from}
          durationInFrames={layout.titleCard.durationInFrames}
          name="Title card"
        >
          <KitSlot
            type="title_card"
            refName={layout.titleCard.ref}
            kitProps={{ title: layout.titleCard.title, fromFrame: 0, design }}
          />
        </Sequence>
      ) : null}
      {sectionCards.map((card, i) => (
        <Sequence
          key={`seccion-${i}`}
          from={card.from}
          durationInFrames={card.durationInFrames}
          name={`Sección ${i + 1}`}
        >
          <KitSlot
            type="title_card"
            refName={card.ref}
            kitProps={{ title: card.title, fromFrame: 0, design }}
          />
        </Sequence>
      ))}
      {layout.lowerThird !== null ? (
        <Sequence
          from={layout.lowerThird.from}
          durationInFrames={layout.lowerThird.durationInFrames}
          name="Rótulo"
        >
          <KitSlot
            type="lower_third"
            refName={layout.lowerThird.ref}
            kitProps={{
              title: layout.lowerThird.title,
              fromFrame: 0,
              design,
              ...(master.brand?.channel_name ? { subtitle: master.brand.channel_name } : {}),
            }}
          />
        </Sequence>
      ) : null}
      {/* overlays de edición: callouts, tarjetas de dato y citas sobre todo lo
          demás (bajo intro/outro, que se pintan después y cubren la pantalla) */}
      {overlayCues.map((cue, i) => (
        <Sequence
          key={`fx-${i}`}
          from={cue.from}
          durationInFrames={cue.durationInFrames}
          name={cue.type}
        >
          {/* Sin envolver. Hubo aquí un `scale(ancho/1920)` para conservar el
              tamaño con el que se calibraron las tarjetas, y encogía TODA la
              capa un 44 %: medido sobre un short renderizado, el callout salía
              a 26 px efectivos y era ilegible en un móvil. Lo que se calibró en
              1920 es el ANCHO de las piezas grandes, no el cuerpo del texto;
              las que no caben en 1080 se maquetan en columna, que es lo que
              pedía el formato desde el principio. */}
          <EditOverlay cue={cue} design={design} />
        </Sequence>
      ))}
      {annotationCues.map((cue, i) => (
        <Sequence
          key={`anot-${i}`}
          from={cue.from}
          durationInFrames={cue.durationInFrames}
          name="anotación"
        >
          <Annotation shape={cue.style} text={cue.text} seed={cue.from} design={design} />
        </Sequence>
      ))}
      {microCues.map((cue, i) => (
        <Sequence
          key={`micro-${i}`}
          from={cue.from}
          durationInFrames={cue.durationInFrames}
          name="micro-fx"
        >
          <MicroFx shape={cue.style} design={design} />
        </Sequence>
      ))}
      {/* barra de progreso: cubre todo el cuerpo (oculta bajo intro/outro). En
          vertical se apaga: la plataforma pinta su propio scrubber encima y dos
          barras de progreso son peor que ninguna. */}
      {perfil.progreso && beats.length > 0 ? (
        <Sequence from={offset} durationInFrames={Math.max(1, bodyEnd - offset)} name="Progreso">
          <ProgressBar design={design} />
        </Sequence>
      ) : null}
      {layout.intro !== null ? (
        <Sequence from={0} durationInFrames={layout.intro.durationInFrames} name="Intro">
          <KitSlot
            type="intro"
            refName={layout.intro.ref}
            kitProps={{
              channel_name: master.brand?.channel_name ?? '',
              design,
              ...(master.brand?.tagline ? { tagline: master.brand.tagline } : {}),
              ...(avatar ? { logo: avatar } : {}),
            }}
          />
        </Sequence>
      ) : null}
      {layout.outro !== null ? (
        <Sequence
          from={layout.outro.from}
          durationInFrames={layout.outro.durationInFrames}
          name="Outro"
        >
          <KitSlot
            type="outro"
            refName={layout.outro.ref}
            kitProps={{
              channel_name: master.brand?.channel_name ?? '',
              design,
              ...(master.brand?.tagline ? { tagline: master.brand.tagline } : {}),
              ...(avatar ? { logo: avatar } : {}),
            }}
          />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
