import type { Research } from './master-json.js';
import { entidadesNombradas } from './script-quality.js';

// ¿Cuánto vídeo da este material?
//
// La duración era un número fijo del canal (`target_minutes`) y el research no
// pintaba nada: todos los vídeos pedían las mismas 875 palabras. Con eso,
// `uVkNtcYIrYqEX8D3dG1Ah` —un tuit, un claim, CERO caracteres descargados
// porque Twitter bloquea al bot— recibió el encargo de escribir siete minutos,
// y salieron mil palabras de generalidades que hasta se lo confesaban al
// espectador: «Nuestro research pack es limitado».
//
// Ahora el canal fija un RANGO editorial y la noticia decide dónde cae dentro.
// Una con dos datos no da doce minutos; una con veinte no cabe en cinco.

/** Minutos que aporta cada dato con sustancia, y el suelo de arranque. */
const BASE_MIN = 2.5;
const MIN_POR_DATO = 0.45;

/**
 * Techo que impone el texto realmente descargado.
 *
 * Va aparte del recuento de claims porque son señales distintas: el research
 * puede extraer diez claims de un titular si se lo propone, pero sin texto
 * detrás no hay con qué desarrollarlos. Los cortes salen del corpus: 2 000
 * caracteres es un artículo corto de verdad; por debajo de 500 no hay ni eso.
 */
function techoPorTexto(caracteres: number): number {
  if (caracteres >= 2_000) return Infinity;
  if (caracteres >= 500) return 4;
  return BASE_MIN;
}

/**
 * Cuánto se puede estirar por debajo del mínimo del canal antes de que deje de
 * ser un vídeo corto y pase a ser relleno. Con un mínimo de 5, todo lo que dé
 * 3 minutos o más se publica a 5; por debajo, incidencia.
 */
const TOLERANCIA_ESTIRADO = 0.6;

export type Suficiencia = 'suficiente' | 'justo' | 'insuficiente';

export interface RangoDuracion {
  min: number;
  max: number;
}

export interface Veredicto {
  nivel: Suficiencia;
  /** minutos que se le van a pedir al guion */
  minutos: number;
  /** lo que el material daría de sí sin el rango, para diagnosticar */
  minutosPorMaterial: number;
  /** en español y listo para enseñar */
  motivo: string;
  claims: number;
  claimsConDato: number;
  caracteres: number;
}

const CIFRA = /\d/;

/**
 * ¿El claim aporta algo, o solo dice que algo existe?
 *
 * Usa la MISMA definición de entidad que el resto del linter, para no tener dos
 * ideas distintas de «nombra algo real». El prefijo tonto es para que la primera
 * palabra no cuente como inicio de frase: en un claim el nombre propio suele ir
 * justo ahí («Nvidia vendió 3 millones»), y descartarlo por posición dejaría
 * fuera precisamente los buenos.
 */
function claimConDato(texto: string): boolean {
  return CIFRA.test(texto) || entidadesNombradas(`x ${texto}`).size > 0;
}

/** Redondeo a medio minuto: pedir 7,3 minutos es precisión fingida. */
function aMedioMinuto(n: number): number {
  return Math.round(n * 2) / 2;
}

export function suficienciaResearch(
  research: Research | undefined,
  caracteresDescargados: number,
  rango: RangoDuracion,
): Veredicto {
  const claims = research?.claims ?? [];
  const conDato = claims.filter((c) => claimConDato(c.text)).length;
  const base = {
    claims: claims.length,
    claimsConDato: conDato,
    caracteres: caracteresDescargados,
  };
  const porMaterial = aMedioMinuto(
    Math.min(BASE_MIN + conDato * MIN_POR_DATO, techoPorTexto(caracteresDescargados)),
  );

  if (porMaterial >= rango.max) {
    return {
      ...base,
      nivel: 'suficiente',
      minutos: rango.max,
      minutosPorMaterial: porMaterial,
      motivo: `${conDato} datos con sustancia y ${caracteresDescargados} caracteres: da para el vídeo más largo del canal (${rango.max} min).`,
    };
  }
  if (porMaterial >= rango.min) {
    return {
      ...base,
      nivel: 'suficiente',
      minutos: porMaterial,
      minutosPorMaterial: porMaterial,
      motivo: `${conDato} datos con sustancia: la noticia da para ${porMaterial} min, dentro del rango ${rango.min}-${rango.max}.`,
    };
  }
  if (porMaterial >= rango.min * TOLERANCIA_ESTIRADO) {
    return {
      ...base,
      nivel: 'justo',
      minutos: rango.min,
      minutosPorMaterial: porMaterial,
      motivo: `El material da para ~${porMaterial} min y el canal no baja de ${rango.min}: se escribe al mínimo, denso, sin rellenar.`,
    };
  }
  return {
    ...base,
    nivel: 'insuficiente',
    minutos: 0,
    minutosPorMaterial: porMaterial,
    motivo:
      `Con ${conDato} ${conDato === 1 ? 'dato' : 'datos'} y ${caracteresDescargados} caracteres de fuente ` +
      `no sale ni el vídeo más corto del canal (${rango.min} min). Revisa la fuente de la idea.`,
  };
}
