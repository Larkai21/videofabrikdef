import { Player } from '@remotion/player';
import { extractYoutubeId, FPS, SHORT_HEIGHT, SHORT_WIDTH, type ShortDto } from '@fabrica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  approveShort,
  discardShort,
  fileUrl,
  getEpisode,
  getEpisodeClips,
  getShort,
  markShortPublished,
  proposeEpisodeClips,
  proposeEpisodeClipWindow,
  renameShort,
  retryShort,
  shortDownloadUrl,
} from '../lib/api';
import { useLive } from '../lib/events';
import { fmtClock, parseClock } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { loadShortForm } from '../lib/shortform';
import { PlayerBoundary } from '../lib/longform';
import { useToasts } from '../lib/toasts';
import { BarraCortes } from '../components/BarraCortes';
import {
  Button,
  Chip,
  EmptyState,
  Incidencia,
  InputModal,
  Kbd,
  ProgressBar,
  ReasonModal,
  SkeletonRows,
  useModalKeyboard,
} from '../components/ui';

// Aprobación de clips de un episodio externo. Es el espejo de la pantalla de
// shorts —mismas filas, mismo DTO, mismas acciones por id— pero el padre es un
// episodio: el CTA de proponer pide encuadre elegido, y cada clip renderizado
// sale con la atribución de la fuente ya escrita en su descripción.

const MOTIVOS_DESCARTE = [
  { id: 'no-solo', label: 'No se entiende sin el contexto del episodio' },
  { id: 'flojo', label: 'El gancho no engancha' },
  { id: 'repetido', label: 'Dice lo mismo que otro candidato' },
  { id: 'corte', label: 'El corte entra o sale a mitad de idea' },
];

/**
 * Subventana a mano: dos relojes y la ventana manda. Es la vía para momentos
 * que el director evita por criterio o zonas ya usadas — el operador mira el
 * episodio en YouTube, apunta entrada y salida y las teclea aquí. El worker
 * ajusta los bordes a frases, pero no infla ni retrae la zona pedida.
 */
function VentanaModal({
  open,
  sourceUrl,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  sourceUrl: string | null;
  pending: boolean;
  /** Mensaje del servidor: el modal se queda abierto para corregir. */
  error?: string;
  onConfirm: (fromMs: number, toMs: number) => void;
  onClose: () => void;
}) {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const desdeRef = useRef<HTMLInputElement>(null);
  useModalKeyboard(open, boxRef, onClose, desdeRef);

  if (!open) return null;

  const fromMs = parseClock(desde);
  const toMs = parseClock(hasta);
  // la validación habla solo cuando ambos campos tienen algo que decir:
  // corregir un campo vacío a gritos es ruido, no ayuda
  const aviso =
    desde !== '' && fromMs === null
      ? 'No entiendo la entrada — usa m:ss (por ejemplo 12:40)'
      : hasta !== '' && toMs === null
        ? 'No entiendo la salida — usa m:ss (por ejemplo 13:05)'
        : fromMs !== null && toMs !== null && toMs <= fromMs
          ? 'La salida tiene que ir después de la entrada'
          : fromMs !== null && toMs !== null && toMs - fromMs < 3_000
            ? 'Menos de 3 segundos no dan para un clip'
            : null;
  const valido = fromMs !== null && toMs !== null && aviso === null;
  const largo = valido ? Math.round((toMs - fromMs) / 1000) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={boxRef}
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-label="Clip a mano"
        onClick={(e) => e.stopPropagation()}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valido && !pending) onConfirm(fromMs, toMs);
          }}
        >
          <div style={{ padding: 'var(--pad)', borderBottom: '1px solid var(--line)' }}>
            <div className="head" style={{ fontSize: 17 }}>
              Clip a mano
            </div>
            <div className="muted fs-sm" style={{ marginTop: 5 }}>
              Apunta el momento exacto y el sistema hace el resto: corta por frases, aprieta los
              silencios y encuadra. Tu ventana manda — no se mueve para «mejorarla».
            </div>
          </div>
          <div style={{ padding: 'var(--pad)', display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <label className="fs-sm" style={{ flex: 1, display: 'grid', gap: 4 }}>
                Entrada
                <input
                  ref={desdeRef}
                  className="control mono"
                  placeholder="12:40"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                />
              </label>
              <label className="fs-sm" style={{ flex: 1, display: 'grid', gap: 4 }}>
                Salida
                <input
                  className="control mono"
                  placeholder="13:05"
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                />
              </label>
            </div>
            {aviso !== null ? (
              <span className="fs-sm" style={{ color: 'var(--danger)' }} role="alert">
                {aviso}
              </span>
            ) : largo !== null ? (
              <span className="muted fs-sm">
                {largo} segundos{largo > 90 ? ' — más de minuto y medio es mucho short' : ''}
              </span>
            ) : (
              <span className="muted fs-sm">
                Los clips del canal de referencia rondan los 20–60 segundos
              </span>
            )}
            {sourceUrl !== null && fromMs !== null ? (
              <a
                className="fs-sm"
                href={`${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}t=${Math.floor(fromMs / 1000)}`}
                target="_blank"
                rel="noreferrer"
              >
                Comprobar la entrada en YouTube ↗
              </a>
            ) : null}
            {error !== undefined ? (
              <span className="fs-sm" style={{ color: 'var(--danger)' }} role="alert">
                {error}
              </span>
            ) : null}
          </div>
          <div
            style={{
              padding: 'var(--pad)',
              borderTop: '1px solid var(--line)',
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
            }}
          >
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" disabled={!valido || pending}>
              {pending ? 'Pidiendo…' : 'Proponer este momento'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const ESTADOS: Record<
  ShortDto['state'],
  { label: string; kind: 'ok' | 'warn' | 'danger' | 'neutral' }
> = {
  propuesto: { label: 'Propuesto', kind: 'warn' },
  aprobado: { label: 'Aprobado', kind: 'neutral' },
  render: { label: 'Renderizando', kind: 'neutral' },
  hecho: { label: 'Listo', kind: 'ok' },
  descartado: { label: 'Descartado', kind: 'neutral' },
  incidencia: { label: 'Incidencia', kind: 'danger' },
};

export function EpisodioClips() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const { shortProgress } = useLive();
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [descartando, setDescartando] = useState<string | null>(null);

  // cuelga del prefijo ['episodios'] a propósito: el evento episode_state
  // invalida esa key global y este detalle se refresca gratis
  const episodioQ = useQuery({
    queryKey: ['episodios', id],
    queryFn: () => getEpisode(id),
    enabled: id !== '',
  });
  const clipsQ = useQuery({
    queryKey: ['episodio-clips', id],
    queryFn: () => getEpisodeClips(id),
    enabled: id !== '',
    // mientras algo renderiza, el detalle del progreso llega por SSE, pero la
    // lista se refresca por si acaso el evento se pierde
    refetchInterval: (query) => {
      const clips = query.state.data ?? [];
      if (clips.some((s) => s.state === 'render' || s.state === 'aprobado')) return 5_000;
      // sin candidatos vivos puede haber una propuesta en vuelo cuyo
      // short_state se pierda si el SSE se cae al reconectar: respaldo lento
      // como en Bandeja (every() sobre lista vacía es true: cubre «aún sin
      // clips» y «todos descartados tras Proponer otros»)
      return clips.every((s) => s.state === 'descartado') ? 30_000 : false;
    },
  });

  const vivos = (clipsQ.data ?? []).filter((s) => s.state !== 'descartado');
  // seleccionado se valida contra vivos: un clip descartado desde otra
  // pestaña no debe quedarse abierto en la previsualización
  const abierto = vivos.some((v) => v.id === seleccionado)
    ? seleccionado
    : (vivos[0]?.id ?? null);
  const detalleQ = useQuery({
    queryKey: ['short', abierto],
    queryFn: () => getShort(abierto as string),
    enabled: abierto !== null,
  });

  const invalidar = () => {
    void queryClient.invalidateQueries({ queryKey: ['episodio-clips', id] });
    if (abierto !== null) void queryClient.invalidateQueries({ queryKey: ['short', abierto] });
  };
  const alFallar = (fallback: string) => (err: unknown) =>
    push(err instanceof ApiError && err.detail !== undefined ? err.detail : fallback, 'danger');

  const proponerMut = useMutation({
    mutationFn: () => proposeEpisodeClips(id),
    onSuccess: (r) => {
      push(
        r.ya_en_curso
          ? 'Ya se están buscando momentos en este episodio'
          : 'Buscando los momentos con más gancho del episodio',
      );
      invalidar();
    },
    onError: alFallar('No se pudieron pedir clips'),
  });
  // subventana a mano: el error del servidor se enseña dentro del modal para
  // poder corregir los tiempos sin volver a abrirlo (patrón InputModal)
  const [ventanaAbierta, setVentanaAbierta] = useState(false);
  const [ventanaError, setVentanaError] = useState<string | undefined>(undefined);
  const ventanaMut = useMutation({
    mutationFn: ({ fromMs, toMs }: { fromMs: number; toMs: number }) =>
      proposeEpisodeClipWindow(id, fromMs, toMs),
    onSuccess: (r) => {
      push(
        r.ya_en_curso
          ? 'Ese momento ya se está preparando'
          : 'Preparando tu momento; aparecerá como candidato en unos segundos',
      );
      setVentanaAbierta(false);
      setVentanaError(undefined);
      invalidar();
    },
    onError: (err) =>
      setVentanaError(
        err instanceof ApiError && err.detail !== undefined
          ? err.detail
          : 'No se pudo pedir el clip',
      ),
  });
  const aprobarMut = useMutation({
    mutationFn: (shortId: string) => approveShort(shortId),
    onSuccess: () => {
      push('Clip aprobado; entra en la cola de render');
      invalidar();
    },
    onError: alFallar('No se pudo aprobar'),
  });
  const descartarMut = useMutation({
    mutationFn: ({ shortId, reason }: { shortId: string; reason: string }) =>
      discardShort(shortId, reason),
    onSuccess: () => {
      push('Candidato descartado');
      setDescartando(null);
      setSeleccionado(null);
      invalidar();
    },
    onError: alFallar('No se pudo descartar'),
  });
  const reintentarMut = useMutation({
    mutationFn: (shortId: string) => retryShort(shortId),
    onSuccess: () => {
      push('Render reintentado');
      invalidar();
    },
    onError: alFallar('No se pudo reintentar'),
  });
  // el enlace de YouTube se pide en un modal (patrón de Entrega): con el id el
  // casado del CSV de Studio es exacto en vez de por título
  const [publicando, setPublicando] = useState<string | null>(null);
  const [publicarError, setPublicarError] = useState<string | undefined>(undefined);
  const publicadoMut = useMutation({
    mutationFn: ({ shortId, urlOrId }: { shortId: string; urlOrId: string }) =>
      markShortPublished(shortId, urlOrId),
    onSuccess: () => {
      push('Clip marcado como publicado');
      setPublicando(null);
      setPublicarError(undefined);
      invalidar();
    },
    onError: (err) =>
      setPublicarError(
        err instanceof ApiError && err.detail !== undefined ? err.detail : 'No se pudo marcar',
      ),
  });
  const renombrarMut = useMutation({
    mutationFn: ({ shortId, title }: { shortId: string; title: string }) =>
      renameShort(shortId, title),
    onSuccess: () => invalidar(),
    onError: alFallar('No se pudo cambiar el título'),
  });

  // Curación con teclado, calcando el espíritu de la timeline: j/k (o ↓/↑)
  // recorren los candidatos vivos, a aprueba el seleccionado y d abre el
  // descarte. useHotkeys ya se calla dentro de inputs (el título editable de
  // cada tarjeta), y con un modal abierto los atajos se apagan porque el
  // modal gestiona su propio teclado.
  const actual = vivos.find((v) => v.id === abierto);
  const mover = (delta: number) => {
    const idx = vivos.findIndex((v) => v.id === abierto);
    if (idx < 0) return;
    const siguiente = vivos[Math.max(0, Math.min(vivos.length - 1, idx + delta))];
    if (siguiente === undefined || siguiente.id === abierto) return;
    setSeleccionado(siguiente.id);
    // la tarjeta recién seleccionada puede quedar fuera del viewport: se trae
    // al borde más cercano para que el teclado no navegue a ciegas
    document
      .getElementById(`clip-${siguiente.id}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  useHotkeys((e) => {
    if (descartando !== null || publicando !== null || ventanaAbierta) return;
    const k = e.key.toLowerCase();
    if (k === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      mover(1);
    } else if (k === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      mover(-1);
    } else if (k === 'a') {
      // sin la guarda de vuelo, pulsar rápido re-aprueba con datos rancios
      // (la query aún no refleja el cambio de estado)
      if (actual !== undefined && actual.state === 'propuesto' && !aprobarMut.isPending) {
        e.preventDefault();
        aprobarMut.mutate(actual.id);
      }
    } else if (k === 'd') {
      // mismo alcance que el botón: solo lo propuesto o en incidencia se descarta
      if (actual !== undefined && (actual.state === 'propuesto' || actual.state === 'incidencia')) {
        e.preventDefault();
        setDescartando(actual.id);
      }
    }
  });

  const episodio = episodioQ.data;
  const detalle = detalleQ.data;
  // proponer exige episodio listo Y encuadre elegido: la API devuelve 409 en
  // ambos casos, pero el botón no debe invitar a chocar contra ella
  const puedeProponer = episodio?.state === 'listo' && episodio.focus_x !== null;

  return (
    <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px 72px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 'var(--gap)',
        }}
      >
        <Button variant="ghost" onClick={() => void navigate('/episodios')}>
          ← Episodios
        </Button>
        <h1 className="head" style={{ fontSize: 18, margin: 0 }}>
          Clips de «{episodio?.source_title ?? 'este episodio'}»
        </h1>
        <div style={{ flex: 1 }} />
        <Button
          variant="ghost"
          disabled={!puedeProponer}
          title="Pedir un momento exacto que el director no propuso"
          onClick={() => setVentanaAbierta(true)}
        >
          Clip a mano
        </Button>
        <Button
          variant={vivos.length === 0 ? 'primary' : 'secondary'}
          disabled={proponerMut.isPending || !puedeProponer}
          onClick={() => proponerMut.mutate()}
        >
          {vivos.length === 0 ? 'Buscar clips' : 'Proponer otros'}
        </Button>
      </div>

      {episodio !== undefined && episodio.state === 'listo' && episodio.focus_x === null ? (
        <div className="banner" style={{ marginBottom: 'var(--gap)' }}>
          Falta elegir el encuadre vertical del episodio.{' '}
          <Link to="/episodios">Elígelo en la lista de episodios</Link> y vuelve aquí para proponer
          clips.
        </div>
      ) : null}

      {clipsQ.isPending ? (
        <SkeletonRows rows={3} label="Cargando los clips" />
      ) : vivos.length === 0 ? (
        <EmptyState title="Todavía no hay candidatos">
          El director lee la transcripción del episodio y propone los momentos que funcionan solos.
          Tú eliges cuáles se renderizan; cada clip sale con la atribución de la fuente en su
          descripción.
        </EmptyState>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 320px',
            gap: 'var(--gap)',
          }}
        >
          <div style={{ display: 'grid', gap: 'var(--gap)', alignContent: 'start' }}>
            {vivos.map((s) => {
              const estado = ESTADOS[s.state];
              const progreso = shortProgress[s.id];
              return (
                <div
                  key={s.id}
                  // ancla del scrollIntoView de la navegación con teclado
                  id={`clip-${s.id}`}
                  className="card"
                  style={{
                    padding: 'var(--pad)',
                    display: 'grid',
                    gap: 10,
                    outline: s.id === abierto ? '1px solid var(--accent)' : undefined,
                  }}
                  onClick={() => setSeleccionado(s.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <Chip kind={estado.kind}>{estado.label}</Chip>
                    <span className="mono fs-sm muted">
                      {fmtClock(s.from_ms)} → {fmtClock(s.to_ms)} ·{' '}
                      {Math.round(s.duration_ms / 1000)} s
                    </span>
                    <div style={{ flex: 1 }} />
                    <span className="mono fs-sm muted">confianza {Math.round(s.score)}</span>
                  </div>

                  {s.state === 'propuesto' ? (
                    <input
                      className="control"
                      defaultValue={s.title}
                      aria-label="Título del clip"
                      style={{ fontWeight: 600 }}
                      onBlur={(e) => {
                        const title = e.target.value.trim();
                        if (title !== '' && title !== s.title) {
                          renombrarMut.mutate({ shortId: s.id, title });
                        }
                      }}
                    />
                  ) : (
                    <div className="head" style={{ fontSize: 16 }}>
                      {s.title}
                    </div>
                  )}

                  <p className="fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
                    {s.hook}
                  </p>
                  <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
                    {s.reason}
                  </p>

                  {s.incident !== null ? (
                    <Incidencia mensaje={s.incident.message} />
                  ) : null}

                  {s.metrics !== null ? (
                    <span className="mono fs-sm muted">
                      {s.metrics.views ?? '—'} visualizaciones
                      {s.metrics.avg_pct_viewed !== undefined
                        ? ` · ${s.metrics.avg_pct_viewed} % visto de media`
                        : ''}
                      {s.metrics.avg_view_duration_s !== undefined
                        ? ` · ${Math.round(s.metrics.avg_view_duration_s)} s de media`
                        : ''}
                    </span>
                  ) : null}

                  {s.state === 'render' || s.state === 'aprobado' ? (
                    <>
                      <ProgressBar value={progreso ?? 2} />
                      <span className="muted fs-sm">
                        {progreso === undefined
                          ? 'En cola; si hay un vídeo largo renderizando, va detrás'
                          : `Renderizando · ${progreso} %`}
                      </span>
                    </>
                  ) : null}

                  {s.state === 'hecho' && s.video_url !== null ? (
                    <video
                      src={fileUrl(s.video_url)}
                      poster={s.thumbnail_url !== null ? fileUrl(s.thumbnail_url) : undefined}
                      controls
                      style={{
                        width: 200,
                        aspectRatio: '9 / 16',
                        borderRadius: 'var(--r-sm)',
                        background: '#000',
                      }}
                    />
                  ) : null}

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {s.state === 'propuesto' ? (
                      <Button
                        variant="primary"
                        // el atajo solo se anuncia en la tarjeta seleccionada:
                        // es la única sobre la que actúa
                        kbd={s.id === abierto ? 'a' : undefined}
                        disabled={aprobarMut.isPending}
                        onClick={() => aprobarMut.mutate(s.id)}
                      >
                        Aprobar y renderizar
                      </Button>
                    ) : null}
                    {s.state === 'incidencia' ? (
                      <Button variant="primary" onClick={() => reintentarMut.mutate(s.id)}>
                        Reintentar
                      </Button>
                    ) : null}
                    {s.state === 'hecho' ? (
                      <>
                        <a className="btn btn-secondary" href={shortDownloadUrl(s.id)}>
                          Guardar el MP4
                        </a>
                        <Button
                          disabled={s.published_at !== null}
                          onClick={() => setPublicando(s.id)}
                        >
                          {s.published_at !== null ? 'Publicado' : 'Marcar publicado'}
                        </Button>
                      </>
                    ) : null}
                    {s.state === 'propuesto' || s.state === 'incidencia' ? (
                      <Button
                        variant="danger-ghost"
                        kbd={s.id === abierto ? 'd' : undefined}
                        onClick={() => setDescartando(s.id)}
                      >
                        Descartar
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {/* La previsualización monta la MISMA composición que el render, así
              que lo que se ve aquí es lo que se va a renderizar. */}
          <div
            style={{ position: 'sticky', top: 'calc(var(--row) * 2 + 18px)', alignSelf: 'start' }}
          >
            <div
              style={{
                aspectRatio: '9 / 16',
                background: '#000',
                borderRadius: 'var(--r)',
                overflow: 'hidden',
                border: '1px solid var(--line)',
              }}
            >
              {detalle !== undefined ? (
                <PlayerBoundary
                  fallback={
                    <div className="muted fs-sm" style={{ padding: 12 }}>
                      Sin previsualización
                    </div>
                  }
                >
                  <Player
                    lazyComponent={loadShortForm}
                    inputProps={detalle.master}
                    durationInFrames={Math.max(
                      1,
                      Math.ceil((detalle.master.short.duration_ms / 1000) * FPS),
                    )}
                    fps={FPS}
                    compositionWidth={SHORT_WIDTH}
                    compositionHeight={SHORT_HEIGHT}
                    controls
                    style={{ width: '100%', height: '100%' }}
                  />
                </PlayerBoundary>
              ) : (
                <div className="muted fs-sm" style={{ padding: 12 }}>
                  Cargando la previsualización
                </div>
              )}
            </div>
            {/* auditoría visual del apretado: dónde caen los cortes de plano
                que el pre-corte horneó; sin plan (clips de vídeo propio,
                maestros antiguos) no se pinta nada */}
            {detalle !== undefined &&
            detalle.master.short.encuadre_plan !== undefined &&
            detalle.master.short.encuadre_plan.length > 0 ? (
              <BarraCortes
                plan={detalle.master.short.encuadre_plan}
                duracionMs={detalle.master.short.duration_ms}
              />
            ) : null}
            <p className="muted fs-sm" style={{ marginTop: 8, lineHeight: 1.5 }}>
              Los cortes los fija la transcripción y el encuadre quedó congelado al proponer. La
              descripción de cada clip lleva la atribución al episodio original.
            </p>
            <div className="mono muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
              <Kbd>j</Kbd> <Kbd>k</Kbd> moverse · <Kbd>a</Kbd> aprobar · <Kbd>d</Kbd> descartar
            </div>
          </div>
        </div>
      )}

      <VentanaModal
        open={ventanaAbierta}
        sourceUrl={episodio?.source_url ?? null}
        pending={ventanaMut.isPending}
        error={ventanaError}
        onConfirm={(fromMs, toMs) => ventanaMut.mutate({ fromMs, toMs })}
        onClose={() => {
          setVentanaAbierta(false);
          setVentanaError(undefined);
        }}
      />

      <ReasonModal
        open={descartando !== null}
        title="Descartar el candidato"
        desc="No volverá a proponerse esa ventana cuando pidas otros."
        motivos={MOTIVOS_DESCARTE}
        cta="Descartar"
        onConfirm={(reason) => {
          if (descartando !== null) descartarMut.mutate({ shortId: descartando, reason });
        }}
        onClose={() => setDescartando(null)}
      />

      <InputModal
        open={publicando !== null}
        title="Marcar como publicado"
        desc="Registra el clip que ya subiste tú. Con el enlace, las métricas del CSV de Studio casan por id exacto."
        label="Enlace o id del short en YouTube"
        placeholder="https://www.youtube.com/shorts/…"
        ayuda="Pega la URL del short o su id de 11 caracteres"
        cta="Marcar como publicado"
        error={publicarError}
        pending={publicadoMut.isPending}
        validate={(v) => (extractYoutubeId(v) === null ? 'No reconozco ese enlace ni ese id' : null)}
        onConfirm={(v) => {
          if (publicando !== null) publicadoMut.mutate({ shortId: publicando, urlOrId: v });
        }}
        onClose={() => {
          setPublicando(null);
          setPublicarError(undefined);
        }}
      />
    </div>
  );
}
