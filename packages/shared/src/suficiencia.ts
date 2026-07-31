import type { Research } from './master-json.js';
import { entidadesNombradas } from './script-quality.js';

// ¿Da el material para el vídeo que se va a escribir?
//
// La duración se impone hoy desde `settings.target_minutes` y no mira el
// research. Medido sobre los guiones producidos, eso da vídeos de siete minutos
// escritos a partir de un tuit: `uVkNtcYIrYqEX8D3dG1Ah` tiene UN claim y cero
// caracteres descargados —Twitter bloquea al bot— y aun así el sistema le pidió
// 875 palabras. El resultado son mil palabras de generalidades, y el guion
// llegaba a confesárselo al espectador: «Nuestro research pack es limitado».
//
// Un tuit da dos minutos honestos. Escribir siete es relleno con voz en off.

/** Un tuit o un titular dan para esto, y no más. */
export const MINUTOS_MINIMOS = 2;

export type Suficiencia = 'suficiente' | 'justo' | 'insuficiente';

export interface Veredicto {
  nivel: Suficiencia;
  /** minutos que el material aguanta, como mucho */
  minutosMax: number;
  /** en español y listo para enseñar: por qué */
  motivo: string;
  claims: number;
  /** claims que traen una cifra o un nombre propio */
  claimsConDato: number;
  /** caracteres de texto REALMENTE descargado de las fuentes */
  caracteres: number;
}

const CIFRA = /\d/;

/**
 * ¿El claim aporta algo, o solo dice que algo existe?
 *
 * Usa la MISMA definición de entidad que el resto del linter, para no tener dos
 * ideas distintas de «nombra algo real». El prefijo tonto es para que la primera
 * palabra no sea tratada como inicio de frase: en un claim, el nombre propio
 * suele ir justo ahí («Nvidia vendió 3 millones»), y descartarlo por posición
 * dejaría fuera precisamente los buenos.
 */
function claimConDato(texto: string): boolean {
  return CIFRA.test(texto) || entidadesNombradas(`x ${texto}`).size > 0;
}

/**
 * Cuánto vídeo aguanta este material.
 *
 * Se mide lo que de verdad predice el relleno, no lo que es fácil de contar:
 *
 * - **caracteres descargados**, no número de fuentes. Los once vídeos del corpus
 *   tienen UNA fuente, así que exigir dos apagaría la fábrica entera; y una
 *   fuente de HuggingFace con 12 000 caracteres da mucho más que cinco titulares.
 * - **claims con dato**, no claims a secas. «Existe un artículo titulado X» es un
 *   claim y no aporta nada; con ese solo se escribieron 864 palabras.
 */
export function suficienciaResearch(
  research: Research | undefined,
  caracteresDescargados: number,
  minutosPedidos: number,
): Veredicto {
  const claims = research?.claims ?? [];
  const conDato = claims.filter((c) => claimConDato(c.text)).length;
  const base = {
    claims: claims.length,
    claimsConDato: conDato,
    caracteres: caracteresDescargados,
  };

  if (claims.length === 0 && caracteresDescargados < 500) {
    return {
      ...base,
      nivel: 'insuficiente',
      minutosMax: 0,
      motivo:
        'Las fuentes no devolvieron texto y el research no tiene ni un dato. Con esto no hay vídeo: revisa la fuente de la idea.',
    };
  }

  // Un minuto de locución son ~125 palabras, y sostener un minuto sin repetirse
  // pide del orden de un dato con sustancia. El corte de caracteres es el mismo
  // umbral por otra vía: 2 000 caracteres es un artículo corto de verdad.
  const porClaims = Math.max(MINUTOS_MINIMOS, conDato);
  const porTexto = caracteresDescargados >= 2_000 ? minutosPedidos : MINUTOS_MINIMOS;
  const minutosMax = Math.min(minutosPedidos, Math.max(porClaims, porTexto));

  if (minutosMax >= minutosPedidos) {
    return {
      ...base,
      nivel: 'suficiente',
      minutosMax,
      motivo: `${conDato} datos con sustancia y ${caracteresDescargados} caracteres de fuente: da para los ${minutosPedidos} minutos.`,
    };
  }
  return {
    ...base,
    nivel: 'justo',
    minutosMax,
    motivo:
      `El material da para ~${minutosMax} min, no para ${minutosPedidos}: ` +
      `${conDato} ${conDato === 1 ? 'dato con sustancia' : 'datos con sustancia'} y ` +
      `${caracteresDescargados} caracteres descargados. Se escribe más corto y más denso en vez de rellenar.`,
  };
}
