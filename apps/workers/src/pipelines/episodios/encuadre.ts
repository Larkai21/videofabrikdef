// Tracking continuo del hablante DENTRO del plano (funciones puras).
//
// El encuadre por tramo dejaba la x clavada aunque el hablante se meciera:
// el editor humano del canal de referencia lo corrige con keyframes a mano.
// Aquí el sidecar de Vision ya muestrea la cara cada ~1,2 s; estas funciones
// convierten esa serie en un paneo suave y DETERMINISTA (principio 6: misma
// serie → mismos keyframes; nada se analiza durante el render, el pre-corte
// lo hornea igual que la x fija).

export interface KeyframeEncuadre {
  /** reloj que decida el llamador; aquí solo se exige monótono creciente */
  t_ms: number;
  /** centro del recorte, 0..1 sobre el ancho del origen */
  x: number;
}

/**
 * Media móvil de ventana 3 (centrada, bordes con lo que hay): quita el ruido
 * de detección sin inventar posiciones — un solo fotograma con la cara mal
 * detectada no debe mover la cámara.
 */
function mediaMovil(kf: readonly KeyframeEncuadre[]): KeyframeEncuadre[] {
  return kf.map((k, i) => {
    const ventana = kf.slice(Math.max(0, i - 1), Math.min(kf.length, i + 2));
    const x = ventana.reduce((acc, v) => acc + v.x, 0) / ventana.length;
    return { t_ms: k.t_ms, x: Number(x.toFixed(4)) };
  });
}

/**
 * Zona muerta: por debajo de este delta el encuadre NO se mueve. 0,02 del
 * ancho de origen (~38 px a 1920) es micro-vaivén de hombros; perseguirlo
 * marea más que el defecto que se quiere arreglar.
 */
export const ZONA_MUERTA_X = 0.02;

/**
 * Serie muestreada → keyframes de paneo: arranca en la x del tramo (la que
 * el pre-corte usaría fija), suaviza con media móvil y solo emite keyframe
 * cuando la deriva supera la zona muerta. Con una serie corta o quieta
 * devuelve solo el arranque — el llamador entiende «1 keyframe = x fija».
 */
export function suavizarKf(
  xBase: number,
  kf: readonly KeyframeEncuadre[],
  zonaMuerta: number = ZONA_MUERTA_X,
): KeyframeEncuadre[] {
  const inicio: KeyframeEncuadre = { t_ms: kf[0]?.t_ms ?? 0, x: Number(xBase.toFixed(4)) };
  if (kf.length < 2) return [inicio];
  const suaves = mediaMovil(kf);
  const salida: KeyframeEncuadre[] = [inicio];
  for (const k of suaves) {
    const ultimo = salida[salida.length - 1]!;
    if (k.t_ms <= ultimo.t_ms) continue;
    if (Math.abs(k.x - ultimo.x) > zonaMuerta) salida.push(k);
  }
  return salida;
}

/**
 * Keyframes en píxeles → expresión de ffmpeg para `crop=w:h:x='…':0`:
 * interpolación lineal a trozos sobre `t` (el reloj del SEGMENTO ya cortado
 * con -ss, que arranca en 0). Antes del primer keyframe vale el primero;
 * después del último, el último — sin extrapolar.
 */
export function exprCropX(puntos: readonly { t_s: number; x_px: number }[]): string {
  if (puntos.length === 0) return '0';
  if (puntos.length === 1) return String(Math.round(puntos[0]!.x_px));
  let expr = String(Math.round(puntos[puntos.length - 1]!.x_px));
  for (let i = puntos.length - 2; i >= 0; i -= 1) {
    const a = puntos[i]!;
    const b = puntos[i + 1]!;
    const dt = Math.max(0.001, b.t_s - a.t_s);
    const lerp =
      `${Math.round(a.x_px)}+(${Math.round(b.x_px)}-${Math.round(a.x_px)})*` +
      `(t-${a.t_s.toFixed(3)})/${dt.toFixed(3)}`;
    // antes del primer punto no se interpola: se sostiene su valor
    const tramo = i === 0 ? `if(lt(t,${a.t_s.toFixed(3)}),${Math.round(a.x_px)},${lerp})` : lerp;
    expr = `if(lt(t,${b.t_s.toFixed(3)}),${tramo},${expr})`;
  }
  return expr;
}
