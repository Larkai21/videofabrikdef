import { z } from 'zod';
import { MAX_QUERY_CHARS, MAX_VISUALS_PER_BEAT } from '@fabrica/shared';
import type { WorkerContext } from '../../lib/context.js';
import { ledgeredLlmJson } from '../ideas/llm-call.js';
import { expandQuery } from './score.js';

// Director de b-roll: en una sola llamada LLM produce, POR BEAT, entre 1 y 3
// "cortes" visuales. Un corte si el beat es una sola idea visual; varios,
// anclados a palabras concretas de la narración (keyword), cuando el texto salta
// entre sujetos filmables distintos (p. ej. «bibliotecas» → «industria»). Así el
// b-roll cambia dentro del beat sin tocar los cortes de audio (principio 1).

export interface DirectorBeat {
  idx: number;
  // narración de ese hueco de 8-15 s: la señal principal de relevancia
  text: string;
  // consulta de la escena, como pista temática de respaldo
  sceneQuery: string;
}

// Un corte visual dentro de un beat. `keyword` (opcional) es la palabra de la
// narración donde debe entrar el plano; sin ella, el corte va por idea.
// `alt_query` (opcional) es un SEGUNDO ángulo del mismo sujeto: solo se
// consulta cuando la primera búsqueda no llena el pool (variedad sin duplicar
// requests en el caso común — el cuello documentado era UNA query por plano
// contra una caché de 24 h que devolvía siempre los mismos candidatos).
export interface DirectorCut {
  keyword?: string;
  visual_query: string;
  alt_query?: string;
}

export const brollResultSchema = z.object({
  beats: z.array(
    z.object({
      idx: z.number().int().nonnegative(),
      visuals: z
        .array(
          z.object({
            keyword: z.string().optional(),
            visual_query: z.string().min(1),
            // obligatoria: como campo opcional, el modelo la omitió en 575 de
            // 575 sub-planos de producción y el mecanismo entero quedó muerto
            alt_query: z.string().min(1),
          }),
        )
        .min(1),
    }),
  ),
});

export interface DirectorParams {
  videoId: string;
  channelId: string;
  lang: 'en' | 'es';
  beats: DirectorBeat[];
}

export function buildDirectorPrompt(params: DirectorParams): { system: string; user: string } {
  const langName = params.lang === 'en' ? 'inglés' : 'español';
  const system = [
    'Eres director de b-roll de un canal de YouTube tipo "faceless".',
    'Recibes la narración de un vídeo dividida en beats (trozos de 8-15 s).',
    'Para CADA beat decides cuántos PLANOS mostrar, de 1 a ' + MAX_VISUALS_PER_BEAT + ':',
    '- 1 plano si el beat trata de una sola idea visual.',
    '- 2 o 3 planos si la narración salta entre sujetos filmables DISTINTOS; cada',
    '  plano se ancla a la palabra exacta de la narración donde debe entrar (keyword).',
    'Sé conservador: menos es más; no trocees una sola idea.',
    'Cada plano: una CONSULTA DE BUSCADOR de archivo (stock) para lo que se DICE ahí.',
    'Escribe como quien teclea en el buscador de un banco de vídeo, NO como quien',
    'describe un plano: los bancos suman las palabras en vez de afinar, así que cada',
    'palabra de más TRAE MÁS BASURA. Medido: «server room» devuelve salas de servidores;',
    '«dusty empty server room corridor» devuelve un colegio abandonado de Chernóbil.',
    'Reglas de la consulta:',
    `- 2-3 palabras, en ${langName}; nunca más de ${MAX_QUERY_CHARS} caracteres.`,
    '- SUJETO filmable (+ contexto si hace falta): «server room», «robotic arm»,',
    '  «team meeting office», «solar panels».',
    '- PROHIBIDO: adjetivos de ambiente (dusty, empty, modern, worried, small),',
    '  verbos en -ing, preposiciones (on, at, with, of, inside), artículos, y',
    '  cualquier palabra que describa la ESCENA en vez de nombrar el objeto.',
    '  El ambiente y el encuadre se eligen después, al ver los candidatos.',
    '- Nada de conceptos abstractos ni de texto en pantalla: cosas que se filman.',
    '- Planos consecutivos (dentro y entre beats) VISUALMENTE DISTINTOS. Un mismo',
    '  objeto no puede aparecer en más de dos consultas de todo el vídeo.',
    '- keyword: una palabra EXACTA tal cual aparece en la narración del beat (o vacío).',
    '- alt_query: OBLIGATORIA. Otro OBJETO de la misma frase (no un sinónimo del',
    '  primero) para tener un segundo ángulo cuando el primero no dé nada:',
    '  visual_query «cleanroom» → alt_query «microchip». Mismas reglas de arriba.',
    'Ejemplos (narración → visual_query / alt_query):',
    '- «los centros de datos se llenan de aceleradores» → «data center» / «gpu»',
    '- «un brazo robótico repite la misma tarea sin cansarse» → «robotic arm» / «factory line»',
    '- «el equipo revisó los resultados del piloto» → «team meeting» / «laptop screen»',
    '- «la norma europea obliga a avisar» → «european parliament» / «legal documents»',
    'Devuelve JSON: { "beats": [ { "idx": number, "visuals": [ { "keyword"?: string,',
    '"visual_query": string, "alt_query": string } ] } ] }, un objeto por beat',
    'recibido con el mismo idx.',
  ].join('\n');

  const user = [
    'Beats (idx · tema de escena · narración):',
    ...params.beats.map(
      (b) => `${b.idx} · ${b.sceneQuery} · ${b.text.replace(/\s+/g, ' ').trim().slice(0, 240)}`,
    ),
  ].join('\n');

  return { system, user };
}

/**
 * El prompt pide consultas cortas; esto lo garantiza. Pixabay devuelve 400 por
 * encima de MAX_QUERY_CHARS y su error no dice por qué, así que un modelo algo
 * hablador tumbaba en silencio una de las dos fuentes de stock. Se corta por
 * palabra entera para no partir un término por la mitad.
 */
export function recortarConsulta(q: string): string {
  const limpia = q.trim().replace(/\s+/g, ' ');
  if (limpia.length <= MAX_QUERY_CHARS) return limpia;
  const cortada = limpia.slice(0, MAX_QUERY_CHARS);
  const ultimo = cortada.lastIndexOf(' ');
  return (ultimo > 0 ? cortada.slice(0, ultimo) : cortada).trim();
}

// Palabras que ENSANCHAN el pool en vez de afinarlo. Los bancos de stock suman
// tokens (Pixabay hace OR puro: 'server'=48 resultados, 'server room'=803,
// '+corridor'=989, '+empty'=1281), así que cada una de estas trae material de
// otro tema: «small» mete perros pequeños, «dusty» mete confeti dorado, «empty»
// mete pasillos de Chernóbil. El ambiente se elige mirando los candidatos, no
// pidiéndoselo al buscador.
const RUIDO = new Set([
  // preposiciones, artículos y conectores (los dos idiomas del canal)
  'on','at','with','of','in','inside','the','a','an','and','for','to','from','into','over','under',
  'near','by','through','between','without','around',
  'de','del','la','el','los','las','un','una','con','en','sobre','bajo','para','por','y','al','entre','sin',
  // adjetivos de ambiente y estado: describen la escena, no el objeto
  'dusty','empty','modern','worried','small','large','big','busy','quiet','dark','bright','clean',
  'old','new','young','happy','sad','tired','abandoned','futuristic','minimal','cozy','beautiful',
  'professional','simple','complex','real','digital','virtual','smart','advanced','innovative',
  'luminoso','vacío','moderno','pequeño','grande','oscuro','limpio','viejo','nuevo','abandonado',
  'futurista','amplio','sencillo','avanzado',
  // vocabulario de ENCUADRE: no es un objeto que exista en el banco
  'shot','view','angle','closeup','close-up','close','wide','footage','scene','frame','clip','video',
  'image','photo','background','plano','toma','fondo','imagen','vídeo','video',
  // verbos de acción genéricos (el banco los ignora o los cruza con otro tema).
  // Lista explícita en vez de la regla «acaba en -ing», que se comía sustantivos
  // legítimos y frecuentes en este canal: meeting, cooling, building, training.
  'looking','watching','reviewing','checking','using','showing','doing','performing','making',
  'holding','walking','sitting','standing','working','typing','auditing','replacing','moving',
  'mirando','revisando','usando','trabajando','sentado','caminando',
]);

/**
 * Deja la consulta como la teclearía un humano: quita el RUIDO (ambiente,
 * preposiciones, encuadre, verbos genéricos) y conserva los sustantivos.
 *
 * NO trunca por defecto, y eso está medido: recortar a tres palabras se comía
 * contexto útil («youtube comments section on smartphone screen» → «youtube
 * comments section» devolvía botones de suscribirse, peor que el original).
 * Quitar ruido siempre ayuda; cortar sustantivos, no. `maxPalabras` existe
 * para Pixabay, que hace OR puro y sí necesita el recorte duro.
 *
 * Es una GUARDA, no el mecanismo: el prompt es quien debe escribir corto — una
 * regex no sabe cuál es el sujeto filmable. Si al limpiar no queda nada, se
 * devuelve la original: mejor una consulta larga que ninguna.
 */
export function consultaDeBuscador(q: string, maxPalabras?: number): string {
  const palabras = q.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/);
  const utiles = palabras.filter((p) => p !== '' && !RUIDO.has(p));
  if (utiles.length === 0) return recortarConsulta(q);
  const cortadas = maxPalabras !== undefined ? utiles.slice(0, maxPalabras) : utiles;
  return recortarConsulta(cortadas.join(' '));
}

// Devuelve idx→cortes[]. Ante cualquier fallo del LLM se cae con gracia a un
// único corte con la consulta de escena (expandida) para no bloquear el pipeline.
export async function directBroll(
  ctx: WorkerContext,
  params: DirectorParams,
): Promise<Map<number, DirectorCut[]>> {
  const fallback = new Map<number, DirectorCut[]>(
    params.beats.map((b) => [
      b.idx,
      // el fallback también pasa por la guarda: expandQuery añade keywords del
      // beat y sin limpiar salían consultas de 6-8 palabras
      [{ visual_query: consultaDeBuscador(expandQuery(b.sceneQuery, b.text)) }],
    ]),
  );
  if (params.beats.length === 0) return fallback;

  const { system, user } = buildDirectorPrompt(params);
  let data: z.infer<typeof brollResultSchema>;
  try {
    data = await ledgeredLlmJson(ctx, {
      videoId: params.videoId,
      channelId: params.channelId,
      op: 'broll_director',
      system,
      user,
      schema: brollResultSchema,
      mockContext: { beats: params.beats },
    });
  } catch (err) {
    ctx.logger.warn(
      { err, videoId: params.videoId },
      'Director de b-roll falló; se usan las consultas de escena',
    );
    return fallback;
  }

  const out = new Map(fallback);
  for (const b of data.beats) {
    if (!out.has(b.idx)) continue;
    const cuts: DirectorCut[] = b.visuals
      .map((v) => {
        // la guarda corre SIEMPRE, no solo cuando el modelo se pasa de largo:
        // el prompt pide 2-3 palabras y aun así conviene garantizarlo, porque
        // una consulta de 5 palabras no es «un poco peor», trae otro tema
        const principal = consultaDeBuscador(v.visual_query);
        const alt = v.alt_query !== undefined ? consultaDeBuscador(v.alt_query) : '';
        return {
          ...(v.keyword && v.keyword.trim() !== '' ? { keyword: v.keyword.trim() } : {}),
          visual_query: principal,
          // una alt igual a la principal no aporta nada: fuera
          ...(alt !== '' && alt !== principal ? { alt_query: alt } : {}),
        };
      })
      .filter((v) => v.visual_query !== '')
      .slice(0, MAX_VISUALS_PER_BEAT);
    if (cuts.length > 0) out.set(b.idx, cuts);
  }
  return out;
}
