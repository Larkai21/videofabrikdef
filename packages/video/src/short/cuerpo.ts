// Geometría y tiempos del titular de la cartela, sin React: puros para poder
// comprobar la contención por aritmética en CI (igual que `cuerpoDeGrupo` con
// los subtítulos) y para que el worker de render pueda importar los frames por
// el subpath '@fabrica/video/cartela' sin arrastrar la composición.

export const CARTELA_ENTRADA_FRAMES = 12;
export const CARTELA_PERMANENCIA_FRAMES = 75;
export const CARTELA_SALIDA_FRAMES = 10;
export const CARTELA_FRAMES =
  CARTELA_ENTRADA_FRAMES + CARTELA_PERMANENCIA_FRAMES + CARTELA_SALIDA_FRAMES;
/** Dónde ATERRIZA el titular: ahí cae el golpe de arranque (kitSfxCues). */
export const CARTELA_ATERRIZA_FRAME = CARTELA_ENTRADA_FRAMES;
/** Dónde empieza a retirarse: ahí entra el destello que tapa la salida. */
export const CARTELA_SALE_FRAME = CARTELA_ENTRADA_FRAMES + CARTELA_PERMANENCIA_FRAMES;

/** Padding del bloque de la cartela; lo usa también el cálculo del cuerpo. */
export const CARTELA_PAD_X = 26;
export const CARTELA_PAD_Y = 18;
export const CARTELA_INTERLINEA = 1.12;

/**
 * Cuerpo del titular que CABE en la banda de la cartela, en ≤2 líneas.
 *
 * Existe porque 54 px cableados eran el 5 % del ancho por accidente y no
 * había ningún clamp: el contrato permite 60 caracteres (y el PATCH humano
 * también), que a 54 px envuelven a 3+ líneas y desbordan la banda hacia la
 * ventana limpia sin que nadie lo vea. Mismo estimador de glifo que
 * `cuerpoDeGrupo` (Inter 800 ≈ 0,55 em).
 */
export function cuerpoDeCartela(
  titulo: string,
  lienzo: {
    ancho: number;
    safe: { left: number; right: number };
    zonas: { cartela: readonly [number, number] };
  },
): number {
  const [ini, fin] = lienzo.zonas.cartela;
  const anchoUtil = lienzo.ancho - lienzo.safe.left - lienzo.safe.right - 2 * CARTELA_PAD_X;
  const altoUtil = fin - ini - 2 * CARTELA_PAD_Y;
  const MAX = Math.round(lienzo.ancho * 0.05); // 54 a 1080: el tamaño de siempre
  const MIN = Math.round(lienzo.ancho * 0.033); // ≈36: por debajo ya no es titular
  const GLIFO = 0.55;
  const chars = Math.max(1, titulo.trim().length);
  for (let cuerpo = MAX; cuerpo >= MIN; cuerpo -= 2) {
    const porLinea = Math.max(1, Math.floor(anchoUtil / (GLIFO * cuerpo)));
    const lineas = Math.ceil(chars / porLinea);
    if (lineas <= 2 && lineas * cuerpo * CARTELA_INTERLINEA <= altoUtil) return cuerpo;
  }
  return MIN;
}
