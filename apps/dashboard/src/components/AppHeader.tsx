import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getInboxFor } from '../lib/api';
import { useChannel } from '../lib/channel';
import { fmtMoney } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useSearch } from '../lib/search';
import { useTheme } from '../lib/theme';
import { CostBadge } from './ui';

const NAV = [
  { label: 'Bandeja', to: '/' },
  { label: 'En curso', to: '/#en-curso' },
  { label: 'Publicados', to: '/#publicados' },
  { label: 'Biblioteca', to: '/biblioteca' },
  { label: 'Brand kit', to: '/componentes' },
  { label: 'Ajustes', to: '/ajustes' },
];

export function AppHeader() {
  const { tema, densidad, setTema, setDensidad } = useTheme();
  const { search, setSearch } = useSearch();
  const location = useLocation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const { channels, activeChannelId, setActiveChannel } = useChannel();

  const { data: inbox } = useQuery({
    queryKey: ['inbox', activeChannelId],
    queryFn: () => getInboxFor(activeChannelId),
    refetchInterval: 30_000,
  });

  useHotkeys((e) => {
    if (e.key === '/') {
      e.preventDefault();
      inputRef.current?.focus();
    }
  });

  const isActive = (to: string): boolean => {
    if (to === '/') return location.pathname === '/' && location.hash === '';
    if (to.startsWith('/#')) return location.pathname === '/' && location.hash === to.slice(1);
    return location.pathname.startsWith(to);
  };

  return (
    <header className="app-header">
      <div className="wrap-1420 app-header-inner">
        <span className="head" style={{ fontSize: 15 }}>
          Fábrica
        </span>
        {channels !== undefined && channels.length >= 2 ? (
          <select
            className="control"
            aria-label="Canal activo"
            value={activeChannelId ?? ''}
            style={{ width: 'auto', minWidth: 120, fontSize: 'var(--fs-sm)' }}
            onChange={(e) => {
              if (e.target.value !== '') setActiveChannel(e.target.value);
            }}
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
        <Link to="/wizard" className="nav-link muted fs-sm" title="Crear un canal nuevo">
          Nuevo canal
        </Link>
        <nav style={{ display: 'flex', gap: 14 }} aria-label="Secciones">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="nav-link"
              aria-current={isActive(item.to) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <div className="input-wrap" style={{ minWidth: 230 }}>
          <span className="muted" style={{ fontSize: 12 }} aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (location.pathname !== '/' && e.target.value !== '') {
                void navigate('/');
              }
            }}
            placeholder="Buscar vídeos, ideas o beats"
            aria-label="Buscar vídeos, ideas o beats"
          />
          <span className="kbd" aria-hidden="true">
            /
          </span>
        </div>
        {inbox !== undefined ? (
          <CostBadge>
            {fmtMoney(inbox.month_cost_usd)} · {inbox.month_videos} vídeos
          </CostBadge>
        ) : null}
        <div className="seg-group" role="group" aria-label="Tema">
          <button
            type="button"
            className="seg-btn"
            aria-pressed={tema === 'claro'}
            onClick={() => setTema('claro')}
          >
            Claro
          </button>
          <button
            type="button"
            className="seg-btn"
            aria-pressed={tema === 'oscuro'}
            onClick={() => setTema('oscuro')}
          >
            Oscuro
          </button>
        </div>
        <div className="seg-group" role="group" aria-label="Densidad">
          <button
            type="button"
            className="seg-btn"
            aria-pressed={densidad === 'comoda'}
            onClick={() => setDensidad('comoda')}
          >
            Cómoda
          </button>
          <button
            type="button"
            className="seg-btn"
            aria-pressed={densidad === 'compacta'}
            onClick={() => setDensidad('compacta')}
          >
            Compacta
          </button>
        </div>
      </div>
    </header>
  );
}
