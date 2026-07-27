import path from 'node:path';
import type { beats } from '@fabrica/db';
import type { Beat, BeatCandidate, BeatStatus, Fit } from '@fabrica/shared';
import { toFileUrl } from './files.js';

export type BeatRow = typeof beats.$inferSelect;

// Mecanismo de elegido (la fila beats no tiene columna chosen_ref): el
// candidato elegido se persiste reordenando `candidates` (elegido SIEMPRE en
// la posición 0) y copiando score/origen legible en chosen_score/chosen_origin
// más el fit provisional; si el candidato es de biblioteca, además asset_id.
// GET /videos/:id/timeline expone candidates[0] como elegido cuando el beat
// está locked. assets.ingest usa la misma convención al congelar master.beats.

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v', 'mkv']);

export function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase().replace('.', '');
}

export function kindFromPath(filePath: string): 'clip' | 'image' {
  return IMAGE_EXTS.has(extOf(filePath)) ? 'image' : 'clip';
}

export function isVideoExt(ext: string): boolean {
  return VIDEO_EXTS.has(ext);
}

const PROVIDER_LABELS: Record<BeatCandidate['provider'], string> = {
  library: 'Biblioteca',
  pexels: 'Pexels',
  pixabay: 'Pixabay',
  flux: 'Flux',
};

export function originLabel(candidate: BeatCandidate): string {
  // misma convención que el worker de assets: Flux no expone su ref interna
  if (candidate.provider === 'flux') return 'Generado · Flux';
  const colon = candidate.ref.indexOf(':');
  const bare = colon > 0 ? candidate.ref.slice(colon + 1) : candidate.ref;
  return `${PROVIDER_LABELS[candidate.provider]} · ${bare}`;
}

// Fit provisional a partir de los metadatos del candidato; el definitivo lo
// recalcula assets.ingest con ffprobe tras descargar el archivo.
export function provisionalFit(candidate: BeatCandidate, beatMs: number): Fit {
  const metaKind = typeof candidate.meta?.kind === 'string' ? candidate.meta.kind : null;
  const kind = metaKind ?? (candidate.provider === 'flux' ? 'image' : 'clip');
  if (kind === 'image') return { mode: 'kenburns' };
  const durationMs = Number(candidate.meta?.duration_ms ?? 0);
  if (durationMs > 0 && beatMs > 0 && durationMs >= beatMs) {
    return { mode: 'trim', offset_ms: Math.round((durationMs - beatMs) / 2) };
  }
  if (durationMs > 0 && beatMs > 0) {
    return { mode: 'loop', loops: Math.min(3, Math.ceil(beatMs / durationMs)) };
  }
  return { mode: 'trim', offset_ms: 0 };
}

// Para candidatos de biblioteca el id del asset viaja en meta.asset_id o en el
// propio ref con prefijo `library:`.
export function libraryAssetId(candidate: BeatCandidate): string | null {
  if (candidate.provider !== 'library') return null;
  const metaId = candidate.meta?.asset_id;
  if (typeof metaId === 'string' && metaId) return metaId;
  return candidate.ref.startsWith('library:') ? candidate.ref.slice('library:'.length) : candidate.ref;
}

export interface AssetFileInfo {
  path: string;
  kind: 'clip' | 'image';
}

export function beatRowToBeat(row: BeatRow, assetFile?: AssetFileInfo): Beat {
  const beat: Beat = {
    idx: row.idx,
    from_ms: row.fromMs,
    to_ms: row.toMs,
    text: row.text,
    visual_query: row.visualQuery,
    status: row.status as BeatStatus,
  };
  if (row.candidates?.length) beat.candidates = row.candidates;
  if (row.assetId && row.fit) {
    beat.asset = {
      id: row.assetId,
      fit: row.fit,
      ...(assetFile ? { path: toFileUrl(assetFile.path), kind: assetFile.kind } : {}),
    };
  }
  return beat;
}

export function beatRowToTimelineDto(row: BeatRow, assetFile?: AssetFileInfo) {
  return {
    ...beatRowToBeat(row, assetFile),
    discard_reason: row.discardReason ?? null,
    chosen_score: row.chosenScore ?? null,
    chosen_origin: row.chosenOrigin ?? null,
  };
}
