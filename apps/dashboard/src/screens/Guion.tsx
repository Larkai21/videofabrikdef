import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Chip, CostBadge, Kbd, ReasonModal, type Motivo } from '../components/ui';
import { approveScript, chooseTitle, getChannel, getVideo, putScript, requestRewrite } from '../lib/api';
import { useLive } from '../lib/events';
import { fmtClock, fmtMoney, sceneOffsets, speechMs, wordCount } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useToasts } from '../lib/toasts';
import { marginNotes } from '../lib/warnings';

// Motivos de reescritura, copiados del mock.
const MOTIVOS_REESCRITURA: Motivo[] = [
  { id: 'largo', label: 'Demasiado largo para ocho minutos' },
  { id: 'tono', label: 'El tono se va a la hipérbole' },
  { id: 'fuente', label: 'Faltan fuentes en los datos marcados' },
  { id: 'entrada', label: 'La entradilla tarda en llegar al grano' },
];

function titleNote(t: string): string {
  if (t.length <= 45) return 'directo, bien para resultados';
  if (t.length <= 60) return 'longitud correcta';
  return 'puede cortarse en resultados';
}

export function Guion() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const live = useLive();

  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [rewriteOpen, setRewriteOpen] = useState(false);

  const videoQ = useQuery({ queryKey: ['video', id], queryFn: () => getVideo(id), enabled: id !== '' });
  const video = videoQ.data;
  const master = video?.master;

  const channelQ = useQuery({
    queryKey: ['channel', video?.channel_id],
    queryFn: () => getChannel(video?.channel_id as string),
    enabled: video !== undefined,
  });

  const invalidateVideo = () => {
    void queryClient.invalidateQueries({ queryKey: ['video', id] });
    void queryClient.invalidateQueries({ queryKey: ['inbox'] });
  };

  const titleMut = useMutation({
    mutationFn: (idx: number) => chooseTitle(id, idx),
    onSuccess: invalidateVideo,
    onError: () => push('No se pudo elegir el título', 'danger'),
  });

  const scriptMut = useMutation({
    mutationFn: (args: { sceneId: string; text: string }) =>
      putScript(id, { scenes: [{ id: args.sceneId, text: args.text }] }),
    onSuccess: () => {
      invalidateVideo();
      push('Escena guardada · marcada como editada por ti');
    },
    onError: () => push('No se pudo guardar la escena', 'danger'),
  });

  const approveMut = useMutation({
    mutationFn: () => approveScript(id),
    onSuccess: () => {
      invalidateVideo();
      push('Guion y título aprobados · la voz se está generando');
      void navigate('/');
    },
    onError: (err) => push(err instanceof Error ? err.message : 'No se pudo aprobar', 'danger'),
  });

  const rewriteMut = useMutation({
    mutationFn: (reason: string) => requestRewrite(id, reason),
    onSuccess: () => {
      invalidateVideo();
      push('Reescritura pedida · te avisamos cuando llegue el nuevo borrador');
      void navigate('/');
    },
    onError: () => push('No se pudo pedir la reescritura', 'danger'),
  });

  const scenes = master?.script?.scenes ?? [];
  const seo = master?.seo;
  const research = master?.research;
  const chosenIdx = seo?.chosen_idx ?? null;
  const canApprove =
    video?.state === 'guion_borrador' && chosenIdx !== null && !approveMut.isPending;

  useHotkeys((e) => {
    const k = e.key.toLowerCase();
    if (k === 'a' && canApprove) {
      e.preventDefault();
      approveMut.mutate();
    } else if (k === 'r' && video?.state === 'guion_borrador') {
      e.preventDefault();
      setRewriteOpen(true);
    } else if (['1', '2', '3'].includes(k) && seo !== undefined) {
      e.preventDefault();
      titleMut.mutate(Number(k) - 1);
    }
  });

  if (videoQ.isPending) {
    return (
      <div className="wrap-1320" style={{ padding: 'calc(var(--pad) * 2) 26px' }}>
        <div className="muted fs-sm">Cargando el guion</div>
      </div>
    );
  }

  if (video === undefined || master === undefined) {
    return (
      <div className="wrap-1320" style={{ padding: 'calc(var(--pad) * 2) 26px' }}>
        <div className="banner banner-danger">No se pudo cargar el vídeo.</div>
      </div>
    );
  }

  const words = scenes.reduce((acc, s) => acc + wordCount(s.text), 0);
  const estMs = speechMs(words);
  const offsets = sceneOffsets(scenes.map((s) => s.text));
  const notes = marginNotes(scenes, research?.claims ?? []);
  const citedSources = new Set((research?.claims ?? []).map((c) => c.source_idx)).size;
  const totalSources = research?.sources.length ?? 0;
  const tone = channelQ.data?.profile?.identity.tone.join(', ') ?? '—';

  const jobNote = live.jobNotes[id];
  const misaligned =
    jobNote !== undefined &&
    jobNote.queue.includes('script') &&
    jobNote.detail !== undefined &&
    /misalign|alinea/i.test(jobNote.detail);

  const chosenTitle =
    chosenIdx !== null ? (seo?.titles[chosenIdx] ?? '') : (seo?.titles[0] ?? 'Sin título todavía');

  return (
    <div>
      <div className="subbar">
        <div className="wrap-1320 subbar-inner">
          <Button variant="secondary" onClick={() => void navigate('/')}>
            ← Bandeja
          </Button>
          <span className="head" style={{ fontSize: 15, whiteSpace: 'nowrap' }}>
            Guion · borrador
          </span>
          <Chip kind="warn">Puerta 2 de 3</Chip>
          <div style={{ flex: 1 }} />
          <span className="mono fs-sm muted" style={{ whiteSpace: 'nowrap' }}>
            {words.toLocaleString('es-ES')} palabras · {fmtClock(estMs)} de locución estimada ·{' '}
            {scenes.length} escenas
          </span>
          <CostBadge>{fmtMoney(video.costs_total)}</CostBadge>
        </div>
      </div>

      <div
        className="wrap-1320"
        style={{
          padding: 'calc(var(--pad) * 1.6) 26px 70px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 380px',
          gap: 'calc(var(--gap) * 1.8)',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--gap)' }}>
          {video.incident !== null ? (
            <div className="banner banner-danger">
              {video.incident.message}
              {video.incident.suggested_action !== null
                ? ` · acción sugerida: ${video.incident.suggested_action}`
                : ''}
            </div>
          ) : null}
          {misaligned && jobNote !== undefined ? (
            <div className="banner">
              El juez de alineación ve divergencia entre el título elegido y el guion.{' '}
              {jobNote.detail}
            </div>
          ) : null}

          <article
            className="card"
            style={{ padding: 'calc(var(--pad) * 1.8) calc(var(--pad) * 2)' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 'calc(var(--pad) * 1.2)',
                paddingBottom: 12,
                borderBottom: '1px solid var(--line)',
              }}
            >
              <span className="step-label">Solo lectura · doble clic edita una escena</span>
              <div style={{ flex: 1 }} />
              {notes.size > 0 ? (
                <span className="mono fs-sm" style={{ color: 'var(--warn)' }}>
                  {notes.size} {notes.size === 1 ? 'aviso' : 'avisos'} en el margen
                </span>
              ) : null}
            </div>

            <h1
              className="head"
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 30,
                lineHeight: 1.15,
                letterSpacing: '-0.025em',
                margin: '0 0 6px',
                maxWidth: '22ch',
              }}
            >
              {chosenTitle}
            </h1>
            <div className="mono fs-sm muted" style={{ marginBottom: 'calc(var(--pad) * 1.6)' }}>
              {chosenIdx !== null
                ? 'título elegido · lo cambias en el panel de la derecha'
                : 'sin título elegido · elígelo en el panel de la derecha'}
            </div>

            {scenes.map((scene, i) => {
              const note = notes.get(scene.id);
              const isEditing = editing !== null && editing.id === scene.id;
              return (
                <div
                  key={scene.id}
                  style={{
                    display: 'flex',
                    gap: 16,
                    alignItems: 'flex-start',
                    marginBottom: 'calc(var(--pad) * 1.15)',
                  }}
                >
                  <div
                    className="mono"
                    style={{
                      width: 88,
                      flex: 'none',
                      paddingTop: 5,
                      fontSize: 10.5,
                      color: 'var(--fg2)',
                      lineHeight: 1.5,
                    }}
                  >
                    Escena {i + 1}
                    <br />
                    <span style={{ opacity: 0.7 }}>{fmtClock(offsets[i] ?? 0)}</span>
                    {scene.section === 'hook' ? (
                      <>
                        <br />
                        <span style={{ opacity: 0.7 }}>gancho</span>
                      </>
                    ) : null}
                    {scene.section === 'cta' ? (
                      <>
                        <br />
                        <span style={{ opacity: 0.7 }}>cierre</span>
                      </>
                    ) : null}
                    {scene.edited_by_human === true ? (
                      <>
                        <br />
                        <span style={{ color: 'var(--accent)' }}>editado por ti</span>
                      </>
                    ) : null}
                  </div>

                  {isEditing ? (
                    <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 8 }}>
                      <textarea
                        className="control"
                        rows={4}
                        autoFocus
                        value={editing.text}
                        onChange={(e) => setEditing({ id: scene.id, text: e.target.value })}
                        style={{ fontFamily: 'var(--font-serif)', fontSize: 16.5, lineHeight: 1.7 }}
                        aria-label={`Editar la escena ${i + 1}`}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                          variant="primary"
                          disabled={scriptMut.isPending}
                          onClick={() => {
                            scriptMut.mutate({ sceneId: scene.id, text: editing.text });
                            setEditing(null);
                          }}
                        >
                          Guardar la escena
                        </Button>
                        <Button variant="ghost" onClick={() => setEditing(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p
                      className="doc-text"
                      style={{ flex: 1, minWidth: 0 }}
                      onDoubleClick={() => {
                        if (video.state === 'guion_borrador') {
                          setEditing({ id: scene.id, text: scene.text });
                        }
                      }}
                      title="Doble clic para editar esta escena"
                    >
                      {scene.text}
                    </p>
                  )}

                  {note !== undefined && !isEditing ? (
                    <div
                      style={{
                        width: 150,
                        flex: 'none',
                        fontSize: 11.5,
                        lineHeight: 1.45,
                        color: 'var(--warn)',
                        borderLeft: '2px solid var(--warn)',
                        paddingLeft: 9,
                        marginTop: 4,
                      }}
                    >
                      {note}
                    </div>
                  ) : null}
                </div>
              );
            })}

            <div
              style={{
                marginTop: 'calc(var(--pad) * 1.6)',
                paddingTop: 14,
                borderTop: '1px solid var(--line)',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
              className="muted fs-sm"
            >
              <span>
                {scenes.length} escenas · el documento se aprueba entero, los cortes los fija el
                audio después
              </span>
            </div>
          </article>
        </div>

        <aside
          style={{
            position: 'sticky',
            top: 'calc(var(--row) * 2 + 18px)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--gap)',
          }}
        >
          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <span className="head" style={{ fontSize: 16 }}>
                Elige un título
              </span>
              <span className="mono muted" style={{ fontSize: 11 }}>
                1 · 2 · 3
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }} role="radiogroup" aria-label="Título">
              {(seo?.titles ?? []).map((t, i) => {
                const active = chosenIdx === i;
                return (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => titleMut.mutate(i)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 7,
                      width: '100%',
                      textAlign: 'left',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                      background: active
                        ? 'color-mix(in oklab, var(--accent) 8%, var(--bg2))'
                        : 'var(--bg2)',
                      borderRadius: 'var(--r-sm)',
                      padding: '11px 12px',
                      transition: 'border-color .12s',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span
                        className="motivo-dot"
                        style={{
                          marginTop: 4,
                          borderColor: active ? 'var(--accent)' : 'var(--line)',
                          boxShadow: active ? 'inset 0 0 0 3px var(--accent)' : 'none',
                        }}
                        aria-hidden="true"
                      />
                      <span
                        className="head"
                        style={{ flex: 1, fontSize: 15, lineHeight: 1.3 }}
                      >
                        {t}
                      </span>
                    </div>
                    <div
                      className="mono muted"
                      style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: 22, fontSize: 10.5 }}
                    >
                      <span>{t.length} caracteres</span>
                      <span>·</span>
                      <span>{titleNote(t)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className="card"
            style={{ padding: 'var(--pad)', display: 'flex', flexDirection: 'column', gap: 9 }}
          >
            <div className="fs-sm" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">Tono detectado</span>
              <span>{tone}</span>
            </div>
            <div className="fs-sm" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">Fuentes citadas</span>
              <span className="mono">
                {citedSources} de {totalSources}
              </span>
            </div>
            <div className="fs-sm" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">Duración estimada</span>
              <span className="mono">{fmtClock(estMs)}</span>
            </div>
            <Button
              variant="primary"
              kbd="a"
              disabled={!canApprove}
              onClick={() => approveMut.mutate()}
              style={{ marginTop: 5, height: 40 }}
            >
              Aprobar guion y título
            </Button>
            <Button
              variant="secondary"
              kbd="r"
              disabled={video.state !== 'guion_borrador'}
              onClick={() => setRewriteOpen(true)}
            >
              Pedir reescritura
            </Button>
            <div className="mono muted" style={{ fontSize: 11, lineHeight: 1.6, paddingTop: 4 }}>
              <Kbd>a</Kbd> aprobar · <Kbd>r</Kbd> reescribir · <Kbd>1 2 3</Kbd> elegir título
            </div>
          </div>
        </aside>
      </div>

      <ReasonModal
        open={rewriteOpen}
        title="Pedir una reescritura del guion"
        desc="La máquina reescribe el borrador con tu motivo y te avisa. Tú no editas el texto."
        motivos={MOTIVOS_REESCRITURA}
        cta="Pedir reescritura"
        onConfirm={(reason) => {
          setRewriteOpen(false);
          rewriteMut.mutate(reason);
        }}
        onClose={() => setRewriteOpen(false)}
      />
    </div>
  );
}
