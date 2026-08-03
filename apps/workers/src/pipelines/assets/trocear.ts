import {
  CLIP_MAX_S,
  IMAGE_MAX_S,
  TROCEO_MAX_PARTES,
  TROCEO_PARTE_MIN_MS,
  type Fit,
} from '@fabrica/shared';
import { kenburnsEffect } from './fit.js';

// Troceo de la CONGELACIÓN: la red que garantiza los topes de duración por
// plano, aplicada en el único punto por el que pasa todo.
//
// El troceo del matching intenta traer contenido DISTINTO para cada trozo, y es
// mejor cuando funciona — pero el juez de planos y la curación humana eligen
// después, y 16 de los 22 beats de un vídeo real llegaron a la ingesta por el
// camino compat sin trocear: imágenes de 14 s con el tope en 5. Este módulo
// corre donde ya no hay nadie detrás.
//
// La restricción que lo diseña: aquí NO se puede introducir contenido que el
// humano no aprobó (principio 2: el humano selecciona y aprueba; la puerta de
// curación ya pasó). Así que no se busca nada nuevo:
// - una imagen larga se parte en varios tramos de la MISMA imagen, cada uno con
//   un Ken Burns distinto — el re-encuadre de toda la vida de los documentales;
// - un clip largo recortado de una fuente más larga se parte con SALTOS hacia
//   delante (jump cuts): material que ya estaba en el archivo aprobado y que el
//   recorte centrado descartaba.
// Un clip en loop o estirado no se toca: partir una repetición no añade nada.

export interface PlanoCongelado {
  from_ms: number;
  to_ms: number;
  fit: Fit;
  /** dirección de Ken Burns, solo para imágenes */
  effect?: string;
}

/** Salto mínimo entre partes de un clip para que se LEA como corte y no como tirón. */
const SALTO_MIN_MS = 500;
/** Salto máximo: más allá no aporta y puede caer en contenido sin relación. */
const SALTO_MAX_MS = 4000;
/**
 * Cola que se deja SIN usar al final de la fuente. El render extiende la última
 * parte con el solape de la transición (~200 ms) y el crossfade entre partes
 * lee otros 200 ms: sin esta reserva, la última parte acababa exactamente en el
 * fin del archivo y esos frames extra leían más allá del EOF.
 */
const COLA_SEGURIDAD_MS = 700;

function partesPara(spanMs: number, maxMs: number): number {
  const deseadas = Math.ceil(spanMs / maxMs);
  const legibles = Math.floor(spanMs / TROCEO_PARTE_MIN_MS);
  return Math.max(1, Math.min(deseadas, TROCEO_MAX_PARTES, legibles));
}

/**
 * Parte un plano congelado en tramos que respetan IMAGE_MAX_S / CLIP_MAX_S.
 * Devuelve [plano original] cuando no procede partir. Determinista: todo deriva
 * de `seed`.
 */
export function trocearCongelado(args: {
  kind: 'clip' | 'image';
  from_ms: number;
  to_ms: number;
  fit: Fit;
  assetDurationMs: number | null;
  seed: number;
}): PlanoCongelado[] {
  const span = args.to_ms - args.from_ms;
  const original: PlanoCongelado = {
    from_ms: args.from_ms,
    to_ms: args.to_ms,
    fit: args.fit,
    ...(args.fit.mode === 'kenburns' ? { effect: kenburnsEffect(args.seed) } : {}),
  };

  if (args.kind === 'image') {
    if (span <= IMAGE_MAX_S * 1000) return [original];
    const partes = partesPara(span, IMAGE_MAX_S * 1000);
    if (partes < 2) return [original];
    const step = span / partes;
    return Array.from({ length: partes }, (_, k) => ({
      from_ms: args.from_ms + Math.round(k * step),
      to_ms: k === partes - 1 ? args.to_ms : args.from_ms + Math.round((k + 1) * step),
      fit: { mode: 'kenburns' as const },
      // Solo variantes 'in', alternando lado. No vale rotar el catálogo entero:
      // 'out' TERMINA en escala 1,0 y 'in' EMPIEZA en 1,0, así que el empalme
      // out→in encuadra idéntico y el corte se vuelve invisible — la imagen
      // seguiría >3 s efectivos en pantalla y el troceo no habría hecho nada.
      // Con in→in cada frontera salta de 1,08 a 1,00 y cambia el lado del
      // paneo: se lee inequívocamente como un plano nuevo.
      effect: (args.seed + k) % 2 === 0 ? 'kenburns-in-left' : 'kenburns-in-right',
    }));
  }

  // clip: solo se trocea el modo trim (recorte de una fuente más larga).
  // loop y stretch repiten o estiran material justo: partirlos no da variedad.
  if (args.fit.mode !== 'trim') return [original];
  if (span <= CLIP_MAX_S * 1000) return [original];
  const len = args.assetDurationMs ?? 0;
  const partes = partesPara(span, CLIP_MAX_S * 1000);
  if (partes < 2) return [original];

  // material sobrante de la fuente = lo que el recorte centrado descartaba;
  // se reparte en saltos entre partes, reservando la cola de seguridad.
  // Sin salto legible, no hay troceo.
  const lenUtil = len - COLA_SEGURIDAD_MS;
  const sobra = lenUtil - span;
  const salto = Math.min(SALTO_MAX_MS, Math.floor(sobra / (partes - 1)));
  if (salto < SALTO_MIN_MS) return [original];

  const usado = span + salto * (partes - 1);
  const offset0 = Math.max(0, Math.floor((lenUtil - usado) / 2));
  const step = span / partes;
  return Array.from({ length: partes }, (_, k) => {
    const desde = args.from_ms + Math.round(k * step);
    const hasta = k === partes - 1 ? args.to_ms : args.from_ms + Math.round((k + 1) * step);
    return {
      from_ms: desde,
      to_ms: hasta,
      // cada parte arranca donde le toca en pantalla MÁS los saltos acumulados
      // dentro de la fuente: el espectador ve avanzar la acción a trompicones
      // deliberados, no la misma acción repetida
      fit: { mode: 'trim' as const, offset_ms: offset0 + (desde - args.from_ms) + k * salto },
    };
  });
}
