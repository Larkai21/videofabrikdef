import path from 'node:path';
import type pino from 'pino';
import { EMBEDDING_DIMS } from '@fabrica/shared';
import { REPO_ROOT } from '../lib/env.js';

// Embeddings locales (docs/assets-y-biblioteca.md §1): el MISMO modelo en todo
// el sistema para que las similitudes sean comparables. Guiones en español y
// queries visuales en inglés → el modelo tiene que ser multilingüe y de
// EMBEDDING_DIMS (384) dims exactas (las columnas pgvector son vector(384)).
//
// Por qué NO usamos la librería `fastembed` 2.1.0 instalada:
//  - Sus modelos densos de 384 dims (AllMiniLML6V2, BGESmallENV15) son solo
//    inglés; su único multilingüe (MLE5Large) es de 1024 dims.
//  - Su modo CUSTOM exige un directorio local (`modelAbsoluteDirPath`), no
//    descarga por nombre de HF para modelos densos.
//  - Además su inferencia inyecta siempre `token_type_ids` (los e5 basados en
//    XLM-RoBERTa no aceptan esa entrada → error de onnxruntime) y hace pooling
//    CLS, mientras que los e5 exigen mean pooling: los vectores saldrían mal.
//
// Backend real elegido: transformers.js (@huggingface/transformers) con el
// modelo Xenova/multilingual-e5-small (384 dims, multilingüe, mean pooling).
// La dependencia aún no está instalada: se detecta con import dinámico y, si
// falta, el proveedor se degrada a 'hash' con un warn claro (regla: el modo
// degradado nunca rompe el pipeline). 'hash' sigue siendo el mock determinista
// para desarrollo y tests.
//
// Regla del doc §1: cambiar de modelo invalida TODAS las similitudes → al
// activar el backend real hay que lanzar el job 'reembed' de la cola library
// (apps/workers/src/pipelines/library/reembed.ts).

export interface EmbeddingsProvider {
  // clave del proveedor tal y como se configura en EMBEDDINGS_PROVIDER
  readonly name: 'fastembed' | 'hash';
  /**
   * Asimetría e5 ADOPTADA para el dominio de assets (11-ago-2026): las
   * consultas van con 'query' (defecto) y los captions/títulos de los assets
   * con 'passage'. Medido en el banco con 182 pares etiquetados: AUC 0,669
   * uniforme → 0,707 asimétrico, cruzando el 0,70 que la curva fija como «la
   * señal separa». El margen es fino y NINGÚN umbral da precisión útil ni aun
   * así (100 % de precisión solo con 5 % de cobertura): el coseno RECUPERA y
   * ordena; decidir sigue siendo del juez de planos.
   *
   * Los dominios simétricos (ideas↔pilares, fuentes, beats) siguen con
   * 'query' a ambos lados, que es lo que la model card recomienda para ellos.
   * Tras cambiar el prefijo de un lado hay que re-embeber lo almacenado de ese
   * dominio (job reembed): mezclar prefijos es mezclar espacios.
   */
  embed(texts: string[], prefijo?: 'query' | 'passage'): Promise<number[][]>;
  // backend efectivo (tras la primera carga) para logs y verificación
  describe(): { backend: 'e5-transformers' | 'hash'; model: string; dims: number };
}

export const E5_MODEL_ID = 'Xenova/multilingual-e5-small';

// Prefijos e5 (model card de intfloat/multilingual-e5-small): TODO texto debe
// llevar prefijo 'query: ' o 'passage: ', también en textos no ingleses; para
// tareas simétricas (similitud semántica, no retrieval documento-largo) la
// model card recomienda 'query: ' en ambos lados. Como la interfaz embed() se
// usa hoy indistintamente para queries y para captions/títulos (poll, score,
// assets), aplicamos 'query: ' uniforme: un único espacio coherente. Adoptar
// asimetría query/passage exigiría tocar los call sites y re-embeber todo.
export const E5_QUERY_PREFIX = 'query: ';
export const E5_PASSAGE_PREFIX = 'passage: ';

export const E5_BATCH_SIZE = 16;

const HASH_MODEL_ID = 'hash-ngram-v1';

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

export function l2Normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
  if (norm === 0) return vec.slice();
  return vec.map((v) => v / norm);
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error(`Tamaño de lote inválido: ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface BatchedEmbedderOptions {
  // función cruda del modelo: recibe un lote ya prefijado y devuelve vectores
  embedBatch: (texts: string[]) => Promise<number[][]>;
  batchSize: number;
  dims: number;
  prefix?: string;
}

// Envoltorio puro y testeable: prefijo e5 + lotes + verificación de dims +
// normalización L2 garantizada (aunque el backend ya normalice, renormalizar
// un vector unitario es inocuo y protege frente a backends que no lo hagan).
export function createBatchedEmbedder(
  opts: BatchedEmbedderOptions,
): (texts: string[], prefijoOverride?: string) => Promise<number[][]> {
  const { embedBatch, batchSize, dims, prefix } = opts;
  return async (texts: string[], prefijoOverride?: string): Promise<number[][]> => {
    if (texts.length === 0) return [];
    const efectivo = prefijoOverride ?? prefix;
    const prefixed = efectivo ? texts.map((t) => `${efectivo}${t}`) : texts;
    const out: number[][] = [];
    for (const batch of chunk(prefixed, batchSize)) {
      const vectors = await embedBatch(batch);
      if (vectors.length !== batch.length) {
        throw new Error(
          `El backend de embeddings devolvió ${vectors.length} vectores para un lote de ${batch.length}`,
        );
      }
      for (const vec of vectors) {
        if (vec.length !== dims) {
          throw new Error(
            `El modelo de embeddings devuelve ${vec.length} dims y el sistema exige ${dims} (EMBEDDING_DIMS)`,
          );
        }
        out.push(l2Normalize(vec));
      }
    }
    return out;
  };
}

// Bolsa de n-gramas con hashing: determinista, normalizado y con similitud
// razonable entre textos que comparten vocabulario. Suficiente para modo mock;
// NO es multilingüe (ES/EN no comparten tokens → cos ≈ 0 entre idiomas).
class HashEmbeddings implements EmbeddingsProvider {
  readonly name = 'hash' as const;

  describe(): { backend: 'e5-transformers' | 'hash'; model: string; dims: number } {
    return { backend: 'hash', model: HASH_MODEL_ID, dims: EMBEDDING_DIMS };
  }

  // el hash ignora el prefijo: no hay dos espacios que distinguir
  async embed(texts: string[], _prefijo: 'query' | 'passage' = 'query'): Promise<number[][]> {
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

// Forma mínima del módulo transformers.js que usamos (tipado local porque la
// dependencia es opcional y se resuelve con import dinámico).
interface FeatureExtractionTensor {
  tolist(): number[][];
}
type FeatureExtractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<FeatureExtractionTensor>;
interface TransformersModule {
  pipeline(task: 'feature-extraction', model: string): Promise<FeatureExtractor>;
  env?: { cacheDir?: string };
}

// nombres de paquete a probar, en orden de preferencia (el segundo es el
// nombre antiguo del mismo proyecto)
const TRANSFORMERS_MODULES = ['@huggingface/transformers', '@xenova/transformers'];

function embeddingsCacheDir(): string {
  // el mismo directorio gitignoreado que usaba fastembed
  return process.env.FASTEMBED_CACHE_DIR ?? path.join(REPO_ROOT, '.fastembed_cache');
}

// Proveedor real: clave 'fastembed' en EMBEDDINGS_PROVIDER por compatibilidad
// con el .env existente, backend transformers.js + multilingual-e5-small.
class MultilingualE5Embeddings implements EmbeddingsProvider {
  readonly name = 'fastembed' as const;
  private loadPromise: Promise<
    ((texts: string[], prefijoOverride?: string) => Promise<number[][]>) | null
  > | null = null;
  private readonly hash = new HashEmbeddings();
  private degraded = false;
  private warned = false;

  constructor(private logger: pino.Logger) {}

  describe(): { backend: 'e5-transformers' | 'hash'; model: string; dims: number } {
    return this.degraded
      ? { backend: 'hash', model: HASH_MODEL_ID, dims: EMBEDDING_DIMS }
      : { backend: 'e5-transformers', model: E5_MODEL_ID, dims: EMBEDDING_DIMS };
  }

  private async load(): Promise<
    ((texts: string[], prefijoOverride?: string) => Promise<number[][]>) | null
  > {
    this.loadPromise ??= (async () => {
      for (const spec of TRANSFORMERS_MODULES) {
        let mod: TransformersModule;
        try {
          // especificador variable a propósito: la dependencia es opcional y
          // no debe romper el typecheck ni el arranque si no está instalada
          mod = (await import(spec)) as TransformersModule;
        } catch {
          continue; // paquete no instalado; probar el siguiente
        }
        try {
          const t0 = Date.now();
          this.logger.info(
            { model: E5_MODEL_ID, paquete: spec, cache: embeddingsCacheDir() },
            'Cargando el modelo de embeddings multilingüe (la primera vez descarga pesos)',
          );
          if (mod.env) mod.env.cacheDir = embeddingsCacheDir();
          const extractor = await mod.pipeline('feature-extraction', E5_MODEL_ID);
          this.logger.info(
            { model: E5_MODEL_ID, ms: Date.now() - t0 },
            'Modelo de embeddings listo',
          );
          return createBatchedEmbedder({
            embedBatch: async (batch) => {
              const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
              return tensor.tolist();
            },
            batchSize: E5_BATCH_SIZE,
            dims: EMBEDDING_DIMS,
            prefix: E5_QUERY_PREFIX,
          });
        } catch (err) {
          // fallo de descarga/inicialización (a menudo transitorio: red);
          // NO se cachea el fallo — el siguiente embed reintenta la carga
          this.logger.warn(
            { err, model: E5_MODEL_ID, paquete: spec },
            'No se pudo inicializar el modelo de embeddings; se reintentará en la siguiente llamada',
          );
          return null;
        }
      }
      return null;
    })();
    const loaded = await this.loadPromise;
    if (!loaded) this.loadPromise = null;
    return loaded;
  }

  async embed(texts: string[], prefijo: 'query' | 'passage' = 'query'): Promise<number[][]> {
    if (texts.length === 0) return [];
    const embedder = await this.load();
    if (!embedder) {
      // mezclar espacios vectoriales corrompe TODAS las similitudes: escribir
      // vectores hash cuando se espera e5 solo se permite de forma explícita
      if (process.env.EMBEDDINGS_ALLOW_FALLBACK !== 'true') {
        throw new Error(
          'Backend de embeddings multilingüe no disponible (EMBEDDINGS_PROVIDER=fastembed). ' +
            'Instala @huggingface/transformers o exporta EMBEDDINGS_ALLOW_FALLBACK=true para ' +
            'permitir el hash de desarrollo (los vectores NO serán comparables con e5).',
        );
      }
      this.degraded = true;
      if (!this.warned) {
        this.warned = true;
        this.logger.warn(
          { faltan: TRANSFORMERS_MODULES, model: E5_MODEL_ID },
          'Modo degradado EXPLÍCITO (EMBEDDINGS_ALLOW_FALLBACK): vectores hash no comparables con e5; lanzar el job reembed tras instalar el modelo',
        );
      }
      return this.hash.embed(texts);
    }
    return embedder(texts, prefijo === 'passage' ? E5_PASSAGE_PREFIX : E5_QUERY_PREFIX);
  }
}

export function createEmbeddings(logger: pino.Logger): EmbeddingsProvider {
  const provider = process.env.EMBEDDINGS_PROVIDER ?? 'hash';
  if (provider === 'fastembed') return new MultilingualE5Embeddings(logger);
  return new HashEmbeddings();
}
