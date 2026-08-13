import type { ShortCut } from '@fabrica/shared';

// Marcas de los cortes de plano de un clip, bajo el player de previsualización.
// Es información de auditoría visual (¿cuántos planos tiene el clip y dónde
// cambian?), no un control: el encuadre quedó horneado en el fichero al
// proponer y el render no lee este plan (principio 1: los cortes no se tocan).

interface BarraCortesProps {
  /** Tramos del encuadre_plan del maestro, en el reloj de la ventana del clip. */
  plan: NonNullable<ShortCut['encuadre_plan']>;
  duracionMs: number;
}

function fmtSegundos(ms: number): string {
  return `${(ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`;
}

export function BarraCortes({ plan, duracionMs }: BarraCortesProps) {
  if (plan.length === 0 || duracionMs <= 0) return null;

  // Los tramos del detector no cubren el 100 % de la ventana (hay huecos sin
  // plano asignado): se materializan como segmentos vacíos para que cada
  // bloque caiga donde de verdad está en el reloj del clip, no apelotonado.
  const segmentos: { desde: number; hasta: number; plano: boolean }[] = [];
  let cursor = 0;
  for (const tramo of plan) {
    if (tramo.from_ms > cursor) {
      segmentos.push({ desde: cursor, hasta: tramo.from_ms, plano: false });
    }
    segmentos.push({ desde: tramo.from_ms, hasta: tramo.to_ms, plano: true });
    cursor = tramo.to_ms;
  }
  if (cursor < duracionMs) {
    segmentos.push({ desde: cursor, hasta: duracionMs, plano: false });
  }

  return (
    <div style={{ marginTop: 8, display: 'grid', gap: 5 }}>
      <div
        role="img"
        aria-label={`${plan.length} planos; los separadores marcan los cortes`}
        style={{
          display: 'flex',
          // el hueco del flex ES el separador del borde de tramo: donde
          // termina un bloque y empieza otro es donde cae el corte
          gap: 2,
          height: 6,
          borderRadius: 3,
          overflow: 'hidden',
          background: 'var(--bg2)',
        }}
      >
        {segmentos.map((seg) => (
          <div
            key={seg.desde}
            title={seg.plano ? `corte de plano a ${fmtSegundos(seg.desde)}` : undefined}
            style={{
              // proporcional a la duración del segmento; el mínimo evita que
              // un plano de decenas de ms desaparezca del todo
              flex: `${Math.max(seg.hasta - seg.desde, 120)} 0 0px`,
              background: seg.plano ? 'var(--fg2)' : 'transparent',
              opacity: seg.plano ? 0.55 : 1,
              borderRadius: 1,
            }}
          />
        ))}
      </div>
      <span className="mono muted" style={{ fontSize: 10.5 }}>
        cortes de plano del apretado · {plan.length} {plan.length === 1 ? 'plano' : 'planos'}
      </span>
    </div>
  );
}
