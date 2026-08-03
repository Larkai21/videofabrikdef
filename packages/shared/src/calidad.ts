import {
  CLIP_MAX_S,
  FX_CARD_GUARD_MS,
  IMAGE_MAX_S,
  RATIO_IMAGENES_MAX,
  TROCEO_PARTE_MIN_MS,
} from './constants.js';
import { MAX_CARD_WORDS, normalizeWord, wordInText } from './edit-intents.js';
import { EDIT_RENDER_KIND, type Edit, type MasterVideoJson } from './master-json.js';

// Métricas de calidad de un vídeo terminado, calculadas SOLO con lo que ya
// existe en el maestro. Sin esto, juzgar un cambio exige ver el MP4 entero y
// fiarse de la memoria; con esto se lee en una pantalla y se puede diffear
// entre vídeos.
//
// La regla que ordena qué entra aquí: una métrica solo vale si un valor malo
// señala algo concreto que arreglar. «Puntuación global de calidad» no cumple.

/**
 * Distancia máxima tolerada entre el fotograma con el que se describió un clip
 * y el centro del tramo que se ve.
 *
 * El encaje recorta CENTRADO en el clip y la descripción se extrae del punto
 * medio, así que la distancia debería ser cero por construcción: esto es una
 * invariante, no un ajuste. Salta si alguien cambia una de las dos mitades sin
 * la otra, que es justo lo que había pasado — se describía el segundo 1 y se
 * mostraba el centro, con una mediana de 5,9 s de separación.
 */
export const DESFASE_ENCUADRE_MS = 1_500;
// Cuota de imágenes fijas por encima de la cual el vídeo deja de parecer
// metraje. Vive en `constants.ts` porque el mismo número gobierna la PRODUCCIÓN
// (reparto de plazas de finalista en la cascada) y no solo esta auditoría.

/** Cadencia sana de planos por minuto (fuera de esto, o marea o aburre). */
export const CADENCIA_MIN = 6;
export const CADENCIA_MAX = 16;

export type Gravedad = 'alta' | 'media';

export interface Aviso {
  gravedad: Gravedad;
  codigo: string;
  detalle: string;
  /** instante al que mirar en el vídeo, si el aviso tiene uno */
  at_ms?: number;
}

export interface MetricasVideo {
  duracion_min: number;
  beats: number;
  planos: number;
  // encuadre: ¿se puntuó el fotograma que se ve?
  recortes: number;
  recortes_desfasados: number;
  desfase_mediana_s: number;
  // montaje
  imagenes: number;
  ratio_imagenes: number;
  planos_repetidos: number;
  cadencia_planos_min: number;
  bucles: number;
  // efectos
  efectos: number;
  efectos_visuales_por_min: number;
  reparto_por_minuto: number[];
  minutos_mudos: number;
  // intenciones declaradas (si el maestro trae telemetría)
  intents_declaradas: number | null;
  intents_vivas: number | null;
  avisos: Aviso[];
}

/** Overlays que ocupan el centro de la pantalla y por tanto compiten entre sí. */
// Los que cubren pantalla, derivados del contrato. Antes era otra lista de
// literales escrita a mano, o sea otra oportunidad de que un efecto nuevo
// contara en el informe pero no en el render (o al revés).
const VISUALES = new Set<string>(
  Object.entries(EDIT_RENDER_KIND)
    .filter(([, kind]) => kind === 'overlay')
    .map(([type]) => type),
);

/**
 * Palabras que no merecen resaltarse en pantalla: no aportan significado y
 * gastan el presupuesto del carril de subrayado. Se detectó resaltando «vez».
 */
const VACIAS = new Set([
  'que',
  'de',
  'la',
  'el',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'y',
  'o',
  'a',
  'en',
  'con',
  'por',
  'para',
  'del',
  'al',
  'se',
  'su',
  'sus',
  'lo',
  'le',
  'les',
  'es',
  'son',
  'ser',
  'fue',
  'ha',
  'han',
  'hay',
  'muy',
  'mas',
  'pero',
  'como',
  'si',
  'no',
  'ya',
  'este',
  'esta',
  'esto',
  'ese',
  'esa',
  'eso',
  'aqui',
  'alli',
  'ahi',
  'vez',
  'veces',
  'cosa',
  'cosas',
  'algo',
  'asi',
  'solo',
  'tambien',
  'tras',
  'entre',
  'sobre',
  'desde',
  'hasta',
  'cuando',
  'donde',
  'porque',
  'aunque',
  'mientras',
  'todo',
  'toda',
  'todos',
  'todas',
  'otro',
  'otra',
]);

/** ¿Vale la pena poner esta palabra en pantalla? */
export function palabraResaltable(palabra: string): boolean {
  const w = normalizeWord(palabra);
  if (w === '' || VACIAS.has(w)) return false;
  // las siglas cortas sí valen (IA, CI, API); el resto de palabras cortas no
  if (w.length < 4) return palabra === palabra.toUpperCase() && /[A-Z]/.test(palabra);
  return true;
}

/** Una cifra de cinco dígitos o más sin separador se lee mal en pantalla. */
export function cifraSinSeparador(value: string): boolean {
  return /^\d{5,}$/.test(value.trim());
}

function mediana(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2 : (s[m] ?? 0);
}

/** ¿Se pronuncia esta palabra dentro de este tramo? Usa los cues reales. */
function palabraEnTramo(
  master: MasterVideoJson,
  palabra: string,
  from: number,
  to: number,
): boolean {
  for (const cue of master.cues ?? []) {
    if (cue.to_ms < from || cue.from_ms > to) continue;
    for (const w of cue.words ?? []) {
      if (w.from_ms >= from && w.from_ms <= to && wordInText(w.w, palabra)) return true;
    }
  }
  return false;
}

export function analizarMaster(master: MasterVideoJson): MetricasVideo {
  const beats = master.beats ?? [];
  const edits = master.edits ?? [];
  const durMs = beats.reduce((acc, b) => Math.max(acc, b.to_ms), 0);
  const durMin = durMs / 60_000;
  const avisos: Aviso[] = [];

  // ---- planos y encaje
  const planos = beats.flatMap((b) => {
    const vs = b.visuals ?? [];
    return vs.length > 0 ? vs.map((v) => v.asset) : [b.asset];
  });
  const presentes = planos.filter((a): a is NonNullable<typeof a> => a != null);
  // tramos con su duración en pantalla, para los topes por plano
  const tramos = beats.flatMap((b) => {
    const vs = b.visuals ?? [];
    return vs.length > 0
      ? vs.map((v) => ({ asset: v.asset, ms: v.to_ms - v.from_ms }))
      : [{ asset: b.asset, ms: b.to_ms - b.from_ms }];
  });
  const desfases: number[] = [];
  let bucles = 0;
  let lentos = 0;
  for (const a of presentes) {
    const fit = (a as { fit?: { mode?: string; offset_ms?: number; playback_rate?: number } }).fit;
    if (fit?.mode === 'trim') desfases.push(fit.offset_ms ?? 0);
    if (fit?.mode === 'loop') bucles += 1;
    // cámara lenta perceptible: por debajo de 0,95 el ojo lo nota en gente
    // andando o tecleando, y en un vídeo de noticias lee como error
    if (fit?.mode === 'stretch' && (fit.playback_rate ?? 1) < 0.95) lentos += 1;
  }
  // Cuánto se está recortando de los clips. NO es un aviso: el encaje centra el
  // recorte y la descripción se extrae del punto medio, así que el fotograma
  // que decidió la relevancia cae siempre dentro del tramo visible. Se reporta
  // como dato porque un recorte enorme significa que se está usando un trozo
  // pequeño de un clip largo, y eso sí es información para elegir mejor.
  const desfasados = desfases.filter((d) => d > DESFASE_ENCUADRE_MS).length;

  // proporción de imágenes fijas: es lo que separa «un vídeo editado» de «una
  // presentación con voz en off»
  const imagenes = presentes.filter((a) => (a as { kind?: string }).kind === 'image').length;
  const ratioImagenes = presentes.length > 0 ? imagenes / presentes.length : 0;
  // el techo con el que se PRODUJO este vídeo, no el que tenga el canal hoy
  const techoImagenes = master.broll_telemetry?.imagenes_max_pct ?? RATIO_IMAGENES_MAX;
  if (presentes.length > 0 && ratioImagenes > techoImagenes) {
    avisos.push({
      gravedad: ratioImagenes > 0.5 ? 'alta' : 'media',
      codigo: 'demasiada_imagen',
      detalle: `${imagenes} de ${presentes.length} planos son imagen fija (${Math.round(ratioImagenes * 100)} %); por encima del ${Math.round(techoImagenes * 100)} % el vídeo se siente una presentación`,
    });
  }
  // topes de duración por plano: los mismos contra los que se produce
  // (IMAGE_MAX_S / CLIP_MAX_S), con medio segundo de tolerancia de redondeo
  // el umbral arranca donde el troceo PUEDE partir (2×TROCEO_PARTE_MIN_MS):
  // avisar de una imagen de 3,4 s que ningún troceo puede partir sin crear
  // parpadeos sería pedir lo imposible
  const umbralImagen = Math.max(IMAGE_MAX_S * 1000 + 500, 2 * TROCEO_PARTE_MIN_MS);
  const imagenesLargas = tramos.filter(
    (t) => (t.asset as { kind?: string } | null)?.kind === 'image' && t.ms > umbralImagen,
  ).length;
  if (imagenesLargas > 0) {
    avisos.push({
      gravedad: 'media',
      codigo: 'imagen_larga',
      detalle: `${imagenesLargas} ${imagenesLargas === 1 ? 'imagen fija pasa' : 'imágenes fijas pasan'} de ${IMAGE_MAX_S} s en pantalla`,
    });
  }
  const clipsLargos = tramos.filter(
    (t) => (t.asset as { kind?: string } | null)?.kind === 'clip' && t.ms > CLIP_MAX_S * 1000 + 500,
  ).length;
  if (clipsLargos > 0) {
    avisos.push({
      gravedad: 'media',
      codigo: 'plano_largo',
      detalle: `${clipsLargos} ${clipsLargos === 1 ? 'clip aguanta' : 'clips aguantan'} más de ${CLIP_MAX_S} s sin corte`,
    });
  }
  if (lentos > 0) {
    avisos.push({
      gravedad: 'media',
      codigo: 'camara_lenta',
      detalle: `${lentos} ${lentos === 1 ? 'clip va' : 'clips van'} ralentizado${lentos === 1 ? '' : 's'} por debajo de 0,95× para llenar su hueco`,
    });
  }
  if (bucles > 0) {
    avisos.push({
      gravedad: 'media',
      codigo: 'bucle',
      detalle: `${bucles} ${bucles === 1 ? 'plano se repite' : 'planos se repiten'} en bucle para llenar su hueco`,
    });
  }

  // ---- repetición y cadencia
  // La repetición se cuenta ENTRE beats, deduplicando por beat: el troceo de la
  // congelación parte un plano largo en tramos del MISMO asset a propósito
  // (re-encuadres, jump cuts), y contarlos como repetición convertiría cada
  // troceo en un falso aviso. El mismo asset en dos beats distintos sigue
  // siendo la señal real.
  const ids = beats.flatMap((b) => {
    const vs = b.visuals ?? [];
    const delBeat = (vs.length > 0 ? vs.map((v) => v.asset) : [b.asset])
      .map((a) => (a as { id?: string } | null)?.id)
      .filter(Boolean) as string[];
    return [...new Set(delBeat)];
  });
  const cuenta = new Map<string, number>();
  for (const id of ids) cuenta.set(id, (cuenta.get(id) ?? 0) + 1);
  const repetidos = [...cuenta.values()].filter((n) => n > 1).length;
  if (repetidos > 0) {
    avisos.push({
      gravedad: 'media',
      codigo: 'repeticion',
      detalle: `${repetidos} ${repetidos === 1 ? 'plano aparece' : 'planos aparecen'} más de una vez en el mismo vídeo`,
    });
  }
  const cadencia = durMin > 0 ? presentes.length / durMin : 0;
  if (durMin > 0 && (cadencia < CADENCIA_MIN || cadencia > CADENCIA_MAX)) {
    avisos.push({
      gravedad: 'media',
      codigo: 'cadencia',
      detalle: `${cadencia.toFixed(1)} planos por minuto, fuera de la banda ${CADENCIA_MIN}–${CADENCIA_MAX}`,
    });
  }

  // ---- efectos: cuántos y CÓMO se reparten (el total solo no ve los huecos)
  const visuales = edits.filter((e) => VISUALES.has(e.type));
  const minutos = Math.max(1, Math.ceil(durMin));
  const reparto = Array.from({ length: minutos }, () => 0);
  for (const e of visuales) {
    const i = Math.min(minutos - 1, Math.floor(e.from_ms / 60_000));
    reparto[i] = (reparto[i] ?? 0) + 1;
  }
  const mudos = reparto.filter((n) => n === 0).length;
  if (mudos > 0) {
    avisos.push({
      gravedad: mudos >= minutos / 2 ? 'alta' : 'media',
      codigo: 'minuto_mudo',
      detalle: `${mudos} ${mudos === 1 ? 'minuto no tiene' : 'minutos no tienen'} ningún efecto visual; reparto ${reparto.join(', ')}`,
    });
  }

  // ---- higiene de lo que se lee en pantalla
  for (const e of edits) {
    const at = e.from_ms;
    if (e.type === 'keyword_highlight' && !palabraResaltable(e.keyword)) {
      avisos.push({
        gravedad: 'media',
        codigo: 'palabra_vacia',
        detalle: `se resalta «${e.keyword}», que no aporta significado`,
        at_ms: at,
      });
    }
    const copy = textoDeEdit(e);
    if (copy !== undefined && copy.trim().split(/\s+/).length > MAX_CARD_WORDS) {
      avisos.push({
        gravedad: 'media',
        codigo: 'copy_largo',
        detalle: `la tarjeta dice «${copy}»: es un titular, no una transcripción`,
        at_ms: at,
      });
    }
    if ((e.type === 'stat_card' || e.type === 'stat_odometer') && cifraSinSeparador(e.value)) {
      avisos.push({
        gravedad: 'media',
        codigo: 'cifra_sin_separador',
        detalle: `la cifra ${e.value} sale sin separador de millares`,
        at_ms: at,
      });
    }
    // un efecto anclado a una palabra tiene que entrar cuando esa palabra suena
    const ancla = e.type === 'keyword_highlight' ? e.keyword : undefined;
    if (ancla !== undefined && !palabraEnTramo(master, ancla, e.from_ms, e.to_ms)) {
      avisos.push({
        gravedad: 'alta',
        codigo: 'ancla_perdida',
        detalle: `«${ancla}» se resalta en un tramo donde no se pronuncia`,
        at_ms: at,
      });
    }
  }

  // dos tarjetas a la vez compiten por el centro de la pantalla
  const orden = [...visuales].sort((a, b) => a.from_ms - b.from_ms);
  for (let i = 1; i < orden.length; i += 1) {
    const prev = orden[i - 1]!;
    const cur = orden[i]!;
    if (cur.from_ms < prev.to_ms + FX_CARD_GUARD_MS) {
      avisos.push({
        gravedad: 'alta',
        codigo: 'solape',
        detalle: `${prev.type} y ${cur.type} se pisan en el centro de la pantalla`,
        at_ms: cur.from_ms,
      });
    }
  }

  const tel = master.script_telemetry;
  return {
    duracion_min: durMin,
    beats: beats.length,
    planos: presentes.length,
    recortes: desfases.length,
    recortes_desfasados: desfasados,
    desfase_mediana_s: mediana(desfases) / 1000,
    imagenes,
    ratio_imagenes: ratioImagenes,
    planos_repetidos: repetidos,
    cadencia_planos_min: cadencia,
    bucles,
    efectos: edits.length,
    efectos_visuales_por_min: durMin > 0 ? visuales.length / durMin : 0,
    reparto_por_minuto: reparto,
    minutos_mudos: mudos,
    intents_declaradas: tel?.intents_declared ?? null,
    intents_vivas: tel?.intents_kept ?? null,
    avisos: avisos.sort((a, b) => (a.gravedad === b.gravedad ? 0 : a.gravedad === 'alta' ? -1 : 1)),
  };
}

/** El copy visible de un efecto, si tiene. */
function textoDeEdit(e: Edit): string | undefined {
  if ('text' in e && typeof e.text === 'string') return e.text;
  if ('label' in e && typeof e.label === 'string') return e.label;
  return undefined;
}
