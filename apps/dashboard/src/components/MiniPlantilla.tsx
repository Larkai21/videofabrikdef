import { useEffect, useRef, useState } from 'react';
import { plantillaUrl } from '../lib/editor-catalogo';

// Miniatura VIVA de una plantilla del editor: el mismo iframe same-origin de
// la galería (proxy /files → API), escalado a tamaño de sello y congelado a
// mitad del gesto, que es donde la pieza ya está desplegada. No es una
// captura: es la plantilla real con el config REAL de la capa, así que tocar
// el config en la puerta se ve aquí al instante, antes de gastar un render.

interface VentanaConTpl extends Window {
  TPL?: {
    setup: (cfg: Record<string, unknown>) => void;
    seek: (t: number) => void;
    duration?: number;
  };
}

export function MiniPlantilla({
  plantilla,
  config,
  ancho = 72,
  animar = false,
}: {
  plantilla: string;
  config?: Record<string, unknown> | undefined;
  /** ancho del sello en px; el alto sale del lienzo 1080×1920 */
  ancho?: number;
  /** true = reproduce el gesto en bucle (hover de la galería) en vez de congelar */
  animar?: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [cargado, setCargado] = useState(false);
  const escala = ancho / 1080;

  // el config serializado como dependencia: el objeto cambia de identidad en
  // cada render del padre y lo que importa es su contenido
  const configJson = JSON.stringify(config ?? {});

  useEffect(() => {
    if (!cargado) return;
    const api = (iframeRef.current?.contentWindow as VentanaConTpl | null)?.TPL;
    if (api === undefined) return;
    api.setup(JSON.parse(configJson) as Record<string, unknown>);
    const dur = typeof api.duration === 'number' && api.duration > 0 ? api.duration : 2;
    api.seek(dur / 2);
  }, [cargado, configJson]);

  // bucle de reproducción por rAF haciendo seek: la misma semántica
  // determinista del rasterizador, igual que el visor grande de la galería
  useEffect(() => {
    if (!cargado || !animar) return;
    const api = (iframeRef.current?.contentWindow as VentanaConTpl | null)?.TPL;
    if (api === undefined) return;
    const dur = typeof api.duration === 'number' && api.duration > 0 ? api.duration : 2;
    let t = 0;
    let antes = performance.now();
    let raf = 0;
    const paso = (ahora: number) => {
      t = (t + (ahora - antes) / 1000) % dur;
      antes = ahora;
      api.seek(t);
      raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [cargado, animar]);

  return (
    <div
      // decorativa: la información de la capa está en el texto de la fila
      aria-hidden="true"
      style={{
        width: Math.round(1080 * escala),
        height: Math.round(1920 * escala),
        overflow: 'hidden',
        borderRadius: 6,
        border: '1px solid var(--line)',
        background: '#000',
        flexShrink: 0,
      }}
    >
      <iframe
        ref={iframeRef}
        title={`Miniatura de ${plantilla}`}
        src={plantillaUrl(plantilla)}
        onLoad={() => setCargado(true)}
        tabIndex={-1}
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
  );
}
