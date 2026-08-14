import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { extractYoutubeId } from '@fabrica/shared';
import { Button, Chip, CostBadge, InputModal, ProgressBar } from '../components/ui';
import { WEEKDAY_LABELS } from '../components/YoutubeSection';
import {
  ApiError,
  fileUrl,
  getChannel,
  getDeliverables,
  getInbox,
  getVideo,
  getYoutubeStatus,
  markPublishedByHand,
  publishToYoutube,
  revealVideoFolder,
  videoDownloadUrl,
} from '../lib/api';
import { useLive } from '../lib/events';
import { fmtMoney } from '../lib/format';
import { useToasts } from '../lib/toasts';

interface CopyFieldProps {
  label: string;
  value: string;
  multiline?: boolean;
  onCopied: () => void;
}

function CopyField({ label, value, multiline = false, onCopied }: CopyFieldProps) {
  return (
    <div className="card" style={{ padding: 'var(--pad)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span className="step-label">{label}</span>
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(onCopied);
          }}
          aria-label={`Copiar ${label.toLowerCase()}`}
        >
          Copiar
        </Button>
      </div>
      <div
        className={multiline ? 'fs-sm' : undefined}
        style={{
          lineHeight: 1.55,
          whiteSpace: multiline ? 'pre-wrap' : 'normal',
          fontWeight: multiline ? 400 : 500,
        }}
      >
        {value === '' ? <span className="muted">—</span> : value}
      </div>
    </div>
  );
}

// Nombre de fichero según docs/render.md (video.mp4) y convención de miniaturas.
// La miniatura A solo se usa ya como póster del player: la sección de
// miniaturas (oficial, variante B, brief, subida) se quitó de esta pantalla a
// petición del usuario (14-ago); los ficheros siguen en la carpeta del vídeo.
const THUMB_NAMES = ['thumb_a.jpg', 'thumb_b.jpg'];


/** ISO → «lunes, 3 de agosto, 17:00» en hora local. */
function fmtInstant(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function Entrega() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { push } = useToasts();

  const videoQ = useQuery({
    queryKey: ['video', id],
    queryFn: () => getVideo(id),
    enabled: id !== '',
    // la publicación no toca la máquina de estados (no hay video_state por
    // SSE al terminar): mientras sube se sondea el detalle del vídeo
    refetchInterval: (query) => (query.state.data?.youtube?.status === 'subiendo' ? 2_000 : false),
  });
  const inboxQ = useQuery({ queryKey: ['inbox'], queryFn: getInbox });

  const video = videoQ.data;
  const master = video?.master;
  const channelQ = useQuery({
    queryKey: ['channel', video?.channel_id],
    queryFn: () => getChannel(video?.channel_id as string),
    enabled: video !== undefined,
  });

  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // publicación en YouTube (S3): estado de conexión + aprobación de la subida
  const queryClient = useQueryClient();
  const { jobNotes } = useLive();
  const ytStatusQ = useQuery({
    queryKey: ['youtube-status', video?.channel_id],
    queryFn: () => getYoutubeStatus(video?.channel_id as string),
    enabled: video !== undefined,
  });
  const publishMut = useMutation({
    mutationFn: () => publishToYoutube(id),
    onSuccess: () => {
      push('Subida a YouTube encolada');
      void queryClient.invalidateQueries({ queryKey: ['video', id] });
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: (err) =>
      push(
        err instanceof ApiError && err.detail !== undefined
          ? err.detail
          : 'No se pudo encolar la subida',
        'danger',
      ),
  });

  // marcado manual: el humano ya lo subió por su cuenta y solo registra el
  // enlace. El error se enseña DENTRO del modal, que se queda abierto, porque
  // el caso típico es un enlace mal pegado que hay que poder corregir.
  const [manualAbierto, setManualAbierto] = useState(false);
  const [manualError, setManualError] = useState<string | undefined>(undefined);
  const manualMut = useMutation({
    mutationFn: (urlOrId: string) => markPublishedByHand(id, urlOrId),
    onSuccess: (r) => {
      push(r.ya_estaba ? 'Ya estaba marcado con ese enlace' : 'Marcado como publicado');
      setManualAbierto(false);
      setManualError(undefined);
      void queryClient.invalidateQueries({ queryKey: ['video', id] });
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: (err) =>
      setManualError(
        err instanceof ApiError && err.detail !== undefined
          ? err.detail
          : 'No se pudo marcar como publicado',
      ),
  });

  const revealMut = useMutation({
    mutationFn: () => revealVideoFolder(id),
    onSuccess: () => push('Carpeta abierta en el gestor de archivos'),
    onError: (err) =>
      push(
        err instanceof ApiError && err.detail !== undefined
          ? err.detail
          : 'No se pudo abrir la carpeta',
        'danger',
      ),
  });

  // los ENTREGABLES finales del render (description.txt lleva los capítulos
  // reales, no los que escribió el LLM): lo que se copia es lo que se sube
  const deliverablesQ = useQuery({
    queryKey: ['entregables', id],
    queryFn: () => getDeliverables(id),
    enabled: id !== '' && videoQ.data?.state === 'hecho',
    retry: false,
  });

  if (videoQ.isPending) {
    return (
      <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px' }}>
        <div className="muted fs-sm">Cargando la entrega</div>
      </div>
    );
  }

  if (video === undefined || master === undefined) {
    return (
      <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px' }}>
        <div className="banner banner-danger">No se pudo cargar el vídeo.</div>
      </div>
    );
  }

  const doneEntry = inboxQ.data?.done.find((d) => d.video_id === id);
  const outputDir = doneEntry?.output_dir ?? `outputs/${id}`;
  const relativeDir = outputDir.startsWith('/') ? `outputs/${id}` : outputDir;
  const seo = master.seo;
  const title =
    deliverablesQ.data?.title ??
    video.title_chosen ??
    (seo !== undefined ? (seo.titles[seo.chosen_idx ?? 0] ?? '') : '');
  const description = deliverablesQ.data?.description ?? seo?.description ?? '';
  const tags = deliverablesQ.data?.tags ?? (seo?.tags ?? []).join(', ');
  const aiDisclosure = channelQ.data?.profile?.flags.ai_disclosure === true;

  const yt = video.youtube;
  const ytStatus = ytStatusQ.data;
  const providerIsYoutube = ytStatus?.provider === 'youtube';
  const needsConnection = providerIsYoutube && ytStatus !== undefined && !ytStatus.connected;
  const liveNote = jobNotes[id];
  const uploadProgress =
    yt?.status === 'subiendo' && liveNote?.queue === 'publish' ? liveNote.progress : null;

  const checklist: { id: string; label: string }[] = [
    { id: 'titulo', label: 'Título pegado en YouTube Studio' },
    { id: 'descripcion', label: 'Descripción pegada' },
    { id: 'tags', label: 'Tags pegadas' },
    { id: 'miniatura', label: 'Miniatura elegida (A o B) y subida' },
    { id: 'visibilidad', label: 'Visibilidad configurada (privado, programado o público)' },
    ...(aiDisclosure
      ? [{ id: 'sintetico', label: 'Contenido sintético declarado (containsSyntheticMedia)' }]
      : []),
  ];

  return (
    <div>
      <div className="subbar">
        <div className="wrap-1160 subbar-inner">
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
            }}
          >
            {title === '' ? 'Entrega' : title}
          </span>
          <Chip kind={video.state === 'hecho' ? 'ok' : 'neutral'}>
            {video.state === 'hecho' ? 'Lista para publicar' : 'Aún en producción'}
          </Chip>
          <div style={{ flex: 1 }} />
          <CostBadge>{fmtMoney(video.costs_total)}</CostBadge>
        </div>
      </div>

      <div
        className="wrap-1160 split-side"
        style={{
          padding: 'calc(var(--pad) * 1.6) 26px 72px',
          gap: 'calc(var(--gap) * 1.8)',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--gap)' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            {/* El worker de render escribe outputs/<id>/video.mp4 (docs/render.md).
                El tope de altura mantiene player Y controles dentro del viewport
                cuando la columna es ancha (a una columna el 16:9 salía más alto
                que la pantalla y el vídeo se veía «cortado»); el vídeo hace
                letterbox dentro, como cualquier player. La miniatura A de póster
                para que el primer frame no sea una caja negra. */}
            <video
              controls
              src={fileUrl(`${relativeDir}/video.mp4`)}
              poster={fileUrl(`${relativeDir}/${THUMB_NAMES[0]}`)}
              style={{
                width: '100%',
                aspectRatio: '16 / 9',
                maxHeight: 'calc(100vh - 240px)',
                display: 'block',
                background: '#000',
              }}
            />
          </div>

          <CopyField label="Título" value={title} onCopied={() => push('Título copiado')} />
          <CopyField
            label="Descripción"
            value={description}
            multiline
            onCopied={() => push('Descripción copiada')}
          />
          <CopyField label="Tags" value={tags} multiline onCopied={() => push('Tags copiadas')} />

        </div>

        <aside
          style={{
            display: 'grid',
            gap: 'var(--gap)',
            position: 'sticky',
            top: 'calc(var(--row) * 2 + 18px)',
          }}
        >
          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div className="head" style={{ fontSize: 16, marginBottom: 10 }}>
              Publicación
            </div>
            {yt?.status === 'subido' ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <div>
                  <Chip kind="ok">
                    {yt.origin === 'manual' ? 'Publicado a mano' : 'Subido a YouTube en privado'}
                  </Chip>
                </div>
                {yt.url !== null ? (
                  <a href={yt.url} target="_blank" rel="noreferrer" className="fs-sm">
                    Ver en YouTube →
                  </a>
                ) : null}
                <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
                  {yt.origin === 'manual'
                    ? 'Lo subiste tú; el sistema solo guarda el enlace.'
                    : yt.publish_at !== null
                      ? `Publicación programada para ${fmtInstant(yt.publish_at)}.`
                      : 'Queda en privado sin fecha; publícalo desde YouTube Studio.'}
                </p>
                {yt.origin === 'manual' ? (
                  <div>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setManualError(undefined);
                        setManualAbierto(true);
                      }}
                    >
                      Corregir el enlace
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : yt?.status === 'subiendo' ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <ProgressBar value={uploadProgress ?? 6} />
                <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
                  Subiendo a YouTube en privado
                  {liveNote?.queue === 'publish' && liveNote.detail !== undefined
                    ? ` · ${liveNote.detail.toLowerCase()}`
                    : ''}
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {yt?.status === 'fallido' ? (
                  <div className="banner banner-danger fs-sm">{yt.error ?? 'La subida falló.'}</div>
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button
                    variant="primary"
                    disabled={video.state !== 'hecho' || needsConnection || publishMut.isPending}
                    onClick={() => publishMut.mutate()}
                  >
                    {yt?.status === 'fallido'
                      ? 'Reintentar la subida'
                      : 'Subir a YouTube en privado'}
                  </Button>
                  {/* el cierre del flujo de la checklist de abajo: hasta ahora
                      se podía subir a mano pero no dejar constancia */}
                  <Button
                    disabled={video.state !== 'hecho'}
                    onClick={() => {
                      setManualError(undefined);
                      setManualAbierto(true);
                    }}
                  >
                    Ya lo he subido a mano
                  </Button>
                </div>
                {needsConnection ? (
                  <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
                    Conecta el canal de YouTube en ajustes para activar la subida.
                  </p>
                ) : null}
                {ytStatus !== undefined && !providerIsYoutube ? (
                  <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
                    Proveedor en modo simulado (PUBLISH_PROVIDER=mock): la subida se simula sin
                    llegar a YouTube.
                  </p>
                ) : null}
                <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
                  {ytStatus?.publish_schedule
                    ? `Se programará para el siguiente ${(
                        WEEKDAY_LABELS[ytStatus.publish_schedule.weekday] ?? ''
                      ).toLowerCase()} a las ${String(ytStatus.publish_schedule.hour).padStart(2, '0')}:00.`
                    : 'Sin programación en ajustes: quedará en privado sin fecha.'}
                </p>
              </div>
            )}
          </div>

          {/* del vídeo largo salen los shorts: el recorte se hace sobre el
              maestro ya entregado, así que la puerta es que esté en hecho */}
          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div className="head" style={{ fontSize: 16, marginBottom: 10 }}>
              Shorts
            </div>
            <p className="muted fs-sm" style={{ margin: '0 0 10px', lineHeight: 1.5 }}>
              El sistema lee la narración y propone los fragmentos que funcionan solos en vertical.
              Tú eliges cuáles se renderizan.
            </p>
            <Button
              variant="secondary"
              disabled={video.state !== 'hecho'}
              onClick={() => void navigate(`/videos/${id}/shorts`)}
            >
              Crear shorts
            </Button>
          </div>

          {/* la telemetría importada con pnpm metricas: hasta ahora se
              guardaba en la BD y ninguna pantalla la enseñaba */}
          {video.metrics !== null ? (
            <div className="card" style={{ padding: 'var(--pad)' }}>
              <div className="head" style={{ fontSize: 16, marginBottom: 10 }}>
                Rendimiento en YouTube
              </div>
              <div className="mono fs-sm" style={{ display: 'grid', gap: 4 }}>
                {video.metrics.views !== undefined ? (
                  <span>{video.metrics.views} visualizaciones</span>
                ) : null}
                {video.metrics.impressions !== undefined ? (
                  <span>
                    {video.metrics.impressions} impresiones
                    {video.metrics.ctr_pct !== undefined ? ` · CTR ${video.metrics.ctr_pct} %` : ''}
                  </span>
                ) : null}
                {video.metrics.avg_view_duration_s !== undefined ? (
                  <span>
                    {Math.round(video.metrics.avg_view_duration_s)} s de media
                    {video.metrics.avg_pct_viewed !== undefined
                      ? ` (${video.metrics.avg_pct_viewed} % de la pieza)`
                      : ''}
                  </span>
                ) : null}
                {video.metrics.subscribers_gained !== undefined ? (
                  <span>{video.metrics.subscribers_gained} suscriptores</span>
                ) : null}
              </div>
              <p className="muted fs-sm" style={{ margin: '10px 0 0' }}>
                Importado el {new Date(video.metrics.imported_at).toLocaleDateString('es-ES')} con
                pnpm metricas
              </p>
            </div>
          ) : null}

          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div className="head" style={{ fontSize: 16, marginBottom: 10 }}>
              Checklist de subida manual
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {checklist.map((item) => (
                <label
                  key={item.id}
                  className="fs-sm"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    lineHeight: 1.5,
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked[item.id] === true}
                    onChange={(e) =>
                      setChecked((prev) => ({ ...prev, [item.id]: e.target.checked }))
                    }
                    style={{ marginTop: 2 }}
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div className="step-label" style={{ marginBottom: 8 }}>
              Carpeta en disco
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {/* target _blank: si la API responde error JSON, se pinta en una
                  pestaña desechable en vez de reemplazar la SPA (en éxito el
                  attachment descarga y Chrome cierra la pestaña solo) */}
              <a
                className="btn btn-primary"
                style={{
                  textDecoration: 'none',
                  ...(video.state !== 'hecho' ? { opacity: 0.55, pointerEvents: 'none' } : {}),
                }}
                href={video.state === 'hecho' ? videoDownloadUrl(id) : undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={video.state !== 'hecho'}
                onClick={(e) => {
                  if (video.state !== 'hecho') e.preventDefault();
                }}
              >
                Guardar el MP4
              </a>
              <Button
                variant="secondary"
                disabled={revealMut.isPending}
                onClick={() => revealMut.mutate()}
              >
                Abrir la carpeta
              </Button>
            </div>
            <div
              className="mono fs-sm"
              style={{
                background: 'var(--bg3)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-sm)',
                padding: '8px 10px',
                wordBreak: 'break-all',
              }}
            >
              {outputDir}
            </div>
            <p className="muted fs-sm" style={{ margin: '10px 0 0', lineHeight: 1.5 }}>
              La subida manual sigue disponible; la automática en privado va en el bloque de
              publicación.
            </p>
          </div>
        </aside>
      </div>

      <InputModal
        open={manualAbierto}
        title="Marcar como publicado"
        desc="Registra el vídeo que ya subiste tú. No sube nada ni cambia el estado del vídeo."
        label="Enlace o id del vídeo en YouTube"
        placeholder="https://www.youtube.com/watch?v=…"
        ayuda="Pega la URL del vídeo en YouTube o su id de 11 caracteres"
        cta="Marcar como publicado"
        error={manualError}
        pending={manualMut.isPending}
        validate={(v) =>
          extractYoutubeId(v) === null ? 'No reconozco ese enlace ni ese id' : null
        }
        onConfirm={(v) => manualMut.mutate(v)}
        onClose={() => {
          setManualAbierto(false);
          setManualError(undefined);
        }}
      />
    </div>
  );
}
