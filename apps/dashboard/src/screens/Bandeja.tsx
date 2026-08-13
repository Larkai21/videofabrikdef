import type { VideoState } from '@fabrica/shared';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getInboxFor } from '../lib/api';
import { useChannel } from '../lib/channel';
import {
  filtrarEntregas,
  FILTRO_VACIO,
  hayFiltroDeFecha,
  type FiltroEntregas,
} from '../lib/entregas';
import { useLive } from '../lib/events';
import { fmtMoney } from '../lib/format';
import { useHotkeys } from '../lib/hotkeys';
import { useSearch } from '../lib/search';
import { FiltrosEntregas } from '../components/FiltrosEntregas';
import { Radar } from '../components/Radar';
import { LineaProduccion, esperandoFirma, type EnVuelo } from '../components/LineaProduccion';
import { Galeria } from '../components/Galeria';
import { Button, EmptyState, SkeletonRows } from '../components/ui';

/**
 * Una puerta abierta implica el estado que la abrió: la API deriva `kind` del
 * estado, así que la vuelta es exacta. Sirve para situar en el raíl un vídeo
 * que solo aparece como puerta (la lista de «en curso» solo trae lo que la
 * máquina está tocando ahora mismo, y un vídeo esperándote no lo está).
 */
const ESTADO_DE_PUERTA: Record<'guion' | 'timeline', VideoState> = {
  guion: 'guion_borrador',
  timeline: 'assets',
};

export function Bandeja() {
  const navigate = useNavigate();
  const { search } = useSearch();
  const live = useLive();
  const { activeChannelId } = useChannel();
  const [filtroEntregas, setFiltroEntregas] = useState<FiltroEntregas>(FILTRO_VACIO);

  const {
    data: inbox,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['inbox', activeChannelId],
    queryFn: () => getInboxFor(activeChannelId),
    refetchInterval: 30_000,
    // sin canal resuelto todavía no se pinta el agregado global como si
    // fuera el canal activo
    enabled: activeChannelId !== null,
  });

  const q = search.trim().toLowerCase();
  // las puertas del clipping y del editor no paran ningún vídeo del raíl:
  // van a su propia sección, cada ficha con su enlace a donde se resuelve
  const puertasFuera = (inbox?.gates ?? []).filter(
    (g) =>
      (g.kind === 'episodio_listo' || g.kind === 'clips_episodio' || g.kind === 'reel_plan') &&
      (q === '' || g.title.toLowerCase().includes(q)),
  );
  // las puertas de idea son el radar y las de entrega la galería: aquí solo
  // interesan las que paran un vídeo a mitad de la línea
  const gates = (inbox?.gates ?? []).filter(
    (g) =>
      g.kind !== 'entrega' &&
      g.kind !== 'episodio_listo' &&
      g.kind !== 'clips_episodio' &&
      g.kind !== 'reel_plan' &&
      (q === '' || g.title.toLowerCase().includes(q)),
  );
  const running = (inbox?.running ?? []).filter(
    (v) => q === '' || v.title.toLowerCase().includes(q),
  );
  // la galería filtra y ordena aparte: el texto se compone con el rango de
  // fechas y con el orden dentro de filtrarEntregas
  const done = inbox?.done ?? [];
  const entregas = useMemo(
    () => filtrarEntregas(done, { ...filtroEntregas, q: search }),
    [done, filtroEntregas, search],
  );

  // El raíl se alimenta de las dos fuentes a la vez: «en curso» aporta estado y
  // progreso, las puertas aportan el porqué y el tiempo que te va a costar. Un
  // vídeo puede estar en ambas, así que se funden por id.
  const enVuelo: EnVuelo[] = (() => {
    const porId = new Map<string, EnVuelo>();
    for (const v of running) {
      const enVivo = live.renderProgress[v.video_id];
      porId.set(v.video_id, {
        video_id: v.video_id,
        title: v.title,
        state: v.state,
        nota: v.detail,
        eta_min: null,
        progreso: v.state === 'render' && enVivo !== undefined ? enVivo : (v.progress ?? null),
        incidencia:
          v.incident === null
            ? null
            : v.incident.suggested_action === null
              ? v.incident.message
              : `${v.incident.message} · puedes ${v.incident.suggested_action}`,
      });
    }
    for (const g of gates) {
      // el filtro de arriba ya excluye las puertas fuera del raíl; repetirlas
      // aquí es lo que deja a TypeScript probar que g.kind indexa ESTADO_DE_PUERTA
      if (
        g.video_id === null ||
        g.kind === 'idea' ||
        g.kind === 'entrega' ||
        g.kind === 'episodio_listo' ||
        g.kind === 'clips_episodio' ||
        g.kind === 'reel_plan'
      )
        continue;
      const previo = porId.get(g.video_id);
      porId.set(g.video_id, {
        video_id: g.video_id,
        title: g.title,
        state: previo?.state ?? ESTADO_DE_PUERTA[g.kind],
        nota: g.meta,
        eta_min: g.eta_min,
        progreso: null,
        incidencia: previo?.incidencia ?? null,
      });
    }
    return [...porId.values()];
  })();

  const atajos = esperandoFirma(enVuelo).slice(0, 3);
  useHotkeys((e) => {
    const n = Number.parseInt(e.key, 10);
    const destino = atajos[n - 1];
    if (destino !== undefined) void navigate(destino.href);
  });

  const monthBudget = inbox?.month_budget_usd ?? 0;
  const monthCost = inbox?.month_cost_usd ?? 0;
  const perVideo =
    inbox !== undefined && inbox.month_videos > 0 ? monthCost / inbox.month_videos : 0;

  if (isError) {
    return (
      <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px' }}>
        <div
          className="banner banner-danger"
          style={{ display: 'flex', alignItems: 'center', gap: 12 }}
        >
          <span style={{ flex: 1 }}>No se pudo cargar la bandeja. La API no responde.</span>
          <Button variant="secondary" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap-1160" style={{ padding: 'calc(var(--pad) * 2) 26px 72px' }}>
      {/* aviso de fuentes caídas: el funnel de ideas se seca en silencio */}
      {inbox !== undefined && inbox.stale_sources.length > 0 ? (
        <div className="banner" style={{ marginBottom: 'var(--pad)' }}>
          {inbox.stale_sources.length === 1
            ? `Fuente caída: ${inbox.stale_sources[0]!.label} (${inbox.stale_sources[0]!.failures} fallos). Revísala en Ajustes.`
            : `${inbox.stale_sources.length} fuentes de scraping caídas (${inbox.stale_sources
                .map((s) => s.label)
                .slice(0, 3)
                .join(', ')}${inbox.stale_sources.length > 3 ? '…' : ''}). Revísalas en Ajustes.`}
        </div>
      ) : null}

      {/* Lo primero de la página: dónde está cada vídeo en vuelo y si la
          máquina te necesita. Antes esto estaba debajo del radar, así que había
          que bajar para saber si había algo esperando tu firma. */}
      {isPending ? (
        <SkeletonRows rows={1} label="Cargando la línea de producción" />
      ) : (
        <LineaProduccion
          videos={enVuelo}
          esperasFuera={puertasFuera.length}
          minutosFuera={puertasFuera.reduce((acc, g) => acc + (g.eta_min ?? 0), 0)}
        />
      )}

      {/* clips de episodios y reels del editor: turno humano que no vive en
          el raíl, y por eso va ANTES que el radar — lo que espera tu firma
          nunca debajo del lanzador (auditoría S4.1, hallazgo 6). Ámbar como
          toda espera; cada ficha lleva a donde se resuelve (el caso sin
          encuadre lo reconduce el banner de la pantalla de clips). Shell de
          card silenciosa como el radar: el chrome del raíl (.linea) es solo
          suyo. */}
      {puertasFuera.length > 0 ? (
        <section
          className="card"
          style={{ padding: 'var(--pad)', marginBottom: 'var(--sec-gap)' }}
          aria-label="Clips y reels"
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <h2 className="head" style={{ fontSize: 17, margin: 0, whiteSpace: 'nowrap' }}>
              Clips y reels
            </h2>
            <div style={{ flex: 1 }} />
            <span className="mono fs-sm muted" style={{ whiteSpace: 'nowrap' }}>
              {puertasFuera.length === 1
                ? 'una pieza espera tu decisión'
                : `${puertasFuera.length} piezas esperan tu decisión`}
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 'var(--e-2)',
            }}
          >
            {puertasFuera.map((g) => (
              <Link
                key={`${g.kind}-${g.episode_id ?? g.reel_id ?? g.title}`}
                to={
                  g.kind === 'reel_plan'
                    ? g.reel_id != null
                      ? `/reels/${g.reel_id}`
                      : '/reels'
                    : // el selector de encuadre solo existe en /episodios: la
                      // ficha lleva allí mientras falte ese paso
                      g.episode_id != null && g.encuadre_pendiente !== true
                      ? `/episodios/${g.episode_id}/clips`
                      : '/episodios'
                }
                className="ficha"
                data-estado="espera"
              >
                <span className="ficha-titulo">{g.title}</span>
                <span className="ficha-detalle">{g.meta}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* el radar es el lanzador: se usa cuando no hay nada esperando, así
          que va detrás de todo lo que sí espera */}
      {activeChannelId !== null ? (
        <Radar channelId={activeChannelId} costeMedio={perVideo > 0 ? perVideo : null} />
      ) : null}

      <div
        id="publicados"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 'var(--pad)',
          scrollMarginTop: 'calc(var(--row) * 2 + 24px)',
        }}
      >
        <h2 className="head" style={{ fontSize: 17, margin: 0, whiteSpace: 'nowrap' }}>
          Lo que has hecho
        </h2>
        <span className="muted fs-sm">
          {done.length === 0
            ? 'todavía no hay ningún vídeo terminado'
            : 'pasa el ratón por encima para verlo en movimiento'}
        </span>
      </div>

      {done.length > 0 ? (
        <FiltrosEntregas
          filtro={filtroEntregas}
          onChange={setFiltroEntregas}
          visibles={entregas.length}
          total={done.length}
        />
      ) : null}

      {isPending ? (
        <SkeletonRows rows={2} label="Cargando las entregas" />
      ) : entregas.length === 0 && done.length > 0 ? (
        // «Nada pendiente de publicar» (el vacío de la galería) sería mentira
        // aquí: hay entregas, es el filtro el que no deja pasar ninguna
        <EmptyState title="Ningún vídeo en ese rango">
          <Button
            onClick={() => setFiltroEntregas({ ...filtroEntregas, desde: '', hasta: '' })}
            disabled={!hayFiltroDeFecha(filtroEntregas)}
          >
            Quitar filtros
          </Button>
        </EmptyState>
      ) : (
        <Galeria entregas={entregas} />
      )}

      {/* El coste cierra la página como una franja, no como una columna al lado
          de la galería: partir el ancho dejaba las entregas en dos por fila. */}
      <div className="franja-coste">
        <span className="muted fs-sm">Coste del mes</span>
        <span className="mono" style={{ fontSize: 20, fontWeight: 500 }}>
          {fmtMoney(monthCost)}
        </span>
        <div className="franja-coste-barra">
          <div
            style={{
              width: `${monthBudget > 0 ? Math.min(100, (monthCost / monthBudget) * 100) : 0}%`,
              height: '100%',
              background: 'var(--fg2)',
              opacity: 0.55,
            }}
          />
        </div>
        <span className="mono fs-sm muted">
          {inbox?.month_videos ?? 0} {(inbox?.month_videos ?? 0) === 1 ? 'vídeo' : 'vídeos'}
          {inbox !== undefined && inbox.month_videos > 0 ? ` · ${fmtMoney(perVideo)} cada uno` : ''}
        </span>
        <span className="mono fs-sm muted" style={{ whiteSpace: 'nowrap' }}>
          límite {fmtMoney(monthBudget)}
        </span>
      </div>
    </div>
  );
}
