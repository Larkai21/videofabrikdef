import type { IdeaDto } from '@fabrica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiError,
  approveIdea,
  discardIdea,
  getIdeasFor,
  getSources,
  orderIdeas,
  pollSources,
} from '../lib/api';
import { useLive } from '../lib/events';
import { useToasts } from '../lib/toasts';
import { Button, ProgressBar } from './ui';

const RANKING_VISIBLE = 8;
// si en este tiempo no ha llegado el cierre, se libera el botón: el ranking
// se refresca solo por SSE cuando el scoring termine
const SEARCH_TIMEOUT_MS = 180_000;

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** 79.5 → «79,5» (mismo formato decimal que el resto del dashboard). */
function fmtScore(score: number): string {
  return score.toFixed(1).replace('.', ',');
}

// Radar de ideas: buscar con las fuentes reales, ver el progreso en vivo,
// reordenar el ranking (el orden manual manda; sin tocar, manda el score) y
// arrancar la producción de la primera idea. Las puertas 2 y 3 no cambian.
export function Radar({ channelId }: { channelId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToasts();
  const { sourcePolls, ideasScored } = useLive();

  // instante en que se pulsó «Buscar»: el feed solo enseña lo posterior
  const [searchStart, setSearchStart] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  // descarte en dos pasos: id de la idea esperando confirmación
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

  const sourcesQ = useQuery({
    queryKey: ['fuentes', channelId],
    queryFn: () => getSources(channelId),
  });
  const ideasQ = useQuery({
    queryKey: ['ideas', 'new', channelId],
    queryFn: () => getIdeasFor('new', channelId),
    refetchInterval: 60_000,
  });

  const pollMut = useMutation({
    mutationFn: () => pollSources(channelId),
    onSuccess: ({ enqueued }) => {
      if (enqueued === 0) {
        setSearchStart(null);
        push('El canal no tiene fuentes habilitadas', 'danger');
      }
    },
    onError: (err) => {
      setSearchStart(null);
      push(err instanceof ApiError ? err.message : 'No se pudo lanzar la búsqueda', 'danger');
    },
  });

  // reordenación con último-orden-gana: si hay un PUT en vuelo, se recuerda el
  // último orden pedido y se envía al asentarse (dos clicks rápidos no compiten)
  const latestOrderRef = useRef<string[] | null>(null);
  const orderMut = useMutation({
    mutationFn: (ids: string[]) => orderIdeas(channelId, ids),
    onMutate: async (ids: string[]) => {
      // sin cancelar, un GET en vuelo (invalidación por SSE) pisaría el
      // orden optimista al resolver
      await queryClient.cancelQueries({ queryKey: ['ideas', 'new', channelId] });
      const current = queryClient.getQueryData<IdeaDto[]>(['ideas', 'new', channelId]) ?? [];
      const byId = new Map(current.map((i) => [i.id, i]));
      const reordered = [
        ...ids.flatMap((id, pos) => {
          const idea = byId.get(id);
          return idea !== undefined ? [{ ...idea, manual_rank: pos }] : [];
        }),
        ...current.filter((i) => !ids.includes(i.id)),
      ];
      queryClient.setQueryData(['ideas', 'new', channelId], reordered);
    },
    onError: () => push('No se pudo guardar el orden', 'danger'),
    onSettled: () => {
      const pending = latestOrderRef.current;
      latestOrderRef.current = null;
      if (pending !== null) {
        orderMut.mutate(pending);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['ideas', 'new', channelId] });
    },
  });

  const generateMut = useMutation({
    mutationFn: (idea: IdeaDto) => approveIdea(idea.id),
    onSuccess: (_, idea) => {
      push(`Vídeo en marcha: ${idea.title}`);
      void queryClient.invalidateQueries({ queryKey: ['ideas'] });
      void queryClient.invalidateQueries({ queryKey: ['inbox'] });
    },
    onError: (err) =>
      push(
        err instanceof ApiError && err.detail !== undefined
          ? err.detail
          : 'No se pudo arrancar el vídeo',
        'danger',
      ),
  });

  const discardMut = useMutation({
    mutationFn: (idea: IdeaDto) => discardIdea(idea.id, 'descartada desde el radar'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ideas'] });
    },
    onError: () => push('No se pudo descartar la idea', 'danger'),
  });

  // la confirmación de descarte caduca sola
  useEffect(() => {
    if (confirmDiscard === null) return;
    const t = setTimeout(() => setConfirmDiscard(null), 4_000);
    return () => clearTimeout(t);
  }, [confirmDiscard]);

  const sources = sourcesQ.data ?? [];
  const ideas = ideasQ.data ?? [];
  const ranking = ideas.slice(0, RANKING_VISIBLE);
  const hasManualOrder = ranking.some((i) => i.manual_rank !== null);

  // progreso de la búsqueda: fuentes que ya respondieron desde searchStart
  const feed = useMemo(() => {
    if (searchStart === null) return [];
    return sourcePolls.filter(
      (p) => p.at >= searchStart && (p.channel_id === null || p.channel_id === channelId),
    );
  }, [sourcePolls, searchStart, channelId]);
  const polled = new Set(feed.map((p) => p.source_id)).size;
  const allPolled = sources.length > 0 && polled >= sources.length;
  const anyNew = feed.some((p) => p.nuevos > 0);
  const anyOk = feed.some((p) => p.error === undefined);
  // el scoring que cierra la búsqueda debe ser POSTERIOR al último poll que
  // insertó material: un evento de una pasada programada anterior no vale
  const lastInsertAt = feed.reduce((acc, p) => (p.nuevos > 0 ? Math.max(acc, p.at) : acc), 0);
  const scored = searchStart !== null ? ideasScored[channelId] : undefined;
  const scoredOk =
    scored !== undefined && scored.at >= (searchStart ?? 0) && allPolled && scored.at >= lastInsertAt;
  const finishedWithoutNews = allPolled && !anyNew && anyOk;
  const allFailed = allPolled && !anyOk;
  const closed = scoredOk || finishedWithoutNews || allFailed;
  const searching = searchStart !== null && !closed && !timedOut;

  // válvula de escape: sin cierre en 3 min se libera el botón
  useEffect(() => {
    if (searchStart === null || closed) return;
    setTimedOut(false);
    const t = setTimeout(() => setTimedOut(true), SEARCH_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [searchStart, closed]);

  const labelOf = (note: { source_id: string; kind: string }): string =>
    sources.find((s) => s.id === note.source_id)?.label ?? note.kind;

  const move = (idx: number, delta: number) => {
    const j = idx + delta;
    if (j < 0 || j >= ranking.length) return;
    const ids = ranking.map((i) => i.id);
    const a = ids[idx];
    const b = ids[j];
    if (a === undefined || b === undefined) return;
    ids[idx] = b;
    ids[j] = a;
    if (orderMut.isPending) {
      // último orden gana; se enviará al asentarse el PUT en vuelo
      latestOrderRef.current = ids;
      void queryClient.cancelQueries({ queryKey: ['ideas', 'new', channelId] }).then(() => {
        const current = queryClient.getQueryData<IdeaDto[]>(['ideas', 'new', channelId]) ?? [];
        const byId = new Map(current.map((i) => [i.id, i]));
        queryClient.setQueryData(['ideas', 'new', channelId], [
          ...ids.flatMap((id, pos) => {
            const idea = byId.get(id);
            return idea !== undefined ? [{ ...idea, manual_rank: pos }] : [];
          }),
          ...current.filter((i) => !ids.includes(i.id)),
        ]);
      });
      return;
    }
    orderMut.mutate(ids);
  };

  const first = ranking[0];

  return (
    <section className="card" style={{ padding: 'var(--pad)', marginBottom: 'var(--sec-gap)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <h2 className="head" style={{ fontSize: 17, margin: 0 }}>
          Radar de ideas
        </h2>
        <span className="muted fs-sm">
          las fuentes del canal, puntuadas por el modelo; tu orden manda
        </span>
        <div style={{ flex: 1 }} />
        <span className="mono fs-sm muted" style={{ whiteSpace: 'nowrap' }}>
          {plural(ideas.length, 'idea en el ranking', 'ideas en el ranking')}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Button
          variant="secondary"
          disabled={searching || pollMut.isPending}
          onClick={() => {
            setTimedOut(false);
            setSearchStart(Date.now());
            pollMut.mutate();
          }}
        >
          {searching ? 'Buscando' : 'Buscar ideas ahora'}
        </Button>
        <Button
          variant="primary"
          disabled={first === undefined || generateMut.isPending}
          title={first !== undefined ? `Generar «${first.title}»` : undefined}
          onClick={() => {
            if (first !== undefined) generateMut.mutate(first);
          }}
        >
          Generar vídeo
        </Button>
        {first !== undefined ? (
          <span
            className="muted fs-sm"
            style={{
              alignSelf: 'center',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            saldrá la primera del orden: «{first.title}»
          </span>
        ) : null}
      </div>

      {searchStart !== null ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-sm)',
            background: 'var(--bg3)',
            padding: '10px 12px',
            marginBottom: 12,
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ProgressBar
              value={sources.length > 0 ? Math.round((polled / sources.length) * 100) : 0}
              className="flex-1"
            />
            <span className="mono fs-sm muted" style={{ whiteSpace: 'nowrap' }}>
              {polled} de {plural(sources.length, 'fuente', 'fuentes')}
            </span>
          </div>
          <div className="mono fs-sm" style={{ display: 'grid', gap: 3 }}>
            {feed.slice(-5).map((p) => (
              <span
                key={`${p.source_id}-${p.at}`}
                style={{ color: p.error !== undefined ? 'var(--danger)' : 'var(--fg2)' }}
              >
                {labelOf(p)} ·{' '}
                {p.error !== undefined
                  ? 'falló tras varios intentos'
                  : `${plural(p.items, 'entrada', 'entradas')} · ${plural(p.nuevos, 'nueva', 'nuevas')}`}
              </span>
            ))}
            {searching && allPolled && anyNew ? (
              <span className="muted">Puntuando lo nuevo con el modelo (puede tardar un minuto)</span>
            ) : null}
            {finishedWithoutNews && !scoredOk ? (
              <span style={{ color: 'var(--ok)' }}>
                Búsqueda terminada · sin material nuevo; el ranking se queda como está
              </span>
            ) : null}
            {allFailed ? (
              <span style={{ color: 'var(--danger)' }}>
                La búsqueda falló en todas las fuentes; prueba de nuevo en un rato
              </span>
            ) : null}
            {scoredOk ? (
              <span style={{ color: 'var(--ok)' }}>
                {scored.nuevas === 0
                  ? 'Búsqueda terminada · sin ideas nuevas'
                  : `Búsqueda terminada · ${plural(scored.nuevas, 'idea nueva', 'ideas nuevas')} en el ranking`}
              </span>
            ) : null}
            {timedOut && !closed ? (
              <span className="muted">
                La búsqueda tarda más de lo normal; el ranking se actualizará solo cuando termine
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {ranking.length === 0 ? (
        <div className="muted fs-sm">
          {ideasQ.isPending
            ? 'Cargando el ranking'
            : 'No hay ideas nuevas; lanza una búsqueda para llenar el ranking.'}
        </div>
      ) : (
        <div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {ranking.map((idea, i) => (
              <li
                key={idea.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '9px 2px',
                  borderTop: i === 0 ? 'none' : '1px solid var(--line)',
                }}
              >
                <span
                  className="mono fs-sm muted"
                  style={{ width: 18, flex: 'none', textAlign: 'right' }}
                >
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {idea.title}
                  </div>
                  {idea.why_now !== null && idea.why_now !== '' ? (
                    <div
                      className="muted fs-sm"
                      style={{
                        marginTop: 2,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {idea.why_now}
                    </div>
                  ) : null}
                </div>
                <span className="mono fs-sm muted" style={{ flex: 'none' }}>
                  {fmtScore(idea.score)}
                </span>
                <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
                  {/* aria-disabled (y no disabled) en los bordes: deshabilitar
                      el botón enfocado tras mover expulsaría el foco */}
                  <Button
                    variant="ghost"
                    aria-label={`Subir «${idea.title}»`}
                    aria-disabled={i === 0}
                    style={i === 0 ? { opacity: 0.4 } : undefined}
                    onClick={() => {
                      if (i > 0) move(i, -1);
                    }}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Bajar «${idea.title}»`}
                    aria-disabled={i === ranking.length - 1}
                    style={i === ranking.length - 1 ? { opacity: 0.4 } : undefined}
                    onClick={() => {
                      if (i < ranking.length - 1) move(i, 1);
                    }}
                  >
                    ↓
                  </Button>
                  {confirmDiscard === idea.id ? (
                    <Button
                      variant="danger-ghost"
                      aria-label={`Confirmar el descarte de «${idea.title}»`}
                      disabled={discardMut.isPending}
                      onClick={() => {
                        setConfirmDiscard(null);
                        discardMut.mutate(idea);
                      }}
                    >
                      ¿Seguro?
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      aria-label={`Descartar «${idea.title}»`}
                      onClick={() => setConfirmDiscard(idea.id)}
                    >
                      Descartar
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div
            className="muted fs-sm"
            style={{ display: 'flex', gap: 12, paddingTop: 9, borderTop: '1px solid var(--line)' }}
          >
            <span>
              {hasManualOrder
                ? 'Orden manual guardado; «Generar vídeo» usa el primero.'
                : 'Ordenadas por score; reordena con las flechas si quieres decidir tú.'}
            </span>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="nav-link fs-sm"
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onClick={() => void navigate('/ideas')}
            >
              Ver el ranking completo →
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
