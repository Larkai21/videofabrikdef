import type { BeatCandidate, BeatStatus } from '@fabrica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Player, type PlayerRef } from '@remotion/player';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Chip, CostBadge, Kbd, ProgressBar, ReasonModal, type ChipKind, type Motivo } from '../components/ui';
import {
  approveTimeline,
  beatAction,
  getTimeline,
  getVideo,
  searchStock,
  uploadToLibrary,
} from '../lib/api';
import { beatShortLabel, fmtClock, fmtMoney, fmtSim, pct, timeMarks } from '../lib/format';
import { useDebounced, useHotkeys } from '../lib/hotkeys';
import { loadLongForm, PlayerBoundary } from '../lib/longform';
import { useToasts } from '../lib/toasts';

const FPS = 30;

// Motivos de descarte de un clip, copiados del mock.
const MOTIVOS_BEAT: Motivo[] = [
  { id: 'guion', label: 'No coincide con lo que dice el guion' },
  { id: 'calidad', label: 'Calidad o resolución insuficiente' },
  { id: 'repetido', label: 'Ya se usa en otro beat' },
  { id: 'marca', label: 'Marca o rostro reconocible' },
];

const STATUS_CHIP: Record<BeatStatus, { label: string; kind: ChipKind }> = {
  pending: { label: 'En cola', kind: 'neutral' },
  auto_ok: { label: 'Auto-aprobado', kind: 'ok' },
  review: { label: 'Requiere revisión', kind: 'warn' },
  locked: { label: 'Aprobado por ti', kind: 'ok' },
};

function isGreen(status: BeatStatus): boolean {
  return status === 'auto_ok' || status === 'locked';
}

function pillStyle(status: BeatStatus, selected: boolean, durMs: number): CSSProperties {
  const c = isGreen(status) ? 'var(--ok)' : 'var(--warn)';
  return {
    flex: `${Math.max(durMs, 1)} 1 0px`,
    minWidth: 0,
    ['--pill-bg' as string]: `color-mix(in oklab, ${c} ${selected ? 30 : 16}%, var(--bg2))`,
    ['--pill-line' as string]: `color-mix(in oklab, ${c} ${selected ? 70 : 40}%, transparent)`,
    ['--pill-ring' as string]: selected ? 'inset 0 0 0 2px var(--accent)' : 'none',
  } as CSSProperties;
}

function providerLicense(candidate: BeatCandidate | undefined): string {
  if (candidate === undefined) return '—';
  const metaLicense = candidate.meta?.['license'];
  if (typeof metaLicense === 'string' && metaLicense !== '') return metaLicense;
  switch (candidate.provider) {
    case 'pexels':
      return 'Pexels · uso comercial';
    case 'pixabay':
      return 'Pixabay · uso comercial';
    case 'library':
      return 'Biblioteca propia';
    case 'flux':
      return 'Generada · uso propio';
  }
}

function candidateTitle(candidate: BeatCandidate): string {
  const t = candidate.meta?.['title'];
  if (typeof t === 'string' && t !== '') return t;
  return `${candidate.provider} · ${candidate.ref}`;
}

export function Timeline() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { push } = useToasts();
  const queryClient = useQueryClient();

  const videoQ = useQuery({ queryKey: ['video', id], queryFn: () => getVideo(id), enabled: id !== '' });
  const tlQ = useQuery({ queryKey: ['timeline', id], queryFn: () => getTimeline(id), enabled: id !== '' });

  const video = videoQ.data;
  const master = video?.master;
  const beats = useMemo(() => tlQ.data?.beats ?? [], [tlQ.data]);

  const durationMs =
    tlQ.data?.duration_ms ??
    master?.audio?.duration_ms ??
    (beats.length > 0 ? (beats[beats.length - 1]?.to_ms ?? 0) : 0);

  // Selección
  const [selIdx, setSelIdx] = useState<number | null>(null);
  useEffect(() => {
    if (selIdx === null && beats.length > 0) {
      const firstPending = beats.find((b) => !isGreen(b.status));
      setSelIdx(firstPending?.idx ?? beats[0]?.idx ?? 0);
    }
  }, [beats, selIdx]);
  const sel = beats.find((b) => b.idx === selIdx);

  // Player
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (player === null) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
    };
  }, [player]);

  const currentMs = (frame / FPS) * 1000;
  const durationInFrames = Math.max(1, Math.round((durationMs / 1000) * FPS));

  const seekToMs = (ms: number) => {
    player?.seekTo(Math.round((ms / 1000) * FPS));
  };

  const selectBeat = (idx: number) => {
    setSelIdx(idx);
    setAltsOpen(false);
    const beat = beats.find((b) => b.idx === idx);
    if (beat !== undefined) seekToMs(beat.from_ms + 1);
  };

  // Acciones por beat
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['timeline', id] });
    void queryClient.invalidateQueries({ queryKey: ['video', id] });
    void queryClient.invalidateQueries({ queryKey: ['inbox'] });
  };

  const actionMut = useMutation({
    mutationFn: (args: { idx: number; action: 'approve' | 'choose' | 'discard'; ref?: string; reason?: string }) =>
      beatAction(id, args.idx, {
        action: args.action,
        ...(args.ref !== undefined ? { ref: args.ref } : {}),
        ...(args.reason !== undefined ? { reason: args.reason } : {}),
      }),
    onSuccess: (_, args) => {
      invalidate();
      if (args.action === 'approve') push(`Beat ${args.idx + 1} aprobado`);
      if (args.action === 'choose') push(`Clip sustituido en el beat ${args.idx + 1}`);
      if (args.action === 'discard') push(`Beat ${args.idx + 1} descartado · buscamos alternativa`);
    },
    onError: (err) => push(err instanceof Error ? err.message : 'La acción no se pudo aplicar', 'danger'),
  });

  const approveTlMut = useMutation({
    mutationFn: () => approveTimeline(id),
    onSuccess: () => {
      invalidate();
      push('Timeline aprobada · el render ha empezado');
      void navigate('/');
    },
    onError: (err) => push(err instanceof Error ? err.message : 'No se pudo aprobar la timeline', 'danger'),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) =>
      uploadToLibrary({ file, videoId: id, ...(selIdx !== null ? { beatIdx: selIdx } : {}) }),
    onSuccess: () => {
      invalidate();
      push('Subido a la biblioteca · asignado al beat');
    },
    onError: () => push('No se pudo subir el archivo', 'danger'),
  });

  // Alternativas, stock y descarte
  const [altsOpen, setAltsOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [stockQ, setStockQ] = useState('');
  const debouncedQ = useDebounced(stockQ.trim(), 350);
  const stockSearchQ = useQuery({
    queryKey: ['stock', debouncedQ, id, selIdx],
    queryFn: () => searchStock(debouncedQ, id, selIdx ?? undefined),
    enabled: debouncedQ.length > 1,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pendientes = beats.filter((b) => !isGreen(b.status));
  const aprobados = beats.length - pendientes.length;

  const nextPending = () => {
    if (pendientes.length === 0) return;
    const after = pendientes.find((b) => selIdx === null || b.idx > selIdx) ?? pendientes[0];
    if (after !== undefined) selectBeat(after.idx);
  };

  const move = (delta: number) => {
    if (beats.length === 0) return;
    const i = beats.findIndex((b) => b.idx === selIdx);
    const j = Math.max(0, Math.min(beats.length - 1, (i === -1 ? 0 : i) + delta));
    const beat = beats[j];
    if (beat !== undefined) selectBeat(beat.idx);
  };

  const togglePlay = () => {
    if (player === null) return;
    if (player.isPlaying()) player.pause();
    else player.play();
  };

  const chosenCandidate =
    sel?.candidates?.find((c) => c.ref === sel.asset?.id) ?? sel?.candidates?.[0];
  const alternatives = (sel?.candidates ?? [])
    .filter((c) => c.ref !== chosenCandidate?.ref)
    .slice(0, 3);

  const allReady = beats.length > 0 && pendientes.length === 0;
  const canApproveTimeline = allReady && video?.state === 'assets' && !approveTlMut.isPending;

  useHotkeys((e) => {
    const k = e.key.toLowerCase();
    if (k === 'a') {
      e.preventDefault();
      if (sel !== undefined && sel.status !== 'locked') {
        actionMut.mutate({ idx: sel.idx, action: 'approve' });
      }
    } else if (e.key === ' ') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      move(-1);
    } else if (k === 'd') {
      e.preventDefault();
      if (sel !== undefined) setDiscardOpen(true);
    } else if (k === 'n') {
      e.preventDefault();
      nextPending();
    } else if (['1', '2', '3'].includes(k) && altsOpen && sel !== undefined) {
      e.preventDefault();
      const alt = alternatives[Number(k) - 1];
      if (alt !== undefined) {
        actionMut.mutate({ idx: sel.idx, action: 'choose', ref: alt.ref });
        setAltsOpen(false);
      }
    }
  });

  if (videoQ.isPending || tlQ.isPending) {
    return (
      <div className="wrap-1420" style={{ padding: 'calc(var(--pad) * 2) 26px' }}>
        <div className="muted fs-sm">Cargando la timeline</div>
      </div>
    );
  }

  if (video === undefined || master === undefined) {
    return (
      <div className="wrap-1420" style={{ padding: 'calc(var(--pad) * 2) 26px' }}>
        <div className="banner banner-danger">No se pudo cargar el vídeo.</div>
      </div>
    );
  }

  const videoTitle =
    video.title_chosen ??
    (master.seo !== undefined ? master.seo.titles[master.seo.chosen_idx ?? 0] : undefined) ??
    'Vídeo sin título';

  const playerPlaceholder = (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
      }}
    >
      <div>
        <div
          className="mono"
          style={{
            fontSize: 12,
            letterSpacing: '.14em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,.62)',
          }}
        >
          previsualización en vivo
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'rgba(255,255,255,.34)', marginTop: 6 }}>
          se recompone al aprobar o cambiar un clip
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="subbar">
        <div className="wrap-1420 subbar-inner">
          <Button variant="secondary" onClick={() => void navigate('/')}>
            ← Bandeja
          </Button>
          <span
            className="head"
            style={{
              fontSize: 15,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 340,
            }}
          >
            {videoTitle}
          </span>
          <Chip kind="warn">Curar timeline</Chip>
          <div style={{ flex: 1 }} />
          {canApproveTimeline ? (
            <Button variant="primary" onClick={() => approveTlMut.mutate()}>
              Aprobar timeline y renderizar
            </Button>
          ) : null}
          <span className="mono fs-sm muted" style={{ whiteSpace: 'nowrap' }}>
            {aprobados} de {beats.length} beats aprobados
          </span>
          <div style={{ width: 120, flex: 'none' }}>
            <ProgressBar value={pct(aprobados, beats.length)} color="var(--ok)" />
          </div>
          <CostBadge>{fmtMoney(video.costs_total)}</CostBadge>
        </div>
      </div>

      <div
        className="wrap-1420"
        style={{
          padding: 'calc(var(--pad) * 1.5) 26px 60px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 372px',
          gap: 'calc(var(--gap) * 1.6)',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--gap)' }}>
          {/* Player 16:9 con controles propios */}
          <div
            style={{
              position: 'relative',
              aspectRatio: '16 / 9',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r)',
              overflow: 'hidden',
              backgroundColor: '#000',
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,255,255,.05) 0 10px, transparent 10px 20px)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <PlayerBoundary fallback={playerPlaceholder}>
              <Player
                ref={setPlayer}
                lazyComponent={loadLongForm}
                inputProps={master}
                durationInFrames={durationInFrames}
                fps={FPS}
                compositionWidth={1920}
                compositionHeight={1080}
                controls={false}
                clickToPlay={false}
                spaceKeyToPlayOrPause={false}
                style={{ width: '100%', height: '100%' }}
              />
            </PlayerBoundary>
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                background: 'linear-gradient(to top, rgba(0,0,0,.72), transparent)',
              }}
            >
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? 'Pausar' : 'Reproducir'}
                style={{
                  width: 32,
                  height: 32,
                  flex: 'none',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,.28)',
                  background: 'rgba(255,255,255,.12)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                }}
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <span className="mono" style={{ fontSize: 12, color: 'rgba(255,255,255,.86)' }}>
                {fmtClock(currentMs)} / {fmtClock(durationMs)}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 3,
                  background: 'rgba(255,255,255,.2)',
                  borderRadius: 999,
                  overflow: 'hidden',
                  cursor: 'pointer',
                }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = (e.clientX - rect.left) / rect.width;
                  seekToMs(ratio * durationMs);
                }}
                role="slider"
                aria-label="Posición de reproducción"
                aria-valuemin={0}
                aria-valuemax={Math.round(durationMs / 1000)}
                aria-valuenow={Math.round(currentMs / 1000)}
                tabIndex={0}
              >
                <div
                  style={{ width: `${pct(currentMs, durationMs)}%`, height: '100%', background: '#fff' }}
                />
              </div>
              <span className="mono" style={{ fontSize: 10.5, color: 'rgba(255,255,255,.5)' }}>
                espacio
              </span>
            </div>
          </div>

          {/* Pista de clips */}
          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <span className="muted fs-sm">
                Pista de clips · {beats.length} beats · anchos fijados por el audio
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
                <span className="mono fs-sm muted" style={{ whiteSpace: 'nowrap' }}>
                  verde aprobado · ámbar requiere revisión
                </span>
                <Button variant="secondary" kbd="n" onClick={nextPending} disabled={pendientes.length === 0}>
                  {pendientes.length > 0 ? `${pendientes.length} sin revisar · siguiente` : 'Todo revisado'}
                </Button>
              </span>
            </div>

            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', gap: 3, alignItems: 'stretch', position: 'relative' }}>
                {beats.map((b) => (
                  <div key={b.idx} style={pillStyle(b.status, b.idx === selIdx, b.to_ms - b.from_ms)}>
                    <button
                      type="button"
                      className="beat-pill"
                      onClick={() => selectBeat(b.idx)}
                      aria-label={`Beat ${b.idx + 1} · ${STATUS_CHIP[b.status].label}`}
                      aria-pressed={b.idx === selIdx}
                    >
                      <span
                        className="mono"
                        style={{ fontSize: 10, color: 'var(--fg)', whiteSpace: 'nowrap' }}
                      >
                        {b.idx + 1}
                      </span>
                      <span
                        style={{
                          fontSize: 10.5,
                          color: 'var(--fg)',
                          opacity: 0.85,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '100%',
                        }}
                      >
                        {beatShortLabel(b.visual_query)}
                      </span>
                    </button>
                  </div>
                ))}
                {durationMs > 0 ? (
                  <div
                    style={{
                      position: 'absolute',
                      top: -4,
                      bottom: -4,
                      width: 2,
                      background: 'var(--accent)',
                      boxShadow: '0 0 0 3px color-mix(in oklab, var(--accent) 22%, transparent)',
                      pointerEvents: 'none',
                      left: `${pct(currentMs, durationMs)}%`,
                    }}
                    aria-hidden="true"
                  />
                ) : null}
              </div>

              <div style={{ display: 'flex', gap: 3, marginTop: 6 }}>
                <div
                  style={{
                    flex: 1,
                    height: 16,
                    borderRadius: 'var(--pill-r)',
                    border: '1px solid var(--line)',
                    backgroundColor: 'var(--bg3)',
                    backgroundImage:
                      'repeating-linear-gradient(90deg, color-mix(in oklab, var(--fg) 34%, transparent) 0 2px, transparent 2px 6px)',
                    opacity: 0.7,
                  }}
                  aria-hidden="true"
                />
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--fg2)', width: 74, flex: 'none', lineHeight: '16px' }}>
                  voz · locución
                </span>
              </div>
              <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>
                <div
                  style={{
                    flex: 1,
                    height: 10,
                    borderRadius: 'var(--pill-r)',
                    border: '1px solid var(--line)',
                    backgroundColor: 'var(--bg3)',
                    backgroundImage:
                      'repeating-linear-gradient(90deg, color-mix(in oklab, var(--fg) 22%, transparent) 0 26px, transparent 26px 34px)',
                  }}
                  aria-hidden="true"
                />
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--fg2)', width: 74, flex: 'none', lineHeight: '10px' }}>
                  subtítulos
                </span>
              </div>
              <div
                className="mono"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 7,
                  fontSize: 10,
                  color: 'var(--fg2)',
                }}
              >
                {timeMarks(durationMs, 6).map((mark, i) => (
                  <span key={i}>{mark}</span>
                ))}
              </div>
            </div>

            <div
              className="mono fs-sm muted"
              style={{
                marginTop: 'var(--pad)',
                paddingTop: 10,
                borderTop: '1px solid var(--line)',
                display: 'flex',
                gap: 16,
                flexWrap: 'wrap',
              }}
            >
              <span>
                <Kbd>a</Kbd> aprobar
              </span>
              <span>
                <Kbd>espacio</Kbd> reproducir
              </span>
              <span>
                <Kbd>← →</Kbd> moverse
              </span>
              <span>
                <Kbd>d</Kbd> descartar con motivo
              </span>
              <div style={{ flex: 1 }} />
              <span>los tiempos son de solo lectura</span>
            </div>
          </div>

          {allReady && !canApproveTimeline && video.state !== 'assets' ? (
            <div className="banner">
              La timeline ya está aprobada. El vídeo sigue su camino hacia el render.
            </div>
          ) : null}
        </div>

        {/* Panel del beat seleccionado */}
        <aside
          className="card"
          style={{ position: 'sticky', top: 'calc(var(--row) * 2 + 18px)', overflow: 'hidden' }}
        >
          {chosenCandidate?.thumb_url !== undefined && chosenCandidate.thumb_url !== '' ? (
            <img
              src={chosenCandidate.thumb_url}
              alt={sel !== undefined ? `Candidato del beat ${sel.idx + 1}` : 'Candidato'}
              style={{
                width: '100%',
                aspectRatio: '16 / 9',
                objectFit: 'cover',
                display: 'block',
                borderBottom: '1px solid var(--line)',
              }}
            />
          ) : (
            <div
              className="thumb-ph"
              style={{
                aspectRatio: '16 / 9',
                borderLeft: 'none',
                borderRight: 'none',
                borderTop: 'none',
                borderRadius: 0,
                display: 'flex',
                alignItems: 'flex-end',
                padding: 10,
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: 'var(--fg2)',
                  background: 'var(--bg2)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--r-sm)',
                  padding: '3px 7px',
                }}
              >
                sin miniatura · 1920 × 1080
              </span>
            </div>
          )}

          {sel === undefined ? (
            <div className="muted fs-sm" style={{ padding: 'var(--pad)' }}>
              Selecciona un beat en la pista para revisarlo.
            </div>
          ) : (
            <div style={{ padding: 'var(--pad)', display: 'flex', flexDirection: 'column', gap: 'var(--pad)' }}>
              <div>
                <div className="mono" style={{ fontSize: 'var(--fs)', fontWeight: 500 }}>
                  Beat {sel.idx + 1} · {fmtClock(sel.from_ms)}–{fmtClock(sel.to_ms)} ·{' '}
                  {Math.round((sel.to_ms - sel.from_ms) / 1000)} s (fijado por el audio)
                </div>
                <div
                  className="muted fs-sm"
                  style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span aria-hidden="true">⛬</span>
                  <span>La duración la fija el audio. No hay recorte manual.</span>
                </div>
              </div>

              <div className="head" style={{ fontSize: 16, lineHeight: 1.3 }}>
                {sel.visual_query}
              </div>

              <div style={{ borderLeft: '2px solid var(--line)', paddingLeft: 11 }}>
                <div className="step-label" style={{ marginBottom: 4 }}>
                  La locución dice aquí
                </div>
                <div className="fs-sm" style={{ lineHeight: 1.5 }}>
                  {sel.text}
                </div>
                <Link
                  to={`/videos/${id}/guion`}
                  className="fs-sm"
                  style={{ display: 'inline-block', marginTop: 6 }}
                >
                  Ver en el guion →
                </Link>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} className="fs-sm">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span className="muted">Origen</span>
                  <span className="mono">{sel.chosen_origin ?? chosenCandidate?.provider ?? '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span className="muted">Licencia</span>
                  <span className="mono">{providerLicense(chosenCandidate)}</span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                    alignItems: 'center',
                  }}
                >
                  <span className="muted">Similitud con el beat</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {(() => {
                      const sim = sel.chosen_score ?? chosenCandidate?.score ?? null;
                      if (sim === null) return <span className="mono">—</span>;
                      return (
                        <>
                          <span
                            style={{
                              width: 66,
                              height: 5,
                              borderRadius: 999,
                              background: 'var(--bg3)',
                              overflow: 'hidden',
                              display: 'inline-block',
                            }}
                          >
                            <span
                              style={{
                                display: 'block',
                                height: '100%',
                                width: `${Math.round(sim * 100)}%`,
                                background: sim >= 0.75 ? 'var(--ok)' : 'var(--warn)',
                              }}
                            />
                          </span>
                          <span className="mono">{fmtSim(sim)}</span>
                        </>
                      );
                    })()}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span className="muted">Estado</span>
                  <Chip kind={STATUS_CHIP[sel.status].kind}>{STATUS_CHIP[sel.status].label}</Chip>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
                <Button
                  variant="primary"
                  kbd="a"
                  style={{ height: 38 }}
                  disabled={sel.status === 'locked' || actionMut.isPending}
                  onClick={() => actionMut.mutate({ idx: sel.idx, action: 'approve' })}
                >
                  Aprobar
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setAltsOpen((v) => !v)}
                  disabled={alternatives.length === 0}
                  aria-expanded={altsOpen}
                >
                  Alternativas ({alternatives.length})
                </Button>
                {altsOpen ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                    {alternatives.map((alt, i) => (
                      <button
                        key={alt.ref}
                        type="button"
                        onClick={() => {
                          actionMut.mutate({ idx: sel.idx, action: 'choose', ref: alt.ref });
                          setAltsOpen(false);
                        }}
                        style={{
                          border: '1px solid var(--line)',
                          borderRadius: 'var(--r-sm)',
                          overflow: 'hidden',
                          background: 'var(--bg2)',
                          padding: 0,
                          textAlign: 'left',
                          cursor: 'pointer',
                        }}
                        aria-label={`Elegir alternativa ${i + 1} · similitud ${fmtSim(alt.score)}`}
                      >
                        {alt.thumb_url !== undefined && alt.thumb_url !== '' ? (
                          <img
                            src={alt.thumb_url}
                            alt=""
                            style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block' }}
                          />
                        ) : (
                          <div className="thumb-ph" style={{ aspectRatio: '16 / 9', border: 'none', borderRadius: 0 }} />
                        )}
                        <div
                          className="mono"
                          style={{
                            fontSize: 9.5,
                            color: 'var(--fg2)',
                            padding: '4px 5px',
                            display: 'flex',
                            justifyContent: 'space-between',
                          }}
                        >
                          <span>{fmtSim(alt.score)}</span>
                          <span>{i + 1}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="input-wrap">
                  <span className="muted" style={{ fontSize: 12 }} aria-hidden="true">
                    ⌕
                  </span>
                  <input
                    value={stockQ}
                    onChange={(e) => setStockQ(e.target.value)}
                    placeholder="Buscar en stock"
                    aria-label="Buscar en stock"
                  />
                </div>
                {debouncedQ.length > 1 ? (
                  <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', overflow: 'hidden' }}>
                    {stockSearchQ.isPending ? (
                      <div className="muted fs-sm" style={{ padding: '7px 9px' }}>
                        Buscando en stock
                      </div>
                    ) : null}
                    {stockSearchQ.data !== undefined && stockSearchQ.data.results.length === 0 ? (
                      <div className="muted fs-sm" style={{ padding: '7px 9px' }}>
                        Sin resultados para esa búsqueda.
                      </div>
                    ) : null}
                    {(stockSearchQ.data?.results ?? []).slice(0, 6).map((r) => (
                      <button
                        key={r.ref}
                        type="button"
                        className="row-hover"
                        onClick={() => actionMut.mutate({ idx: sel.idx, action: 'choose', ref: r.ref })}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '7px 9px',
                          borderBottom: '1px solid var(--line)',
                          fontSize: 'var(--fs-sm)',
                          width: '100%',
                          textAlign: 'left',
                          background: 'transparent',
                          border: 'none',
                          borderRadius: 0,
                          cursor: 'pointer',
                        }}
                      >
                        {r.thumb_url !== undefined && r.thumb_url !== '' ? (
                          <img
                            src={r.thumb_url}
                            alt=""
                            style={{ width: 44, flex: 'none', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 2 }}
                          />
                        ) : (
                          <div className="thumb-ph" style={{ width: 44, aspectRatio: '16 / 9', borderRadius: 2 }} />
                        )}
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {candidateTitle(r)}
                        </span>
                        <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg2)' }}>
                          {fmtSim(r.score)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*,image/*"
                    style={{ display: 'none' }}
                    aria-hidden="true"
                    tabIndex={-1}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file !== undefined) uploadMut.mutate(file);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    variant="ghost"
                    style={{ flex: 1, height: 34 }}
                    disabled={uploadMut.isPending}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploadMut.isPending ? 'Subiendo' : 'Subir el mío'}
                  </Button>
                  <Button
                    variant="danger-ghost"
                    kbd="d"
                    style={{ flex: 1, height: 34 }}
                    onClick={() => setDiscardOpen(true)}
                  >
                    Descartar
                  </Button>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      <ReasonModal
        open={discardOpen}
        title={sel !== undefined ? `Descartar el clip del beat ${sel.idx + 1}` : ''}
        desc="El hueco se rellena con la mejor alternativa. La duración no cambia: la fija el audio."
        motivos={MOTIVOS_BEAT}
        cta="Descartar y sustituir"
        onConfirm={(reason) => {
          setDiscardOpen(false);
          if (sel !== undefined) actionMut.mutate({ idx: sel.idx, action: 'discard', reason });
        }}
        onClose={() => setDiscardOpen(false)}
      />
    </div>
  );
}
