// Parámetros transversales del pipeline. Los umbrales de matching son
// PROVISIONALES: se calibran en S1 etiquetando ~50 beats a mano (SPEC docs/assets-y-biblioteca.md §2).

// Vídeo
export const FPS = 30;
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;

// Embeddings — el MISMO modelo en todo el sistema; cambiarlo = re-embeber todo
export const EMBEDDING_DIMS = 384;

// Beats (segundos)
export const BEAT_MIN_S = 8;
export const BEAT_MAX_S = 15;
export const BEAT_TARGET_S = 11.5;
export const BEAT_LAST_MIN_S = 5;
export const BEAT_LAST_MAX_S = 18;

// Cascada de assets (similitud coseno)
export const T_AUTO = 0.62;
export const T_REV = 0.45;
export const T_STOCK = 0.7;
export const ANTI_REPEAT_N = 8;
export const STOCK_CACHE_TTL_H = 24;
export const MAX_LOOPS = 3;
export const LOOP_CROSSFADE_MS = 300;

// Audio
export const LOUDNORM_LUFS = -16;
export const LOUDNORM_TRUE_PEAK = -1.5;
export const SCENE_GAP_MS = 300;
export const SECTION_GAP_MS = 450;

// Subtítulos
export const CUE_MAX_CHARS = 32;
export const CUE_MAX_WORDS = 7;
export const CUE_MAX_LINES = 2;
export const CUE_MIN_S = 1;
export const CUE_MAX_S = 5;

// Ideación
export const DEDUPE_COS = 0.9;
export const DEDUPE_WINDOW_DAYS = 14;
export const IDEA_SCORE_THRESHOLD = 55;

// Guion
export const WORDS_PER_MIN = 150;
export const SCRIPT_LENGTH_TOLERANCE = 0.1;
export const RESEARCH_MAX_CHARS_PER_SOURCE = 20_000;
