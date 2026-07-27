import type { ChannelSettings } from '@fabrica/shared';

// Matemática pura del scoring de clusters (docs/scraper.md §4). Sin IO para
// que sea testeable con casos sintéticos.

export type ScoringWeights = ChannelSettings['scoring'];

export interface ClusterSignals {
  // mejor z-score del cluster (métrica del item dentro de su fuente)
  externalZ: number;
  // cos máx entre centroide del cluster y pilares del perfil
  fitCos: number;
  // horas desde la publicación más reciente del cluster
  ageHours: number;
  // cos máx contra títulos de competidores (fuentes kind youtube, 21 días)
  saturationCos: number;
  // match con high_cpm_topics (keyword → 1, si no cos máx por embedding)
  commercialFit: number;
}

export interface ScoreParts {
  external: number;
  fit: number;
  freshness: number;
  saturation: number;
  commercial: number;
  external_z: number;
  fit_cos: number;
  age_hours: number;
  saturation_cos: number;
  commercial_fit: number;
  total: number;
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

// mapea un z-score a 0..1 (z=0 → 0,5) para escalarlo con el peso
export function logistic01(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

export function zScore(value: number, mean: number, std: number): number {
  if (std <= 0) return 0;
  return (value - mean) / std;
}

// mejor señal numérica del item según su fuente (points HN, views YT, score Reddit)
export function metricValue(metrics: unknown): number {
  if (!metrics || typeof metrics !== 'object') return 0;
  const m = metrics as Record<string, unknown>;
  for (const key of ['points', 'views', 'score']) {
    const raw = m[key];
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function centroid(vectors: number[][]): number[] {
  const dims = vectors[0]?.length ?? 0;
  const acc = new Array<number>(dims).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dims; i++) acc[i] = (acc[i] ?? 0) + (vec[i] ?? 0);
  }
  const norm = Math.sqrt(acc.reduce((s, x) => s + x * x, 0)) || 1;
  return acc.map((x) => x / norm);
}

export function scoreCluster(
  signals: ClusterSignals,
  weights: ScoringWeights,
): { score: number; parts: ScoreParts } {
  const external = weights.external * logistic01(signals.externalZ);
  const fit = weights.fit * clamp01(signals.fitCos);
  const freshness =
    weights.freshness *
    Math.exp(-Math.max(0, signals.ageHours) / Math.max(1, weights.freshness_tau_hours));
  // saturación en negativo: muy cubierto penaliza, hueco bonifica
  const saturation = weights.saturation * (1 - clamp01(signals.saturationCos));
  const commercial = weights.commercial * clamp01(signals.commercialFit);
  const total = Math.min(100, Math.max(0, external + fit + freshness + saturation + commercial));
  return {
    score: total,
    parts: {
      external,
      fit,
      freshness,
      saturation,
      commercial,
      external_z: signals.externalZ,
      fit_cos: signals.fitCos,
      age_hours: signals.ageHours,
      saturation_cos: signals.saturationCos,
      commercial_fit: signals.commercialFit,
      total,
    },
  };
}

export interface RefCandidate {
  url: string;
  title?: string;
  metric: number;
}

export function safeDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

// las 3–5 mejores fuentes del cluster: por señal y con diversidad de dominio
export function pickSourceRefs(
  candidates: RefCandidate[],
  max = 5,
): Array<{ url: string; title?: string; domain?: string }> {
  const sorted = [...candidates].sort((a, b) => b.metric - a.metric);
  const seen = new Set<string>();
  const preferred: Array<{ url: string; title?: string; domain?: string }> = [];
  const rest: Array<{ url: string; title?: string; domain?: string }> = [];
  for (const c of sorted) {
    const domain = safeDomain(c.url);
    const ref = { url: c.url, ...(c.title ? { title: c.title } : {}), ...(domain ? { domain } : {}) };
    if (domain && !seen.has(domain)) {
      seen.add(domain);
      preferred.push(ref);
    } else {
      rest.push(ref);
    }
  }
  return [...preferred, ...rest].slice(0, max);
}
