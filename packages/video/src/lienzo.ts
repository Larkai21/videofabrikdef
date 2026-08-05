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

/**
 * Dónde se dibujan las marcas a mano y los micro-FX. Estaban cableadas en las
 * coordenadas de un SVG con `viewBox="0 0 1920 1080"`: como el SVG es
 * width/height 100 %, en un lienzo 1080×1920 no reventaba —salía a media escala
 * y en el sitio equivocado—, que es peor porque no lo denuncia nadie.
 *
 * Viven aquí y no en cada componente para que el único punto donde el formato
 * ramifica siga siendo `lienzoDe`.
 */
export interface Anclajes {
  microFx: { cx: number; cy: number };
  circulo: { cx: number; cy: number; rx: number; ry: number };
  subrayado: { x1: number; x2: number; y: number };
  tachado: { x1: number; x2: number; y: number };
  visto: { cx: number; cy: number; r: number };
  flecha: { x1: number; y1: number; x2: number; y2: number };
  /** top de la etiqueta opcional, según la forma que acompaña */
  etiqueta: { subrayado: number; flecha: number; tachado: number; otras: number };
}

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
  /**
   * Cuánto hay que escalar la tipografía de los efectos de edición.
   *
   * Sus tamaños están en píxeles absolutos calibrados sobre 1920 de ancho, así
   * que a 1080 salen 1,78x más grandes EN RELATIVO: medido, el texto cinético
   * del gancho ocupaba el ancho entero del short y competía con la cartela y
   * con los subtítulos. Escalar por esta fracción conserva el tamaño relativo
   * con el que se calibraron.
   */
  escala: number;
  anclajes: Anclajes;
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

const r = (total: number, fraccion: number): number => Math.round(total * fraccion);

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
      escala: 1,
      // Los mismos números que estaban escritos a mano, expresados como
      // fracción del lienzo. A 1920×1080 tienen que dar exactamente los de
      // antes, y hay un test que lo exige.
      anclajes: {
        // arriba a la derecha: no compite con las tarjetas (centro) ni con los
        // subtítulos (abajo)
        microFx: { cx: r(ancho, 1580 / 1920), cy: r(alto, 240 / 1080) },
        circulo: {
          cx: r(ancho, 0.5),
          cy: r(alto, 470 / 1080),
          rx: r(ancho, 320 / 1920),
          ry: r(alto, 210 / 1080),
        },
        subrayado: { x1: r(ancho, 620 / 1920), x2: r(ancho, 1300 / 1920), y: r(alto, 650 / 1080) },
        tachado: { x1: r(ancho, 620 / 1920), x2: r(ancho, 1300 / 1920), y: r(alto, 520 / 1080) },
        visto: { cx: r(ancho, 0.5), cy: r(alto, 470 / 1080), r: r(ancho, 190 / 1920) },
        flecha: {
          x1: r(ancho, 560 / 1920),
          y1: r(alto, 820 / 1080),
          x2: r(ancho, 900 / 1920),
          y2: r(alto, 540 / 1080),
        },
        etiqueta: {
          subrayado: r(alto, 500 / 1080),
          flecha: r(alto, 700 / 1080),
          tachado: r(alto, 380 / 1080),
          otras: r(alto, 210 / 1080),
        },
      },
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
    escala: ancho / 1920,
    columnaAcciones: {
      x: r(ancho, 0.88),
      y: r(alto, 0.52),
      ancho: r(ancho, 0.12),
    },
    // En vertical las marcas NO pueden ir donde iban. El ancla del micro-FX,
    // trasladada por fracción, caería en el borde de la cartela y cerca de la
    // columna de acciones; y los subtítulos se han ido al 67 % del alto, así
    // que la ventana limpia está libre y es donde se lee. Todo se centra ahí.
    anclajes: (() => {
      const centroY = Math.round((cartelaFin + subtitulosIni) / 2);
      const cx = r(ancho, 0.5);
      return {
        microFx: { cx, cy: centroY },
        circulo: { cx, cy: centroY, rx: r(ancho, 0.3), ry: r(alto, 0.11) },
        // los extremos se quedan cortos de la columna de acciones a propósito
        subrayado: { x1: r(ancho, 0.13), x2: r(ancho, 0.85), y: centroY + r(alto, 0.06) },
        tachado: { x1: r(ancho, 0.13), x2: r(ancho, 0.85), y: centroY },
        visto: { cx, cy: centroY, r: r(ancho, 0.18) },
        flecha: {
          x1: r(ancho, 0.28),
          y1: subtitulosIni - r(alto, 0.04),
          x2: r(ancho, 0.62),
          y2: cartelaFin + r(alto, 0.06),
        },
        etiqueta: {
          subrayado: centroY - r(alto, 0.09),
          flecha: cartelaFin + r(alto, 0.02),
          tachado: centroY - r(alto, 0.11),
          otras: cartelaFin + r(alto, 0.02),
        },
      };
    })(),
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
