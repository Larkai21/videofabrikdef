import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { COMPONENT_TYPES, type ComponentDto, type ComponentType } from '@fabrica/shared';
import { Button, Chip, EmptyState, type ChipKind } from '../components/ui';
import {
  activateComponent,
  deleteComponent,
  fileUrl,
  getComponents,
  uploadComponent,
} from '../lib/api';
import { useChannel } from '../lib/channel';
import { useLive, type JobNote } from '../lib/events';
import { useHotkeys } from '../lib/hotkeys';
import { useToasts } from '../lib/toasts';

// Brand kit por zips (SPEC §10): lista por tipo con estado, preview y log,
// subida del zip y activación por canal. Los tiempos de validación llegan en
// vivo por SSE (job_progress con video_id = id del componente).

const TYPE_LABELS: Record<ComponentType, string> = {
  intro: 'Intro',
  outro: 'Outro',
  title_card: 'Tarjeta de título',
  lower_third: 'Rótulo',
  subtitle_theme: 'Tema de subtítulos',
  transition: 'Transición',
  thumbnail_template: 'Plantilla de miniatura',
};

const STATUS_CHIP: Record<ComponentDto['status'], { kind: ChipKind; label: string }> = {
  pending: { kind: 'warn', label: 'Pendiente de validar' },
  validated: { kind: 'ok', label: 'Validado' },
  failed: { kind: 'danger', label: 'Fallido' },
};

interface ComponentCardProps {
  component: ComponentDto;
  note?: JobNote;
  busy: boolean;
  onActivate: (id: string) => void;
  onDelete: (id: string) => void;
}

function ComponentCard({ component: c, note, busy, onActivate, onDelete }: ComponentCardProps) {
  const status = STATUS_CHIP[c.status];
  const showNote = c.status === 'pending' && note !== undefined && note.queue === 'components';
  return (
    <div className="card" style={{ padding: 'var(--pad)', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 'var(--fs-sm)' }}>
          {c.name}@{c.version}
        </span>
        <Chip kind={status.kind}>{status.label}</Chip>
        {c.active ? <Chip kind="ok">Activo</Chip> : null}
      </div>

      {showNote ? (
        <div className="muted fs-sm">{note.detail ?? `Validando (${note.progress} %)`}</div>
      ) : null}

      {c.preview_url !== null ? (
        <img
          src={fileUrl(c.preview_url)}
          alt={`Preview de ${c.name}@${c.version}`}
          style={{
            width: '100%',
            maxWidth: 420,
            aspectRatio: '16 / 9',
            objectFit: 'cover',
            borderRadius: 'var(--r)',
            border: '1px solid var(--line)',
            background: 'var(--bg2)',
          }}
        />
      ) : null}

      {c.log !== null ? (
        <details open={c.status === 'failed'}>
          <summary className="muted fs-sm" style={{ cursor: 'pointer' }}>
            {c.status === 'failed' ? 'Log del fallo' : 'Log de la validación'}
          </summary>
          <pre
            className="mono"
            style={{
              margin: '8px 0 0',
              padding: 10,
              fontSize: 11.5,
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              maxHeight: 260,
              overflow: 'auto',
              background: 'var(--bg2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r)',
            }}
          >
            {c.log}
          </pre>
        </details>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {c.status === 'validated' && !c.active ? (
          <Button variant="primary" disabled={busy} onClick={() => onActivate(c.id)}>
            Activar
          </Button>
        ) : null}
        {!c.active ? (
          <Button variant="danger-ghost" disabled={busy} onClick={() => onDelete(c.id)}>
            Quitar
          </Button>
        ) : (
          <span className="muted fs-sm" style={{ alignSelf: 'center' }}>
            En uso en los vídeos nuevos del canal
          </span>
        )}
      </div>
    </div>
  );
}

export function Componentes() {
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // el canal activo viene del contexto multicanal (antes se asumía channels[0])
  const {
    activeChannel: channel,
    activeChannelId: channelId,
    isPending: channelsPending,
    isError: channelsError,
    refetch: refetchChannels,
  } = useChannel();

  // EventsProvider invalida el prefijo ['componentes'] con el SSE inbox_changed
  // (que el worker publica al terminar la validación) y con job_progress de la
  // cola components al llegar al 100 %: la lista se refresca en vivo
  const componentsQ = useQuery({
    queryKey: ['componentes', channelId],
    queryFn: () => getComponents(channelId as string),
    enabled: channelId !== null,
  });

  const { jobNotes } = useLive();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['componentes'] });

  const uploadMut = useMutation({
    mutationFn: (file: File) => uploadComponent({ file, channelId: channelId as string }),
    onMutate: () => setUploading(true),
    onSettled: () => setUploading(false),
    onSuccess: () => {
      void invalidate();
      push('Zip subido; validación en marcha');
    },
    onError: (err) => push(err instanceof Error ? err.message : 'No se pudo subir el zip', 'danger'),
  });

  const activateMut = useMutation({
    mutationFn: activateComponent,
    onSuccess: () => {
      void invalidate();
      push('Componente activado para el canal');
    },
    onError: (err) =>
      push(err instanceof Error ? err.message : 'No se pudo activar el componente', 'danger'),
  });

  const deleteMut = useMutation({
    mutationFn: deleteComponent,
    onSuccess: () => {
      void invalidate();
      push('Componente eliminado');
    },
    onError: (err) =>
      push(err instanceof Error ? err.message : 'No se pudo eliminar el componente', 'danger'),
  });

  useHotkeys((e) => {
    if (e.key === 's' && channelId !== null && !uploading) {
      e.preventDefault();
      fileRef.current?.click();
    }
  });

  const onFileChosen = (files: FileList | null) => {
    const file = files?.[0];
    if (file !== undefined && channelId !== null) uploadMut.mutate(file);
    if (fileRef.current !== null) fileRef.current.value = '';
  };

  const busy = activateMut.isPending || deleteMut.isPending;
  const componentsByType = new Map<ComponentType, ComponentDto[]>();
  for (const c of componentsQ.data ?? []) {
    const type = c.type as ComponentType;
    const list = componentsByType.get(type) ?? [];
    list.push(c);
    componentsByType.set(type, list);
  }

  return (
    <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px 72px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 'var(--sec-gap)',
        }}
      >
        <h1 className="head" style={{ fontSize: 26, letterSpacing: '-0.02em', margin: 0 }}>
          Brand kit
        </h1>
        <div style={{ flex: 1 }} />
        <input
          ref={fileRef}
          type="file"
          accept=".zip,application/zip"
          style={{ display: 'none' }}
          onChange={(e) => onFileChosen(e.target.files)}
        />
        <Button
          variant="primary"
          kbd="s"
          disabled={channelId === null || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Subiendo el zip' : 'Subir zip'}
        </Button>
      </div>

      {/* nota fija: restricciones del contrato del zip */}
      <div
        className="card"
        style={{ padding: 'var(--pad)', marginBottom: 'var(--sec-gap)', display: 'grid', gap: 6 }}
      >
        <div className="head" style={{ fontSize: 14 }}>
          Contrato del zip
        </div>
        <p className="muted fs-sm" style={{ margin: 0, lineHeight: 1.55 }}>
          manifest.json (v1) + Component.tsx con export default + schema.ts con export default
          z.object + assets/. Restricciones de render: animar solo con useCurrentFrame, sin fetch
          durante el render, sin aleatoriedad sin semilla y fuentes empaquetadas en el zip o pila
          del sistema. La validación compila el componente, comprueba el contrato de props de su
          tipo y hace un render de humo de 60 frames antes de dejarlo activable. Nota: el render
          usa el componente nuevo de inmediato; la previsualización del dashboard compilado lo
          incorpora en el siguiente build (en desarrollo se recarga sola).
        </p>
      </div>

      {channelsPending || (channelId !== null && componentsQ.isPending) ? (
        <div className="muted fs-sm">Cargando el brand kit</div>
      ) : null}

      {channelsError ? (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="banner banner-danger">No se pudieron cargar los canales.</div>
          <div>
            <Button variant="secondary" onClick={refetchChannels}>
              Reintentar
            </Button>
          </div>
        </div>
      ) : null}

      {!channelsPending && !channelsError && channel === undefined ? (
        <EmptyState title="Todavía no hay canal">
          Crea el canal con el wizard para poder subir componentes del brand kit.
        </EmptyState>
      ) : null}

      {componentsQ.data !== undefined && componentsQ.data.length === 0 ? (
        <EmptyState title="Sin componentes todavía">
          Genera un zip de plantilla con scripts/make-example-component.ts de packages/video y
          súbelo aquí para probar el ciclo completo.
        </EmptyState>
      ) : null}

      <div style={{ display: 'grid', gap: 'var(--sec-gap)' }}>
        {COMPONENT_TYPES.map((type) => {
          const list = componentsByType.get(type);
          if (list === undefined || list.length === 0) return null;
          return (
            <section key={type}>
              <h2 className="head" style={{ fontSize: 16, margin: '0 0 10px' }}>
                {TYPE_LABELS[type]}
              </h2>
              <div style={{ display: 'grid', gap: 'var(--gap)' }}>
                {list.map((c) => (
                  <ComponentCard
                    key={c.id}
                    component={c}
                    note={jobNotes[c.id]}
                    busy={busy}
                    onActivate={(id) => activateMut.mutate(id)}
                    onDelete={(id) => deleteMut.mutate(id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
