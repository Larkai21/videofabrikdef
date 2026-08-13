import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { EpisodeDto } from '@fabrica/shared';
import {
  ApiError,
  archiveEpisode,
  chooseEpisodeFocus,
  createEpisode,
  fileUrl,
  getChannels,
  getEpisodeEncuadres,
  getEpisodes,
  retryEpisode,
} from '../lib/api';
import { useToasts } from '../lib/toasts';
import { Button, Chip, EmptyState, SkeletonRows } from '../components/ui';

const ENCUADRE_LABEL: Record<string, string> = {
  izq: 'Izquierda',
  centro: 'Centro',
  dcha: 'Derecha',
};

/**
 * Selector de encuadre 9:16: tres tiras reales (misma x en tres instantes) y
 * el humano ELIGE — no hay asa de arrastre. En multicámara el foco fijo es el
 * menos malo; por eso cada opción enseña tres tomas, no una.
 */
function EncuadreSelector({ episodeId, onElegido }: { episodeId: string; onElegido: () => void }) {
  const { push } = useToasts();
  const encuadresQ = useQuery({
    queryKey: ['episodio-encuadres', episodeId],
    queryFn: () => getEpisodeEncuadres(episodeId),
    staleTime: Infinity,
  });
  const elegirMut = useMutation({
    mutationFn: (x: number) => chooseEpisodeFocus(episodeId, x),
    onSuccess: () => {
      push('Encuadre elegido');
      onElegido();
    },
    onError: (err) =>
      push(err instanceof ApiError ? err.message : 'No se pudo guardar', 'danger'),
  });

  if (encuadresQ.isLoading) {
    return <span className="muted fs-sm">Preparando los encuadres…</span>;
  }
  const data = encuadresQ.data;
  if (data === undefined) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <span className="muted fs-sm">
        Elige el encuadre vertical: cada tira enseña la misma ventana en tres momentos del
        episodio.
      </span>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {data.opciones.map((o) => (
          <figure key={o.id} style={{ margin: 0, display: 'grid', gap: 6, justifyItems: 'center' }}>
            <img
              src={fileUrl(o.url)}
              alt={`Encuadre ${ENCUADRE_LABEL[o.id] ?? o.id}`}
              style={{ width: 280, borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }}
            />
            <Button
              variant={data.elegido_x === o.x ? 'primary' : 'secondary'}
              disabled={elegirMut.isPending}
              onClick={() => elegirMut.mutate(o.x)}
            >
              {data.elegido_x === o.x ? 'Elegido' : (ENCUADRE_LABEL[o.id] ?? o.id)}
            </Button>
          </figure>
        ))}
      </div>
    </div>
  );
}

// Episodios externos (clipping): pegar la URL de un podcast o VOD, seguir la
// descarga y la transcripción, y desde «listo» proponer clips. El material es
// ajeno: la fuente se registra desde el día 1 y cada short llevará su
// atribución en la descripción.

const ESTADOS: Record<EpisodeDto['state'], { label: string; kind: 'ok' | 'warn' | 'danger' | 'neutral' }> = {
  nuevo: { label: 'En cola', kind: 'neutral' },
  descargando: { label: 'Descargando', kind: 'warn' },
  transcribiendo: { label: 'Transcribiendo', kind: 'warn' },
  listo: { label: 'Listo para clips', kind: 'ok' },
  archivado: { label: 'Archivado', kind: 'neutral' },
  incidencia: { label: 'Incidencia', kind: 'danger' },
};

export function Episodios() {
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');

  const canalesQ = useQuery({ queryKey: ['channels'], queryFn: getChannels });
  const [canal, setCanal] = useState<string>('');
  const canalActivo = canal !== '' ? canal : (canalesQ.data?.[0]?.id ?? '');

  const episodiosQ = useQuery({
    queryKey: ['episodios'],
    queryFn: getEpisodes,
    // la descarga no emite progreso fino todavía: refresco suave de respaldo
    refetchInterval: 10_000,
  });

  const invalidar = () => void queryClient.invalidateQueries({ queryKey: ['episodios'] });

  const crearMut = useMutation({
    mutationFn: () => createEpisode(canalActivo, url.trim()),
    onSuccess: (r) => {
      push(r.ya_existia ? 'Ese episodio ya estaba dado de alta' : 'Episodio en cola de descarga');
      setUrl('');
      invalidar();
    },
    onError: (err) =>
      push(err instanceof ApiError ? err.message : 'No se pudo dar de alta', 'danger'),
  });

  const reintentarMut = useMutation({
    mutationFn: (id: string) => retryEpisode(id),
    onSuccess: () => {
      push('Reintento encolado');
      invalidar();
    },
    onError: (err) =>
      push(err instanceof ApiError ? err.message : 'No se pudo reintentar', 'danger'),
  });

  // archivar pide DOS clics (armar + confirmar): purga el mp4 y después no se
  // pueden proponer más clips — una decisión así no cabe en un clic al pasar
  const [archivando, setArchivando] = useState<string | null>(null);
  const archivarMut = useMutation({
    mutationFn: (id: string) => archiveEpisode(id),
    onSuccess: () => {
      push('Episodio archivado: mp4 purgado; los clips ya cortados siguen intactos');
      setArchivando(null);
      invalidar();
    },
    onError: (err) => {
      setArchivando(null);
      push(
        err instanceof ApiError && err.detail !== undefined
          ? err.detail
          : 'No se pudo archivar',
        'danger',
      );
    },
  });

  const episodios = episodiosQ.data ?? [];

  return (
    // wrap-1160 como el resto de pantallas: era la única sin contenedor
    <div
      className="wrap-1160"
      style={{ padding: 'calc(var(--pad) * 2) 26px 72px', display: 'grid', gap: 'var(--pad)' }}
    >
      <div className="card" style={{ padding: 'var(--pad)' }}>
        <div className="head" style={{ fontSize: 17, marginBottom: 6 }}>
          Nuevo episodio
        </div>
        <p className="muted fs-sm" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
          Pega la URL de un podcast de YouTube o un VOD de Twitch. Se descarga, se transcribe y
          desde ahí se proponen clips. La fuente queda registrada y cada clip llevará su
          atribución.
        </p>
        <form
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() !== '' && canalActivo !== '' && !crearMut.isPending) {
              crearMut.mutate();
            }
          }}
        >
          <select
            className="control"
            aria-label="Canal de clips destino"
            value={canalActivo}
            onChange={(e) => setCanal(e.target.value)}
            style={{ flex: 'none', width: 200 }}
          >
            {(canalesQ.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className="control"
            type="url"
            placeholder="https://www.youtube.com/watch?v=…"
            aria-label="URL del episodio"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ flex: 1, minWidth: 280 }}
          />
          <Button
            variant="primary"
            disabled={url.trim() === '' || canalActivo === '' || crearMut.isPending}
            onClick={() => crearMut.mutate()}
          >
            Dar de alta
          </Button>
        </form>
      </div>

      {episodiosQ.isLoading ? (
        <SkeletonRows rows={3} label="Cargando episodios" />
      ) : episodios.length === 0 ? (
        <EmptyState title="Sin episodios">
          Da de alta el primero pegando su URL arriba.
        </EmptyState>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {episodios.map((ep) => {
            const estado = ESTADOS[ep.state];
            return (
              <div key={ep.id} className="card" style={{ padding: 'var(--pad)', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Chip kind={estado.kind}>{estado.label}</Chip>
                  <span className="head" style={{ fontSize: 15 }}>
                    {ep.source_title ?? ep.source_url}
                  </span>
                  <div style={{ flex: 1 }} />
                  {ep.duration_ms !== null ? (
                    <span className="mono fs-sm muted">{Math.round(ep.duration_ms / 60000)} min</span>
                  ) : null}
                </div>
                <div className="muted fs-sm" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {ep.source_channel_name !== null ? <span>{ep.source_channel_name}</span> : null}
                  <span className="mono">{ep.source_platform}</span>
                  {ep.claims.length > 0 ? (
                    <span>
                      {ep.claims.length} {ep.claims.length === 1 ? 'reclamación' : 'reclamaciones'}
                    </span>
                  ) : null}
                </div>
                {ep.incident !== null ? (
                  <div className="banner banner-danger fs-sm">{ep.incident.message}</div>
                ) : null}
                {ep.state === 'incidencia' ? (
                  <div>
                    <Button variant="primary" onClick={() => reintentarMut.mutate(ep.id)}>
                      Reintentar
                    </Button>
                  </div>
                ) : null}
                {ep.state === 'listo' && ep.focus_x === null ? (
                  <EncuadreSelector episodeId={ep.id} onElegido={invalidar} />
                ) : null}
                {ep.focus_x !== null ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span className="muted fs-sm">
                      Encuadre: {ep.focus_x === 0.25 ? 'izquierda' : ep.focus_x === 0.5 ? 'centro' : ep.focus_x === 0.75 ? 'derecha' : `x=${ep.focus_x}`}
                    </span>
                    {/* con el encuadre elegido el flujo sigue en su pantalla:
                        proponer, aprobar y descargar viven allí */}
                    <Link className="btn btn-primary" to={`/episodios/${ep.id}/clips`}>
                      Clips del episodio
                    </Link>
                    {ep.state === 'listo' ? (
                      archivando === ep.id ? (
                        <>
                          <span className="fs-sm" style={{ color: 'var(--danger)' }}>
                            Purga el mp4: no podrás proponer más clips ni re-encuadrar
                          </span>
                          <Button
                            variant="danger"
                            disabled={archivarMut.isPending}
                            onClick={() => archivarMut.mutate(ep.id)}
                          >
                            Archivar de verdad
                          </Button>
                          <Button variant="ghost" onClick={() => setArchivando(null)}>
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <Button variant="danger-ghost" onClick={() => setArchivando(ep.id)}>
                          Archivar
                        </Button>
                      )
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
