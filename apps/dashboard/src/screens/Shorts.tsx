import { Player } from '@remotion/player';
import { extractYoutubeId, FPS, SHORT_HEIGHT, SHORT_WIDTH, type ShortDto } from '@fabrica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ApiError,
  approveShort,
  discardShort,
  fileUrl,
  getShort,
  getShorts,
  getVideo,
  markShortPublished,
  proposeShorts,
  renameShort,
  retryShort,
  shortDownloadUrl,
} from '../lib/api';
import { useLive } from '../lib/events';
import { fmtClock } from '../lib/format';
import { loadShortForm } from '../lib/shortform';
import { PlayerBoundary } from '../lib/longform';
import { useToasts } from '../lib/toasts';
import {
  Button,
  Chip,
  EmptyState,
  Incidencia,
  InputModal,
  ProgressBar,
  ReasonModal,
  SkeletonRows,
} from '../components/ui';

// Aprobación de shorts. El humano ELIGE entre los candidatos que propuso el
// director y descarta los que no le valen; no mueve la ventana (principio 1:
// sin asas de recorte). Si ninguno convence, se piden otros.

const MOTIVOS_DESCARTE = [
  { id: 'no-solo', label: 'No se entiende sin el contexto del vídeo' },
  { id: 'flojo', label: 'El gancho no engancha' },
  { id: 'repetido', label: 'Dice lo mismo que otro candidato' },
  { id: 'planos', label: 'Los planos no acompañan' },
];

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

export function Shorts() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const { shortProgress } = useLive();
  const [seleccionado, setSeleccionado] = useState<string | null>(null);
  const [descartando, setDescartando] = useState<string | null>(null);

  const videoQ = useQuery({
    queryKey: ['video', id],
    queryFn: () => getVideo(id),
    enabled: id !== '',
  });
  const shortsQ = useQuery({
    queryKey: ['shorts', id],
    queryFn: () => getShorts(id),
    enabled: id !== '',
    // mientras algo renderiza, el detalle del progreso llega por SSE, pero la
    // lista se refresca por si acaso el evento se pierde
    refetchInterval: (query) => {
      const lista = query.state.data ?? [];
      if (lista.some((s) => s.state === 'render' || s.state === 'aprobado')) return 5_000;
      // sin candidatos vivos puede haber una propuesta en vuelo cuyo
      // short_state se pierda si el SSE se cae al reconectar: respaldo lento
      // como en Bandeja (every() sobre lista vacía es true)
      return lista.every((s) => s.state === 'descartado') ? 30_000 : false;
    },
  });

  const vivos = (shortsQ.data ?? []).filter((s) => s.state !== 'descartado');
  // seleccionado se valida contra vivos: un short descartado desde otra
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
    void queryClient.invalidateQueries({ queryKey: ['shorts', id] });
    if (abierto !== null) void queryClient.invalidateQueries({ queryKey: ['short', abierto] });
  };
  const alFallar = (fallback: string) => (err: unknown) =>
    push(err instanceof ApiError && err.detail !== undefined ? err.detail : fallback, 'danger');

  const proponerMut = useMutation({
    mutationFn: () => proposeShorts(id),
    onSuccess: (r) => {
      push(r.ya_en_curso ? 'Ya se están buscando fragmentos' : 'Buscando fragmentos para el short');
      invalidar();
    },
    onError: alFallar('No se pudieron pedir shorts'),
  });
  const aprobarMut = useMutation({
    mutationFn: (shortId: string) => approveShort(shortId),
    onSuccess: () => {
      push('Short aprobado; entra en la cola de render');
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
      push('Short marcado como publicado');
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

  const video = videoQ.data;
  const detalle = detalleQ.data;

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
        <Button variant="ghost" onClick={() => void navigate(`/videos/${id}/entrega`)}>
          ← Entrega
        </Button>
        <h1 className="head" style={{ fontSize: 18, margin: 0 }}>
          Shorts de «{video?.title_chosen ?? 'este vídeo'}»
        </h1>
        <div style={{ flex: 1 }} />
        <Button
          variant={vivos.length === 0 ? 'primary' : 'secondary'}
          disabled={proponerMut.isPending || video?.state !== 'hecho'}
          onClick={() => proponerMut.mutate()}
        >
          {vivos.length === 0 ? 'Buscar fragmentos' : 'Proponer otros'}
        </Button>
      </div>

      {shortsQ.isPending ? (
        <SkeletonRows rows={3} label="Cargando los shorts" />
      ) : vivos.length === 0 ? (
        <EmptyState title="Todavía no hay candidatos">
          El sistema lee la narración y propone los fragmentos que funcionan solos. Tú eliges cuáles
          se renderizan.
        </EmptyState>
      ) : (
        <div className="lista-con-preview">
          <div style={{ display: 'grid', gap: 'var(--gap)', alignContent: 'start' }}>
            {vivos.map((s) => {
              const estado = ESTADOS[s.state];
              const progreso = shortProgress[s.id];
              return (
                <div
                  key={s.id}
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
                      aria-label="Título del short"
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
                      <Button variant="danger-ghost" onClick={() => setDescartando(s.id)}>
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
          <div className="preview-pegada">
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
            <p className="muted fs-sm" style={{ marginTop: 8, lineHeight: 1.5 }}>
              Los cortes los fija el audio. Puedes elegir entre estos, cambiarles el título o pedir
              otros, pero la ventana no se arrastra.
            </p>
          </div>
        </div>
      )}

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
        desc="Registra el short que ya subiste tú. Con el enlace, las métricas del CSV de Studio casan por id exacto."
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
