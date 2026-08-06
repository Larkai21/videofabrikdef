import { displayCifra } from './cifras.js';
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

/**
 * Tramo seguido sin nada dibujado a partir del cual se avisa. Un minuto de
 * b-roll con subtítulos y nada más es el hueco que hace que una pieza «se vea
 * vacía»; por debajo de eso el respiro es deliberado.
 */
export const HUECO_GRAFICO_MAX_MS = 60_000;
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
  /** fracción del tiempo en pantalla ocupada por imágenes fijas (no de planos) */
  ratio_imagenes: number;
  /** el techo contra el que se produjo (broll_telemetry) — para que el CLI y el aviso no diverjan */
  techo_imagenes: number;
  /**
   * fracción del tiempo en pantalla que ganó la BIBLIOTECA frente al stock
   * (la promesa del tier 0: coste y tiempo bajan con cada vídeo). null si el
   * maestro es anterior a congelar `origin` — mejor sin dato que un 0 falso.
   */
  cuota_biblioteca: number | null;
  planos_repetidos: number;
  cadencia_planos_min: number;
  bucles: number;
  // efectos
  efectos: number;
  efectos_visuales_por_min: number;
  reparto_por_minuto: number[];
  minutos_mudos: number;
  /** fracción de la pieza con un gráfico en pantalla (ver `cobertura`) */
  cobertura_grafica: number;
  /** el tramo seguido más largo sin nada dibujado, en segundos */
  hueco_grafico_s: number;
  // intenciones declaradas (si el maestro trae telemetría)
  intents_declaradas: number | null;
  intents_vivas: number | null;
  avisos: Aviso[];
}

/**
 * Cuánto de la pieza tiene algo DIBUJADO en pantalla, y dónde están los huecos.
 *
 * Es el número que mide si una pieza «se ve vacía», y hasta ahora no existía:
 * `minutos_mudos` cuenta minutos de reloj, que en una pieza de treinta segundos
 * no dice nada. Cuenta solo lo que pinta algo nuevo —`overlay` y `anotacion`—,
 * no el b-roll ni el subtítulo, que siempre están, ni el `zoom_punch`, que
 * mueve la cámara sobre lo que ya había, ni el `keyword_highlight`, que tiñe
 * una palabra del subtítulo. Los tramos solapados se funden antes de medir.
 */
export function cobertura(
  edits: readonly { type: string; from_ms: number; to_ms: number }[],
  durationMs: number,
): { ms_con_grafico: number; ratio: number; hueco_max_ms: number; huecos: [number, number][] } {
  const dibuja = new Set<string>(
    Object.entries(EDIT_RENDER_KIND)
      .filter(([, kind]) => kind === 'overlay' || kind === 'anotacion')
      .map(([type]) => type),
  );
  const tramos = edits
    .filter((e) => dibuja.has(e.type))
    .map((e): [number, number] => [Math.max(0, e.from_ms), Math.min(durationMs, e.to_ms)])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const fundidos: [number, number][] = [];
  for (const [a, b] of tramos) {
    const ultimo = fundidos[fundidos.length - 1];
    if (ultimo && a <= ultimo[1]) ultimo[1] = Math.max(ultimo[1], b);
    else fundidos.push([a, b]);
  }
  const conGrafico = fundidos.reduce((acc, [a, b]) => acc + (b - a), 0);
  const huecos: [number, number][] = [];
  let cursor = 0;
  for (const [a, b] of fundidos) {
    if (a > cursor) huecos.push([cursor, a]);
    cursor = b;
  }
  if (cursor < durationMs) huecos.push([cursor, durationMs]);
  return {
    ms_con_grafico: conGrafico,
    ratio: durationMs > 0 ? conGrafico / durationMs : 0,
    hueco_max_ms: huecos.reduce((max, [a, b]) => Math.max(max, b - a), 0),
    huecos,
  };
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

  // proporción de imágenes fijas POR TIEMPO EN PANTALLA: es lo que separa «un
  // vídeo editado» de «una presentación con voz en off». Por tiempo y no por
  // número de planos porque el troceo de la congelación parte una imagen larga
  // en varios planos cortos: contar planos infla el ratio con cada parte (37 %
  // por planos vs 20 % por tiempo en el mismo vídeo) y castigaría justo al
  // mecanismo que hace las imágenes soportables.
  const imagenes = presentes.filter((a) => (a as { kind?: string }).kind === 'image').length;
  const msImagenes = tramos.reduce(
    (acc, t) => acc + ((t.asset as { kind?: string } | null)?.kind === 'image' ? t.ms : 0),
    0,
  );
  const msTramos = tramos.reduce((acc, t) => acc + t.ms, 0);
  const ratioImagenes = msTramos > 0 ? msImagenes / msTramos : 0;
  // cuota de biblioteca por tiempo en pantalla, solo sobre los tramos que
  // traen `origin` congelado (maestros nuevos): mide si el tier 0 crece
  const conOrigen = tramos.filter(
    (t) => (t.asset as { origin?: string } | null)?.origin !== undefined,
  );
  const msBiblioteca = conOrigen.reduce(
    (acc, t) => acc + ((t.asset as { origin?: string }).origin === 'library' ? t.ms : 0),
    0,
  );
  const msConOrigen = conOrigen.reduce((acc, t) => acc + t.ms, 0);
  const cuotaBiblioteca = msConOrigen > 0 ? msBiblioteca / msConOrigen : null;

  // el techo con el que se PRODUJO este vídeo, no el que tenga el canal hoy
  const techoImagenes = master.broll_telemetry?.imagenes_max_pct ?? RATIO_IMAGENES_MAX;
  if (presentes.length > 0 && ratioImagenes > techoImagenes) {
    avisos.push({
      gravedad: ratioImagenes > 0.5 ? 'alta' : 'media',
      codigo: 'demasiada_imagen',
      detalle: `las imágenes fijas ocupan el ${Math.round(ratioImagenes * 100)} % del tiempo en pantalla (${imagenes} de ${presentes.length} planos); por encima del ${Math.round(techoImagenes * 100)} % el vídeo se siente una presentación`,
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
    // se audita el DISPLAY, no el value crudo: los dos componentes de stat
    // pintan a través del formateador compartido, así que el aviso solo salta
    // si lo que va a verse en pantalla de verdad carece de separador
    if (
      (e.type === 'stat_card' || e.type === 'stat_odometer') &&
      cifraSinSeparador(displayCifra(e.value))
    ) {
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

  // Dos tarjetas a la vez compiten por el centro de la pantalla.
  //
  // Se probó relajarlo a «solo si comparten banda», con el argumento de que el
  // montador deja convivir la banda superior con el centro. Es falso: medido
  // sobre el fotograma, el recuadro del inserto es lo bastante alto como para
  // llegar al centro y TAPA la tarjeta de cita. El informe tenía razón y el
  // montaje no; se arregló allí (los centrados que pisan un inserto se caen).
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

  const cob = cobertura(edits, durMs);
  // Un minuto entero sin nada dibujado es un tramo en el que la pantalla solo
  // enseña b-roll y subtítulos. No es un fallo de render: es material que falta.
  if (cob.hueco_max_ms > HUECO_GRAFICO_MAX_MS) {
    const peor = cob.huecos.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a), [0, 0]);
    avisos.push({
      gravedad: 'media',
      codigo: 'hueco_grafico',
      detalle: `${Math.round(cob.hueco_max_ms / 1000)} s seguidos sin nada dibujado en pantalla: solo b-roll y subtítulos`,
      at_ms: peor[0],
    });
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
    techo_imagenes: techoImagenes,
    cuota_biblioteca: cuotaBiblioteca,
    planos_repetidos: repetidos,
    cadencia_planos_min: cadencia,
    bucles,
    efectos: edits.length,
    efectos_visuales_por_min: durMin > 0 ? visuales.length / durMin : 0,
    reparto_por_minuto: reparto,
    minutos_mudos: mudos,
    cobertura_grafica: cob.ratio,
    hueco_grafico_s: cob.hueco_max_ms / 1000,
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
