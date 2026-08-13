import { useEffect, useState } from 'react';
import { Button } from './ui';
import {
  fmtFechaEs,
  hayFiltroDeFecha,
  parseFechaEs,
  rangoImposible,
  type FiltroEntregas,
  type Orden,
} from '../lib/entregas';

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

// El input nativo type="date" pinta el formato del navegador (mm/dd/yyyy en
// un Chrome en inglés): campo de texto dd/mm/aaaa con la conversión a ISO en
// la frontera (parseFechaEs), mismo criterio que el selector de mes de Costes.
function CampoFecha({
  label,
  iso,
  onIso,
}: {
  label: string;
  iso: string;
  onIso: (v: string) => void;
}) {
  const [texto, setTexto] = useState(fmtFechaEs(iso));
  // sincronía solo con cambios EXTERNOS («Quitar filtros»): si lo escrito ya
  // representa el valor del filtro, se respeta la forma en que se tecleó
  useEffect(() => {
    setTexto((t) => {
      const representa = t.trim() === '' ? iso === '' : parseFechaEs(t) === iso;
      return representa ? t : fmtFechaEs(iso);
    });
  }, [iso]);
  const invalido = texto.trim() !== '' && parseFechaEs(texto) === null;
  return (
    <input
      className="control"
      style={{ width: 110 }}
      aria-label={label}
      placeholder="dd/mm/aaaa"
      aria-invalid={invalido || undefined}
      value={texto}
      onChange={(e) => {
        const v = e.target.value;
        setTexto(v);
        if (v.trim() === '') {
          onIso('');
          return;
        }
        const p = parseFechaEs(v);
        if (p !== null) onIso(p);
      }}
    />
  );
}

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
        <CampoFecha
          label="Desde"
          iso={filtro.desde}
          onIso={(v) => onChange({ ...filtro, desde: v })}
        />
        <span className="muted fs-sm">Hasta</span>
        <CampoFecha
          label="Hasta"
          iso={filtro.hasta}
          onIso={(v) => onChange({ ...filtro, hasta: v })}
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
