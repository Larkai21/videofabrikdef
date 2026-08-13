import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { ReelPlanLayer } from '@fabrica/shared';
import {
  ApiError,
  fileUrl,
  getReel,
  prepareReel,
  renderReel,
  retryReel,
  updateReelPlan,
} from '../lib/api';
import { useLive } from '../lib/events';
import { useToasts } from '../lib/toasts';
import { Button, Chip, EmptyState, ProgressBar, SkeletonRows } from '../components/ui';

// LA puerta del pipeline de reels: el plan de capas que preparó la máquina
// espera la firma humana. Se revisa como documento (principio 2: nada de JSON
// crudo): una fila por capa con lo que un humano decide de verdad — cuándo
// entra, cuánto dura, y si sobra. El config interno de cada capa lo fijó el
// guion; retocarlo es trabajo del guion, no de esta pantalla.

const ESTADOS: Record<string, { label: string; kind: 'ok' | 'warn' | 'danger' | 'neutral' }> = {
  nuevo: { label: 'En cola', kind: 'neutral' },
  preparando: { label: 'Preparando', kind: 'warn' },
  plan_listo: { label: 'Plan listo para revisar', kind: 'ok' },
  render: { label: 'Renderizando', kind: 'warn' },
  hecho: { label: 'Listo', kind: 'ok' },
  incidencia: { label: 'Incidencia', kind: 'danger' },
};

export function ReelDetalle() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const { reelProgress } = useLive();

  const reelQ = useQuery({
    queryKey: ['reels', id],
    queryFn: () => getReel(id),
    enabled: id !== '',
    // preparando/render avanzan sin progreso fino: refresco de respaldo
    refetchInterval: (query) => {
      const s = query.state.data?.state;
      return s === 'preparando' || s === 'render' || s === 'nuevo' ? 5_000 : false;
    },
  });

  // borrador local del plan: se edita encima de una copia y solo el botón
  // Guardar lo manda; así un refetch no pisa lo que estás tocando
  const [borrador, setBorrador] = useState<ReelPlanLayer[] | null>(null);
  const reel = reelQ.data;
  useEffect(() => {
    setBorrador(null);
  }, [reel?.plan]);
  const plan = borrador ?? reel?.plan ?? null;
  const editable = reel?.state === 'plan_listo';

  const invalidar = () => void queryClient.invalidateQueries({ queryKey: ['reels'] });
  const alFallar = (fallback: string) => (err: unknown) =>
    push(err instanceof ApiError && err.detail !== undefined ? err.detail : fallback, 'danger');

  const guardarMut = useMutation({
    mutationFn: (capas: ReelPlanLayer[]) => updateReelPlan(id, capas),
    onSuccess: () => {
      push('Plan guardado');
      setBorrador(null);
      invalidar();
    },
    onError: alFallar('No se pudo guardar el plan'),
  });
  const renderMut = useMutation({
    mutationFn: () => renderReel(id),
    onSuccess: () => {
      push('Plan firmado; el render está en cola');
      invalidar();
    },
    onError: alFallar('No se pudo lanzar el render'),
  });
  const prepararMut = useMutation({
    mutationFn: () => prepareReel(id),
    onSuccess: () => {
      push('Regenerando el plan desde el guion');
      invalidar();
    },
    onError: alFallar('No se pudo regenerar'),
  });
  const reintentarMut = useMutation({
    mutationFn: () => retryReel(id),
    onSuccess: () => {
      push('Reintento encolado');
      invalidar();
    },
    onError: alFallar('No se pudo reintentar'),
  });

  const cambiarCapa = (idx: number, patch: Partial<ReelPlanLayer>) => {
    if (plan === null) return;
    const nuevo = plan.map((capa, i) => (i === idx ? { ...capa, ...patch } : capa));
    setBorrador(nuevo);
  };
  const quitarCapa = (idx: number) => {
    if (plan === null) return;
    setBorrador(plan.filter((_, i) => i !== idx));
  };

  const estado = reel !== undefined ? ESTADOS[reel.state] : undefined;

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
        <Button variant="ghost" onClick={() => void navigate('/reels')}>
          ← Reels
        </Button>
        <h1 className="head" style={{ fontSize: 18, margin: 0 }}>
          {reel?.title ?? 'Reel'}
        </h1>
        {estado !== undefined ? <Chip kind={estado.kind}>{estado.label}</Chip> : null}
        <div style={{ flex: 1 }} />
        {editable ? (
          <>
            <Button
              variant="secondary"
              disabled={prepararMut.isPending}
              onClick={() => prepararMut.mutate()}
            >
              Regenerar plan
            </Button>
            {borrador !== null ? (
              <Button
                variant="secondary"
                disabled={guardarMut.isPending || borrador.length === 0}
                onClick={() => guardarMut.mutate(borrador)}
              >
                Guardar cambios
              </Button>
            ) : null}
            <Button
              variant="primary"
              // un borrador sin guardar no se firma: lo renderizado debe ser
              // exactamente lo que hay en la fila
              disabled={renderMut.isPending || borrador !== null || (plan?.length ?? 0) === 0}
              onClick={() => renderMut.mutate()}
            >
              Aprobar y renderizar
            </Button>
          </>
        ) : null}
        {reel?.state === 'incidencia' ? (
          <Button variant="primary" onClick={() => reintentarMut.mutate()}>
            Reintentar
          </Button>
        ) : null}
      </div>

      {reel?.incident != null ? (
        <div className="banner banner-danger fs-sm" style={{ marginBottom: 'var(--gap)' }}>
          {reel.incident.message}
        </div>
      ) : null}

      {reel?.state === 'render' ? (
        <div style={{ display: 'grid', gap: 6, marginBottom: 'var(--gap)' }}>
          <ProgressBar value={reelProgress[id] ?? 2} />
          <span className="muted fs-sm">
            {reelProgress[id] === undefined
              ? 'En cola del editor (un render de reel cada vez)'
              : `Renderizando · ${reelProgress[id]} % — el rasterizado es lo largo; la composición va a saltos`}
          </span>
        </div>
      ) : null}

      {reelQ.isPending ? (
        <SkeletonRows rows={3} label="Cargando el reel" />
      ) : reel === undefined ? null : reel.state === 'hecho' && reel.video_url !== null ? (
        <div style={{ display: 'grid', gap: 'var(--gap)', justifyItems: 'start' }}>
          <video
            src={fileUrl(reel.video_url)}
            poster={reel.portada_url !== null ? fileUrl(reel.portada_url) : undefined}
            controls
            style={{
              width: reel.formato === '16:9' ? 640 : 300,
              aspectRatio: reel.formato === '16:9' ? '16 / 9' : reel.formato === '1:1' ? '1 / 1' : '9 / 16',
              borderRadius: 'var(--r)',
              background: '#000',
            }}
          />
          <a className="btn btn-secondary" href={fileUrl(reel.video_url)} download>
            Guardar el MP4
          </a>
        </div>
      ) : plan === null || plan.length === 0 ? (
        <EmptyState title="El plan aún no existe">
          La máquina está transcribiendo el A-roll y cruzándolo con el guion. Cuando el plan esté
          listo, esta pantalla lo enseña capa a capa para que lo firmes.
        </EmptyState>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--gap)' }}>
          <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.5 }}>
            Una fila por capa: cuándo entra, cuánto dura y con qué plantilla. El contenido de cada
            capa lo fijó el guion; si algo de fondo está mal, corrige el guion y regenera el plan.
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {plan.map((capa, idx) => (
              <div
                key={`${String(capa.capa)}-${idx}`}
                className="card"
                style={{
                  padding: 'var(--pad)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <span className="head" style={{ fontSize: 14, minWidth: 140 }}>
                  {capa.capa}
                </span>
                <span className="mono fs-sm muted" style={{ minWidth: 160 }}>
                  {capa.template ?? '—'}
                </span>
                <label className="fs-sm muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  entra en
                  <input
                    className="control"
                    type="number"
                    step={0.1}
                    min={0}
                    value={capa.t ?? 0}
                    disabled={!editable}
                    onChange={(e) => cambiarCapa(idx, { t: Number(e.target.value) })}
                    style={{ width: 90 }}
                    aria-label={`Segundo de entrada de ${String(capa.capa)}`}
                  />
                  s
                </label>
                <label className="fs-sm muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  dura
                  <input
                    className="control"
                    type="number"
                    step={0.1}
                    min={0.1}
                    value={capa.duracion ?? 0}
                    disabled={!editable}
                    onChange={(e) => cambiarCapa(idx, { duracion: Number(e.target.value) })}
                    style={{ width: 90 }}
                    aria-label={`Duración de ${String(capa.capa)}`}
                  />
                  s
                </label>
                <div style={{ flex: 1 }} />
                {editable ? (
                  <Button variant="danger-ghost" onClick={() => quitarCapa(idx)}>
                    Quitar
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
