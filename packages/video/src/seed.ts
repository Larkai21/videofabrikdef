// Semilla determinista para toda variación visual (docs/render.md §4).
// FNV-1a de 32 bits: mismo string de entrada ⇒ mismo entero sin signo,
// en player y en render SSR. Nunca Math.random en este paquete.
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
