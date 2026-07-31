import type { DesignTokens } from '@fabrica/shared';
import { hexToRgba } from '@fabrica/shared';

// Tokens de motion graphics portados de `editor-youtube/templates/_tokens.css`.
//
// Se copian las MEDIDAS —escala tipográfica, espaciado, radios, la rampa del
// material— porque son las que dan el aire del catálogo, y están calibradas:
// la escala de texto lleva los valores redondeados a partir de una progresión,
// con el comentario de cuál cambió y por qué.
//
// Lo que NO se copia es la paleta. Aquel repo es «papel y tinta» con azul de
// sello, y este canal tiene la suya en el design system del brand kit, editable
// por canal. Los COLORES salen siempre de `DesignTokens`; lo que se hereda es
// el reparto de papeles: qué es fondo, qué es tinta, qué manda y qué acompaña.
//
// La razón de que la paleta no se copie no es solo que sea de otro canal: allí
// está argumentada contra sí misma —el acento es azul porque el rojo quedaba a
// ΔE 4,5 de la señal de error— y trasplantar los hex sin ese razonamiento sería
// quedarse con el resultado y perder el motivo.

/**
 * Escala tipográfica. Los comentarios son del original: dicen para qué sirve
 * cada paso, que es lo que evita usarlos por tamaño en vez de por papel.
 */
export const T = {
  xs2: 16, // unidad, pie de nota, sello
  xs: 19, // rótulo mono, etiqueta
  sm: 23, // cuerpo secundario
  md: 27, // cuerpo
  lg: 33, // entradilla
  xl: 46, // titular corto
  xl2: 61, // titular
  xl3: 82, // titular a plena página
  hero: 109, // cifra protagonista
  mega: 145, // cifra que ocupa el plano
} as const;

/** Espaciado. Progresión del original, sin tocar. */
export const S = {
  1: 6,
  2: 10,
  3: 14,
  4: 18,
  5: 26,
  6: 34,
  7: 48,
  8: 64,
} as const;

/** Radios. */
export const R = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * Los tres papeles tipográficos, tal y como los define la guía de origen:
 * display AFIRMA, subs NARRA, mono MIDE. La familia concreta la pone el design
 * system del canal; aquí solo se conserva la distinción de papel y el respaldo.
 */
export function familias(d: DesignTokens): { display: string; subs: string; mono: string } {
  const propia = d.font_family;
  return {
    display: `"${propia}", "Plus Jakarta Sans", Inter, system-ui, sans-serif`,
    subs: `"${propia}", Inter, "SF Pro Text", system-ui, sans-serif`,
    mono: `"Geist Mono", "JetBrains Mono", "SF Mono", Menlo, monospace`,
  };
}

/**
 * La rampa del acento: cinco paradas que son el MATERIAL del color, no cinco
 * colores distintos. En el original se llama `--metal-1..5` por herencia de una
 * paleta anterior y su test comprueba que ninguna se despegue más de ΔE 45 del
 * acento.
 *
 * Aquí se DERIVA del acento del canal en vez de fijarse a mano, que es lo que
 * permite que cambie con el brand kit sin romper la relación entre las paradas.
 */
export function rampa(d: DesignTokens): [string, string, string, string, string] {
  return [
    mezcla(d.accent, d.background, 0.45),
    mezcla(d.accent, d.background, 0.2),
    mezcla(d.accent, d.foreground, 0.35),
    d.accent,
    mezcla(d.accent, d.background, 0.6),
  ];
}

/** El halo de legibilidad tras el texto. Sin esto, un overlay claro sobre un plano claro no se lee. */
export function scrimColor(d: DesignTokens): string {
  return hexToRgba(d.background, 0.82);
}

/** Fondo tenue del acento, para rótulos y bordes activos. */
export function acentoSuave(d: DesignTokens): string {
  return hexToRgba(d.accent, 0.13);
}

/** Mezcla dos hex en el espacio sRGB. Determinista y sin dependencias. */
export function mezcla(a: string, b: string, cuanto: number): string {
  const p = (h: string): [number, number, number] => {
    let s = h.replace('#', '');
    if (s.length === 3)
      s = s
        .split('')
        .map((c) => c + c)
        .join('');
    return [
      Number.parseInt(s.slice(0, 2), 16),
      Number.parseInt(s.slice(2, 4), 16),
      Number.parseInt(s.slice(4, 6), 16),
    ];
  };
  const [r1, g1, b1] = p(a);
  const [r2, g2, b2] = p(b);
  const k = Math.max(0, Math.min(1, cuanto));
  const c = (x: number, y: number): string =>
    Math.round(x + (y - x) * k)
      .toString(16)
      .padStart(2, '0');
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

/**
 * Los colores de SEÑAL no son de marca y no cambian con la paleta: un visto
 * verde y un choque rojo significan lo que significan, y volverlos del color
 * del canal sería quitarles el sentido para ganar coherencia. Copiados tal cual
 * del original, que lo argumenta igual.
 */
export const SENAL = {
  ok: '#3DD68C',
  no: '#E5484D',
} as const;
