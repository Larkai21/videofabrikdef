import type { VideoState } from '@fabrica/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getInbox } from '../lib/api';
import { useLive } from '../lib/events';
import { fmtMoney } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useSearch } from '../lib/search';
import { Button, Chip, EmptyState, ProgressBar, ThumbPlaceholder, type ChipKind } from '../components/ui';

const STATE_CHIP: Record<VideoState, { label: string; kind: ChipKind }> = {
  idea: { label: 'Idea', kind: 'neutral' },
  idea_aprobada: { label: 'En cola', kind: 'neutral' },
  guion_borrador: { label: 'Requiere revisión', kind: 'warn' },
  guion_ok: { label: 'En cola', kind: 'neutral' },
  audio: { label: 'Generando voz', kind: 'neutral' },
  assets: { label: 'Buscando clips', kind: 'neutral' },
  timeline_ok: { label: 'En cola de render', kind: 'neutral' },
  render: { label: 'Renderizando', kind: 'neutral' },
  hecho: { label: 'Hecho', kind: 'ok' },
  incidencia: { label: 'Incidencia', kind: 'danger' },
};

function gateTarget(kind: 'idea' | 'guion' | 'timeline' | 'entrega', videoId: string | null): string {
  if (kind === 'idea') return '/ideas';
  if (videoId === null) return '/';
  if (kind === 'guion') return `/videos/${videoId}/guion`;
  if (kind === 'timeline') return `/videos/${videoId}/timeline`;
  return `/videos/${videoId}/entrega`;
}

function runningTarget(state: VideoState, videoId: string): string | null {
  if (state === 'guion_borrador') return `/videos/${videoId}/guion`;
  if (state === 'assets') return `/videos/${videoId}/timeline`;
  if (state === 'hecho') return `/videos/${videoId}/entrega`;
  return null;
}

export function Bandeja() {
  const navigate = useNavigate();
  const { search } = useSearch();
  const live = useLive();

  const { data: inbox, isPending, isError, refetch } = useQuery({
    queryKey: ['inbox'],
    queryFn: getInbox,
    refetchInterval: 30_000,
  });

  const q = search.trim().toLowerCase();
  const gates = (inbox?.gates ?? []).filter((g) => q === '' || g.title.toLowerCase().includes(q));
  const running = (inbox?.running ?? []).filter(
    (v) => q === '' || v.title.toLowerCase().includes(q),
  );
  const done = (inbox?.done ?? []).filter((d) => q === '' || d.title.toLowerCase().includes(q));

  useHotkeys((e) => {
    const n = Number.parseInt(e.key, 10);
    if (n >= 1 && n <= Math.min(3, gates.length)) {
      const gate = gates[n - 1];
      if (gate !== undefined) void navigate(gateTarget(gate.kind, gate.video_id));
    }
  });

  const totalEta = gates.reduce((acc, g) => acc + g.eta_min, 0);
  const monthBudget = inbox?.month_budget_usd ?? 0;
  const monthCost = inbox?.month_cost_usd ?? 0;
  const perVideo =
    inbox !== undefined && inbox.month_videos > 0 ? monthCost / inbox.month_videos : 0;

  if (isError) {
    return (
      <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px' }}>
        <div className="banner banner-danger" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ flex: 1 }}>No se pudo cargar la bandeja. La API no responde.</span>
          <Button variant="secondary" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px 72px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 'var(--pad)' }}>
        <h1 className="head" style={{ fontSize: 26, letterSpacing: '-0.02em', margin: 0 }}>
          Te espera
        </h1>
        <span className="muted fs-sm">
          {gates.length === 0
            ? 'no hay puertas abiertas ahora mismo'
            : `${gates.length} ${gates.length === 1 ? 'puerta' : 'puertas'} · unos ${totalEta} min en total`}
        </span>
        <div style={{ flex: 1 }} />
        {gates.length > 0 ? (
          <span className="mono fs-sm muted">
            pulsa{' '}
            {gates.slice(0, 3).map((_, i) => (
              <span key={i}>
                {i > 0 ? ' · ' : ''}
                <b style={{ color: 'var(--fg)' }}>{i + 1}</b>
              </span>
            ))}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'grid', gap: 'var(--gap)', marginBottom: 'var(--sec-gap)' }}>
        {isPending ? <div className="muted fs-sm">Cargando la bandeja</div> : null}
        {!isPending && gates.length === 0 ? (
          <EmptyState title="Nada que decidir">
            La máquina sigue trabajando sola; te avisará aquí cuando haya una puerta que cruzar.
          </EmptyState>
        ) : null}
        {gates.map((gate, i) => (
          <button
            key={`${gate.kind}-${gate.video_id ?? i}`}
            type="button"
            className="gate-card"
            onClick={() => void navigate(gateTarget(gate.kind, gate.video_id))}
          >
            <ThumbPlaceholder width={104} note={gate.kind} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="step-label">{gate.step_label}</span>
                {gate.kind === 'entrega' ? (
                  <Chip kind="ok">Lista para publicar</Chip>
                ) : (
                  <Chip kind="warn">Requiere revisión</Chip>
                )}
              </div>
              <div className="head" style={{ fontSize: 16, lineHeight: 1.25 }}>
                {gate.title}
              </div>
              <div className="muted fs-sm" style={{ lineHeight: 1.45 }}>
                {gate.meta}
              </div>
            </div>
            <div
              style={{
                flex: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 8,
              }}
            >
              <span className="mono fs-sm muted">≈ {gate.eta_min} min</span>
              {i < 3 ? <span className="kbd-block">{i + 1}</span> : null}
            </div>
          </button>
        ))}
      </div>

      <div
        id="en-curso"
        style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 'var(--pad)' }}
      >
        <h2 className="head" style={{ fontSize: 17, margin: 0 }}>
          En curso
        </h2>
        <span className="muted fs-sm">
          la máquina trabaja sola; solo te avisa al cruzar una puerta
        </span>
      </div>

      <div className="card" style={{ overflow: 'hidden', marginBottom: 'var(--sec-gap)' }}>
        {running.length === 0 ? (
          <div className="muted fs-sm" style={{ padding: 'var(--pad)' }}>
            No hay vídeos en producción ahora mismo.
          </div>
        ) : null}
        {running.map((v) => {
          const chip =
            v.incident !== null
              ? { label: 'Incidencia', kind: 'danger' as ChipKind }
              : STATE_CHIP[v.state];
          const liveRender = live.renderProgress[v.video_id];
          const progress =
            v.state === 'render' && liveRender !== undefined ? liveRender : (v.progress ?? null);
          const target = runningTarget(v.state, v.video_id);
          return (
            <div
              key={v.video_id}
              className="row-hover"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: 'calc(var(--pad) * 0.85) var(--pad)',
                borderBottom: '1px solid var(--line)',
                cursor: target !== null ? 'pointer' : 'default',
              }}
              onClick={() => {
                if (target !== null) void navigate(target);
              }}
            >
              <ThumbPlaceholder width={64} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {v.title}
                </div>
                <div
                  className="fs-sm"
                  style={{
                    color: v.incident !== null ? 'var(--danger)' : 'var(--fg2)',
                    marginTop: 3,
                  }}
                >
                  {v.incident !== null
                    ? `${v.incident.message}${v.incident.suggested_action !== null ? ` · acción sugerida: ${v.incident.suggested_action}` : ''}`
                    : v.detail}
                </div>
              </div>
              <Chip kind={chip.kind}>{chip.label}</Chip>
              <div
                style={{ width: 190, flex: 'none', display: 'flex', alignItems: 'center', gap: 10 }}
              >
                <ProgressBar
                  value={progress ?? 0}
                  color={
                    chip.kind === 'ok'
                      ? 'var(--ok)'
                      : chip.kind === 'warn'
                        ? 'var(--warn)'
                        : chip.kind === 'danger'
                          ? 'var(--danger)'
                          : 'var(--accent)'
                  }
                  className="flex-1"
                />
                <span className="mono fs-sm muted" style={{ width: 38, textAlign: 'right' }}>
                  {progress !== null ? `${Math.round(progress)} %` : '—'}
                </span>
              </div>
              <span className="mono fs-sm muted" style={{ width: 52, textAlign: 'right' }}>
                {fmtMoney(v.cost_usd)}
              </span>
            </div>
          );
        })}
      </div>

      <div
        id="publicados"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr',
          gap: 'var(--gap)',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--gap)' }}>
          {done.length === 0 ? (
            <EmptyState title="Nada pendiente de publicar">
              Cuando un vídeo termine de renderizar aparecerá aquí para su último visto bueno. No
              hay nada que hacer ahora mismo.
            </EmptyState>
          ) : (
            done.map((d) => (
              <button
                key={d.video_id}
                type="button"
                className="gate-card"
                onClick={() => void navigate(`/videos/${d.video_id}/entrega`)}
              >
                <ThumbPlaceholder width={104} note="mp4" />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="step-label">Entrega · subir a mano</span>
                    <Chip kind="ok">Lista para publicar</Chip>
                  </div>
                  <div className="head" style={{ fontSize: 16, lineHeight: 1.25 }}>
                    {d.title}
                  </div>
                  <div className="muted fs-sm mono">{d.output_dir}</div>
                </div>
              </button>
            ))
          )}
        </div>
        <div className="card" style={{ padding: 'var(--pad)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <span className="muted fs-sm">Coste del mes</span>
            <span className="mono" style={{ fontSize: 20, fontWeight: 500 }}>
              {fmtMoney(monthCost)}
            </span>
          </div>
          <div
            style={{
              height: 5,
              borderRadius: 999,
              background: 'var(--bg3)',
              overflow: 'hidden',
              marginBottom: 10,
            }}
          >
            <div
              style={{
                width: `${monthBudget > 0 ? Math.min(100, (monthCost / monthBudget) * 100) : 0}%`,
                height: '100%',
                background: 'var(--fg2)',
                opacity: 0.55,
              }}
            />
          </div>
          <div
            className="mono fs-sm muted"
            style={{ display: 'flex', justifyContent: 'space-between' }}
          >
            <span>
              {inbox?.month_videos ?? 0} vídeos
              {inbox !== undefined && inbox.month_videos > 0
                ? ` · ${fmtMoney(perVideo)} cada uno`
                : ''}
            </span>
            <span>límite {fmtMoney(monthBudget)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
