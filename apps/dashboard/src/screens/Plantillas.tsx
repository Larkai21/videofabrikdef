import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  getCatalogoEditor,
  plantillaUrl,
  type PiezaCatalogo,
} from '../lib/editor-catalogo';
import { Button, Chip, EmptyState, SkeletonRows } from '../components/ui';

// Galería de las plantillas del módulo editor: el CATALOGO.json que el agente
// guionista ya consume, ahora navegable. La previsualización es la plantilla
// DE VERDAD en un iframe same-origin (proxy /files de Vite): _engine.js
// auto-arranca su demo y el scrubber llama a TPL.seek — mismo píxel que el
// render, sin renderizar nada.

interface VentanaConTpl extends Window {
  TPL?: {
    setup: (cfg: Record<string, unknown>) => void;
    seek: (t: number) => void;
    duration?: number;
  };
}

/**
 * El visor: iframe 1080×1920 escalado por CSS (las plantillas maquetan a px
 * sobre ese lienzo) + scrubber. «Play» es un bucle de requestAnimationFrame
 * haciendo seek — la MISMA semántica determinista del rasterizador, no un
 * reloj propio del iframe.
 */
function VisorPlantilla({ pieza }: { pieza: PiezaCatalogo }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [dur, setDur] = useState(pieza.gesto_s ?? 6);
  const [t, setT] = useState(0);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [tema, setTema] = useState<'carbon' | 'paper'>('carbon');

  const tpl = (): VentanaConTpl['TPL'] =>
    (iframeRef.current?.contentWindow as VentanaConTpl | null)?.TPL;

  // al cargar la plantilla: re-setup con el tema elegido y lee su duración
  const alCargar = () => {
    const api = tpl();
    if (api === undefined) return;
    api.setup({ tema });
    if (typeof api.duration === 'number' && api.duration > 0) setDur(api.duration);
    setT(0);
    api.seek(0);
  };

  // el tema re-instancia la demo (setup pisa el estado del gesto), así que
  // el gesto vuelve a empezar: más honesto que hacer seek a un estado pisado
  useEffect(() => {
    const api = tpl();
    if (api === undefined) return;
    api.setup({ tema });
    setT(0);
    api.seek(0);
  }, [tema]);

  // play por rAF: avanza t y hace seek; en el final vuelve a cero y sigue
  useEffect(() => {
    if (!reproduciendo) return;
    let raf = 0;
    let antes = performance.now();
    const paso = (ahora: number) => {
      const dt = (ahora - antes) / 1000;
      antes = ahora;
      setT((prev) => {
        const sig = prev + dt >= dur ? 0 : prev + dt;
        tpl()?.seek(sig);
        return sig;
      });
      raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [reproduciendo, dur]);

  // ~304 px de ancho de visor: 1080 × factor
  const escala = 304 / 1080;

  return (
    <div style={{ display: 'grid', gap: 10, justifyItems: 'stretch' }}>
      <div
        style={{
          width: Math.round(1080 * escala),
          height: Math.round(1920 * escala),
          overflow: 'hidden',
          borderRadius: 'var(--r)',
          border: '1px solid var(--line)',
          background: '#000',
        }}
      >
        <iframe
          ref={iframeRef}
          title={pieza.plantilla}
          src={plantillaUrl(pieza.plantilla)}
          onLoad={alCargar}
          style={{
            width: 1080,
            height: 1920,
            border: 0,
            transform: `scale(${escala})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button
          variant="secondary"
          onClick={() => setReproduciendo((r) => !r)}
          aria-label={reproduciendo ? 'Pausar' : 'Reproducir'}
        >
          {reproduciendo ? '⏸' : '▶'}
        </Button>
        <input
          type="range"
          min={0}
          max={dur}
          step={0.05}
          value={t}
          aria-label="Segundo del gesto"
          style={{ flex: 1 }}
          onChange={(e) => {
            const v = Number(e.target.value);
            setReproduciendo(false);
            setT(v);
            tpl()?.seek(v);
          }}
        />
        <span className="mono fs-sm muted" style={{ minWidth: 76, textAlign: 'right' }}>
          {t.toFixed(1)} / {dur.toFixed(1)} s
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="muted fs-sm">Tema</span>
        {(['carbon', 'paper'] as const).map((op) => (
          <Button
            key={op}
            variant={tema === op ? 'primary' : 'secondary'}
            onClick={() => setTema(op)}
          >
            {op}
          </Button>
        ))}
      </div>
      <div className="muted fs-sm" style={{ lineHeight: 1.5 }}>
        {pieza.admite_copy
          ? 'Admite copy: sus ranuras de texto se rellenan desde el guion.'
          : 'NO admite copy: su texto vive en el marcado; darle copy aborta el plan.'}
        {pieza.config.length > 0 ? (
          <>
            {' '}
            Config: <span className="mono">{pieza.config.join(', ')}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function Plantillas() {
  const catalogoQ = useQuery({
    queryKey: ['editor-catalogo'],
    queryFn: getCatalogoEditor,
    staleTime: Infinity,
  });
  // ?q= permite el enlace profundo desde la puerta del reel («ver plantilla»)
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [origen, setOrigen] = useState<'todas' | 'propia' | 'hyperframes'>('todas');
  const [soloCopy, setSoloCopy] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);

  const piezas = (catalogoQ.data?.piezas ?? []).filter(
    (p) =>
      (origen === 'todas' || p.origen === origen) &&
      (!soloCopy || p.admite_copy) &&
      (q.trim() === '' || p.plantilla.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const seleccionada =
    piezas.find((p) => p.plantilla === abierta) ?? piezas[0] ?? null;

  return (
    <div className="wrap-1320" style={{ padding: 'calc(var(--pad) * 2) 26px 72px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 'var(--gap)',
        }}
      >
        <h1 className="head" style={{ fontSize: 18, margin: 0 }}>
          Plantillas del editor
        </h1>
        {catalogoQ.data !== undefined ? (
          <span className="mono fs-sm muted">
            {piezas.length} de {catalogoQ.data.piezas_totales} · {catalogoQ.data.lienzo}
          </span>
        ) : null}
        <div style={{ flex: 1 }} />
        <Link className="btn btn-ghost" to="/reels">
          ← Reels
        </Link>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 'var(--gap)' }}>
        <input
          className="control"
          type="search"
          placeholder="Buscar plantilla…"
          aria-label="Buscar plantilla"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select
          className="control"
          aria-label="Origen"
          value={origen}
          onChange={(e) => setOrigen(e.target.value as typeof origen)}
          style={{ width: 170 }}
        >
          <option value="todas">Todas ({catalogoQ.data?.piezas_totales ?? '…'})</option>
          <option value="propia">Propias</option>
          <option value="hyperframes">HyperFrames</option>
        </select>
        <Button
          variant={soloCopy ? 'primary' : 'secondary'}
          onClick={() => setSoloCopy((v) => !v)}
        >
          Solo con copy
        </Button>
      </div>

      {catalogoQ.isPending ? (
        <SkeletonRows rows={4} label="Cargando el catálogo" />
      ) : catalogoQ.isError ? (
        <EmptyState title="El catálogo no está servido">
          {catalogoQ.error instanceof Error
            ? catalogoQ.error.message
            : 'Comprueba que la API esté en marcha.'}
        </EmptyState>
      ) : piezas.length === 0 ? (
        <EmptyState title="Ninguna plantilla casa con el filtro">
          Prueba con otro texto u otro origen.
        </EmptyState>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 320px',
            gap: 'var(--gap)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
              gap: 'var(--e-2)',
              alignContent: 'start',
            }}
          >
            {piezas.map((p) => (
              <button
                key={p.plantilla}
                type="button"
                className="card"
                onClick={() => setAbierta(p.plantilla)}
                style={{
                  padding: 'var(--pad)',
                  display: 'grid',
                  gap: 6,
                  textAlign: 'left',
                  cursor: 'pointer',
                  outline:
                    seleccionada?.plantilla === p.plantilla
                      ? '1px solid var(--accent)'
                      : undefined,
                }}
              >
                <span className="mono fs-sm" style={{ wordBreak: 'break-all' }}>
                  {p.plantilla.replace(/\.html$/, '')}
                </span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Chip kind={p.origen === 'propia' ? 'ok' : 'neutral'}>
                    {p.origen === 'propia' ? 'propia' : 'HF'}
                  </Chip>
                  {p.admite_copy ? <Chip kind="warn">copy</Chip> : null}
                  {p.gesto_s !== null ? (
                    <span className="mono fs-sm muted">{p.gesto_s}s</span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>

          <div
            style={{ position: 'sticky', top: 'calc(var(--row) * 2 + 18px)', alignSelf: 'start' }}
          >
            {seleccionada !== null ? (
              // key: cambiar de pieza re-monta el visor entero (iframe nuevo)
              <VisorPlantilla key={seleccionada.plantilla} pieza={seleccionada} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
