// Utilidades puras de formato y cálculo. Sin dependencias del DOM: se testean solas.

import { WORDS_PER_MIN } from '@fabrica/shared';

/** Milisegundos → «m:ss» (reloj de locución). */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * «h:mm:ss», «m:ss» o segundos a pelo → milisegundos; null si no se entiende.
 * Inverso laxo de fmtClock: acepta lo que un humano teclea mirando YouTube
 * (1:02:35, 62:35 o 3755).
 */
export function parseClock(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(t);
  if (m === null) return null;
  const h = m[1] !== undefined ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const s = Number(m[3]);
  if (s >= 60 || (m[1] !== undefined && min >= 60)) return null;
  return ((h * 60 + min) * 60 + s) * 1000;
}

/** Dólares → «4,80 $» (coma decimal, como el mock). */
export function fmtMoney(usd: number): string {
  // los enteros van limpios como en el mock («límite 15 $», no «15,00 $»)
  if (Number.isInteger(usd)) return `${usd} $`;
  return `${usd.toFixed(2).replace('.', ',')} $`;
}

/** Similitud 0–1 → «0,87». */
export function fmtSim(x: number): string {
  return x.toFixed(2).replace('.', ',');
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/** Duración estimada de locución para un número de palabras (150 wpm por defecto). */
export function speechMs(words: number, wpm: number = WORDS_PER_MIN): number {
  if (wpm <= 0) return 0;
  return Math.round((words / wpm) * 60_000);
}

/** Porcentaje 0–100 acotado. */
export function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (part / total) * 100));
}

/** Etiqueta corta de un beat para la pill: primer tramo antes de coma o dos puntos. */
export function beatShortLabel(label: string): string {
  const first = label.split(/[,:·]/)[0] ?? label;
  return first.trim();
}

/** Marcas de tiempo equiespaciadas para el pie de la pista. */
export function timeMarks(durationMs: number, n = 6): string[] {
  if (durationMs <= 0 || n < 2) return [];
  return Array.from({ length: n }, (_, i) => fmtClock((durationMs * i) / (n - 1)));
}

/** Offsets estimados de comienzo de cada escena, por palabras acumuladas. */
export function sceneOffsets(texts: string[], wpm: number = WORDS_PER_MIN): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const text of texts) {
    offsets.push(acc);
    acc += speechMs(wordCount(text), wpm);
  }
  return offsets;
}
