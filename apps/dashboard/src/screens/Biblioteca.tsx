import type { LibraryAssetDto } from '@fabrica/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Button,
  Chip,
  EmptyState,
  ProgressBar,
  ReasonModal,
  ThumbPlaceholder,
  type Motivo,
} from '../components/ui';
import { ApiError, deleteAsset, fileUrl, getLibrary, requestBackfill } from '../lib/api';
import { useChannel } from '../lib/channel';
import { useLive } from '../lib/events';
import { fmtClock } from '../lib/format';
import { useDebounced, useHotkeys } from '../lib/hotkeys';
import { useToasts } from '../lib/toasts';

// Biblioteca etiquetada (SPEC §11): todo asset con caption, tags y procedencia,
// buscable, y con purga controlada (borrado siempre manual y con motivo).

const PAGE = 60;

const KINDS: { id: string; label: string }[] = [
  { id: '', label: 'Todos' },
  { id: 'clip', label: 'Clips' },
  { id: 'image', label: 'Imágenes' },
  { id: 'screenshot', label: 'Capturas' },
  { id: 'upload', label: 'Subidas' },
  { id: 'music', label: 'Música' },
];

const KIND_LABELS: Record<string, string> = {
  clip: 'Clip',
  image: 'Imagen',
  screenshot: 'Captura',
  upload: 'Subida',
  music: 'Música',
};

const MOTIVOS_PURGA: Motivo[] = [
  { id: 'sin-uso', label: 'Sin uso en 90 días y sin referencias' },
  { id: 'calidad', label: 'Calidad insuficiente para el canal' },
  { id: 'duplicado', label: 'Duplicado de otro asset de la biblioteca' },
];

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function AssetCard({ asset, onOpen }: { asset: LibraryAssetDto; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="card row-hover"
      onClick={onOpen}
      style={{
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      {asset.thumb_url !== null ? (
        <img
          src={fileUrl(asset.thumb_url)}
          alt={asset.caption ?? 'Asset de la biblioteca'}
          loading="lazy"
          style={{
            width: '100%',
            aspectRatio: '16 / 9',
            objectFit: 'cover',
            borderRadius: 'var(--r-sm)',
            border: '1px solid var(--line)',
            display: 'block',
          }}
        />
      ) : (
        <ThumbPlaceholder width="100%" note={kindLabel(asset.kind)} />
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Chip kind="neutral">{kindLabel(asset.kind)}</Chip>
        {asset.kind === 'clip' && asset.duration_ms !== null ? (
          <span className="mono fs-sm muted">{fmtClock(asset.duration_ms)}</span>
        ) : null}
        {asset.purge_candidate ? <Chip kind="warn">purga</Chip> : null}
      </div>
      {asset.tags.length > 0 ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {asset.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--fg2)',
                border: '1px solid var(--line)',
                borderRadius: 999,
                padding: '2px 7px',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg2)' }}>
        {asset.source} · {asset.license}
      </span>
    </button>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
      <span className="step-label" style={{ flex: 'none', width: 110 }}>
        {label}
      </span>
      <span className="fs-sm" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {children}
      </span>
    </div>
  );
}

function AssetDetail({
  asset,
  onClose,
  onAskDelete,
}: {
  asset: LibraryAssetDto;
  onClose: () => void;
  onAskDelete: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-label="Detalle del asset"
        style={{ width: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: 'var(--pad)', borderBottom: '1px solid var(--line)' }}>
          <div className="head" style={{ fontSize: 16, lineHeight: 1.4 }}>
            {asset.caption ?? 'Asset sin caption todavía'}
          </div>
          <div className="mono fs-sm muted" style={{ marginTop: 4 }}>
            {asset.source} · {asset.license}
          </div>
        </div>
        <div
          style={{
            padding: 'var(--pad)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            maxHeight: '60vh',
            overflowY: 'auto',
          }}
        >
          {asset.thumb_url !== null ? (
            <img
              src={fileUrl(asset.thumb_url)}
              alt={asset.caption ?? 'Asset de la biblioteca'}
              style={{
                width: '100%',
                aspectRatio: '16 / 9',
                objectFit: 'cover',
                borderRadius: 'var(--r-sm)',
                border: '1px solid var(--line)',
              }}
            />
          ) : (
            <ThumbPlaceholder width="100%" note={kindLabel(asset.kind)} />
          )}
          <DetailRow label="Tipo">
            {kindLabel(asset.kind)}
            {asset.width !== null && asset.height !== null
              ? ` · ${asset.width}×${asset.height}`
              : ''}
            {asset.duration_ms !== null ? ` · ${fmtClock(asset.duration_ms)}` : ''}
          </DetailRow>
          {asset.origin_query !== null ? (
            <DetailRow label="Búsqueda origen">
              <span className="mono">{asset.origin_query}</span>
            </DetailRow>
          ) : null}
          <DetailRow label="Usos">
            {asset.times_used === 0 ? 'Sin usos todavía' : `${asset.times_used} usos`}
            {asset.last_video_id !== null ? (
              <span className="mono muted"> · último vídeo {asset.last_video_id}</span>
            ) : null}
          </DetailRow>
          <DetailRow label="Añadido">
            {new Date(asset.created_at).toLocaleDateString('es-ES', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </DetailRow>
          <DetailRow label="Archivo">
            <a href={fileUrl(asset.url)} target="_blank" rel="noreferrer">
              Abrir el archivo original
            </a>
          </DetailRow>
          {asset.tags.length > 0 ? (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
              {asset.tags.map((tag) => (
                <span
                  key={tag}
                  className="mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--fg2)',
                    border: '1px solid var(--line)',
                    borderRadius: 999,
                    padding: '2px 7px',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div
          style={{
            padding: 'var(--pad)',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          {asset.purge_candidate ? (
            <Button variant="danger" onClick={onAskDelete}>
              Borrar de la biblioteca
            </Button>
          ) : (
            <span className="muted fs-sm">
              Solo los candidatos a purga se pueden borrar desde aquí.
            </span>
          )}
          <div style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Biblioteca() {
  const { push } = useToasts();
  const queryClient = useQueryClient();
  const { jobNotes } = useLive();
  const { activeChannelId } = useChannel();

  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [purgeOnly, setPurgeOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<LibraryAssetDto | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const q = useDebounced(search.trim(), 300);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['library', activeChannelId, kind, q, purgeOnly, limit],
    queryFn: () =>
      getLibrary({
        ...(activeChannelId !== null ? { channel: activeChannelId } : {}),
        ...(kind !== '' ? { kind } : {}),
        ...(q !== '' ? { q } : {}),
        ...(purgeOnly ? { purge: true } : {}),
        limit,
      }),
    placeholderData: (prev) => prev,
    enabled: activeChannelId !== null,
  });

  const backfillMut = useMutation({
    mutationFn: requestBackfill,
    onSuccess: () => push('Etiquetado en marcha · el progreso aparece arriba'),
    onError: () => push('No se pudo encolar el etiquetado', 'danger'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteAsset(id),
    onSuccess: () => {
      push('Asset borrado de la biblioteca');
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    },
    onError: (err) =>
      push(
        err instanceof ApiError && err.status === 409
          ? 'No se puede borrar: el asset está en uso'
          : 'No se pudo borrar el asset',
        'danger',
      ),
  });

  // progreso del backfill vía SSE: los workers lo emiten con video_id 'library'
  const note = jobNotes['library'];
  const backfillNote = note !== undefined && note.queue === 'library' ? note : undefined;
  const backfillRunning = backfillNote !== undefined && backfillNote.progress < 100;

  const lastProgress = useRef(0);
  useEffect(() => {
    const progress = backfillNote?.progress ?? 0;
    if (progress >= 100 && lastProgress.current > 0 && lastProgress.current < 100) {
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    }
    lastProgress.current = progress;
  }, [backfillNote?.progress, queryClient]);

  useHotkeys((e) => {
    if (selected !== null || confirmingDelete) return;
    if (e.key === '/') {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (e.key === 'e' && !backfillRunning && !backfillMut.isPending) {
      backfillMut.mutate();
    } else if (e.key === 'p') {
      setPurgeOnly((v) => !v);
      setLimit(PAGE);
    }
  });

  const assets = data?.assets ?? [];
  const total = data?.total ?? 0;
  const hasFilters = kind !== '' || q !== '' || purgeOnly;

  return (
    <div>
      <div className="subbar">
        <div className="wrap-1320 subbar-inner">
          <span className="head" style={{ fontSize: 15 }}>
            Biblioteca
          </span>
          <span className="mono fs-sm muted">
            {total} {total === 1 ? 'asset' : 'assets'}
          </span>
          <div style={{ flex: 1 }} />
          {backfillRunning ? (
            <span
              style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 260 }}
              aria-live="polite"
            >
              <span style={{ flex: 1, minWidth: 120 }}>
                <ProgressBar value={backfillNote?.progress ?? 0} height={5} />
              </span>
              <span className="mono fs-sm muted" style={{ whiteSpace: 'nowrap' }}>
                {backfillNote?.detail ?? 'Etiquetando la biblioteca'}
              </span>
            </span>
          ) : (
            <Button
              variant="secondary"
              kbd="E"
              disabled={backfillMut.isPending}
              onClick={() => backfillMut.mutate()}
            >
              Completar etiquetado
            </Button>
          )}
        </div>
      </div>

      <div className="wrap-1320" style={{ padding: 'calc(var(--pad) * 1.6) 26px 72px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 'var(--gap)',
          }}
        >
          <div className="seg-group" role="group" aria-label="Filtrar por tipo">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className="seg-btn"
                aria-pressed={kind === k.id}
                onClick={() => {
                  setKind(k.id);
                  setLimit(PAGE);
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
          <div className="input-wrap" style={{ width: 300 }}>
            <input
              ref={searchRef}
              value={search}
              placeholder="Buscar por tags, caption o consulta"
              aria-label="Buscar en la biblioteca"
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(PAGE);
              }}
            />
            <span className="kbd" aria-hidden="true">
              /
            </span>
          </div>
          <button
            type="button"
            className={purgeOnly ? 'chip chip-warn' : 'chip chip-neutral'}
            aria-pressed={purgeOnly}
            style={{ cursor: 'pointer' }}
            onClick={() => {
              setPurgeOnly((v) => !v);
              setLimit(PAGE);
            }}
          >
            Candidatos a purga
            <span className="kbd" aria-hidden="true">
              P
            </span>
          </button>
        </div>

        {isPending ? <div className="muted fs-sm">Cargando la biblioteca</div> : null}

        {isError ? (
          <div
            className="banner banner-danger"
            style={{ display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <span style={{ flex: 1 }}>No se pudo cargar la biblioteca.</span>
            <Button variant="secondary" onClick={() => void refetch()}>
              Reintentar
            </Button>
          </div>
        ) : null}

        {!isPending && !isError && assets.length === 0 ? (
          purgeOnly ? (
            <EmptyState title="Sin candidatos a purga">
              Nada lleva 90 días sin usarse. La biblioteca está sana.
            </EmptyState>
          ) : hasFilters ? (
            <EmptyState title="Sin resultados con estos filtros">
              Prueba con otro tipo o con menos texto en la búsqueda.
            </EmptyState>
          ) : (
            <EmptyState title="Biblioteca vacía">
              Cada vídeo aprobado deja aquí sus clips e imágenes, etiquetados y listos para
              reutilizarse en los siguientes.
            </EmptyState>
          )
        ) : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 'var(--gap)',
          }}
        >
          {assets.map((asset) => (
            <AssetCard key={asset.id} asset={asset} onOpen={() => setSelected(asset)} />
          ))}
        </div>

        {assets.length < total ? (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--gap)' }}>
            <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
              Mostrar más ({assets.length} de {total})
            </Button>
          </div>
        ) : null}
      </div>

      {selected !== null ? (
        <AssetDetail
          asset={selected}
          onClose={() => setSelected(null)}
          onAskDelete={() => setConfirmingDelete(true)}
        />
      ) : null}

      <ReasonModal
        open={confirmingDelete}
        title="Borrar el asset de la biblioteca"
        desc="Se elimina el archivo y su ficha. Esta acción no se puede deshacer."
        motivos={MOTIVOS_PURGA}
        cta="Borrar el asset"
        onConfirm={() => {
          if (selected !== null) deleteMut.mutate(selected.id);
          setConfirmingDelete(false);
        }}
        onClose={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
