import { useQuery } from '@tanstack/react-query';
import type { InboxDto } from '@fabrica/shared';
import { useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { fileUrl, getInboxFor } from '../lib/api';
import { useChannel } from '../lib/channel';
import { fmtMoney } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useSearch } from '../lib/search';
import { CostBadge } from './ui';

const NAV = [
  { label: 'Bandeja', to: '/' },
  { label: 'En curso', to: '/#en-curso' },
  { label: 'Publicados', to: '/#publicados' },
  { label: 'Biblioteca', to: '/biblioteca' },
  { label: 'Brand kit', to: '/componentes' },
  { label: 'Costes', to: '/costes' },
  { label: 'Ajustes', to: '/ajustes' },
];

/**
 * Queda poco saldo en la clave del proveedor.
 *
 * El umbral es el coste de UN vídeo largo redondeado hacia arriba (los reales
 * han ido entre 0,058 y 0,195 $): por debajo de eso, la siguiente producción
 * puede quedarse a medias. Y sin tope configurado no hay nada que avisar.
 */
export function saldoCritico(saldo: InboxDto['provider_balance']): boolean {
  return saldo !== null && saldo.queda_usd !== null && saldo.queda_usd < 0.25;
}

/**
 * El desglose va en el `title`: el coste del mes es una ESTIMACIÓN por tokens y
 * el del proveedor es el real. Verlos juntos es lo que avisa cuando se separan
 * —pasó: 1,85 $ estimados con la clave a 3,05 $ y devolviendo 403—, pero no
 * merece sitio permanente en la barra.
 */
export function tituloDelCoste(inbox: InboxDto): string {
  const partes = [
    `Estimado este mes: ${fmtMoney(inbox.month_cost_usd)} de ${fmtMoney(inbox.month_budget_usd)}`,
  ];
  const p = inbox.provider_balance;
  if (p !== null) {
    partes.push(`Real en ${p.proveedor}: ${fmtMoney(p.gastado_usd)} gastados`);
    if (p.tope_usd !== null) {
      partes.push(
        `Tope de la clave: ${fmtMoney(p.tope_usd)} · quedan ${fmtMoney(p.queda_usd ?? 0)}`,
      );
    }
  }
  return partes.join('\n');
}

export function AppHeader() {
  const { search, setSearch } = useSearch();
  const location = useLocation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const { channels, activeChannel, activeChannelId, setActiveChannel } = useChannel();

  const { data: inbox } = useQuery({
    queryKey: ['inbox', activeChannelId],
    queryFn: () => getInboxFor(activeChannelId),
    refetchInterval: 30_000,
    enabled: activeChannelId !== null,
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
        {activeChannel?.avatar_url ? (
          <img
            src={fileUrl(activeChannel.avatar_url)}
            alt={`Avatar de ${activeChannel.name}`}
            title={activeChannel.profile?.character?.name ?? activeChannel.name}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              objectFit: 'cover',
              border: '1px solid var(--line)',
              flexShrink: 0,
            }}
          />
        ) : null}
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
        <nav className="app-header-nav" aria-label="Secciones">
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
        <Link to="/wizard" className="nav-link muted fs-sm" title="Crear un canal nuevo">
          Nuevo canal
        </Link>
        <div style={{ flex: 1 }} />
        <div className="input-wrap app-header-search" style={{ flex: '0 1 230px', minWidth: 120 }}>
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
          <CostBadge title={tituloDelCoste(inbox)}>
            {fmtMoney(inbox.month_cost_usd)} · {inbox.month_videos}{' '}
            {inbox.month_videos === 1 ? 'vídeo' : 'vídeos'}
            {/* El saldo del proveedor solo aparece cuando importa: cuando se
                está acabando. Enseñarlo siempre convierte en ruido el único
                aviso que de verdad para la fábrica. */}
            {saldoCritico(inbox.provider_balance) ? (
              <strong style={{ marginLeft: 8, color: 'var(--danger)' }}>
                {inbox.provider_balance!.queda_usd === 0
                  ? 'clave sin saldo'
                  : `quedan ${fmtMoney(inbox.provider_balance!.queda_usd!)}`}
              </strong>
            ) : null}
          </CostBadge>
        ) : null}
        {/* tema y densidad viven en Ajustes → Interfaz: el subbar del mock
            solo lleva marca, navegación, buscador y coste */}
      </div>
    </header>
  );
}
