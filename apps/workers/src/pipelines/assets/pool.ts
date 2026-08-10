/**
 * Anchura del pool de candidatos, compartida entre la cascada (cuántos
 * finalistas entran a puntuar) y el juez de planos (cuántos lee). Vivían como
 * dos literales en dos ficheros y solo coincidían por disciplina; si divergen,
 * el juez deja de ver parte del pool o lee candidatos que no existen.
 */
export const STOCK_FINALISTS = 10;
