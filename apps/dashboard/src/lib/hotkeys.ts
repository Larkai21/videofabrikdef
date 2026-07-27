import { useEffect, useRef, useState } from 'react';

/**
 * Atajos globales de la pantalla. Ignora pulsaciones dentro de inputs,
 * textareas y elementos editables para no pisar la escritura.
 */
export function useHotkeys(handler: (e: KeyboardEvent) => void): void {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target !== null) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      latest.current(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Valor con retardo, para búsquedas con debounce. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
