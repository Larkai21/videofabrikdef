import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'ok' | 'danger';

/** Acción opcional del toast («Deshacer»): ejecuta y cierra el aviso. */
export interface ToastAccion {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
  accion?: ToastAccion;
}

interface ToastState {
  push: (text: string, kind?: ToastKind, accion?: ToastAccion) => void;
}

const ToastContext = createContext<ToastState | null>(null);

/** Un error necesita tiempo para leerse y decidir; una confirmación, no. */
const DURACION_MS: Record<ToastKind, number> = { ok: 3600, danger: 9000 };
// con acción, la confirmación aguanta lo que un error: deshacer necesita
// tiempo de reacción, no reflejos
const DURACION_ACCION_MS = 9000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (text: string, kind: ToastKind = 'ok', accion?: ToastAccion) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-3), { id, text, kind, ...(accion ? { accion } : {}) }]);
      window.setTimeout(
        () => dismiss(id),
        accion !== undefined ? DURACION_ACCION_MS : DURACION_MS[kind],
      );
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast"
            // Los errores interrumpen; las confirmaciones esperan turno.
            role={t.kind === 'danger' ? 'alert' : 'status'}
            aria-live={t.kind === 'danger' ? 'assertive' : 'polite'}
          >
            <span
              className="toast-dot"
              style={{ background: t.kind === 'ok' ? 'var(--ok)' : 'var(--danger)' }}
            />
            <span style={{ flex: 1 }}>{t.text}</span>
            {t.accion !== undefined ? (
              <button
                type="button"
                className="toast-accion"
                onClick={() => {
                  t.accion?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.accion.label}
              </button>
            ) : null}
            <button
              type="button"
              className="toast-close"
              aria-label="Cerrar el aviso"
              onClick={() => dismiss(t.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastState {
  const ctx = useContext(ToastContext);
  if (ctx === null) throw new Error('useToasts fuera de ToastProvider');
  return ctx;
}
