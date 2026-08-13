import type { VideoState } from '@fabrica/shared';
import { Link } from 'react-router-dom';

// La línea de producción: el raíl de la fábrica con cada vídeo en vuelo situado
// en su fase real.
//
// Antes esto eran DOS bloques —«Te espera» y «En curso»— que contaban lo mismo
// partido en dos: dónde está cada vídeo. Aquí se ve de un vistazo si la máquina
// te necesita, y por qué, sin leer una lista.
//
// El color hace todo el trabajo: ámbar = tu turno, cian = la máquina trabaja.

// Solo TRABAJO EN VUELO. Las ideas viven en el radar (que es el lanzador) y lo
// terminado en la galería: meterlos también aquí sería contar lo mismo tres
// veces, que es justo el defecto que esta pieza viene a arreglar.
const FASES = [
  { id: 'guion', label: 'Guion' },
  { id: 'voz', label: 'Voz' },
  { id: 'planos', label: 'Planos' },
  { id: 'render', label: 'Render' },
] as const;

type FaseId = (typeof FASES)[number]['id'];

/** Qué fase ocupa un estado, y si el turno es del humano o de la máquina. */
const UBICACION: Record<VideoState, { fase: FaseId; espera: boolean; detalle: string } | null> = {
  idea: null,
  idea_aprobada: { fase: 'guion', espera: false, detalle: 'escribiendo el guion' },
  guion_borrador: { fase: 'guion', espera: true, detalle: 'espera tu firma' },
  guion_ok: { fase: 'voz', espera: false, detalle: 'sintetizando la voz' },
  audio: { fase: 'voz', espera: false, detalle: 'cortando los beats' },
  assets: { fase: 'planos', espera: true, detalle: 'espera que cures los planos' },
  timeline_ok: { fase: 'render', espera: false, detalle: 'en cola de render' },
  render: { fase: 'render', espera: false, detalle: 'renderizando' },
  // lo terminado sale de la línea y baja a la galería
  hecho: null,
  // una incidencia no está en ninguna fase: está fuera de la línea
  incidencia: null,
};

const RUTA: Record<FaseId, (id: string) => string> = {
  guion: (id) => `/videos/${id}/guion`,
  voz: (id) => `/videos/${id}/timeline`,
  planos: (id) => `/videos/${id}/timeline`,
  render: (id) => `/videos/${id}/timeline`,
};

export interface EnVuelo {
  video_id: string;
  title: string;
  state: VideoState;
  /** lo que la máquina dice de este vídeo ahora mismo, si dice algo */
  nota: string | null;
  /** minutos de trabajo humano estimados, solo cuando el turno es tuyo */
  eta_min: number | null;
  /** 0-100 mientras la máquina trabaja */
  progreso: number | null;
  /** mensaje de la incidencia que lo ha parado */
  incidencia: string | null;
}

interface Situado extends EnVuelo {
  fase: FaseId;
  espera: boolean;
  detalle: string;
}

function situar(videos: EnVuelo[]): Situado[] {
  return videos.flatMap((v) => {
    const u = UBICACION[v.state];
    return u === null || v.incidencia !== null ? [] : [{ ...v, ...u }];
  });
}

/**
 * Los vídeos que esperan tu firma, en el orden en que los pinta el raíl.
 * Lo exporta para que el atajo de teclado y la insignia numérica no puedan
 * discrepar: ambos leen de aquí.
 */
export function esperandoFirma(videos: EnVuelo[]): { video_id: string; href: string }[] {
  const situados = situar(videos);
  return FASES.flatMap((fase) =>
    situados
      .filter((v) => v.fase === fase.id && v.espera)
      .map((v) => ({ video_id: v.video_id, href: RUTA[fase.id](v.video_id) })),
  );
}

export function LineaProduccion({
  videos,
  esperasFuera = 0,
  minutosFuera = 0,
}: {
  videos: EnVuelo[];
  /** puertas humanas que viven FUERA del raíl (clipping): la cabecera es la
      única voz que resume si la máquina te necesita, así que no puede decir
      «la línea está parada» con trabajo ámbar esperando justo debajo */
  esperasFuera?: number;
  minutosFuera?: number;
}) {
  const situados = situar(videos);
  const esperando = situados.filter((v) => v.espera);
  const trabajando = situados.filter((v) => !v.espera);
  const paradas = videos.filter((v) => v.incidencia !== null);
  const atajos = new Map(
    esperandoFirma(videos)
      .slice(0, 3)
      .map((a, i) => [a.video_id, i + 1]),
  );
  const minutos =
    esperando.reduce((acc, v) => acc + (v.eta_min ?? 0), 0) +
    (esperando.length > 0 || esperasFuera > 0 ? minutosFuera : 0);

  return (
    <section className="linea" aria-label="Línea de producción">
      <div className="linea-cabecera">
        <h2 className="linea-titulo">
          {esperando.length > 0
            ? esperando.length === 1
              ? 'Un vídeo espera tu firma'
              : `${esperando.length} vídeos esperan tu firma`
            : esperasFuera > 0
              ? 'Hay piezas esperando tu firma'
              : trabajando.length > 0
                ? 'La máquina trabaja sola'
                : 'La línea está parada'}
        </h2>
        <span className="linea-resumen mono">
          {(esperando.length > 0 || esperasFuera > 0) && minutos > 0
            ? `unos ${minutos} min de trabajo tuyo`
            : trabajando.length > 0
              ? `${trabajando.length} ${trabajando.length === 1 ? 'vídeo' : 'vídeos'} en proceso`
              : esperasFuera > 0
                ? 'las puertas están más abajo'
                : 'lanza una idea para empezar'}
        </span>
      </div>

      <div className="linea-rail">
        {FASES.map((fase) => {
          const aqui = situados.filter((v) => v.fase === fase.id);
          const esperaAqui = aqui.some((v) => v.espera);
          return (
            <div key={fase.id} className="linea-fase">
              <div
                className="linea-marca"
                data-estado={aqui.length === 0 ? 'vacia' : esperaAqui ? 'espera' : 'maquina'}
              />
              <span className="linea-etiqueta">{fase.label}</span>
              <div className="linea-fichas">
                {aqui.map((v) => {
                  const atajo = atajos.get(v.video_id);
                  return (
                    <Link
                      key={v.video_id}
                      to={RUTA[fase.id](v.video_id)}
                      className="ficha"
                      data-estado={v.espera ? 'espera' : 'maquina'}
                    >
                      <span className="ficha-titulo">{v.title}</span>
                      <span className="ficha-detalle">
                        {v.nota ?? v.detalle}
                        {v.progreso !== null ? ` · ${Math.round(v.progreso)} %` : ''}
                      </span>
                      {atajo !== undefined ? (
                        <span className="ficha-atajo kbd-block">{atajo}</span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {paradas.length > 0 ? (
        <div className="linea-incidencias">
          {paradas.map((v) => {
            // el fallo se abre donde ocurrió, no siempre en el guion
            const fase = UBICACION[v.state]?.fase ?? 'guion';
            return (
              <Link
                key={v.video_id}
                to={RUTA[fase](v.video_id)}
                className="ficha"
                data-estado="fallo"
              >
                <span className="ficha-titulo">{v.title}</span>
                <span className="ficha-detalle">{v.incidencia}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
