import type { ShortMasterJson } from '@fabrica/shared';
import type { BeatToken } from '../tts/beats.js';
import { buildCues } from '../tts/cues.js';
import type { Candidato } from '../shorts/director.js';

// Constructor PURO del maestro de un clip de episodio (análogo testeado de
// recortarMaster): del episodio no viaja nada más que lo que el render
// necesita. El clip es UN plano continuo del hablante — el pre-corte ffmpeg ya
// lo dejó en 1080×1920 con el encuadre que eligió el humano — así que:
//
//   - beats: las sub-ventanas del episodio re-basadas a 0, todas apuntando al
//     MISMO fichero pre-cortado con `cover` y offsets contiguos: la costura
//     entre beats es frame-exacta e invisible
//   - cues: karaoke desde los tokens del STT dentro de la ventana
//   - audio: el wav del segmento (offset 0, como el WAV del TTS)
//   - short.fuente: la atribución CONGELADA — sobrevive a purgar el episodio
//
// Sin edits (no hay claims: la única fuente de cifras admitida) y sin seo.

export interface EpisodioParaClip {
  id: string;
  channelId: string;
  sourceUrl: string;
  sourceTitle: string | null;
  sourceChannelName: string | null;
  beats: { idx: number; from_ms: number; to_ms: number; text: string }[];
}

export interface BrandParaClip {
  channel_name?: string;
  design?: NonNullable<ShortMasterJson['brand']>['design'];
  avatar_path?: string;
}

export function montarMaestroClip(params: {
  shortId: string;
  episodio: EpisodioParaClip;
  cand: Candidato;
  tokens: readonly BeatToken[];
  clipVideoPath: string;
  clipAudioPath: string;
  lufs: number;
  brand: BrandParaClip;
  /** plan de encuadre horneado en el fichero; viaja como auditoría */
  encuadrePlan?: { from_ms: number; to_ms: number; x: number | null }[];
}): ShortMasterJson {
  const { shortId, episodio, cand, tokens, clipVideoPath, clipAudioPath, lufs, brand } = params;
  const off = cand.from_ms;
  const durMs = cand.to_ms - cand.from_ms;

  // beats del episodio dentro de la ventana, re-basados y CONTIGUOS sobre el
  // clip pre-cortado (el troceo de ritmo no aplica: es el plano del hablante)
  const dentro = episodio.beats
    .filter((b) => b.from_ms >= cand.from_ms && b.to_ms <= cand.to_ms)
    .sort((a, b) => a.from_ms - b.from_ms);
  const base = dentro.length > 0 ? dentro : [{ idx: 0, from_ms: cand.from_ms, to_ms: cand.to_ms, text: cand.title }];
  const beats = base.map((b, i) => ({
    idx: i,
    from_ms: b.from_ms - off,
    to_ms: Math.min(durMs, b.to_ms - off),
    text: b.text,
    visual_query: '',
    status: 'locked' as const,
    asset: {
      id: `clip-${shortId}`,
      kind: 'clip' as const,
      path: clipVideoPath,
      encuadre: 'cover' as const,
      fit: { mode: 'trim' as const, offset_ms: b.from_ms - off },
    },
  }));
  // el último beat cierra exactamente en el final del clip
  beats[beats.length - 1]!.to_ms = durMs;

  const tokensClip = tokens
    .filter((t) => t.from_ms >= cand.from_ms && t.to_ms <= cand.to_ms)
    .map((t) => ({ ...t, from_ms: t.from_ms - off, to_ms: t.to_ms - off }));
  const cues = buildCues(tokensClip, durMs);

  return {
    version: '1',
    video: {
      id: shortId,
      episode_id: episodio.id,
      channel_id: episodio.channelId,
      fps: 30,
      width: 1080,
      height: 1920,
    },
    audio: { path: clipAudioPath, duration_ms: durMs, lufs },
    cues,
    beats,
    edits: [],
    brand: {
      ...(brand.channel_name !== undefined ? { channel_name: brand.channel_name } : {}),
      ...(brand.design !== undefined ? { design: brand.design } : {}),
      ...(brand.avatar_path !== undefined ? { avatar_path: brand.avatar_path } : {}),
    },
    short: {
      source_from_ms: cand.from_ms,
      source_to_ms: cand.to_ms,
      duration_ms: durMs,
      source_beat_idxs: cand.beat_idxs,
      title: cand.title,
      hook: cand.hook,
      reason: cand.reason,
      score: cand.score,
      fuente: {
        source_url: episodio.sourceUrl,
        source_title: episodio.sourceTitle ?? episodio.sourceUrl,
        source_channel_name: episodio.sourceChannelName ?? '',
      },
      ...(params.encuadrePlan !== undefined ? { encuadre_plan: params.encuadrePlan } : {}),
    },
  } as ShortMasterJson;
}
