import { useCallback, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useHotkeys } from '../lib/hotkeys';
import { Kbd, useModalKeyboard } from './ui';

// Leyenda global de atajos: se abre con ? desde cualquier pantalla y enseña
// los atajos de la RUTA actual más los que funcionan en todas partes. Es el
// patrón visual de ReasonModal (.modal-overlay/.modal-box) implementado aquí
// para no tocar ui.tsx.

interface Atajo {
  teclas: string[];
  accion: string;
}

// Los atajos DECLARADOS por ruta, leídos de las pantallas (sus useHotkeys y
// sus props kbd), no inventados. Si una pantalla cambia sus atajos, esta
// lista tiene que cambiar con ella: es documentación viva, como la lista de
// comandos del CLAUDE.md.
const RUTAS: { patron: RegExp; titulo: string; atajos: Atajo[] }[] = [
  {
    patron: /^\/$/,
    titulo: 'Bandeja',
    atajos: [
      { teclas: ['1', '2', '3'], accion: 'abrir lo que espera tu firma, en el orden del raíl' },
    ],
  },
  {
    patron: /^\/videos\/[^/]+\/guion$/,
    titulo: 'Guion',
    atajos: [
      { teclas: ['a'], accion: 'aprobar guion y título (en packaging: confirmar el título)' },
      { teclas: ['r'], accion: 'pedir reescritura con motivo' },
      { teclas: ['1', '2', '3'], accion: 'elegir título' },
    ],
  },
  {
    patron: /^\/videos\/[^/]+\/timeline$/,
    titulo: 'Timeline',
    atajos: [
      { teclas: ['←', '→'], accion: 'moverse entre beats' },
      { teclas: ['a'], accion: 'aprobar el beat seleccionado' },
      { teclas: ['d'], accion: 'descartar con motivo' },
      { teclas: ['n'], accion: 'saltar al siguiente pendiente' },
      { teclas: ['espacio'], accion: 'reproducir o pausar' },
      { teclas: ['1', '…', '6'], accion: 'abrir una alternativa, con el panel abierto' },
    ],
  },
  {
    patron: /^\/episodios\/[^/]+\/clips$/,
    titulo: 'Clips del episodio',
    atajos: [
      { teclas: ['j', 'k'], accion: 'moverse entre candidatos (también ↓ y ↑)' },
      { teclas: ['a'], accion: 'aprobar el candidato seleccionado' },
      { teclas: ['d'], accion: 'descartar con motivo' },
    ],
  },
  {
    patron: /^\/biblioteca$/,
    titulo: 'Biblioteca',
    atajos: [
      { teclas: ['e'], accion: 'completar el etiquetado' },
      { teclas: ['p'], accion: 'filtrar los candidatos a purga' },
    ],
  },
  {
    patron: /^\/componentes$/,
    titulo: 'Brand kit',
    atajos: [{ teclas: ['s'], accion: 'subir el zip de un componente' }],
  },
];

const GLOBALES: Atajo[] = [
  { teclas: ['/'], accion: 'enfocar la búsqueda' },
  { teclas: ['?'], accion: 'abrir o cerrar esta leyenda' },
  { teclas: ['Esc'], accion: 'cerrar el modal abierto' },
];

function Filas({ atajos }: { atajos: Atajo[] }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {atajos.map((a) => (
        <div key={a.accion} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
          <span style={{ display: 'flex', gap: 4, flex: 'none', minWidth: 70 }}>
            {a.teclas.map((t) => (
              <Kbd key={t}>{t}</Kbd>
            ))}
          </span>
          <span className="fs-sm" style={{ lineHeight: 1.5 }}>
            {a.accion}
          </span>
        </div>
      ))}
    </div>
  );
}

export function LeyendaAtajos() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const boxRef = useRef<HTMLDivElement>(null);
  // estable a propósito: useModalKeyboard re-suscribe si cambia onClose
  const cerrar = useCallback(() => setOpen(false), []);

  useHotkeys((e) => {
    if (e.key !== '?') return;
    // no se abre encima de otro diálogo: cada modal gestiona su propio
    // teclado y superponer la leyenda pelearía por el foco con su trampa
    if (!open && document.querySelector('[role="dialog"]') !== null) return;
    e.preventDefault();
    setOpen((v) => !v);
  });
  useModalKeyboard(open, boxRef, cerrar);

  if (!open) return null;
  const ruta = RUTAS.find((r) => r.patron.test(pathname));

  return (
    <div className="modal-overlay" onClick={cerrar}>
      <div
        ref={boxRef}
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-label="Atajos de teclado"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: 'var(--pad)', borderBottom: '1px solid var(--line)' }}>
          <div className="head" style={{ fontSize: 17 }}>
            Atajos de teclado
          </div>
          <div className="muted fs-sm" style={{ marginTop: 5 }}>
            Los de esta pantalla y los que funcionan en todas. No actúan mientras escribes.
          </div>
        </div>
        <div style={{ padding: 'var(--pad)', display: 'grid', gap: 'var(--pad)' }}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="step-label">{ruta?.titulo ?? 'Esta pantalla'}</div>
            {ruta !== undefined ? (
              <Filas atajos={ruta.atajos} />
            ) : (
              <span className="muted fs-sm">Esta pantalla no tiene atajos propios.</span>
            )}
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="step-label">En todas partes</div>
            <Filas atajos={GLOBALES} />
          </div>
        </div>
      </div>
    </div>
  );
}
