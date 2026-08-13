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

// La nav en GRUPOS por producto (auditoría S4.1: once ítems planos mezclaban
// productos, vistas, anclas y hasta una acción). El separador dibuja el mapa:
// la fábrica del vídeo largo · los otros dos productos · los recursos · el
// sistema. «Nuevo canal» es una ACCIÓN y vive como botón, no como sección.
const NAV_GRUPOS: { label: string; to: string }[][] = [
  [
    { label: 'Bandeja', to: '/' },
    { label: 'En curso', to: '/#en-curso' },
    { label: 'Publicados', to: '/#publicados' },
  ],
  [
    { label: 'Episodios', to: '/episodios' },
    { label: 'Reels', to: '/reels' },
    { label: 'Plantillas', to: '/reels/plantillas' },
  ],
  [
    { label: 'Biblioteca', to: '/biblioteca' },
    { label: 'Brand kit', to: '/componentes' },
  ],
  [
    { label: 'Costes', to: '/costes' },
    { label: 'Ajustes', to: '/ajustes' },
  ],
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
    // /reels/plantillas es más específico que /reels: gana el largo
    if (to === '/reels') return location.pathname.startsWith(to) && !location.pathname.startsWith('/reels/plantillas');
    return location.pathname.startsWith(to);
  };

  return (
    <header className="app-header">
      <div className="wrap-1420 app-header-inner">
        {/* el wordmark navega a casa: es lo que todo el mundo prueba primero */}
        <Link to="/" className="head" style={{ fontSize: 15, textDecoration: 'none', color: 'var(--fg)' }}>
          Fábrica
        </Link>
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
        {/* el selector se RESERVA sitio mientras cargan los canales: la
            cabecera es el ancla espacial y no puede saltar por ruta (era el
            hallazgo 5 de la auditoría — parecía inconsistencia por pantalla
            y era layout shift de la carga) */}
        {channels === undefined || channels.length >= 2 ? (
          <select
            className="control"
            aria-label="Canal activo"
            value={activeChannelId ?? ''}
            disabled={channels === undefined}
            style={{ width: 'auto', minWidth: 120, fontSize: 'var(--fs-sm)' }}
            onChange={(e) => {
              if (e.target.value !== '') setActiveChannel(e.target.value);
            }}
          >
            {channels === undefined ? (
              <option value="">Canal…</option>
            ) : (
              channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))
            )}
          </select>
        ) : null}
        <nav className="app-header-nav" aria-label="Secciones">
          {NAV_GRUPOS.map((grupo, i) => (
            <span key={i} style={{ display: 'contents' }}>
              {i > 0 ? (
                <span className="nav-sep" aria-hidden="true">
                  ·
                </span>
              ) : null}
              {grupo.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="nav-link"
                  aria-current={isActive(item.to) ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              ))}
            </span>
          ))}
        </nav>
        <Link to="/wizard" className="nav-link muted fs-sm" title="Crear un canal nuevo">
          + Canal
        </Link>
        <div style={{ flex: 1 }} />
        {/* factor de encogimiento 999: el buscador cede TODO su ancho antes
            de que la nav (elástica con scroll interno) esconda una sección */}
        <div className="input-wrap app-header-search" style={{ flex: '0 999 185px', minWidth: 84 }}>
          <span className="muted" style={{ fontSize: 12 }} aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              // en las listas con búsqueda propia (bandeja, episodios, reels)
              // el filtro actúa in situ; desde un detalle, teclear te lleva a
              // la bandeja como siempre
              const conBusqueda = ['/', '/episodios', '/reels'].includes(location.pathname);
              if (!conBusqueda && e.target.value !== '') {
                void navigate('/');
              }
            }}
            placeholder="Buscar vídeos, ideas, episodios o reels"
            aria-label="Buscar vídeos, ideas, episodios o reels"
          />
          <span className="kbd" aria-hidden="true">
            /
          </span>
        </div>
        {inbox !== undefined ? (
          <CostBadge title={tituloDelCoste(inbox)}>
            {/* El saldo del proveedor solo aparece cuando importa: cuando se
                está acabando. Y cuando aparece, el contador de vídeos cede su
                sitio — con los dos, el badge crecía y truncaba la nav. */}
            {saldoCritico(inbox.provider_balance) ? (
              <>
                {fmtMoney(inbox.month_cost_usd)}
                <strong style={{ marginLeft: 8, color: 'var(--danger)' }}>
                  {inbox.provider_balance!.queda_usd === 0
                    ? 'clave sin saldo'
                    : `quedan ${fmtMoney(inbox.provider_balance!.queda_usd!)}`}
                </strong>
              </>
            ) : (
              <>
                {fmtMoney(inbox.month_cost_usd)} · {inbox.month_videos}{' '}
                {inbox.month_videos === 1 ? 'vídeo' : 'vídeos'}
              </>
            )}
          </CostBadge>
        ) : null}
        {/* tema y densidad viven en Ajustes → Interfaz: el subbar del mock
            solo lleva marca, navegación, buscador y coste */}
      </div>
    </header>
  );
}
