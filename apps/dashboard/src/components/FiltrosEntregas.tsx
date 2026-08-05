import { Button } from './ui';
import { hayFiltroDeFecha, rangoImposible, type FiltroEntregas, type Orden } from '../lib/entregas';

// Barra de orden y rango para la galería de entregas. Controlada: el estado
// vive en la bandeja, que es quien tiene la lista. Sin persistencia, igual que
// el resto de filtros de la app.

interface Props {
  filtro: FiltroEntregas;
  onChange: (f: FiltroEntregas) => void;
  /** Cuántas se ven de cuántas hay; solo se pinta si hay filtro de fecha. */
  visibles: number;
  total: number;
}

const ORDENES: Array<{ id: Orden; label: string }> = [
  { id: 'reciente', label: 'Más recientes' },
  { id: 'antiguo', label: 'Más antiguos' },
];

export function FiltrosEntregas({ filtro, onChange, visibles, total }: Props) {
  const conFecha = hayFiltroDeFecha(filtro);
  const imposible = rangoImposible(filtro);

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        alignItems: 'center',
        marginBottom: 'var(--gap)',
      }}
    >
      <div className="seg-group" role="group" aria-label="Orden de las entregas">
        {ORDENES.map((o) => (
          <button
            key={o.id}
            type="button"
            className="seg-btn"
            aria-pressed={filtro.orden === o.id}
            onClick={() => onChange({ ...filtro, orden: o.id })}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="muted fs-sm">Desde</span>
        <input
          type="date"
          className="control"
          style={{ width: 'auto' }}
          aria-label="Desde"
          value={filtro.desde}
          onChange={(e) => onChange({ ...filtro, desde: e.target.value })}
        />
        <span className="muted fs-sm">Hasta</span>
        <input
          type="date"
          className="control"
          style={{ width: 'auto' }}
          aria-label="Hasta"
          value={filtro.hasta}
          onChange={(e) => onChange({ ...filtro, hasta: e.target.value })}
        />
      </div>

      {conFecha ? (
        <Button variant="ghost" onClick={() => onChange({ ...filtro, desde: '', hasta: '' })}>
          Quitar filtros
        </Button>
      ) : null}

      {imposible ? (
        <span className="fs-sm" style={{ color: 'var(--danger)' }}>
          La fecha de inicio es posterior a la de fin
        </span>
      ) : conFecha ? (
        <span className="mono fs-sm muted">
          {visibles} de {total}
        </span>
      ) : null}
    </div>
  );
}
