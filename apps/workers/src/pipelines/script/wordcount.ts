import { SCRIPT_LENGTH_TOLERANCE, WORDS_PER_MIN, WORDS_PER_SCENE } from '@fabrica/shared';

/**
 * Cuántas escenas pedir para una duración. Sin este número el modelo improvisa
 * el reparto y por eso saltaba tanto la pasada de ajuste de duración.
 */
export function sceneTarget(targetWords: number): number {
  return Math.max(5, Math.round(targetWords / WORDS_PER_SCENE));
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function scriptWords(scenes: Array<{ text: string }>): number {
  return scenes.reduce((acc, scene) => acc + countWords(scene.text), 0);
}

export function wordTarget(targetMinutes: number): number {
  return Math.round(targetMinutes * WORDS_PER_MIN);
}

export function withinTolerance(words: number, target: number): boolean {
  return Math.abs(words - target) <= target * SCRIPT_LENGTH_TOLERANCE;
}
