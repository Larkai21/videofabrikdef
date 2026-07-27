import { clsx } from 'clsx';
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

// Primitivos del bloque «Base estructural común» del explorador de direcciones.
// Todo se pinta con las variables CSS de los tokens.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Tecla de atajo mostrada dentro del botón (siempre visible en la UI). */
  kbd?: string;
}

export function Button({ variant = 'secondary', kbd, className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={clsx('btn', `btn-${variant}`, className)} {...rest}>
      {children}
      {kbd !== undefined ? (
        <span className="kbd" aria-hidden="true">
          {kbd}
        </span>
      ) : null}
    </button>
  );
}

export type ChipKind = 'ok' | 'warn' | 'danger' | 'neutral';

export function Chip({ kind, children }: { kind: ChipKind; children: ReactNode }) {
  return <span className={clsx('chip', `chip-${kind}`)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

export function ProgressBar({
  value,
  color = 'var(--accent)',
  height = 6,
  className,
}: {
  value: number;
  color?: string;
  height?: number;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={clsx('progress', className)}
      style={{ height }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div style={{ width: `${clamped}%`, background: color }} />
    </div>
  );
}

export function CostBadge({ children }: { children: ReactNode }) {
  return <span className="badge-cost">{children}</span>;
}

export interface Motivo {
  id: string;
  label: string;
}

interface ReasonModalProps {
  open: boolean;
  title: string;
  desc: string;
  motivos: Motivo[];
  cta: string;
  danger?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/** Modal de confirmación con motivos en radio, calcado del mock. */
export function ReasonModal({
  open,
  title,
  desc,
  motivos,
  cta,
  danger = true,
  onConfirm,
  onClose,
}: ReasonModalProps) {
  const [selected, setSelected] = useState<string>(motivos[0]?.id ?? '');

  useEffect(() => {
    if (open) setSelected(motivos[0]?.id ?? '');
    // El listado de motivos es estático por pantalla; basta reiniciar al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const chosen = motivos.find((m) => m.id === selected);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: 'var(--pad)', borderBottom: '1px solid var(--line)' }}>
          <div className="head" style={{ fontSize: 17 }}>
            {title}
          </div>
          <div className="muted fs-sm" style={{ marginTop: 5 }}>
            {desc}
          </div>
        </div>
        <div
          style={{ padding: 'var(--pad)', display: 'flex', flexDirection: 'column', gap: 8 }}
          role="radiogroup"
          aria-label="Motivo"
        >
          {motivos.map((m) => (
            <button
              key={m.id}
              type="button"
              className="motivo-btn"
              role="radio"
              aria-checked={m.id === selected}
              onClick={() => setSelected(m.id)}
            >
              <span className="motivo-dot" aria-hidden="true" />
              {m.label}
            </button>
          ))}
        </div>
        <div
          style={{
            padding: 'var(--pad)',
            borderTop: '1px solid var(--line)',
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              if (chosen !== undefined) onConfirm(chosen.label);
            }}
          >
            {cta}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div
      style={{
        border: '1px dashed var(--line)',
        borderRadius: 'var(--r)',
        padding: 'calc(var(--pad) * 1.6)',
        textAlign: 'center',
        background: 'var(--bg2)',
      }}
    >
      <div className="head" style={{ fontSize: 15, marginBottom: 6 }}>
        {title}
      </div>
      {children !== undefined ? (
        <div
          className="muted fs-sm"
          style={{ maxWidth: 380, margin: '0 auto', lineHeight: 1.5 }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Miniatura placeholder con trama diagonal, como el mock. */
export function ThumbPlaceholder({
  width,
  note,
  className,
}: {
  width?: number | string;
  note?: string;
  className?: string;
}) {
  return (
    <div
      className={clsx('thumb-ph', className)}
      style={{
        width,
        aspectRatio: '16 / 9',
        display: 'flex',
        alignItems: 'flex-end',
        padding: 6,
        flex: 'none',
      }}
      aria-hidden="true"
    >
      {note !== undefined ? (
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--fg2)' }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}
