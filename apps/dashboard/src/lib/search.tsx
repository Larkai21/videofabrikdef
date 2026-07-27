import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface SearchState {
  search: string;
  setSearch: (v: string) => void;
}

const SearchContext = createContext<SearchState | null>(null);

/** Texto del buscador global (atajo «/»); lo consume la bandeja para filtrar. */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [search, setSearch] = useState('');
  const value = useMemo(() => ({ search, setSearch }), [search]);
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchState {
  const ctx = useContext(SearchContext);
  if (ctx === null) throw new Error('useSearch fuera de SearchProvider');
  return ctx;
}
