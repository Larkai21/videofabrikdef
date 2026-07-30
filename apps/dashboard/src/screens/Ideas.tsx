import type { IdeaDto } from '@fabrica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Chip, EmptyState, ReasonModal, SkeletonRows, type Motivo } from '../components/ui';
import { approveIdea, discardIdea, getIdeasFor } from '../lib/api';
import { useChannel } from '../lib/channel';
import { useToasts } from '../lib/toasts';

// Motivos de descarte de ideas, en el estilo del mock (alimentan el scoring).
const MOTIVOS_IDEA: Motivo[] = [
  { id: 'reciente', label: 'Ya se ha tratado hace poco' },
  { id: 'pilares', label: 'No encaja con los pilares del canal' },
  { id: 'fuente', label: 'Fuente poco fiable o sin confirmar' },
  { id: 'nicho', label: 'Demasiado nicho para el público objetivo' },
];

export function Ideas() {
  const navigate = useNavigate();
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const [discarding, setDiscarding] = useState<IdeaDto | null>(null);

  const { channels, activeChannelId } = useChannel();

  const { data: ideas, isPending, isError, refetch } = useQuery({
    queryKey: ['ideas', activeChannelId],
    queryFn: () => getIdeasFor('new', activeChannelId),
    enabled: activeChannelId !== null,
  });

  const approveMut = useMutation({
    mutationFn: (idea: IdeaDto) => approveIdea(idea.id),
    onSuccess: (_res, idea) => {
      void queryClient.invalidateQueries({ queryKey: ['ideas'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
      // con packaging_first el flujo tras aprobar cambia: primero título y
      // miniatura; el flag se lee del canal de la idea, no del canal activo
      const packagingFirst =
        channels?.find((c) => c.id === idea.channel_id)?.profile?.flags.packaging_first === true;
      push(
        packagingFirst
          ? 'Idea aprobada · elige título y miniatura en la puerta 2'
          : 'Idea aprobada · el guion se está escribiendo',
      );
      void navigate('/');
    },
    onError: () => push('No se pudo aprobar la idea', 'danger'),
  });

  const discardMut = useMutation({
    mutationFn: (args: { id: string; reason: string }) => discardIdea(args.id, args.reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ideas'] });
      push('Idea descartada · el motivo alimenta el ranking');
    },
    onError: () => push('No se pudo descartar la idea', 'danger'),
  });

  const sorted = [...(ideas ?? [])].sort((a, b) => b.score - a.score);

  return (
    <div>
      <div className="subbar">
        <div className="wrap-1160 subbar-inner">
          <Button variant="secondary" onClick={() => void navigate('/')}>
            ← Bandeja
          </Button>
          <span className="head" style={{ fontSize: 15 }}>
            Elegir la idea
          </span>
          <Chip kind="warn">Puerta 1 de 3</Chip>
          <div style={{ flex: 1 }} />
          <span className="mono fs-sm muted">
            {sorted.length} ideas puntuadas por interés y encaje
          </span>
        </div>
      </div>

      <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 1.6) 26px 72px' }}>
        {isPending ? <SkeletonRows rows={4} label="Cargando el ranking" /> : null}
        {isError ? (
          <div className="banner banner-danger" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}>No se pudo cargar el ranking de ideas.</span>
            <Button variant="secondary" onClick={() => void refetch()}>
              Reintentar
            </Button>
          </div>
        ) : null}
        {!isPending && !isError && sorted.length === 0 ? (
          <EmptyState title="Sin ideas nuevas">
            El ranking se recalcula solo cuando las fuentes traen material nuevo.
          </EmptyState>
        ) : null}

        <div style={{ display: 'grid', gap: 'var(--gap)' }}>
          {sorted.map((idea, i) => (
            <div key={idea.id} className="card" style={{ padding: 'var(--pad)', display: 'flex', gap: 'var(--gap)' }}>
              <div
                style={{
                  flex: 'none',
                  width: 64,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span className="mono" style={{ fontSize: 22, fontWeight: 500 }}>
                  {Math.round(idea.score)}
                </span>
                <span className="step-label">nº {i + 1}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <div className="head" style={{ fontSize: 17, lineHeight: 1.3 }}>
                  {idea.title}
                </div>
                <div className="muted fs-sm" style={{ lineHeight: 1.5 }}>
                  {idea.summary}
                </div>
                {idea.why_now !== null && idea.why_now !== '' ? (
                  <div className="fs-sm" style={{ lineHeight: 1.5 }}>
                    <span className="step-label" style={{ marginRight: 8 }}>
                      Por qué ahora
                    </span>
                    {idea.why_now}
                  </div>
                ) : null}
                {idea.source_refs.length > 0 ? (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                    {idea.source_refs.map((src, j) => (
                      <a
                        key={j}
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="chip chip-neutral"
                        style={{ textDecoration: 'none' }}
                      >
                        {src.domain ?? new URL(src.url).hostname}
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
              <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
                <Button
                  variant="primary"
                  disabled={approveMut.isPending}
                  onClick={() => approveMut.mutate(idea)}
                >
                  Aprobar y escribir el guion
                </Button>
                <Button variant="danger-ghost" onClick={() => setDiscarding(idea)}>
                  Descartar
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <ReasonModal
        open={discarding !== null}
        title={discarding !== null ? `Descartar «${discarding.title}»` : ''}
        desc="El motivo alimenta el scoring: la máquina deja de proponer cosas parecidas."
        motivos={MOTIVOS_IDEA}
        cta="Descartar la idea"
        onConfirm={(reason) => {
          if (discarding !== null) discardMut.mutate({ id: discarding.id, reason });
          setDiscarding(null);
        }}
        onClose={() => setDiscarding(null)}
      />
    </div>
  );
}
