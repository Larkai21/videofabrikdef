import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReelDto } from '@fabrica/shared';
import { ApiError, createReel, getChannels, getReels, retryReel } from '../lib/api';
import { useSearch } from '../lib/search';
import { useToasts } from '../lib/toasts';
import { Button, Chip, EmptyState, Incidencia, SkeletonRows } from '../components/ui';

// Reels del módulo editor: A-roll PROPIO + guion de dirección JSON. El humano
// sube los dos; la máquina transcribe, cruza el guion con lo grabado y deja el
// plan esperando su firma en /reels/:id. Es otro pipeline que el de la
// fábrica: material propio, sin TTS ni stock, y motor de render del editor
// (Playwright + ffmpeg), no Remotion.

const ESTADOS: Record<ReelDto['state'], { label: string; kind: 'ok' | 'warn' | 'danger' | 'neutral' }> = {
  nuevo: { label: 'En cola', kind: 'neutral' },
  preparando: { label: 'Preparando', kind: 'warn' },
  plan_listo: { label: 'Plan listo para revisar', kind: 'ok' },
  render: { label: 'Renderizando', kind: 'warn' },
  hecho: { label: 'Listo', kind: 'ok' },
  incidencia: { label: 'Incidencia', kind: 'danger' },
};

export function Reels() {
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [nombreAroll, setNombreAroll] = useState('');
  const [titulo, setTitulo] = useState('');
  const [guion, setGuion] = useState('');

  const canalesQ = useQuery({ queryKey: ['channels'], queryFn: getChannels });
  const [canal, setCanal] = useState<string>('');
  const canalActivo = canal !== '' ? canal : (canalesQ.data?.[0]?.id ?? '');

  const reelsQ = useQuery({
    queryKey: ['reels'],
    queryFn: getReels,
    // la preparación no emite progreso fino: refresco suave de respaldo
    refetchInterval: 10_000,
  });

  const invalidar = () => void queryClient.invalidateQueries({ queryKey: ['reels'] });

  // el guion se valida aquí solo como JSON bien formado; el contrato de
  // dirección lo valida el módulo editor al preparar (y avisa por incidencia)
  const guionValido = (() => {
    if (guion.trim() === '') return false;
    try {
      const parsed: unknown = JSON.parse(guion);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch {
      return false;
    }
  })();

  const crearMut = useMutation({
    mutationFn: () => {
      const file = fileRef.current?.files?.[0];
      if (file === undefined) throw new ApiError(400, 'Falta el A-roll');
      return createReel({ file, channelId: canalActivo, guionJson: guion, title: titulo });
    },
    onSuccess: () => {
      push('Reel en cola: transcripción y plan en marcha');
      setTitulo('');
      setGuion('');
      setNombreAroll('');
      if (fileRef.current) fileRef.current.value = '';
      invalidar();
    },
    onError: (err) =>
      push(err instanceof ApiError ? err.message : 'No se pudo dar de alta', 'danger'),
  });

  const reintentarMut = useMutation({
    mutationFn: (id: string) => retryReel(id),
    onSuccess: () => {
      push('Reintento encolado');
      invalidar();
    },
    onError: (err) =>
      push(err instanceof ApiError ? err.message : 'No se pudo reintentar', 'danger'),
  });

  // la búsqueda global filtra in situ, como en la bandeja
  const { search } = useSearch();
  const q = search.trim().toLowerCase();
  const reels = (reelsQ.data ?? []).filter(
    (reel) => q === '' || reel.title.toLowerCase().includes(q),
  );

  return (
    <div
      className="wrap-1160"
      style={{ padding: 'calc(var(--pad) * 2) 26px 72px', display: 'grid', gap: 'var(--pad)' }}
    >
      <div className="card" style={{ padding: 'var(--pad)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
          <div className="head" style={{ fontSize: 17 }}>
            Nuevo reel
          </div>
          <div style={{ flex: 1 }} />
          <Link className="btn btn-secondary" to="/reels/plantillas">
            Plantillas del editor
          </Link>
        </div>
        <p className="muted fs-sm" style={{ margin: '0 0 12px', lineHeight: 1.5 }}>
          Sube tu A-roll y pega el guion de dirección (JSON del contrato del editor). La máquina
          transcribe, cruza el guion con lo que de verdad se grabó y te deja el plan de capas para
          firmar antes de renderizar.
        </p>
        <form
          style={{ display: 'grid', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (guionValido && canalActivo !== '' && !crearMut.isPending) crearMut.mutate();
          }}
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              className="control"
              aria-label="Canal destino"
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
              type="text"
              placeholder="Título (opcional; si no, sale del guion)"
              aria-label="Título del reel"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
            {/* el input nativo dice «Choose File» en el idioma del navegador:
                se esconde y un botón nuestro habla español y enseña el nombre */}
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              aria-label="A-roll (vídeo bruto)"
              style={{ display: 'none' }}
              onChange={(e) => setNombreAroll(e.target.files?.[0]?.name ?? '')}
            />
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              {nombreAroll === '' ? 'Elegir A-roll…' : 'Cambiar A-roll'}
            </Button>
            {nombreAroll !== '' ? (
              <span className="mono fs-sm muted" style={{ alignSelf: 'center' }}>
                {nombreAroll}
              </span>
            ) : null}
          </div>
          <textarea
            className="control"
            rows={6}
            placeholder='{"pieces": [{"act": 1, "voice_speech": "…"}]}'
            aria-label="Guion de dirección (JSON)"
            value={guion}
            onChange={(e) => setGuion(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {guion.trim() !== '' && !guionValido ? (
              <span className="fs-sm" style={{ color: 'var(--danger)' }}>
                El guion no es un objeto JSON válido
              </span>
            ) : null}
            <div style={{ flex: 1 }} />
            <Button
              variant="primary"
              disabled={!guionValido || nombreAroll === '' || canalActivo === '' || crearMut.isPending}
              onClick={() => crearMut.mutate()}
            >
              Dar de alta
            </Button>
          </div>
        </form>
      </div>

      {reelsQ.isLoading ? (
        <SkeletonRows rows={3} label="Cargando reels" />
      ) : reels.length === 0 ? (
        <EmptyState title="Sin reels">
          Sube el primer A-roll con su guion de dirección arriba.
        </EmptyState>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {reels.map((reel) => {
            const estado = ESTADOS[reel.state];
            return (
              <div
                key={reel.id}
                className="card"
                style={{ padding: 'var(--pad)', display: 'grid', gap: 8 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Chip kind={estado.kind}>{estado.label}</Chip>
                  <Link to={`/reels/${reel.id}`} className="head" style={{ fontSize: 15 }}>
                    {reel.title}
                  </Link>
                  <div style={{ flex: 1 }} />
                  <span className="mono fs-sm muted">{reel.formato}</span>
                  {reel.plan_capas !== null ? (
                    <span className="mono fs-sm muted">{reel.plan_capas} capas</span>
                  ) : null}
                </div>
                {reel.incident !== null ? (
                  <Incidencia mensaje={reel.incident.message} />
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {reel.state === 'incidencia' ? (
                    <Button variant="primary" onClick={() => reintentarMut.mutate(reel.id)}>
                      Reintentar
                    </Button>
                  ) : null}
                  {reel.state === 'plan_listo' ? (
                    <Link className="btn btn-primary" to={`/reels/${reel.id}`}>
                      Revisar el plan
                    </Link>
                  ) : null}
                  {reel.state === 'hecho' ? (
                    <Link className="btn btn-secondary" to={`/reels/${reel.id}`}>
                      Ver el resultado
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
