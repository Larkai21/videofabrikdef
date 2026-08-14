import {
  editPayloadText,
  type BeatCandidate,
  type BeatStatus,
  type EditType,
} from '@fabrica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Player, type PlayerRef } from '@remotion/player';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Chip,
  CostBadge,
  Kbd,
  ProgressBar,
  ReasonModal,
  ThumbPlaceholder,
  VisorMedia,
  type ChipKind,
  type Motivo,
  type VisorDato,
  type VisorMediaSource,
} from '../components/ui';
import {
  approveTimeline,
  beatAction,
  fileUrl,
  getTimeline,
  removeEdits,
  getVideo,
  searchStock,
  uploadToLibrary,
} from '../lib/api';
import { beatShortLabel, fmtClock, fmtMoney, fmtSim, pct, timeMarks } from '../lib/format';
import { useDebounced, useHotkeys } from '../lib/hotkeys';
import { loadLongForm, PlayerBoundary } from '../lib/longform';
import { useToasts } from '../lib/toasts';

const FPS = 30;

// Etiquetas de los efectos de edición para el panel de curación.
// Record<EditType, …> y no Record<string, …>: así añadir un tipo de efecto al
// contrato obliga a darle nombre humano aquí, en vez de que el panel de curación
// enseñe el identificador crudo (que es lo que pasaba con cuatro de ellos).
const EDIT_LABELS: Record<EditType, string> = {
  zoom_punch: 'Zoom',
  keyword_highlight: 'Palabra resaltada',
  text_callout: 'Etiqueta',
  stat_card: 'Tarjeta de dato',
  stat_odometer: 'Contador',
  quote_card: 'Cita',
  kinetic_text: 'Tipografía cinética',
  annotation: 'Marca a mano',
  device_frame: 'Marco de navegador',
  micro_fx: 'Acento',
  split_versus: 'Comparación',
  pasos_flow: 'Pasos',
  tendencia: 'Tendencia',
  barras: 'Barras a escala',
  linea_tiempo: 'Línea de tiempo',
  ciclo: 'Ciclo',
  cuello: 'Embudo',
  capas: 'Capas',
  arbol: 'Árbol',
  cobertura: 'Cobertura del veto',
  imagen_apoyo: 'Imagen de referencia',
  sfx: 'Sonido',
};

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
    case 'nasa':
      return 'NASA · dominio público';
    case 'flux':
      return 'Generada · uso propio';
    case 'wikimedia':
      // la licencia real viene en meta.license (rama de arriba); esto es el
      // fallback si un candidato viejo no la trae
      return 'Wikimedia Commons · ver licencia';
  }
}

function candidateTitle(candidate: BeatCandidate): string {
  const t = candidate.meta?.['title'];
  if (typeof t === 'string' && t !== '') return t;
  return `${candidate.provider} · ${candidate.ref}`;
}

function metaStr(candidate: BeatCandidate, key: string): string | null {
  const v = candidate.meta?.[key];
  return typeof v === 'string' && v !== '' ? v : null;
}

function metaNum(candidate: BeatCandidate, key: string): number {
  return Number(candidate.meta?.[key] ?? 0);
}

/**
 * De dónde sale la previsualización de un candidato y qué elemento la pinta.
 *
 * - `meta.kind` manda sobre el tipo: lo rellenan los tres proveedores.
 * - La fuente es `meta.download_url` (stock, https absoluto) o `preview_url`
 *   (biblioteca y flux, que la API deriva de meta.path). NUNCA `meta.path`:
 *   es ruta de disco y acabaría en un 404.
 * - Sin fuente, la miniatura sirve de imagen; sin nada, no hay previsualización.
 */
function candidatePreview(candidate: BeatCandidate): VisorMediaSource | null {
  const src = metaStr(candidate, 'download_url') ?? candidate.preview_url ?? null;
  const poster =
    candidate.thumb_url !== undefined && candidate.thumb_url !== ''
      ? fileUrl(candidate.thumb_url)
      : undefined;
  if (src === null) return poster !== undefined ? { kind: 'image', src: poster } : null;
  const kind = metaStr(candidate, 'kind') ?? (candidate.provider === 'flux' ? 'image' : 'clip');
  if (kind === 'clip') {
    return { kind: 'video', src: fileUrl(src), ...(poster !== undefined ? { poster } : {}) };
  }
  return { kind: 'image', src: fileUrl(src) };
}

/**
 * Filas de datos del visor. La de «encaje» es la que de verdad decide: replica
 * en texto lo que hará provisionalFit en la API al elegir el candidato.
 */
function datosCandidato(
  origen: 'alternativa' | 'stock',
  cand: BeatCandidate,
  beat: { from_ms: number; to_ms: number },
): VisorDato[] {
  const datos: VisorDato[] = [
    { label: 'Origen', value: <span className="mono">{cand.provider}</span> },
    { label: 'Licencia', value: providerLicense(cand) },
  ];

  const kind = metaStr(cand, 'kind') ?? (cand.provider === 'flux' ? 'image' : 'clip');
  const w = metaNum(cand, 'width');
  const h = metaNum(cand, 'height');
  const durMs = metaNum(cand, 'duration_ms');
  const formato = [
    kind === 'clip' ? 'Clip' : 'Imagen',
    w > 0 && h > 0 ? `${w}×${h}` : null,
    durMs > 0 ? fmtClock(durMs) : null,
  ]
    .filter((x) => x !== null)
    .join(' · ');
  datos.push({ label: 'Formato', value: <span className="mono">{formato}</span> });

  // la búsqueda libre de stock no pasa por embeddings: su score es siempre 0 y
  // mostrarlo sería engañoso
  if (origen !== 'stock') {
    datos.push({ label: 'Similitud con el beat', value: <BarraSimilitud value={cand.score} /> });
  }

  const beatMs = beat.to_ms - beat.from_ms;
  if (kind === 'image') {
    datos.push({
      label: 'Encaje',
      value: `Imagen fija: se anima con Ken Burns durante ${fmtClock(beatMs)}`,
    });
  } else if (durMs > 0 && beatMs > 0) {
    datos.push({
      label: 'Encaje',
      value:
        durMs >= beatMs
          ? `Sobra metraje: se recorta al centro (${fmtClock(beatMs)} de ${fmtClock(durMs)})`
          : `Más corto que el beat: se repetirá ${Math.min(3, Math.ceil(beatMs / durMs))} veces`,
    });
  }

  return datos;
}

/** Barra de similitud del panel de curación, compartida con el visor. */
function BarraSimilitud({ value }: { value: number | null }) {
  if (value === null) return <span className="mono">—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
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
            width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`,
            background: value >= 0.75 ? 'var(--ok)' : 'var(--warn)',
          }}
        />
      </span>
      <span className="mono">{fmtSim(value)}</span>
    </span>
  );
}

// posición de reproducción como estado LOCAL: solo re-renderizan estas hojas.
// introFrames descuenta la intro del brand kit y maxMs acota la outro: el
// reloj y la aguja miden la línea temporal del AUDIO (la ley), nunca más.
function useCurrentMs(player: PlayerRef | null, introFrames = 0, maxMs = Infinity): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (player === null) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    player.addEventListener('frameupdate', onFrame);
    return () => player.removeEventListener('frameupdate', onFrame);
  }, [player]);
  return Math.min(maxMs, (Math.max(0, frame - introFrames) / FPS) * 1000);
}

function ClockAndScrub({
  player,
  durationMs,
  introFrames,
  onSeek,
}: {
  player: PlayerRef | null;
  durationMs: number;
  introFrames: number;
  onSeek: (ms: number) => void;
}) {
  const currentMs = useCurrentMs(player, introFrames, durationMs);
  return (
    <>
      <span className="mono" style={{ fontSize: 12, color: 'rgba(255,255,255,.86)' }}>
        {fmtClock(currentMs)} / {fmtClock(durationMs)}
      </span>
      <div
        style={{
          flex: 1,
          // La pista se ve de 3px pero se pulsa en 16px: apuntar a una franja
          // de 3px exige precisión de píxel.
          paddingTop: 7,
          paddingBottom: 6,
          cursor: 'pointer',
        }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          onSeek(ratio * durationMs);
        }}
        onKeyDown={(e) => {
          const paso = e.shiftKey ? 1000 : 5000;
          let next: number | null = null;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = currentMs + paso;
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = currentMs - paso;
          else if (e.key === 'Home') next = 0;
          else if (e.key === 'End') next = durationMs;
          if (next === null) return;
          e.preventDefault();
          // Con el scrubber enfocado las flechas buscan posición; sin él, el
          // atajo global sigue navegando entre beats.
          e.stopPropagation();
          onSeek(Math.max(0, Math.min(durationMs, next)));
        }}
        role="slider"
        aria-label="Posición de reproducción"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(currentMs / 1000)}
        aria-valuetext={`${fmtClock(currentMs)} de ${fmtClock(durationMs)}`}
        tabIndex={0}
      >
        <div
          style={{
            height: 3,
            background: 'rgba(255,255,255,.2)',
            borderRadius: 999,
            overflow: 'hidden',
          }}
        >
          <div
            style={{ width: `${pct(currentMs, durationMs)}%`, height: '100%', background: '#fff' }}
          />
        </div>
      </div>
    </>
  );
}

function Playhead({
  player,
  durationMs,
  introFrames,
}: {
  player: PlayerRef | null;
  durationMs: number;
  introFrames: number;
}) {
  const currentMs = useCurrentMs(player, introFrames, durationMs);
  if (durationMs <= 0) return null;
  return (
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
  );
}

export function Timeline() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { push } = useToasts();
  const queryClient = useQueryClient();

  const videoQ = useQuery({
    queryKey: ['video', id],
    queryFn: () => getVideo(id),
    enabled: id !== '',
  });
  const tlQ = useQuery({
    queryKey: ['timeline', id],
    queryFn: () => getTimeline(id),
    enabled: id !== '',
  });

  const video = videoQ.data;
  const master = video?.master;
  const beats = useMemo(() => tlQ.data?.beats ?? [], [tlQ.data]);
  const edits = tlQ.data?.edits ?? [];
  const tlState = tlQ.data?.state;

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

  // Player. El frame NO vive aquí: durante la reproducción cambia 30 veces
  // por segundo y re-renderizaría toda la pantalla; lo consumen componentes
  // hoja (ClockAndScrub, Playhead) que se suscriben ellos mismos.
  const [player, setPlayer] = useState<PlayerRef | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (player === null) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    return () => {
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
    };
  }, [player]);

  // layout del brand kit (intro/outro desplazan la línea temporal): se calcula
  // con el mismo import dinámico que el Player para no arrastrar Remotion al
  // chunk inicial; sin kit activo equivale al cálculo de siempre
  const [kitLayout, setKitLayout] = useState<{ totalFrames: number; introFrames: number } | null>(
    null,
  );
  // Si el módulo no carga, la preview se desfasa respecto al MP4 justo lo que
  // dura la intro (80 frames = 2,7 s): pulsas un beat y el player salta a otro
  // sitio, y firmas una timeline que no es la que se va a renderizar. Antes
  // caía a introFrames = 0 en silencio; ahora se dice.
  const [kitError, setKitError] = useState(false);
  useEffect(() => {
    if (master === undefined) return;
    let alive = true;
    void import('@fabrica/video')
      .then((mod) => {
        if (!alive) return;
        const layout = mod.computeBrandKitLayout(master);
        setKitLayout({ totalFrames: layout.totalFrames, introFrames: layout.introFrames });
        setKitError(false);
      })
      .catch(() => {
        if (!alive) return;
        setKitLayout(null);
        setKitError(true);
      });
    return () => {
      alive = false;
    };
  }, [master]);
  const introFrames = kitLayout?.introFrames ?? 0;
  const durationInFrames =
    kitLayout?.totalFrames ?? Math.max(1, Math.round((durationMs / 1000) * FPS));

  const seekToMs = (ms: number) => {
    player?.seekTo(introFrames + Math.round((ms / 1000) * FPS));
  };

  const selectBeat = (idx: number) => {
    setSelIdx(idx);
    setAltsOpen(false);
    // sin esto se podría confirmar el visor contra un beat que ya no es el
    // seleccionado
    setVisor(null);
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
    mutationFn: (args: {
      idx: number;
      action: 'approve' | 'choose' | 'discard';
      ref?: string;
      // los resultados de la búsqueda libre no están en beats.candidates:
      // el candidato completo viaja en el body
      candidate?: BeatCandidate;
      reason?: string;
    }) =>
      beatAction(id, args.idx, {
        action: args.action,
        ...(args.ref !== undefined ? { ref: args.ref } : {}),
        ...(args.candidate !== undefined ? { candidate: args.candidate } : {}),
        ...(args.reason !== undefined ? { reason: args.reason } : {}),
      }),
    onSuccess: (_, args) => {
      invalidate();
      if (args.action === 'approve') push(`Beat ${args.idx + 1} aprobado`);
      if (args.action === 'choose') push(`Clip sustituido en el beat ${args.idx + 1}`);
      if (args.action === 'discard') push(`Beat ${args.idx + 1} descartado · buscamos alternativa`);
    },
    onError: (err) =>
      push(err instanceof Error ? err.message : 'La acción no se pudo aplicar', 'danger'),
  });

  const approveTlMut = useMutation({
    mutationFn: () => approveTimeline(id),
    onSuccess: () => {
      invalidate();
      push('Timeline aprobada · el render ha empezado');
      void navigate('/');
    },
    onError: (err) =>
      push(err instanceof Error ? err.message : 'No se pudo aprobar la timeline', 'danger'),
  });

  const removeEditMut = useMutation({
    mutationFn: (index: number) => removeEdits(id, [index]),
    onSuccess: () => {
      invalidate();
      push('Efecto quitado');
    },
    onError: (err) =>
      push(err instanceof Error ? err.message : 'No se pudo quitar el efecto', 'danger'),
  });

  const uploadMut = useMutation({
    mutationFn: (file: File) => {
      if (video === undefined) throw new Error('El vídeo aún no está cargado');
      return uploadToLibrary({
        file,
        channelId: video.channel_id,
        videoId: id,
        ...(selIdx !== null ? { beatIdx: selIdx } : {}),
      });
    },
    onSuccess: () => {
      invalidate();
      push('Subido a la biblioteca · asignado al beat');
    },
    onError: () => push('No se pudo subir el archivo', 'danger'),
  });

  // Alternativas, stock y descarte
  const [altsOpen, setAltsOpen] = useState(false);
  // Candidato abierto en el visor. El origen decide si al confirmar hay que
  // mandar el candidato entero: los de stock no viven en beats.candidates y el
  // servidor los exige en el cuerpo; los de la rejilla se resuelven por ref.
  const [visor, setVisor] = useState<{
    origen: 'alternativa' | 'stock';
    cand: BeatCandidate;
  } | null>(null);
  // Plegado por defecto: la lista de efectos vive entre el player y la pista de
  // clips, y con muchos efectos empujaba la timeline fuera de pantalla.
  const [editsOpen, setEditsOpen] = useState(false);
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
  // 6 y no 3: los candidatos ocultos ya están puntuados y descargados en el
  // maestro, no cuestan ni una llamada, y 6 es hasta donde llegan los atajos.
  const alternatives = (sel?.candidates ?? [])
    .filter((c) => c.ref !== chosenCandidate?.ref)
    .slice(0, 6);

  // Para el clip ya elegido manda el archivo descargado (asset.path), que es lo
  // que se va a renderizar; la miniatura del proveedor es solo el respaldo.
  const elegido: VisorMediaSource | null =
    sel?.asset?.path !== undefined && sel.asset.path !== ''
      ? {
          kind: sel.asset.kind === 'image' ? 'image' : 'video',
          src: fileUrl(sel.asset.path),
          ...(chosenCandidate?.thumb_url ? { poster: fileUrl(chosenCandidate.thumb_url) } : {}),
        }
      : chosenCandidate !== undefined
        ? candidatePreview(chosenCandidate)
        : null;

  const allReady = beats.length > 0 && pendientes.length === 0;
  const canApproveTimeline = allReady && video?.state === 'assets' && !approveTlMut.isPending;

  useHotkeys((e) => {
    // con un modal abierto los atajos globales se apagan (el modal gestiona
    // su propio teclado). El visor entra aquí porque useHotkeys solo se calla
    // dentro de input/textarea/select: sin esta guarda, «espacio» con el visor
    // abierto reproduciría a la vez su vídeo y el player de detrás.
    if (discardOpen || visor !== null) return;
    const k = e.key.toLowerCase();
    if (k === 'a') {
      e.preventDefault();
      // sin la guarda de vuelo, pulsar rápido re-aprueba el mismo beat con
      // datos rancios (la query aún no refleja el locked)
      if (sel !== undefined && sel.status !== 'locked' && !actionMut.isPending) {
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
    } else if (/^[1-6]$/.test(k) && altsOpen && sel !== undefined) {
      e.preventDefault();
      // abre el visor en vez de sustituir a ciegas: mismo gesto que el ratón,
      // y con el foco puesto en «Usar esta» basta Enter para confirmar
      const alt = alternatives[Number(k) - 1];
      if (alt !== undefined) setVisor({ origen: 'alternativa', cand: alt });
    }
  });

  if (videoQ.isPending || tlQ.isPending) {
    return (
      <div className="wrap-1420" style={{ padding: 'calc(var(--pad) * 2) 26px' }}>
        <div className="muted fs-sm">Cargando la timeline</div>
      </div>
    );
  }

  if (video === undefined || master === undefined || tlQ.isError) {
    return (
      <div
        className="wrap-1420"
        style={{ padding: 'calc(var(--pad) * 2) 26px', display: 'grid', gap: 12 }}
      >
        <div className="banner banner-danger">
          {tlQ.isError ? 'No se pudo cargar la timeline.' : 'No se pudo cargar el vídeo.'}
        </div>
        <div>
          <Button
            variant="secondary"
            onClick={() => {
              void videoQ.refetch();
              void tlQ.refetch();
            }}
          >
            Reintentar
          </Button>
        </div>
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
        <div
          className="mono"
          style={{ fontSize: 11, color: 'rgba(255,255,255,.34)', marginTop: 6 }}
        >
          se recompone al aprobar o cambiar un clip
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {kitError ? (
        <div className="wrap-1420" style={{ padding: '12px 26px 0' }}>
          <div className="banner banner-danger">
            La previsualización no ha podido cargar el montaje del brand kit, así que va desplazada
            respecto al vídeo final: los tiempos que ves aquí no son los del MP4. Recarga la página
            antes de firmar la timeline.
          </div>
        </div>
      ) : null}
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
        className="wrap-1420 split-side"
        style={{
          padding: 'calc(var(--pad) * 1.5) 26px 60px',
          gap: 'calc(var(--gap) * 1.6)',
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
              <ClockAndScrub
                player={player}
                durationMs={durationMs}
                introFrames={introFrames}
                onSeek={seekToMs}
              />
              <span className="mono" style={{ fontSize: 10.5, color: 'rgba(255,255,255,.5)' }}>
                espacio
              </span>
            </div>
          </div>

          {/* Efectos de edición (auto): revisables y se pueden quitar antes de aprobar */}
          {edits.length > 0 ? (
            <div className="card" style={{ padding: 'var(--pad)', marginBottom: 'var(--gap)' }}>
              <button
                type="button"
                className="disclosure"
                aria-expanded={editsOpen}
                aria-controls="efectos-edicion"
                onClick={() => setEditsOpen((v) => !v)}
              >
                <svg
                  className="disclosure-caret"
                  viewBox="0 0 10 10"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3.5 1.5 L7 5 L3.5 8.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="muted fs-sm">
                  Efectos de edición · {edits.length} · se ven en la preview; quítalos si sobran
                </span>
              </button>
              {/* se mantiene montado y se oculta con hidden: así aria-controls
                  apunta siempre a un elemento real */}
              <div id="efectos-edicion" hidden={!editsOpen}>
                <div className="efectos-lista">
                  {edits.map((e, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        justifyContent: 'space-between',
                        fontSize: 'var(--fs-sm)',
                      }}
                    >
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span className="mono muted">{fmtClock(e.from_ms)}</span>{' '}
                        <strong>{EDIT_LABELS[e.type] ?? e.type}</strong>
                        {editPayloadText(e) !== undefined ? (
                          <span className="muted"> · {editPayloadText(e)}</span>
                        ) : null}
                      </span>
                      <Button
                        variant="danger-ghost"
                        disabled={tlState !== 'assets' || removeEditMut.isPending}
                        onClick={() => removeEditMut.mutate(i)}
                      >
                        Quitar
                      </Button>
                    </div>
                  ))}
                </div>
                {tlState !== 'assets' ? (
                  <div className="muted fs-sm" style={{ marginTop: 8 }}>
                    Los efectos ya se congelaron (solo se editan durante la curación).
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Pista de clips */}
          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 8,
              }}
            >
              <span
                className="muted fs-sm"
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: '0 1 auto',
                  minWidth: 0,
                }}
              >
                Pista de clips · {beats.length} beats · anchos fijados por el audio
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
                <span className="mono fs-sm muted" style={{ whiteSpace: 'nowrap' }}>
                  verde aprobado · ámbar requiere revisión
                </span>
                <Button
                  variant="secondary"
                  kbd="n"
                  onClick={nextPending}
                  disabled={pendientes.length === 0}
                >
                  {pendientes.length > 0
                    ? `${pendientes.length} sin revisar · siguiente`
                    : 'Todo revisado'}
                </Button>
              </span>
            </div>

            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', gap: 3, alignItems: 'stretch', position: 'relative' }}>
                {beats.map((b) => (
                  <div
                    key={b.idx}
                    style={pillStyle(b.status, b.idx === selIdx, b.to_ms - b.from_ms)}
                  >
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
                <Playhead player={player} durationMs={durationMs} introFrames={introFrames} />
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
                <span
                  className="mono"
                  style={{
                    fontSize: 9.5,
                    color: 'var(--fg2)',
                    width: 74,
                    flex: 'none',
                    lineHeight: '16px',
                    whiteSpace: 'nowrap',
                  }}
                >
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
                <span
                  className="mono"
                  style={{
                    fontSize: 9.5,
                    color: 'var(--fg2)',
                    width: 74,
                    flex: 'none',
                    lineHeight: '10px',
                    whiteSpace: 'nowrap',
                  }}
                >
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
                <Kbd>1</Kbd>–<Kbd>6</Kbd> previsualizar alternativa
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
              {video.state === 'hecho'
                ? 'La timeline quedó aprobada y el vídeo ya está renderizado; los entregables esperan en la entrega.'
                : 'La timeline ya está aprobada. El vídeo sigue su camino hacia el render.'}
            </div>
          ) : null}
        </div>

        {/* Panel del beat seleccionado */}
        <aside
          className="card"
          style={{ position: 'sticky', top: 'calc(var(--row) * 2 + 18px)', overflow: 'hidden' }}
        >
          {elegido === null ? (
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
          ) : elegido.kind === 'video' ? (
            <video
              src={elegido.src}
              poster={elegido.poster}
              controls
              preload="metadata"
              playsInline
              aria-label={sel !== undefined ? `Clip del beat ${sel.idx + 1}` : 'Clip elegido'}
              style={{
                width: '100%',
                aspectRatio: '16 / 9',
                objectFit: 'cover',
                display: 'block',
                background: '#000',
                borderBottom: '1px solid var(--line)',
              }}
            />
          ) : (
            <img
              src={elegido.src}
              alt={sel !== undefined ? `Candidato del beat ${sel.idx + 1}` : 'Candidato'}
              style={{
                width: '100%',
                aspectRatio: '16 / 9',
                objectFit: 'cover',
                display: 'block',
                borderBottom: '1px solid var(--line)',
              }}
            />
          )}

          {sel === undefined ? (
            <div className="muted fs-sm" style={{ padding: 'var(--pad)' }}>
              Selecciona un beat en la pista para revisarlo.
            </div>
          ) : (
            <div
              style={{
                padding: 'var(--pad)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--pad)',
              }}
            >
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
                  <span className="mono">
                    {sel.chosen_origin ?? chosenCandidate?.provider ?? '—'}
                  </span>
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
                  <BarraSimilitud value={sel.chosen_score ?? chosenCandidate?.score ?? null} />
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
                  // 2 columnas y no 3: en 380px de lateral pasa cada miniatura
                  // de ~111×62 a ~176×99, que ya deja juzgar el plano.
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
                    {alternatives.map((alt, i) => {
                      const medio = candidatePreview(alt);
                      return (
                        <button
                          key={alt.ref}
                          type="button"
                          onClick={() => setVisor({ origen: 'alternativa', cand: alt })}
                          style={{
                            border: '1px solid var(--line)',
                            borderRadius: 'var(--r-sm)',
                            overflow: 'hidden',
                            background: 'var(--bg2)',
                            padding: 0,
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                          aria-label={`Previsualizar la alternativa ${i + 1} · similitud ${fmtSim(alt.score)}`}
                        >
                          {medio === null ? (
                            <ThumbPlaceholder width="100%" />
                          ) : medio.kind === 'video' ? (
                            // #t=0.1 pinta un fotograma real sin descargar el
                            // clip entero: el estático responde a rangos.
                            <video
                              src={`${medio.src}#t=0.1`}
                              poster={medio.poster}
                              preload="metadata"
                              muted
                              playsInline
                              tabIndex={-1}
                              style={{
                                width: '100%',
                                aspectRatio: '16 / 9',
                                objectFit: 'cover',
                                display: 'block',
                              }}
                            />
                          ) : (
                            <img
                              src={medio.src}
                              alt=""
                              style={{
                                width: '100%',
                                aspectRatio: '16 / 9',
                                objectFit: 'cover',
                                display: 'block',
                              }}
                            />
                          )}
                          <div
                            className="mono"
                            style={{
                              fontSize: 10.5,
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
                      );
                    })}
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
                  <div
                    style={{
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-sm)',
                      overflow: 'hidden',
                    }}
                  >
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
                        // antes el primer clic ya sustituía el clip, sin ver
                        // nada y sin confirmar: ahora pasa por el visor
                        onClick={() => setVisor({ origen: 'stock', cand: r })}
                        aria-label={`Previsualizar ${candidateTitle(r)}`}
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
                            src={fileUrl(r.thumb_url)}
                            alt=""
                            style={{
                              width: 44,
                              flex: 'none',
                              aspectRatio: '16 / 9',
                              objectFit: 'cover',
                              borderRadius: 2,
                            }}
                          />
                        ) : (
                          <ThumbPlaceholder width={44} />
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

      <VisorMedia
        open={visor !== null}
        title={visor !== null ? candidateTitle(visor.cand) : ''}
        subtitle={sel !== undefined ? `Beat ${sel.idx + 1} · ${sel.visual_query}` : undefined}
        media={visor !== null ? candidatePreview(visor.cand) : null}
        emptyNote="Sin previsualización · el archivo se descarga al elegirlo"
        datos={
          visor !== null && sel !== undefined ? datosCandidato(visor.origen, visor.cand, sel) : []
        }
        cta="Usar esta"
        ctaDisabled={actionMut.isPending}
        onConfirm={() => {
          if (visor === null || sel === undefined) return;
          actionMut.mutate({
            idx: sel.idx,
            action: 'choose',
            ref: visor.cand.ref,
            // los de stock no viven en beats.candidates: el servidor los exige
            // en el cuerpo. Los de la rejilla se resuelven por ref.
            ...(visor.origen === 'stock' ? { candidate: visor.cand } : {}),
          });
          setVisor(null);
          setAltsOpen(false);
        }}
        onClose={() => setVisor(null)}
      />
    </div>
  );
}
