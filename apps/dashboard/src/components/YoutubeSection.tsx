import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ApiError,
  disconnectYoutube,
  getYoutubeAuthUrl,
  getYoutubeStatus,
  putPublishSchedule,
} from '../lib/api';
import { useToasts } from '../lib/toasts';
import { Button, Chip } from './ui';

// Sección de YouTube en Ajustes (S3): conexión OAuth del canal y programación
// de publicación. La aprobación de cada subida vive en Entrega, no aquí.

export const WEEKDAY_LABELS = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
];

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.detail !== undefined) return err.detail;
  return fallback;
}

interface ScheduleDraft {
  enabled: boolean;
  weekday: number;
  hour: number;
}

export function YoutubeSection({ channelId }: { channelId: string }) {
  const { push } = useToasts();
  const queryClient = useQueryClient();

  const statusQ = useQuery({
    queryKey: ['youtube-status', channelId],
    queryFn: () => getYoutubeStatus(channelId),
  });
  const status = statusQ.data;

  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  useEffect(() => {
    if (draft === null && status !== undefined) {
      setDraft({
        enabled: status.publish_schedule !== null,
        weekday: status.publish_schedule?.weekday ?? 1,
        hour: status.publish_schedule?.hour ?? 17,
      });
    }
  }, [status, draft]);

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['youtube-status', channelId] });

  const connectMut = useMutation({
    mutationFn: () => getYoutubeAuthUrl(channelId),
    onSuccess: (url) => {
      window.open(url, '_blank', 'noopener');
      push('Completa el consentimiento de Google y vuelve a esta pestaña');
    },
    onError: (err) => push(describeError(err, 'No se pudo iniciar la conexión'), 'danger'),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnectYoutube(channelId),
    onSuccess: () => {
      invalidate();
      push('Canal de YouTube desconectado');
    },
    onError: (err) => push(describeError(err, 'No se pudo desconectar el canal'), 'danger'),
  });

  const scheduleMut = useMutation({
    mutationFn: () => {
      if (draft === null) throw new Error('Programación aún sin cargar');
      return putPublishSchedule(
        channelId,
        draft.enabled ? { weekday: draft.weekday, hour: draft.hour } : null,
      );
    },
    onSuccess: () => {
      invalidate();
      push('Programación de publicación guardada');
    },
    onError: (err) => push(describeError(err, 'No se pudo guardar la programación'), 'danger'),
  });

  return (
    <div className="card" style={{ padding: 'var(--pad)', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="head" style={{ fontSize: 16 }}>
          YouTube
        </div>
        {status !== undefined ? (
          <Chip kind={status.connected ? 'ok' : 'neutral'}>
            {status.connected ? 'Conectado' : 'Sin conectar'}
          </Chip>
        ) : null}
      </div>

      {statusQ.isPending ? (
        <p className="muted fs-sm" style={{ margin: 0 }}>
          Cargando el estado de la conexión
        </p>
      ) : status === undefined ? (
        <p className="muted fs-sm" style={{ margin: 0 }}>
          No se pudo leer el estado de la conexión con YouTube.
        </p>
      ) : (
        <>
          {status.connected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="fs-sm">
                {status.channel_title !== undefined
                  ? `Conectado como ${status.channel_title}`
                  : 'Canal conectado'}
              </span>
              <Button
                variant="danger-ghost"
                disabled={disconnectMut.isPending}
                onClick={() => disconnectMut.mutate()}
              >
                {disconnectMut.isPending ? 'Desconectando' : 'Desconectar'}
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Button
                variant="primary"
                disabled={!status.oauth_configured || connectMut.isPending}
                onClick={() => connectMut.mutate()}
              >
                Conectar YouTube
              </Button>
              <Button variant="secondary" onClick={() => void statusQ.refetch()}>
                Actualizar
              </Button>
              <span className="muted fs-sm">
                El consentimiento se abre en una pestaña nueva; al terminar, pulsa actualizar.
              </span>
            </div>
          )}

          {!status.oauth_configured ? (
            <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
              Faltan las credenciales OAuth del servidor (YT_OAUTH_CLIENT_ID y
              YT_OAUTH_CLIENT_SECRET en el .env): la conexión está desactivada hasta añadirlas.
            </p>
          ) : null}

          {status.provider !== 'youtube' ? (
            <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
              El proveedor de publicación está en modo simulado (PUBLISH_PROVIDER=mock): las
              subidas se simulan y no llegan a YouTube.
            </p>
          ) : null}

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'grid', gap: 10 }}>
            <div className="step-label">Programación de publicación</div>
            {draft === null ? (
              <p className="muted fs-sm" style={{ margin: 0 }}>
                Cargando la programación
              </p>
            ) : (
              <>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 'var(--fs-sm)' }}
                >
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                  />
                  Programar cada subida para el siguiente hueco semanal
                </label>
                {draft.enabled ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <label style={{ display: 'block' }}>
                      <span className="field-label">Día de la semana</span>
                      <select
                        className="control"
                        value={draft.weekday}
                        onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}
                      >
                        {WEEKDAY_LABELS.map((label, idx) => (
                          <option key={label} value={idx}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ display: 'block' }}>
                      <span className="field-label">Hora local del servidor</span>
                      <select
                        className="control"
                        value={draft.hour}
                        onChange={(e) => setDraft({ ...draft, hour: Number(e.target.value) })}
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, '0')}:00
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : (
                  <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
                    Sin programación, cada vídeo se sube en privado sin fecha y se publica a mano
                    desde YouTube Studio.
                  </p>
                )}
                <div>
                  <Button
                    variant="primary"
                    disabled={scheduleMut.isPending}
                    onClick={() => scheduleMut.mutate()}
                  >
                    {scheduleMut.isPending ? 'Guardando' : 'Guardar la programación'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
