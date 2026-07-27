import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Tema = 'claro' | 'oscuro';
export type Densidad = 'comoda' | 'compacta';

interface ThemeState {
  tema: Tema;
  densidad: Densidad;
  setTema: (t: Tema) => void;
  setDensidad: (d: Densidad) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function readStored<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v !== null && (valid as readonly string[]).includes(v)) return v as T;
  } catch {
    // localStorage no disponible: usamos el valor por defecto
  }
  return fallback;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Por defecto: oscuro (sala de control) + densidad cómoda.
  const [tema, setTema] = useState<Tema>(() =>
    readStored('fabrica.tema', ['claro', 'oscuro'] as const, 'oscuro'),
  );
  const [densidad, setDensidad] = useState<Densidad>(() =>
    readStored('fabrica.densidad', ['comoda', 'compacta'] as const, 'comoda'),
  );

  useEffect(() => {
    document.documentElement.dataset.tema = tema;
    try {
      localStorage.setItem('fabrica.tema', tema);
    } catch {
      // sin persistencia
    }
  }, [tema]);

  useEffect(() => {
    document.documentElement.dataset.density = densidad;
    try {
      localStorage.setItem('fabrica.densidad', densidad);
    } catch {
      // sin persistencia
    }
  }, [densidad]);

  return (
    <ThemeContext.Provider value={{ tema, densidad, setTema, setDensidad }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (ctx === null) throw new Error('useTheme fuera de ThemeProvider');
  return ctx;
}
