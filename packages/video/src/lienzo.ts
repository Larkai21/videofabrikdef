import { useVideoConfig } from 'remotion';
import { SHORT_HEIGHT, SHORT_WIDTH, VIDEO_HEIGHT, VIDEO_WIDTH } from '@fabrica/shared';

// De qué lienzo se está pintando. Un módulo, no un contexto de React: un
// contexto obligaría a envolver el árbol y —lo que lo mata— los componentes del
// brand kit de terceros llegan en un zip y solo conocen sus props y las APIs de
// Remotion, así que no podrían importarlo. `useVideoConfig()` sí lo tienen.
//
// `lienzoDe` es pura para poder comprobar las zonas sin renderizar nada.

export interface SafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Franja vertical [desde, hasta] en píxeles. */
export type Zona = readonly [number, number];

export interface Lienzo {
  ancho: number;
  alto: number;
  vertical: boolean;
  safe: SafeArea;
  zonas: {
    /** banda superior donde vive un callout o el rótulo de gancho */
    cartela: Zona;
    /** el grueso de la pantalla: b-roll y tarjetas */
    ventana: Zona;
    /** el eje de lectura */
    subtitulos: Zona;
  };
  /**
   * Rectángulo que la interfaz de la plataforma tapa a la derecha (like,
   * comentario, compartir). Null en apaisado. Se modela como RECTÁNGULO y no
   * como banda de altura completa: como banda marcaría cualquier gráfico ancho
   * y centrado como problema, y esos no la tocan.
   */
  columnaAcciones: { x: number; y: number; ancho: number } | null;
  viewBox: string;
  /** fracción del lienzo → píxeles */
  fr: (fx: number, fy: number) => [number, number];
}

/**
 * Márgenes del lienzo vertical. NO son una estimación: salen de medir dos
 * capturas de iPhone 1179×2556 de reels distintos (editor-youtube,
 * BRAND_RULES.md §18). Cabecera de la app 11,7 % → se adopta 12 %; usuario,
 * copy, progreso y pestañas 25,5 % → se adopta 24,5 % redondeando SIEMPRE hacia
 * arriba, nunca hacia abajo.
 *
 * Aviso que se copia tal cual del original: está medido en Reels; en Shorts y
 * en TikTok no. Instagram además puede encajar por ancho con bandas negras, en
 * cuyo caso la interfaz tapa MENOS lienzo, así que estas fracciones son el caso
 * conservador y están del lado correcto.
 *
 * Tercer testigo independiente: el único montaje 1080×1920 completo del
 * catálogo de HyperFrames pone sus subtítulos en `bottom: 672`, aún más
 * conservador que esto.
 */
const VERTICAL_PLATAFORMA_SUP = 0.12;
const VERTICAL_PLATAFORMA_INF = 0.245;
/** Márgenes tipográficos, no la columna de acciones: si `right` fuese el ancho
 * de la columna, todo lo centrado se descentraría. */
const VERTICAL_MARGEN_LATERAL = 96;

export function lienzoDe(ancho: number, alto: number): Lienzo {
  const vertical = alto > ancho;
  const fr = (fx: number, fy: number): [number, number] => [ancho * fx, alto * fy];
  const viewBox = `0 0 ${ancho} ${alto}`;

  if (!vertical) {
    // Los del vídeo largo, medidos a ojo en su día y ya calibrados contra ocho
    // minutos de material: se conservan tal cual.
    const safe = { top: 90, right: 160, bottom: 120, left: 160 };
    return {
      ancho,
      alto,
      vertical,
      safe,
      zonas: {
        cartela: [safe.top, Math.round(alto * 0.3)],
        ventana: [Math.round(alto * 0.3), alto - safe.bottom],
        subtitulos: [alto - safe.bottom - Math.round(alto * 0.18), alto - safe.bottom],
      },
      columnaAcciones: null,
      viewBox,
      fr,
    };
  }

  const plataformaSup = Math.round(alto * VERTICAL_PLATAFORMA_SUP);
  const plataformaInf = Math.round(alto * VERTICAL_PLATAFORMA_INF);
  const safe = {
    top: plataformaSup,
    right: VERTICAL_MARGEN_LATERAL,
    bottom: plataformaInf,
    left: VERTICAL_MARGEN_LATERAL,
  };
  // cartela 200 px, subtítulos 310 px, y la ventana limpia se queda con el resto
  const cartelaFin = plataformaSup + 200;
  const subtitulosIni = alto - plataformaInf - 310;

  return {
    ancho,
    alto,
    vertical,
    safe,
    zonas: {
      cartela: [plataformaSup, cartelaFin],
      ventana: [cartelaFin, subtitulosIni],
      subtitulos: [subtitulosIni, alto - plataformaInf],
    },
    columnaAcciones: {
      x: Math.round(ancho * 0.88),
      y: Math.round(alto * 0.52),
      ancho: Math.round(ancho * 0.12),
    },
    viewBox,
    fr,
  };
}

/** El lienzo de la composición que se está pintando. */
export function useLienzo(): Lienzo {
  const { width, height } = useVideoConfig();
  return lienzoDe(width, height);
}

export const LIENZO_LARGO = lienzoDe(VIDEO_WIDTH, VIDEO_HEIGHT);
export const LIENZO_SHORT = lienzoDe(SHORT_WIDTH, SHORT_HEIGHT);
