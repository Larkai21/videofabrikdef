import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { EMBEDDING_DIMS } from '@fabrica/shared';
import {
  E5_BATCH_SIZE,
  E5_QUERY_PREFIX,
  chunk,
  cosineSimilarity,
  createBatchedEmbedder,
  createEmbeddings,
  l2Normalize,
} from './embeddings.js';

const silent = pino({ level: 'silent' });

// el provider hash como doble de un backend real: determinista y offline
function hashProvider() {
  const prev = process.env.EMBEDDINGS_PROVIDER;
  delete process.env.EMBEDDINGS_PROVIDER;
  const provider = createEmbeddings(silent);
  if (prev !== undefined) process.env.EMBEDDINGS_PROVIDER = prev;
  return provider;
}

describe('l2Normalize', () => {
  it('deja el vector con norma 1', () => {
    const v = l2Normalize([3, 4]);
    expect(Math.hypot(...v)).toBeCloseTo(1, 10);
    expect(v[0]).toBeCloseTo(0.6, 10);
    expect(v[1]).toBeCloseTo(0.8, 10);
  });

  it('no divide por cero con el vector nulo', () => {
    expect(l2Normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('chunk', () => {
  it('parte en lotes del tamaño pedido', () => {
    const lots = chunk([1, 2, 3, 4, 5], 2);
    expect(lots).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('rechaza tamaños inválidos', () => {
    expect(() => chunk([1], 0)).toThrow(/inválido/);
  });
});

describe('createBatchedEmbedder', () => {
  it('aplica el prefijo e5 una sola vez y por lotes de 16', async () => {
    const seen: string[][] = [];
    const hash = hashProvider();
    const embed = createBatchedEmbedder({
      embedBatch: async (texts) => {
        seen.push(texts);
        return hash.embed(texts);
      },
      batchSize: E5_BATCH_SIZE,
      dims: EMBEDDING_DIMS,
      prefix: E5_QUERY_PREFIX,
    });

    const texts = Array.from({ length: 35 }, (_, i) => `texto número ${i}`);
    const vectors = await embed(texts);

    expect(vectors).toHaveLength(35);
    expect(seen.map((b) => b.length)).toEqual([16, 16, 3]);
    for (const batch of seen) {
      for (const t of batch) {
        expect(t.startsWith(E5_QUERY_PREFIX)).toBe(true);
        // sin prefijo duplicado
        expect(t.slice(E5_QUERY_PREFIX.length).startsWith(E5_QUERY_PREFIX)).toBe(false);
      }
    }
  });

  it('garantiza normalización L2 aunque el backend no normalice', async () => {
    const embed = createBatchedEmbedder({
      embedBatch: async (texts) => texts.map(() => new Array<number>(EMBEDDING_DIMS).fill(2)),
      batchSize: 16,
      dims: EMBEDDING_DIMS,
    });
    const [vec] = await embed(['hola']);
    expect(vec).toBeDefined();
    const norm = Math.sqrt((vec ?? []).reduce((acc, v) => acc + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('falla con error claro si las dims no cuadran con EMBEDDING_DIMS', async () => {
    const embed = createBatchedEmbedder({
      embedBatch: async (texts) => texts.map(() => [1, 2, 3]),
      batchSize: 16,
      dims: EMBEDDING_DIMS,
    });
    await expect(embed(['hola'])).rejects.toThrow(/3 dims y el sistema exige 384/);
  });

  it('devuelve vacío sin llamar al backend si no hay textos', async () => {
    let calls = 0;
    const embed = createBatchedEmbedder({
      embedBatch: async (texts) => {
        calls += 1;
        return texts.map(() => new Array<number>(EMBEDDING_DIMS).fill(1));
      },
      batchSize: 16,
      dims: EMBEDDING_DIMS,
    });
    expect(await embed([])).toEqual([]);
    expect(calls).toBe(0);
  });
});

describe('backend efectivo con EMBEDDINGS_PROVIDER=fastembed', () => {
  it('usa e5 si transformers.js está instalado y cae a hash si no, sin romper', async () => {
    const prev = process.env.EMBEDDINGS_PROVIDER;
    process.env.EMBEDDINGS_PROVIDER = 'fastembed';
    const provider = createEmbeddings(silent);
    if (prev !== undefined) process.env.EMBEDDINGS_PROVIDER = prev;
    else delete process.env.EMBEDDINGS_PROVIDER;

    expect(provider.name).toBe('fastembed');
    const [vec] = await provider.embed(['sala de servidores']);
    expect(vec).toHaveLength(EMBEDDING_DIMS);
    const norm = Math.sqrt((vec ?? []).reduce((acc, v) => acc + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
    // el backend depende del entorno: e5 con la dependencia instalada,
    // hash como degradación; ambos son válidos y ninguno debe romper
    const backendOk = await (async () => {
      try {
        await import('@huggingface/transformers');
        return 'e5-transformers';
      } catch {
        return 'hash';
      }
    })();
    expect(provider.describe().backend).toBe(backendOk);
  }, 120_000);
});

// disponible solo si transformers.js está instalado (dep opcional propuesta:
// @huggingface/transformers). Descarga pesos la primera vez → timeout amplio.
const transformersAvailable = await (async () => {
  for (const spec of ['@huggingface/transformers', '@xenova/transformers']) {
    try {
      await import(spec);
      return true;
    } catch {
      // seguir probando
    }
  }
  return false;
})();

describe.skipIf(!transformersAvailable)('similitud multilingüe ES/EN (modelo real)', () => {
  it(
    'sala de servidores ~ server room > sala de servidores ~ birthday cake',
    async () => {
      const prev = process.env.EMBEDDINGS_PROVIDER;
      process.env.EMBEDDINGS_PROVIDER = 'fastembed';
      const provider = createEmbeddings(silent);
      if (prev !== undefined) process.env.EMBEDDINGS_PROVIDER = prev;
      else delete process.env.EMBEDDINGS_PROVIDER;

      const [es, en, cake] = await provider.embed([
        'sala de servidores',
        'server room',
        'birthday cake',
      ]);
      expect(provider.describe().backend).toBe('e5-transformers');
      expect(es && en && cake).toBeTruthy();
      const near = cosineSimilarity(es ?? [], en ?? []);
      const far = cosineSimilarity(es ?? [], cake ?? []);
      expect(near).toBeGreaterThan(far);
    },
    300_000,
  );
});
