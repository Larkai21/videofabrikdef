import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Chip, CostBadge } from '../components/ui';
import { fileUrl, getChannel, getInbox, getVideo } from '../lib/api';
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

// Nombres de fichero según docs/render.md (video.mp4) y convención de miniaturas.
const THUMB_NAMES = ['thumb_a.jpg', 'thumb_b.jpg'];

export function Entrega() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { push } = useToasts();

  const videoQ = useQuery({ queryKey: ['video', id], queryFn: () => getVideo(id), enabled: id !== '' });
  const inboxQ = useQuery({ queryKey: ['inbox'], queryFn: getInbox });

  const video = videoQ.data;
  const master = video?.master;
  const channelQ = useQuery({
    queryKey: ['channel', video?.channel_id],
    queryFn: () => getChannel(video?.channel_id as string),
    enabled: video !== undefined,
  });

  const [checked, setChecked] = useState<Record<string, boolean>>({});

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
  const title = video.title_chosen ?? (seo !== undefined ? (seo.titles[seo.chosen_idx ?? 0] ?? '') : '');
  const description = seo?.description ?? '';
  const tags = (seo?.tags ?? []).join(', ');
  const aiDisclosure = channelQ.data?.profile?.flags.ai_disclosure === true;

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
          <span className="head" style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
        className="wrap-1160"
        style={{
          padding: 'calc(var(--pad) * 1.6) 26px 72px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 380px',
          gap: 'calc(var(--gap) * 1.8)',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 'var(--gap)' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            {/* El worker de render escribe outputs/<id>/video.mp4 (docs/render.md) */}
            <video
              controls
              src={fileUrl(`${relativeDir}/video.mp4`)}
              style={{ width: '100%', aspectRatio: '16 / 9', display: 'block', background: '#000' }}
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

          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div className="step-label" style={{ marginBottom: 10 }}>
              Miniaturas · elige A o B
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--gap)' }}>
              {THUMB_NAMES.map((name, i) => (
                <figure key={name} style={{ margin: 0 }}>
                  <img
                    src={fileUrl(`${relativeDir}/${name}`)}
                    alt={`Miniatura ${i === 0 ? 'A' : 'B'}`}
                    style={{
                      width: '100%',
                      aspectRatio: '16 / 9',
                      objectFit: 'cover',
                      borderRadius: 'var(--r-sm)',
                      border: '1px solid var(--line)',
                      background: 'var(--bg3)',
                    }}
                    onError={(e) => {
                      e.currentTarget.style.opacity = '0.25';
                    }}
                  />
                  <figcaption className="mono fs-sm muted" style={{ marginTop: 6 }}>
                    Miniatura {i === 0 ? 'A' : 'B'}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>

        <aside style={{ display: 'grid', gap: 'var(--gap)', position: 'sticky', top: 'calc(var(--row) * 2 + 18px)' }}>
          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div className="head" style={{ fontSize: 16, marginBottom: 10 }}>
              Checklist de subida manual
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {checklist.map((item) => (
                <label
                  key={item.id}
                  className="fs-sm"
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, lineHeight: 1.5, cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={checked[item.id] === true}
                    onChange={(e) => setChecked((prev) => ({ ...prev, [item.id]: e.target.checked }))}
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
              El MVP no toca la API de YouTube: la subida es manual y tarda unos dos minutos.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
