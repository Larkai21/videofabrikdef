// Parámetros transversales del pipeline. Los umbrales de matching son
// PROVISIONALES: se calibran en S1 etiquetando ~50 beats a mano (SPEC docs/assets-y-biblioteca.md §2).

// Vídeo
export const FPS = 30;
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;

// Embeddings — el MISMO modelo en todo el sistema; cambiarlo = re-embeber todo
export const EMBEDDING_DIMS = 384;

// Fuentes de ideas con fetcher implementado (github y web requieren Playwright,
// reddit requiere OAuth: quedan fuera del MVP). La API filtra con esta lista lo
// que enseña y encola el radar; los workers, lo que procesan.
export const SUPPORTED_SOURCE_KINDS = ['hn', 'arxiv', 'news', 'rss', 'youtube'] as const;
export type SupportedSourceKind = (typeof SUPPORTED_SOURCE_KINDS)[number];

// Beats (segundos)
export const BEAT_MIN_S = 8;
export const BEAT_MAX_S = 15;
export const BEAT_TARGET_S = 11.5;
export const BEAT_LAST_MIN_S = 5;
export const BEAT_LAST_MAX_S = 18;

// Tope duro de la consulta de stock. Pixabay responde HTTP 400 si `q` pasa de
// 100 caracteres, y no lo dice en el error. Con el sufijo de estilo del canal
// dentro de la consulta, 28 de 36 consultas de un vídeo lo superaban y 12 de 15
// búsquedas de Pixabay morían en silencio (el fallo se traga y el beat sigue
// sin candidatos de esa fuente). Además, una consulta corta es mejor consulta:
// el embedding no se diluye en palabras de relleno.
export const MAX_QUERY_CHARS = 100;

// Cascada de assets (similitud coseno). Escala de multilingual-e5-small, cuya
// línea base para pares NO relacionados ronda 0,72–0,78.
//
// ESTOS TRES NÚMEROS ESTÁN DESCALIBRADOS Y SE SABE POR QUÉ. Se fijaron a ojo
// contra una distribución INFLADA: los assets de biblioteca se embebían con la
// consulta que los encontró, lo que subía sus cosenos artificialmente. Al
// cerrar esa fuga la media de un vídeo real bajó de 0,864 a 0,840 (medido,
// mismo canal, vídeos de 35-36 beats), así que los beats que superan T_AUTO
// pasaron de 23/36 a 6/35: el umbral quedó estricto de golpe y el humano revisa
// casi todo.
//
// NO se corrige moviendo el número hasta recuperar la tasa de antes: eso sería
// calibrar contra una tasa deseada en vez de contra la precisión, y la tasa
// anterior incluía auto-aprobaciones falsas. La corrección es el conjunto
// etiquetado (`scripts/etiquetar.ts`, 93 pares preparados) y su curva. Con las
// primeras 12 muestras el AUC sale 0,531 —azar—, así que probablemente el
// problema no sea dónde está el corte sino que la señal no separa; ver el plan.
export const T_AUTO = 0.86;
export const T_REV = 0.78;
export const T_STOCK = 0.88;

/**
 * Cuánto tiene que ganar un asset de la BIBLIOTECA a uno de stock para llevarse
 * el plano.
 *
 * No compiten en igualdad: el stock busca de cero entre millones de clips y casi
 * siempre tiene algo que ilustra la consulta; la biblioteca tiene un par de
 * cientos de assets, así que para la mayoría de consultas no tiene nada
 * realmente bueno. Con los cosenos comprimidos en una franja estrecha, un asset
 * mediocre suyo empata con uno bueno de stock y gana por azar. Medido: «lupa
 * sobre texto impreso» → un logo de Windows; «cuaderno con anotaciones» → un
 * tablero Kanban.
 *
 * 0,03 es un cuarto del rango útil observado (0,80–0,90): suficiente para que
 * la biblioteca solo gane cuando de verdad es mejor, que es cuando aporta —
 * reutilizar un plano bueno ahorra descarga y descripción. Subirlo a 1 la
 * desactiva por completo y todo viene de la API.
 */
export const LIBRARY_HANDICAP = 0.03;

/**
 * Cuánto tiene que ganar una IMAGEN FIJA a un clip para llevarse el plano.
 *
 * El b-roll de un vídeo debería moverse: una imagen fija con Ken Burns es el
 * plan B, no el plan A. Pero el sistema no tenía ninguna preferencia por el
 * movimiento, y encima repartía plazas de finalista por proveedor Y tipo, así
 * que las fotos se llevaban ~2,16 de las 6 plazas por construcción (medido
 * sobre 315 pools reales). Resultado: entre el 33 % y el 61 % de los planos de
 * los nueve vídeos producidos son imágenes fijas.
 *
 * No es escasez: de las 173 consultas reales guardadas, TODAS tienen clips de
 * vídeo (mínimo 15, mediana 30) y todas tienen ≥6 que cubren el tramo. Era
 * puro artefacto de selección.
 *
 * 0,02, no más: este handicap y PICK_COS_MARGIN (0,04) se SUMAN, porque la
 * banda de elección se ancla también en el coseno efectivo. Con 0,02 una imagen
 * necesita ganar por 0,06 sobre un rango útil de 0,80–0,90; con 0,04 el
 * requisito sería 0,08, el 80 % del rango, que ya no es una preferencia sino un
 * veto. La preferencia por movimiento no debe poder imponer un plano irrelevante.
 */
export const IMAGE_HANDICAP = 0.02;

/**
 * Techo de imágenes fijas sobre el total de planos de un vídeo. Es a la vez el
 * objetivo con el que se PRODUCE (reparto de plazas de finalista) y el umbral
 * con el que se AUDITA (aviso `demasiada_imagen` de `analizarMaster`): producir
 * contra un objetivo y auditar contra otro haría el informe inútil.
 */
export const RATIO_IMAGENES_MAX = 0.3;

export const ANTI_REPEAT_N = 8;
export const STOCK_CACHE_TTL_H = 24;
export const MAX_LOOPS = 3;
export const LOOP_CROSSFADE_MS = 300;
// Sub-planos: cortes visuales dentro de un beat (b-roll más ágil). Tope por
// beat en la DIRECCIÓN (cuántos planos distintos pide el director de b-roll).
export const MAX_VISUALS_PER_BEAT = 3;
/**
 * Duración máxima de una imagen fija en pantalla. 3 y no 5: medido sobre un
 * vídeo real, con 5 la mediana de plano-imagen quedaba en 4,6 s y el vídeo se
 * sentía una presentación; a 3 la imagen es un golpe visual, no una espera.
 *
 * Se aplica en DOS sitios y no es redundancia: en el matching (que puede traer
 * contenido distinto para cada trozo) y en la congelación de la ingesta (que
 * re-encuadra la MISMA imagen con otro Ken Burns). El segundo existe porque el
 * juez de planos y la curación humana eligen después del matching y nadie
 * re-trocea: sin la red de la ingesta salieron imágenes de 14 s con el tope en 5.
 */
export const IMAGE_MAX_S = 3;
/**
 * Duración máxima de un clip continuo en pantalla. Los clips se mueven, así que
 * toleran más que una imagen, pero sin tope la mediana real salió a 9,9 s (máx
 * 16,1): un solo encuadre de 16 segundos en un vídeo de noticias es una pausa.
 * El troceo de la ingesta corta el MISMO clip con saltos hacia delante (jump
 * cuts): material nuevo del mismo plano, sin búsqueda nueva y sin tocar nada
 * que el humano no haya aprobado.
 */
export const CLIP_MAX_S = 8;
// Techo de partes del troceo de la ingesta. Va aparte de MAX_VISUALS_PER_BEAT
// porque no decide contenido nuevo: re-encuadra lo ya aprobado.
export const TROCEO_MAX_PARTES = 5;
// Ninguna parte troceada baja de esto: un plano de un segundo se lee como
// parpadeo. Es menor que MIN_SUBVISUAL_MS porque aquí no hay ancla de palabra
// que respetar, solo legibilidad.
export const TROCEO_PARTE_MIN_MS = 1800;
// crossfade corto entre sub-planos dentro de un beat
export const SUBVISUAL_CROSSFADE_MS = 200;
// Ralentización máxima admisible para llenar un beat con una sola pasada del
// clip (0,75 = el clip puede cubrir hasta 1/0,75 ≈ 1,33× su duración sin que
// se note como cámara lenta). Por debajo se recurre al bucle.
export const MIN_PLAYBACK_RATE = 0.75;

// Audio
export const LOUDNORM_LUFS = -16;
export const LOUDNORM_TRUE_PEAK = -1.5;
// Sonoridad del MP4 ENTREGADO, distinta de la de la voz: −16 es la referencia
// de mezcla (la música se coloca a −22 dB respecto a ella); YouTube normaliza a
// ~−14 y SOLO atenúa, así que entregar por debajo regala volumen frente a
// cualquier otro vídeo de la plataforma. La ganancia se aplica al final del
// render, limitada por el techo de pico real.
export const DELIVERY_LUFS = -14;
export const DELIVERY_TRUE_PEAK = -1.0;
export const SCENE_GAP_MS = 300;
export const SECTION_GAP_MS = 600;
// pausa entre frases dentro de una escena (respiración; la síntesis pasa a ser
// por frase para poder insertarla). Menor que el hueco entre escenas.
export const PAUSE_SENTENCE_MS = 180;

// Subtítulos
export const CUE_MAX_CHARS = 32;
export const CUE_MAX_WORDS = 7;
export const CUE_MAX_LINES = 2;
export const CUE_MIN_S = 1;
export const CUE_MAX_S = 5;

// Ideación (0,95 en la escala de e5: a 0,90 fusionaría historias distintas
// del mismo tema)
export const DEDUPE_COS = 0.95;
export const DEDUPE_WINDOW_DAYS = 14;
export const IDEA_SCORE_THRESHOLD = 55;

// Guion
/**
 * Velocidad de locución MEDIDA, no estimada. Al cambiar esto se mueve
 * `sceneTarget`, así que el número de escenas del prompt cambia con él.
 *
 * Historial de la medida, que es lo que la hace fiable:
 * - 150: suposición. Descalibraba el régimen de duración un 20 % — pedir 7 min
 *   producía 1.050 palabras, que son 8,5 min de voz.
 * - 125: 2.887 palabras / 23,25 min de voz real con edge-tts (es-ES, rate −8 %),
 *   con las pausas entre escenas ya dentro.
 * - 139: ElevenLabs con la voz del canal (Mario, es-ES) por el modelo que usa el
 *   worker, `eleven_flash_v2_5`. 578 palabras en 4,16 min de alineación real.
 *
 * Se mide con `pnpm probar:voz <videoId> --voz <voiceId>`, que sintetiza un
 * guion entero por el camino del worker y saca el wpm de los word timestamps.
 * Vuelve a medirse al cambiar de voz o de modelo: NO son intercambiables. El
 * mismo texto por `eleven_multilingual_v2` sale bastante más lento que por
 * Flash, así que estimar con una muestra suelta de otro modelo da un número
 * que no vale.
 *
 * Es una constante global y la voz es por canal: con más de un canal esto
 * tendría que colgar de `profile.voice`. Con uno, lo que toca es que el número
 * corresponda a la voz que está puesta.
 */
export const WORDS_PER_MIN = 139;
export const SCRIPT_LENGTH_TOLERANCE = 0.1;
export const RESEARCH_MAX_CHARS_PER_SOURCE = 20_000;
// Palabras por escena: fija cuántas escenas pide el prompt. Sin este número el
// modelo improvisa el reparto y por eso salta tanto la pasada de duración.
export const WORDS_PER_SCENE = 55;
export const SCENE_MIN_WORDS = 40;
export const SCENE_MAX_WORDS = 70;
export const SENTENCE_MAX_WORDS = 25;

// Densidad de la línea de efectos de edición (docs/edicion.md). Las tasas van
// POR MINUTO porque el vídeo es largo (5-10 min); las separaciones y la guarda
// son constantes perceptivas y NO escalan con la duración.
//
// Las del proyecto hermano (6 micro-fx, 7 s de separación) no se escalan
// linealmente: allí están en el régimen «la separación es el cuello de botella»
// y darían 72 micro-fx en diez minutos. Lo que se conserva es la RAREZA
// relativa: 0,9/min da ~7 en ocho minutos, el mismo número que el hermano pero
// para la pieza entera.
/**
 * 1,2 hasta que se midió la COBERTURA GRÁFICA (`cobertura` en calidad.ts) de
 * los tres vídeos entregados: 4,5 %, 7,9 % y 5,7 % del metraje con algo
 * dibujado en pantalla, y huecos seguidos de 69, 76 y 98 segundos. Minuto y
 * medio de b-roll con subtítulos y nada más.
 *
 * Medido con la herramienta de A/B (`scripts/ab-edicion.ts`, que ahora imprime
 * la cobertura) sobre el mismo vídeo de 7,6 min: 7,9 % → 13,9 %, hueco máximo
 * de 76 s → 30,7 s y reparto por minuto de [5,3,3,2,3,4,2,4] a [7,5,5,5,4,5,5,5].
 *
 * Se queda por debajo del ~20 % que se buscaba, y el motivo está medido: el
 * GUION declara 15 intenciones de overlay para 7,6 minutos, así que a partir de
 * ahí todo sale de la capa que rellena huecos. Subir el presupuesto más no
 * añade nada — no hay candidatos que colocar. Eso se arregla en el guion.
 *
 * No se sube al ~35 % del short a propósito: en ocho minutos un efecto
 * frecuente se gasta antes, que es lo que ya avisa micro-fx.ts.
 */
export const FX_CARDS_PER_MIN = 4;
/**
 * Insertos de referencia por minuto (imagen real de una entidad nombrada).
 * Van en su PROPIO carril, no compitiendo con las tarjetas: un inserto es la
 * única vía de enseñar a la persona o el producto del que se habla —el archivo
 * de stock no tiene planos de cosas con nombre propio— así que perderlo en el
 * reparto no es «una tarjeta menos», es que el sujeto no aparece nunca.
 * Medido: con el inserto dentro del carril de tarjetas, el de «Elon Musk» a
 * 24,6 s moría siempre contra el texto cinético del gancho, que va en la misma
 * ventana y tiene más prioridad. 0,35/min ≈ 3 en un vídeo de 8 min, que es lo
 * que el prompt del guion pide declarar.
 */
export const FX_INSERTOS_PER_MIN = 0.35;
export const FX_MICRO_PER_MIN = 1.8;
export const FX_KEYWORDS_PER_MIN = 2.5;
/** Fusible, no objetivo: si muerde es que algo va mal. */
export const FX_SFX_PER_MIN = 6;

// 20 s topaba el presupuesto en 3/min por sí sola: la separación era el cuello
// de botella y subir el presupuesto no se habría notado.
export const FX_CARD_SEP_MS = 7_000;
/**
 * Franja de un solo overlay visual en el vídeo largo. Era el BEAT, que dura
 * 8-15 s: un beat largo con dos ideas solo podía enseñar una. Medirla en tiempo
 * desacopla la densidad gráfica de la longitud del beat, que la fija el audio y
 * no tiene por qué decidir cuántos gráficos caben. Quien impide el
 * amontonamiento es FX_CARD_SEP_MS, no esto.
 */
export const FX_FRANJA_MS = 5_000;
/** ~1 beat: dos acentos dentro del mismo beat se leen como un tic. */
export const FX_MICRO_SEP_MS = 14_000;
export const FX_KEYWORD_SEP_MS = 12_000;
export const FX_ZOOM_SEP_MS = 12_000;
/** Lo que tarda el ojo en acabar de leer la entrada de una tarjeta. */
export const FX_CARD_GUARD_MS = 600;
/** Dos sonidos más juntos que esto se emborronan. */
export const FX_SFX_COLLISION_MS = 120;

// ---- shorts verticales ----
// VIDEO_WIDTH/HEIGHT siguen significando el lienzo del LARGO y no se tocan.
export const SHORT_WIDTH = 1080;
export const SHORT_HEIGHT = 1920;

/** Tope de YouTube Shorts. */
export const SHORT_MAX_S = 59;
export const SHORT_MIN_S = 20;
export const SHORT_TARGET_S = 35;
/** Cuántos candidatos propone el director por vídeo. */
export const SHORTS_PER_VIDEO = 3;

/**
 * Un efecto truncado por el borde de la ventana se descarta si le queda menos
 * de esta fracción de su duración. Un odómetro cortado por la mitad —que empieza
 * a contar y desaparece— es peor que no tener odómetro.
 */
export const SHORT_EDIT_TRUNCATE_MIN = 0.6;
/** Y por debajo de esto no da tiempo ni a leerlo, aunque la fracción cuadre. */
export const SHORT_EDIT_MIN_MS = 400;

/**
 * Tolerancia del ajuste de la ventana a una frontera fuerte. La frontera de
 * beat ya garantiza que no se corta a mitad de palabra; esto solo afina hacia
 * el final de frase más cercano.
 */
export const SHORT_SNAP_MS = 400;
/** Un límite de beat cuenta como fin de frase si cae así de cerca de un cue. */
export const SHORT_FRONTERA_TOL_MS = 120;

/**
 * Presupuesto de motion del short, ABSOLUTO por pieza y no por minuto: el
 * reparto en ventanas parte la duración entre el presupuesto, y una tasa por
 * minuto sobre 30 s degenera en una sola ventana y pierde el mecanismo entero.
 *
 * No son las del largo escaladas. Las del largo son la TRADUCCIÓN a ocho
 * minutos de los números del proyecto hermano, que estaban calibrados para
 * piezas de ~50 s: aquí se vuelve al origen. Ver el comentario de FX_*_PER_MIN
 * y micro-fx.ts:54-57.
 */
export const SHORT_CARDS_MAX = 3;
export const SHORT_MICRO_MAX = 4;
export const SHORT_KEYWORDS_MAX = 8;
export const SHORT_ZOOMS_MAX = 5;
export const SHORT_FX_CARD_SEP_MS = 7_000;
export const SHORT_FX_MICRO_SEP_MS = 6_000;
export const SHORT_FX_ZOOM_SEP_MS = 5_000;
// Ocho subrayados en 35 s son uno cada 4,4 s: con la separación del largo
// (12 s) el tope de arriba sería inalcanzable y sobrarían seis.
export const SHORT_FX_KEYWORD_SEP_MS = 2_500;
/**
 * Franja de no-amontonamiento del carril visual. En el largo esa franja es el
 * BEAT (8-15 s) y está bien: evita apilar dos gráficos en la misma idea. En una
 * pieza de treinta segundos es un techo duro —dos o tres beats, luego dos o tres
 * efectos como mucho, por muchos que se generen— así que el vertical la mide en
 * tiempo. Tres segundos es el mismo grano que el ritmo de corte.
 */
export const SHORT_FX_GRANO_MS = 3_000;
// FX_CARD_GUARD_MS y FX_SFX_COLLISION_MS NO tienen variante corta: son del ojo
// y del oído, no del formato.

/**
 * Ritmo de corte del short: un plano cada 2-3 s, frente a los 4-8 s del vídeo
 * largo. No sale de beats nuevos —eso rompería la ley temporal del audio— sino
 * de trocear MÁS los planos que ya están aprobados: jump cuts dentro del mismo
 * clip y re-encuadres de la misma imagen.
 *
 * Medido sobre cuatro shorts reales antes de esto: 2,8 / 4,8 / 7,5 / 11,3 s por
 * plano. El de 11,3 s es un plano fijo durante once segundos en una pieza que
 * dura treinta.
 */
export const SHORT_PLANO_MAX_MS = 3_000;
/** Techo de partes por plano. El del largo es 5. */
export const SHORT_TROCEO_MAX_PARTES = 8;
/** Por debajo de ~1,1 s el plano se lee como parpadeo y no como corte. */
export const SHORT_TROCEO_PARTE_MIN_MS = 1_200;
/** Planos por beat en vertical. El del largo es 3. */
export const SHORT_MAX_VISUALS_PER_BEAT = 8;

/**
 * Cadencia sana del SHORT en planos por minuto. Derivada del ritmo objetivo
 * del formato (un plano cada 2-3 s, SHORT_PLANO_MAX_MS): 60/3=20 y 60/2=30.
 * La banda del largo (6-16) auditaría el vertical como estroboscopio siempre.
 */
export const SHORT_CADENCIA_MIN = 20;
export const SHORT_CADENCIA_MAX = 30;
/**
 * Tramo seguido sin nada dibujado a partir del cual un SHORT avisa. El techo
 * del largo (60 s) es matemáticamente inalcanzable en una pieza de ≤59 s: la
 * métrica que se creó para «se ve vacía» moría justo en el formato del
 * diagnóstico.
 *
 * Calibrado contra los 11 shorts reales del corpus (12-ago-2026): huecos de
 * 6,7 · 9,0 · 9,6 · 15,4 · 18,9 · 20,0 ×2 · 20,1 · 20,6 · 25,5 · 26,2 s.
 * Disparan 10 de 11 — y NO es el umbral: es el diagnóstico conocido («se ve
 * vacía»). El que pasa (6,7 s, 14 efectos) demuestra que el techo es
 * alcanzable por el pipeline actual cuando la pasada de efectos hace su
 * trabajo.
 */
export const SHORT_HUECO_GRAFICO_MAX_MS = 8_000;
