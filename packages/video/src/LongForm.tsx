import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import {
  defaultDesign,
  type ComponentType as KitType,
  type DesignTokens,
  type MasterVideoJson,
} from '@fabrica/shared';
import { BeatVisual } from './BeatVisual';
import { computeBrandKitLayout, computeBrollTrack, type EffectCue } from './brand-kit';
import { Ambience, ProgressBar, QuoteCard, StatCard, TextCallout } from './effects';
import { ensureFontLoaded, FONT_FAMILY } from './fonts';
import { isRenderableSrc, toSrc } from './media-src';
import { resolveComponent } from './registry.generated';
import { Subtitles } from './Subtitles';

const FALLBACK_SUBTITLE_THEME = 'subtitulos-basicos@0.1.0';

// volumen de cada SFX built-in bajo la voz (la voz está a −16 LUFS)
const SFX_VOLUME: Record<string, number> = { whoosh: 0.5, pop: 0.45, riser: 0.4, ding: 0.5 };

// Renderiza el overlay de edición que corresponde al cue (callout/stat/quote).
const EditOverlay: React.FC<{ cue: EffectCue; design: DesignTokens }> = ({ cue, design }) => {
  if (cue.type === 'text_callout') return <TextCallout text={cue.text ?? ''} design={design} />;
  if (cue.type === 'stat_card') {
    return <StatCard value={cue.value ?? ''} label={cue.label} design={design} />;
  }
  if (cue.type === 'quote_card') return <QuoteCard text={cue.text ?? ''} design={design} />;
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

// Composición principal. inputProps = JSON maestro PROGRESIVO: el player del
// dashboard la monta con el maestro a medio construir (sin audio, sin assets),
// así que cada capa tolera la ausencia de su sección. El render SSR valida
// antes con renderableMasterV1, que sí exige todo.
//
// Brand kit (docs/render.md §1): la intro DESPLAZA beats, audio y subtítulos
// layout.introFrames — la ley temporal del audio no cambia, solo su offset —
// y la outro se monta tras el último beat. Sin intro/outro activos el árbol
// es exactamente el de siempre (offset 0, sin Sequence extra).
export const LongForm: React.FC<MasterVideoJson> = (master) => {
  ensureFontLoaded();
  const { fps, durationInFrames: totalFrames } = useVideoConfig();
  const beats = master.beats ?? [];
  const cues = master.cues ?? [];
  const audio = master.audio;
  const themeRef = master.brand?.components.subtitle_theme ?? FALLBACK_SUBTITLE_THEME;
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
  const overlayCues = effects.filter(
    (e) => e.type === 'text_callout' || e.type === 'stat_card' || e.type === 'quote_card',
  );
  const sfxCues = effects.filter((e) => e.type === 'sfx' && e.sfx);

  const audioEl = audio && isRenderableSrc(audio.path) ? <Audio src={toSrc(audio.path)} /> : null;
  const subtitlesEl = (
    <Subtitles cues={cues} themeRef={themeRef} design={design} highlightKeywords={highlightKeywords} />
  );

  // pista de b-roll con transiciones: solape compensado para que el corte
  // quede centrado y el total siga siendo baseFrames (audio/subtítulos intactos)
  const segmentStartIdxs = React.useMemo(
    () => new Set((master.segments ?? []).map((s) => s.beat_idx)),
    [master.segments],
  );
  const brollTrack = React.useMemo(
    () => computeBrollTrack(beats, { fps, baseFrames: layout.baseFrames, segmentStartIdxs }),
    [beats, fps, layout.baseFrames, segmentStartIdxs],
  );

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
          <Audio src={toSrc(`sfx/${cue.sfx}.wav`)} volume={SFX_VOLUME[cue.sfx ?? ''] ?? 0.5} />
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
                  {trans !== null ? (
                    <TransitionSeries.Transition
                      timing={linearTiming({ durationInFrames: trans.durationInFrames })}
                      presentation={
                        trans.kind === 'section' ? slide({ direction: 'from-right' }) : fade()
                      }
                    />
                  ) : null}
                  <TransitionSeries.Sequence durationInFrames={seq.durationInFrames}>
                    <BeatVisual
                      beat={beat}
                      videoId={master.video.id}
                      durationInFrames={seq.durationInFrames}
                      punchFromFrame={punchByBeat.get(beat.idx)}
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
      {layout.sectionCards.map((card, i) => (
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
        <Sequence key={`fx-${i}`} from={cue.from} durationInFrames={cue.durationInFrames} name={cue.type}>
          <EditOverlay cue={cue} design={design} />
        </Sequence>
      ))}
      {/* barra de progreso: cubre todo el cuerpo (oculta bajo intro/outro) */}
      {beats.length > 0 ? (
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
              ...(avatar ? { logo: avatar } : {}),
            }}
          />
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};
