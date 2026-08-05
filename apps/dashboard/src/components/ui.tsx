import { clsx } from 'clsx';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';

// Primitivos del bloque «Base estructural común» del explorador de direcciones.
// Todo se pinta con las variables CSS de los tokens.

/**
 * Teclado de un diálogo modal: foco inicial dentro, trampa de Tab, Esc cierra y
 * al desmontar se devuelve el foco a donde estaba.
 *
 * El filtro por `tabIndex >= 0` y `[disabled]` es deliberado: sin él la trampa
 * captura botones deshabilitados y los elementos con tabindex -1 (por ejemplo
 * los radios con tabulación móvil de ReasonModal). Un `<video controls>` NO
 * entra por el selector, así que quien quiera que sus controles sean
 * alcanzables debe ponerle `tabIndex={0}` explícito.
 */
export function useModalKeyboard(
  open: boolean,
  boxRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        boxRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]',
        ) ?? [],
      ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex >= 0);
    (initialFocusRef?.current ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open, onClose, boxRef, initialFocusRef]);
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Tecla de atajo mostrada dentro del botón (siempre visible en la UI). */
  kbd?: string;
  /** En React 19 la ref es una prop normal; viaja en `rest` hasta el <button>. */
  ref?: Ref<HTMLButtonElement>;
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

export function CostBadge({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="badge-cost" title={title}>
      {children}
    </span>
  );
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
  const boxRef = useRef<HTMLDivElement>(null);
  const radiosRef = useRef<(HTMLButtonElement | null)[]>([]);

  // Patrón ARIA de radiogroup: una sola parada de tabulación (tabindex móvil)
  // y navegación con flechas, que es lo que anuncia el rol.
  const focusAt = (next: number) => {
    const target = motivos[next];
    if (target === undefined) return;
    setSelected(target.id);
    radiosRef.current[next]?.focus();
  };
  const moveBy = (delta: number) => {
    const i = motivos.findIndex((m) => m.id === selected);
    focusAt((i + delta + motivos.length) % motivos.length);
  };

  useEffect(() => {
    if (open) setSelected(motivos[0]?.id ?? '');
    // El listado de motivos es estático por pantalla; basta reiniciar al abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useModalKeyboard(open, boxRef, onClose);

  if (!open) return null;

  const chosen = motivos.find((m) => m.id === selected);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={boxRef}
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
          {motivos.map((m, i) => (
            <button
              key={m.id}
              type="button"
              className="motivo-btn"
              role="radio"
              aria-checked={m.id === selected}
              tabIndex={m.id === selected ? 0 : -1}
              ref={(el) => {
                radiosRef.current[i] = el;
              }}
              onClick={() => setSelected(m.id)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  moveBy(1);
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  moveBy(-1);
                } else if (e.key === 'Home') {
                  e.preventDefault();
                  focusAt(0);
                } else if (e.key === 'End') {
                  e.preventDefault();
                  focusAt(motivos.length - 1);
                }
              }}
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

interface InputModalProps {
  open: boolean;
  title: string;
  desc: string;
  /** Etiqueta accesible del campo. */
  label: string;
  placeholder?: string;
  cta: string;
  /** Texto de ayuda permanente bajo el campo. */
  ayuda?: string;
  /** Mensaje del servidor: el modal se queda abierto para poder corregir. */
  error?: string;
  pending?: boolean;
  /** null = válido; una cadena es el motivo, se enseña y deshabilita el CTA. */
  validate?: (value: string) => string | null;
  onConfirm: (value: string) => void;
  onClose: () => void;
}

/**
 * Modal con un campo de texto. Hermano de ReasonModal, que solo sabe de radios.
 *
 * El envío va en un <form> para que Enter confirme, y el error del servidor se
 * enseña dentro en vez de como toast: si el humano pega un enlace que la API
 * rechaza, tiene que poder corregirlo sin volver a abrir el diálogo.
 */
export function InputModal({
  open,
  title,
  desc,
  label,
  placeholder,
  cta,
  ayuda,
  error,
  pending = false,
  validate,
  onConfirm,
  onClose,
}: InputModalProps) {
  const [value, setValue] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ayudaId = useId();

  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  useModalKeyboard(open, boxRef, onClose, inputRef);

  if (!open) return null;

  const motivo = validate?.(value) ?? null;
  // con el campo vacío no se grita todavía; el CTA se deshabilita igualmente
  const mensaje = error ?? (value.trim() === '' ? null : motivo);
  const puedeConfirmar = !pending && value.trim() !== '' && motivo === null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={boxRef}
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
        <form
          style={{ padding: 'var(--pad)', display: 'flex', flexDirection: 'column', gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (puedeConfirmar) onConfirm(value.trim());
          }}
        >
          <input
            ref={inputRef}
            className="control"
            type="text"
            value={value}
            placeholder={placeholder}
            aria-label={label}
            aria-invalid={mensaje !== null}
            aria-describedby={ayudaId}
            onChange={(e) => setValue(e.target.value)}
          />
          <div
            id={ayudaId}
            className={clsx('fs-sm', mensaje === null && 'muted')}
            style={mensaje !== null ? { color: 'var(--danger)' } : undefined}
          >
            {mensaje ?? ayuda ?? ''}
          </div>
          {/* submit oculto: sin él, Enter no envía en formularios de un campo
              cuando el botón real vive fuera del <form> */}
          <button type="submit" style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />
        </form>
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
            variant="primary"
            disabled={!puedeConfirmar}
            onClick={() => onConfirm(value.trim())}
          >
            {pending ? 'Guardando' : cta}
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
        <div className="muted fs-sm" style={{ maxWidth: 380, margin: '0 auto', lineHeight: 1.5 }}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Fila etiqueta/valor de los paneles de detalle. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        fontSize: 'var(--fs-sm)',
        padding: '5px 0',
        borderTop: '1px solid var(--line)',
      }}
    >
      <span className="muted" style={{ flex: 'none' }}>
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>{children}</div>
    </div>
  );
}

export interface VisorMediaSource {
  kind: 'video' | 'image';
  src: string;
  poster?: string;
}

export interface VisorDato {
  label: string;
  value: ReactNode;
}

interface VisorMediaProps {
  open: boolean;
  title: string;
  subtitle?: string;
  /** null → placeholder con trama, con `emptyNote` de explicación. */
  media: VisorMediaSource | null;
  emptyNote?: string;
  datos: VisorDato[];
  /** Sin `cta` el visor es solo de lectura (mirar y cerrar). */
  cta?: string;
  ctaDisabled?: boolean;
  onConfirm?: () => void;
  onClose: () => void;
}

/**
 * Visor de un medio a tamaño de juicio: vídeo reproducible o imagen, más sus
 * datos, y una confirmación explícita. Es genérico a propósito (no conoce los
 * candidatos de beat) para que lo compartan la timeline y la biblioteca.
 */
export function VisorMedia({
  open,
  title,
  subtitle,
  media,
  emptyNote,
  datos,
  cta,
  ctaDisabled = false,
  onConfirm,
  onClose,
}: VisorMediaProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const titleId = useId();

  // el foco arranca en la confirmación: abrir con 1..6 y pulsar Enter basta
  useModalKeyboard(open, boxRef, onClose, ctaRef);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={boxRef}
        className="modal-box modal-box-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // «espacio» reproduce, no confirma. El foco arranca en el botón
          // primario para que Enter confirme, pero espacio activaría ese mismo
          // botón de forma nativa y aplicaría el cambio sin querer.
          if (e.key !== ' ' || videoRef.current === null) return;
          e.preventDefault();
          if (videoRef.current.paused) void videoRef.current.play();
          else videoRef.current.pause();
        }}
      >
        <div style={{ padding: 'var(--pad)', borderBottom: '1px solid var(--line)' }}>
          <div className="head" id={titleId} style={{ fontSize: 17 }}>
            {title}
          </div>
          {subtitle !== undefined ? (
            <div className="muted fs-sm" style={{ marginTop: 5 }}>
              {subtitle}
            </div>
          ) : null}
        </div>

        <div style={{ padding: 'var(--pad)', maxHeight: '72vh', overflowY: 'auto' }}>
          {media === null ? (
            <ThumbPlaceholder width="100%" note={emptyNote ?? 'Sin previsualización'} />
          ) : media.kind === 'video' ? (
            // tabIndex explícito: <video controls> no entra en el selector de
            // la trampa de foco, y sin él los controles quedan inalcanzables
            <video
              ref={videoRef}
              className="visor-media"
              src={media.src}
              poster={media.poster}
              controls
              preload="metadata"
              playsInline
              tabIndex={0}
              aria-label={`Previsualización de ${title}`}
            />
          ) : (
            <img className="visor-media" src={media.src} alt={title} />
          )}

          {datos.length > 0 ? (
            <div style={{ marginTop: 'var(--pad)' }}>
              {datos.map((d) => (
                <DetailRow key={d.label} label={d.label}>
                  {d.value}
                </DetailRow>
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
            justifyContent: 'flex-end',
          }}
        >
          <Button variant="ghost" onClick={onClose}>
            {cta !== undefined ? 'Cancelar' : 'Cerrar'}
          </Button>
          {cta !== undefined && onConfirm !== undefined ? (
            <Button ref={ctaRef} variant="primary" disabled={ctaDisabled} onClick={onConfirm}>
              {cta}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Marcador de carga con la silueta de la lista que va a llegar, en vez de una
 * línea de texto: evita el salto de layout al resolverse la query.
 */
export function SkeletonRows({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--gap)' }}>
      <span className="sr-only" role="status">
        {label}
      </span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="card"
          style={{
            padding: 'var(--pad)',
            display: 'flex',
            gap: 'var(--gap)',
            alignItems: 'center',
          }}
          aria-hidden="true"
        >
          <div className="skeleton" style={{ width: 104, aspectRatio: '16 / 9', flex: 'none' }} />
          <div style={{ flex: 1, minWidth: 0, display: 'grid', gap: 8 }}>
            <div className="skeleton" style={{ height: 11, width: '32%' }} />
            <div className="skeleton" style={{ height: 15, width: '68%' }} />
            <div className="skeleton" style={{ height: 11, width: '45%' }} />
          </div>
        </div>
      ))}
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
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg2)' }}>
          {note}
        </span>
      ) : null}
    </div>
  );
}
