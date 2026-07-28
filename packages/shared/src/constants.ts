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

// Cascada de assets (similitud coseno). Escala calibrada a ojo para
// multilingual-e5-small, cuya línea base para pares NO relacionados ronda
// 0,72–0,78 (con el mock hash la escala era otra). Calibración fina en curso:
// etiquetar ~50 beats a mano (objetivo <5% de falsos auto_ok).
export const T_AUTO = 0.86;
export const T_REV = 0.78;
export const T_STOCK = 0.88;
export const ANTI_REPEAT_N = 8;
export const STOCK_CACHE_TTL_H = 24;
export const MAX_LOOPS = 3;
export const LOOP_CROSSFADE_MS = 300;
// Sub-planos: cortes visuales dentro de un beat (b-roll más ágil). Tope por
// beat y duración máxima de una imagen fija en pantalla (los clips, dinámicos,
// no tienen tope y llenan su tramo).
export const MAX_VISUALS_PER_BEAT = 3;
export const IMAGE_MAX_S = 5;
// crossfade corto entre sub-planos dentro de un beat
export const SUBVISUAL_CROSSFADE_MS = 200;
// Ralentización máxima admisible para llenar un beat con una sola pasada del
// clip (0,75 = el clip puede cubrir hasta 1/0,75 ≈ 1,33× su duración sin que
// se note como cámara lenta). Por debajo se recurre al bucle.
export const MIN_PLAYBACK_RATE = 0.75;

// Audio
export const LOUDNORM_LUFS = -16;
export const LOUDNORM_TRUE_PEAK = -1.5;
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
export const WORDS_PER_MIN = 150;
export const SCRIPT_LENGTH_TOLERANCE = 0.1;
export const RESEARCH_MAX_CHARS_PER_SOURCE = 20_000;
