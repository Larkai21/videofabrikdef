import React from 'react';
import {
  AbsoluteFill,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import type { Beat, DesignTokens } from '@fabrica/shared';
import {
  defaultDesign,
  LOOP_CROSSFADE_MS,
  MAX_LOOPS,
  SUBVISUAL_CROSSFADE_MS,
} from '@fabrica/shared';
import { punchScale } from './effects/punch';
import { movimientoDe, planDeEncuadre, type MovimientoKenBurns } from './encuadre';
import { FONT_FAMILY } from './fonts';
import { useLienzo } from './lienzo';
import { isRenderableSrc, toSrc } from './media-src';
import { hashSeed } from './seed';
import { Losa } from './themes/kernel';

type BeatVisualProps = {
  beat: Beat;
  videoId: string;
  durationInFrames: number;
  // frame LOCAL donde el director de edición marcó un zoom punch-in (opcional)
  punchFromFrame?: number;
  // tokens del canal para vestir la Losa del encuadre `entero`; sin ellos, la
  // marca por defecto (que era lo único que había: un canal con paleta propia
  // veía el hueco vestido de otra marca)
  design?: DesignTokens;
};

// Envuelve el visual del beat con el zoom punch-in si el director lo marcó.
const PunchWrap: React.FC<{ punchFromFrame?: number; children: React.ReactNode }> = ({
  punchFromFrame,
  children,
}) => {
  const frame = useCurrentFrame();
  if (punchFromFrame === undefined) return <>{children}</>;
  const scale = punchScale(frame - punchFromFrame);
  return <AbsoluteFill style={{ transform: `scale(${scale})` }}>{children}</AbsoluteFill>;
};

function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

// Placa neutra determinista para beats sin asset resuelto: la preview del
// player siempre pinta algo aunque el maestro esté a medio construir.
const Placeholder: React.FC<{ beat: Beat }> = ({ beat }) => {
  const hue = (beat.idx * 47) % 360;
  return (
    <AbsoluteFill
      style={{
        backgroundColor: `hsl(${hue}, 28%, 16%)`,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 120,
      }}
    >
      <div
        style={{
          fontFamily: FONT_FAMILY,
          fontSize: 44,
          fontWeight: 500,
          color: 'rgba(255, 255, 255, 0.75)',
          textAlign: 'center',
        }}
      >
        {beat.visual_query}
      </div>
    </AbsoluteFill>
  );
};

const KenBurnsImage: React.FC<{
  src: string;
  seed: number;
  durationInFrames: number;
  // efecto congelado en el maestro por la ingesta ('kenburns-in-left'…);
  // manda sobre la derivación local para que master.json documente lo que
  // realmente se renderiza
  effect?: string;
  estilo: React.CSSProperties;
  movimiento: MovimientoKenBurns;
}> = ({ src, seed, durationInFrames, effect, estilo, movimiento }) => {
  const frame = useCurrentFrame();
  let direction = movimiento.direcciones[seed % movimiento.direcciones.length] ?? ([1, 0] as const);
  let zoomIn = true;
  if (effect?.startsWith('kenburns-')) {
    zoomIn = effect.includes('-in-');
    direction = effect.endsWith('left') ? [1, 0] : [-1, 0];
  }
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // En apaisado el zoom 1,00→1,08 deja un 4 % de margen por lado y el paneo usa
  // la mitad de ese margen, atado al zoom para no descubrir bordes. En vertical
  // el elemento desborda un 108 % en horizontal, así que el paneo es un
  // travelling de verdad y el zoom baja (ver encuadre.ts).
  const zoomProgress = zoomIn ? progress : 1 - progress;
  const scale = 1 + movimiento.zoom * zoomProgress;
  const translateX = movimiento.paneo * zoomProgress * direction[0]!;
  const translateY = movimiento.paneo * zoomProgress * direction[1]!;
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img
        src={src}
        style={{
          ...estilo,
          transform: `scale(${scale}) translate(${translateX}%, ${translateY}%)`,
        }}
      />
    </AbsoluteFill>
  );
};

// Movimiento lento para clips de vídeo: un zoom sutil (1,00→1,05) que da vida
// al plano sin distraer, más suave que el Ken Burns de las imágenes. Dirección
// (in/out) determinista por semilla. Determinismo: solo useCurrentFrame.
const ClipMotion: React.FC<{
  seed: number;
  durationInFrames: number;
  /** deriva horizontal en % del elemento; 0 en apaisado (descubriría borde) */
  deriva?: number;
  children: React.ReactNode;
}> = ({ seed, durationInFrames, deriva = 0, children }) => {
  const frame = useCurrentFrame();
  const linear = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // ease-out cúbico: el movimiento arranca con más energía y se asienta (menos
  // "slideshow", más "editado"); dirección de zoom según la semilla
  const eased = 1 - Math.pow(1 - linear, 3);
  const zoomProgress = seed % 2 === 0 ? eased : 1 - eased;
  const scale = 1 + 0.07 * zoomProgress;
  // En vertical el clip desborda de sobra por los lados, así que además del
  // zoom hay sitio para un travelling lateral real. Misma curva ya escrita, y
  // el sentido lo decide la semilla para que no todos los planos vayan igual.
  const sentido = seed % 2 === 0 ? 1 : -1;
  const translateX = deriva * (eased - 0.5) * 2 * sentido;
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `scale(${scale}) translateX(${translateX.toFixed(3)}%)` }}>
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const FadeIn: React.FC<{ fadeFrames: number; children: React.ReactNode }> = ({
  fadeFrames,
  children,
}) => {
  const frame = useCurrentFrame();
  const opacity =
    fadeFrames <= 0
      ? 1
      : interpolate(frame, [0, fadeFrames], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

const LoopedClip: React.FC<{
  src: string;
  trimBeforeFrames: number;
  loops: number;
  durationInFrames: number;
  fps: number;
  estilo: React.CSSProperties;
}> = ({ src, trimBeforeFrames, loops, durationInFrames, fps, estilo }) => {
  const plays = Math.max(1, Math.min(loops, MAX_LOOPS));
  if (plays === 1) {
    return (
      <AbsoluteFill>
        <OffthreadVideo src={src} trimBefore={trimBeforeFrames} muted style={estilo} />
      </AbsoluteFill>
    );
  }
  const fadeFrames = msToFrames(LOOP_CROSSFADE_MS, fps);
  // cada pasada solapa fadeFrames con la anterior para el crossfade de opacidad
  const segmentFrames = Math.ceil((durationInFrames + (plays - 1) * fadeFrames) / plays);
  const segments: { from: number; duration: number }[] = [];
  for (let i = 0; i < plays; i += 1) {
    const from = i * (segmentFrames - fadeFrames);
    const duration = Math.min(segmentFrames, durationInFrames - from);
    if (duration <= 0) break;
    segments.push({ from, duration });
  }
  return (
    <AbsoluteFill>
      {segments.map((segment, i) => (
        <Sequence
          key={i}
          from={segment.from}
          durationInFrames={segment.duration}
          name={`Pasada ${i + 1}`}
        >
          <FadeIn fadeFrames={i === 0 ? 0 : fadeFrames}>
            <OffthreadVideo src={src} trimBefore={trimBeforeFrames} muted style={estilo} />
          </FadeIn>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

// Render de UN asset según fit.mode: trim (clip con offset), stretch (clip algo
// más corto a cámara ligeramente lenta), loop (clip repetido, último recurso) o
// kenburns (imagen con zoom/paneo). Sirve tanto para el beat entero como para
// un sub-plano.
const AssetVisual: React.FC<{
  asset: NonNullable<Beat['asset']>;
  seed: number;
  durationInFrames: number;
  fps: number;
  design?: DesignTokens | undefined;
}> = ({ asset, seed, durationInFrames, fps, design }) => {
  const src = toSrc(asset.path!);
  const lienzo = useLienzo();
  const { estilo, conLosa } = planDeEncuadre(asset.encuadre, lienzo);
  const movimiento = movimientoDe(lienzo, conLosa);
  const trimBeforeFrames = msToFrames(asset.fit.offset_ms ?? 0, fps);
  // el plano no llena el lienzo: el hueco se viste con la marca en vez de
  // dejarlo negro o rellenarlo de papilla desenfocada
  const vestir = (contenido: React.ReactNode): React.ReactElement => (
    <AbsoluteFill>
      {conLosa ? <Losa design={design ?? defaultDesign()} luz={0.6} /> : null}
      {contenido}
    </AbsoluteFill>
  );
  if (asset.kind === 'image') {
    return vestir(
      <KenBurnsImage
        src={src}
        seed={seed}
        durationInFrames={durationInFrames}
        effect={asset.effect}
        estilo={estilo}
        movimiento={movimiento}
      />,
    );
  }
  if (asset.fit.mode === 'loop') {
    return vestir(
      <LoopedClip
        src={src}
        trimBeforeFrames={trimBeforeFrames}
        loops={asset.fit.loops ?? 1}
        durationInFrames={durationInFrames}
        fps={fps}
        estilo={estilo}
      />,
    );
  }
  // stretch: una sola pasada ralentizada (playback_rate < 1) que llena el tramo
  // sin reinicios; trim: clip que sobra, recortado con offset.
  const playbackRate = asset.fit.mode === 'stretch' ? (asset.fit.playback_rate ?? 1) : 1;
  return vestir(
    <ClipMotion seed={seed} durationInFrames={durationInFrames} deriva={movimiento.deriva}>
      <OffthreadVideo
        src={src}
        trimBefore={trimBeforeFrames}
        playbackRate={playbackRate}
        muted
        style={estilo}
      />
    </ClipMotion>,
  );
};

const isRenderable = (a: Beat['asset']): a is NonNullable<Beat['asset']> =>
  !!a?.path && !!a.kind && isRenderableSrc(a.path);

// Visual de un beat. Con varios sub-planos (`beat.visuals`) los tilea dentro de
// la ventana del beat con un crossfade corto entre ellos (b-roll más ágil sin
// tocar los cortes de audio). Con uno solo, pinta el asset del beat.
export const BeatVisual: React.FC<BeatVisualProps> = ({
  beat,
  videoId,
  durationInFrames,
  punchFromFrame,
  design,
}) => {
  const { fps } = useVideoConfig();

  const visuals = beat.visuals ?? [];
  if (visuals.length > 1) {
    const fade = msToFrames(SUBVISUAL_CROSSFADE_MS, fps);
    return (
      <PunchWrap punchFromFrame={punchFromFrame}>
        <AbsoluteFill>
          {visuals.map((sv, vIdx) => {
            if (!isRenderable(sv.asset)) return null;
            const from = msToFrames(sv.from_ms - beat.from_ms, fps);
            // el último sub-plano se extiende hasta el final de la Sequence del
            // beat (incluido el solape de la transición) para no dejar hueco
            const rawEnd =
              vIdx === visuals.length - 1
                ? durationInFrames
                : msToFrames(sv.to_ms - beat.from_ms, fps);
            // Fundido SOLO entre assets distintos. Entre partes del mismo
            // asset (troceo: re-encuadres de una imagen, jump cuts de un clip)
            // el corte va seco: un jump cut disuelto 200 ms es un tirón
            // amortiguado, no un corte — y amortiguarlo era exactamente lo que
            // el troceo quería evitar.
            const mismoAssetQueSig =
              vIdx < visuals.length - 1 && visuals[vIdx + 1]?.asset?.id === sv.asset?.id;
            const mismoAssetQueAnt = vIdx > 0 && visuals[vIdx - 1]?.asset?.id === sv.asset?.id;
            const fadeEntrada = vIdx === 0 || mismoAssetQueAnt ? 0 : fade;
            // Las partes no-últimas se EXTIENDEN los frames del fade de la
            // SIGUIENTE: esa Sequence (más arriba en el AbsoluteFill) funde
            // sobre este plano aún en marcha, no sobre el fondo desnudo. Sin
            // esto el «crossfade» era un destello del lienzo de 200 ms en cada
            // frontera.
            const dur = Math.max(
              1,
              rawEnd - from + (vIdx < visuals.length - 1 && !mismoAssetQueSig ? fade : 0),
            );
            const seed = hashSeed(`${videoId}:${beat.idx}:${vIdx}`);
            return (
              <Sequence key={vIdx} from={from} durationInFrames={dur} name={`Plano ${vIdx + 1}`}>
                <FadeIn fadeFrames={fadeEntrada}>
                  <AssetVisual
                    asset={sv.asset}
                    seed={seed}
                    durationInFrames={dur}
                    fps={fps}
                    design={design}
                  />
                </FadeIn>
              </Sequence>
            );
          })}
        </AbsoluteFill>
      </PunchWrap>
    );
  }

  if (!isRenderable(beat.asset)) return <Placeholder beat={beat} />;
  return (
    <PunchWrap punchFromFrame={punchFromFrame}>
      <AssetVisual
        asset={beat.asset}
        seed={hashSeed(`${videoId}:${beat.idx}`)}
        durationInFrames={durationInFrames}
        fps={fps}
        design={design}
      />
    </PunchWrap>
  );
};
