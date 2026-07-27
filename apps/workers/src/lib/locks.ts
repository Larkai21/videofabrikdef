// Mutex en proceso para serializar toda mutación/lectura empaquetada de
// packages/video/src: la regeneración del registry (validación del brand kit,
// sync de arranque) y el bundle() del render corren en el MISMO proceso de
// workers pero en colas distintas; sin candado, webpack puede leer un árbol a
// medio copiar y el marcador de caché lo perpetuaría.

export interface AsyncLock {
  acquire(): Promise<() => void>;
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createAsyncLock(): AsyncLock {
  let tail: Promise<void> = Promise.resolve();
  return {
    async acquire() {
      let release!: () => void;
      const next = new Promise<void>((resolve) => {
        release = resolve;
      });
      const prev = tail;
      tail = tail.then(() => next);
      await prev;
      return release;
    },
    async run(fn) {
      const release = await this.acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

// candado único del árbol de packages/video/src (registry + kit + bundle)
export const videoSrcLock = createAsyncLock();
