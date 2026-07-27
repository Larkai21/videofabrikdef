import type pino from 'pino';
import { EMBEDDING_DIMS } from '@fabrica/shared';

// Embeddings locales (docs/assets-y-biblioteca.md §1): el MISMO modelo en todo
// el sistema para que las similitudes sean comparables. 'hash' es un mock
// determinista sin modelo (desarrollo y tests); 'fastembed' descarga el modelo
// ONNX a .fastembed_cache la primera vez.

export interface EmbeddingsProvider {
  readonly name: 'fastembed' | 'hash';
  embed(texts: string[]): Promise<number[][]>;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// Bolsa de n-gramas con hashing: determinista, normalizado y con similitud
// razonable entre textos que comparten vocabulario. Suficiente para modo mock.
class HashEmbeddings implements EmbeddingsProvider {
  readonly name = 'hash' as const;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vec = new Array<number>(EMBEDDING_DIMS).fill(0);
      const tokens = text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9áéíóúñü\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2);
      for (const token of tokens) {
        let h = 2166136261;
        for (let i = 0; i < token.length; i++) {
          h ^= token.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        h = h >>> 0;
        const i1 = h % EMBEDDING_DIMS;
        const i2 = (h >> 8) % EMBEDDING_DIMS;
        vec[i1] = (vec[i1] ?? 0) + 1;
        vec[i2] = (vec[i2] ?? 0) + 0.5;
      }
      const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0)) || 1;
      return vec.map((v) => v / norm);
    });
  }
}

class FastEmbedEmbeddings implements EmbeddingsProvider {
  readonly name = 'fastembed' as const;
  private modelPromise: Promise<{
    embed: (texts: string[], batchSize?: number) => AsyncIterable<number[][]>;
  }> | null = null;

  constructor(private logger: pino.Logger) {}

  private async model() {
    if (!this.modelPromise) {
      this.modelPromise = (async () => {
        const { FlagEmbedding, EmbeddingModel } = await import('fastembed');
        // multilingüe si está disponible en la versión instalada; si no,
        // el mejor 384-dims disponible. Cambiar de modelo = re-embeber todo.
        const preferred =
          (EmbeddingModel as Record<string, string>)['MLE5Small'] ??
          (EmbeddingModel as Record<string, string>)['ParaphraseMLMiniLML12V2'] ??
          EmbeddingModel.AllMiniLML6V2;
        this.logger.info({ model: preferred }, 'Inicializando fastembed');
        return FlagEmbedding.init({ model: preferred as never });
      })();
    }
    return this.modelPromise;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const model = await this.model();
    const out: number[][] = [];
    for await (const batch of model.embed(texts, 16)) {
      for (const vec of batch) {
        if (vec.length !== EMBEDDING_DIMS) {
          throw new Error(
            `El modelo de embeddings devuelve ${vec.length} dims y el sistema exige ${EMBEDDING_DIMS}`,
          );
        }
        out.push(Array.from(vec));
      }
    }
    return out;
  }
}

export function createEmbeddings(logger: pino.Logger): EmbeddingsProvider {
  const provider = process.env.EMBEDDINGS_PROVIDER ?? 'hash';
  if (provider === 'fastembed') return new FastEmbedEmbeddings(logger);
  return new HashEmbeddings();
}
