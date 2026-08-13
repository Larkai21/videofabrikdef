import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { CostsDto } from '@fabrica/shared';
import { EmptyState, SkeletonRows } from '../components/ui';
import { getCosts } from '../lib/api';
import { useChannel } from '../lib/channel';

// Panel de costes (SPEC §12): desglose del ledger por proveedor y por operación
// del canal activo y mes elegido. Los datos ya viven en cost_ledger; aquí solo
// se leen. Coste realizado (status complete).

// USD con más precisión para importes pequeños (muchas llamadas cuestan céntimos)
function usd(n: number): string {
  if (n >= 1) return `${n.toFixed(2)} $`;
  if (n >= 0.01) return `${n.toFixed(3)} $`;
  return `${n.toFixed(4)} $`;
}

const OP_LABELS: Record<string, string> = {
  script: 'Guion',
  judge: 'Juez del guion',
  refine: 'Ajuste del guion',
  research: 'Research',
  idea_writeup: 'Redacción de ideas',
  profile_synthesis: 'Síntesis de perfil',
  broll_director: 'Director de b-roll',
  broll_rerank: 'Juez de planos',
  broll_requery: 'Re-consulta del juez',
  packaging: 'Paquete SEO',
  shorts_director: 'Director de shorts',
  chapter_director: 'Director de capítulos',
  editing_director: 'Director de edición',
  vlm_caption: 'Captions VLM',
  component_author: 'Autoría de componentes',
  thumbnail_brief: 'Brief de miniatura',
  tts: 'Voz (TTS)',
  search: 'Búsqueda de stock',
  flux_schnell: 'Imágenes Flux',
  api: 'YouTube API',
};

function Breakdown({ title, rows, max }: { title: string; rows: CostsDto['by_provider']; max: number }) {
  return (
    <div className="card" style={{ padding: 'var(--pad)', display: 'grid', gap: 12 }}>
      <div className="head" style={{ fontSize: 14 }}>
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="muted fs-sm">Sin gasto en este periodo.</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((r) => (
            <div key={r.key} style={{ display: 'grid', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)' }}>
                <span>
                  {OP_LABELS[r.key] ?? r.key}{' '}
                  <span className="muted">· {r.calls} llamadas</span>
                </span>
                <span className="mono">{usd(r.cost_usd)}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: 'var(--bg2, rgba(127,127,127,0.15))' }}>
                <div
                  style={{
                    width: `${max > 0 ? Math.max(2, (r.cost_usd / max) * 100) : 0}%`,
                    height: '100%',
                    borderRadius: 4,
                    background: 'var(--accent, #7aa2ff)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Costes() {
  const { activeChannelId, activeChannel } = useChannel();
  // mes por defecto: el actual (YYYY-MM); el input lo cambia
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const costsQ = useQuery({
    queryKey: ['costs', activeChannelId, month],
    queryFn: () => getCosts({ channel: activeChannelId, month }),
    enabled: activeChannelId !== null,
  });

  const data = costsQ.data;
  const maxProvider = Math.max(0, ...(data?.by_provider.map((r) => r.cost_usd) ?? [0]));
  const maxOperation = Math.max(0, ...(data?.by_operation.map((r) => r.cost_usd) ?? [0]));

  return (
    <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px 72px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 'var(--sec-gap)' }}>
        <h1 className="head" style={{ fontSize: 26, letterSpacing: '-0.02em', margin: 0 }}>
          Costes
        </h1>
        <div style={{ flex: 1 }} />
        <label className="muted fs-sm" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          Mes
          <input
            className="control"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ width: 'auto', fontSize: 'var(--fs-sm)' }}
          />
        </label>
      </div>

      {activeChannel !== undefined ? (
        <p className="muted fs-sm" style={{ margin: '0 0 var(--sec-gap)' }}>
          Canal: {activeChannel.name}
        </p>
      ) : null}

      {activeChannelId === null ? (
        <EmptyState title="Sin canal">Crea un canal para ver sus costes.</EmptyState>
      ) : costsQ.isPending ? (
        <SkeletonRows rows={3} label="Cargando los costes" />
      ) : costsQ.isError ? (
        <div className="banner banner-danger">No se pudieron cargar los costes.</div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--sec-gap)' }}>
          <div className="card" style={{ padding: 'var(--pad)' }}>
            <div className="muted fs-sm">Total del mes</div>
            <div className="head" style={{ fontSize: 34, letterSpacing: '-0.02em' }}>
              {usd(data?.total_usd ?? 0)}
            </div>
          </div>
          <div className="split-half">
            <Breakdown title="Por proveedor" rows={data?.by_provider ?? []} max={maxProvider} />
            <Breakdown title="Por operación" rows={data?.by_operation ?? []} max={maxOperation} />
          </div>
        </div>
      )}
    </div>
  );
}
